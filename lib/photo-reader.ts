// Reads one photo into JSON (PO request prices, quotation items, worker maintenance invoices). Claude first; when
// Claude is busy, over its limit, too slow, refuses the key or answers something that is not JSON, the same photo
// goes to the backup (Grok or Groq, lib/ai-providers.ts).
import { askBackup, askClaude, backup, claudeKey, claudeText, failureKind, failureWhy, isTimeout, parseJsonText, type AiFailure, type Backup } from "./ai-providers"

export { parseJsonText } from "./ai-providers"

/** True when some service can read photos (Claude or the backup has a key). */
export const photoReaderReady = () => Boolean(claudeKey() || backup())

// Under the route's 60-second limit: Claude gets the first part when the backup is there to take over.
const TOTAL_MS = 55_000
const CLAUDE_MS_WITH_BACKUP = 30_000
// Claude reads these photo types; anything else goes straight to the backup.
const CLAUDE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]

export type ReadFailure = AiFailure
export type PhotoRead<T> = { ok: true; data: T | null; via: "claude" | "grok" | "groq" } | { ok: false; kind: ReadFailure; why: string }

export interface PhotoRequest {
  tag: string
  system: string
  text: string
  image: string // base64, no data: prefix
  mediaType: string
  /** the JSON shape in words/example; every reader is told to answer in exactly this shape */
  jsonShape: string
  /** Time for Claude when there is no backup. Background readings (worker photos) can wait longer than a screen. */
  claudeMs?: number
}

const systemWithShape = (req: PhotoRequest) => `${req.system}\n\nAnswer with JSON only, no other text, in exactly this shape:\n${req.jsonShape}`

async function viaClaude<T>(req: PhotoRequest, timeoutMs: number): Promise<PhotoRead<T>> {
  if (!CLAUDE_TYPES.includes(req.mediaType)) return { ok: false, kind: "failed", why: `claude cannot read ${req.mediaType}` }
  try {
    const response = await askClaude(
      {
        system: systemWithShape(req),
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: req.mediaType, data: req.image } },
              { type: "text", text: req.text },
            ],
          },
        ],
      },
      timeoutMs,
    )
    if (!response.ok) {
      const why = await failureWhy("claude", response)
      console.error(`${req.tag}: Claude error`, why)
      return { ok: false, kind: failureKind(response.status), why }
    }
    return { ok: true, data: parseJsonText<T>(claudeText(await response.json())), via: "claude" }
  } catch (error) {
    if (isTimeout(error)) return { ok: false, kind: "timeout", why: "claude timeout" }
    console.error(`${req.tag}: Claude request failed`, error)
    return { ok: false, kind: "failed", why: "claude unreachable" }
  }
}

async function viaBackup<T>(req: PhotoRequest, b: Backup, timeoutMs: number): Promise<PhotoRead<T>> {
  try {
    const response = await askBackup(
      b,
      {
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemWithShape(req) },
          {
            role: "user",
            content: [
              { type: "text", text: req.text },
              { type: "image_url", image_url: { url: `data:${req.mediaType};base64,${req.image}` } },
            ],
          },
        ],
      },
      timeoutMs,
    )
    if (!response.ok) {
      const why = await failureWhy(b.name, response)
      console.error(`${req.tag}: ${b.name} error`, why)
      return { ok: false, kind: failureKind(response.status), why }
    }
    const data = await response.json().catch(() => null)
    return { ok: true, data: parseJsonText<T>(data?.choices?.[0]?.message?.content || ""), via: b.name }
  } catch (error) {
    if (isTimeout(error)) return { ok: false, kind: "timeout", why: `${b.name} timeout` }
    console.error(`${req.tag}: ${b.name} request failed`, error)
    return { ok: false, kind: "failed", why: `${b.name} unreachable` }
  }
}

/** Read the photo: Claude, then the backup. `data` is null when the answer was not usable JSON. */
export async function readPhoto<T>(req: PhotoRequest): Promise<PhotoRead<T>> {
  const b = backup()
  if (!claudeKey() && !b) return { ok: false, kind: "not_setup", why: "no key" }
  const start = Date.now()
  let first: PhotoRead<T> | null = null
  if (claudeKey()) {
    first = await viaClaude<T>(req, b ? CLAUDE_MS_WITH_BACKUP : req.claudeMs ?? 50_000)
    if (!b || (first.ok && first.data !== null)) return first
    console.error(`${req.tag}: Claude could not read the photo (${first.ok ? "unreadable answer" : first.kind}) - trying ${b.name}`)
  }
  const second = await viaBackup<T>(req, b!, TOTAL_MS - (Date.now() - start))
  if (second.ok || !first) return second
  if (first.ok) return { ok: true, data: null, via: "claude" } // Claude answered, the backup failed: treat as unreadable
  // Both failed: "limit" wins (it tells the person to wait), otherwise the backup's reason.
  const kind = first.kind === "limit" || second.kind === "limit" ? "limit" : second.kind
  return { ok: false, kind, why: `${first.why}; ${second.why}` }
}
