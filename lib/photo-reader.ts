// Reads one photo into JSON (PO request prices, quotation items). Google Gemini first; when Google is busy, over its
// free limit, too slow, refuses the key or answers something that is not JSON, the same photo goes to Groq's free
// photo model as a backup (owner, 2026-11-04: "google api is ... very bad, i want another free way").
// Groq is used only when GROQ_API_KEY is set in Vercel; without it nothing changes.
import { askGemini, geminiFailure, geminiJson } from "./gemini-models"

export const GROQ_MODEL = "qwen/qwen3.8-27b"
// Under the route's 60-second limit: Google gets the first part when Groq is there to take over.
const TOTAL_MS = 55_000
const GEMINI_MS_WITH_BACKUP = 30_000

export type ReadFailure = "not_setup" | "key_rejected" | "limit" | "failed" | "timeout"
export type PhotoRead<T> = { ok: true; data: T | null; via: "gemini" | "groq" } | { ok: false; kind: ReadFailure; why: string }

export interface PhotoRequest {
  tag: string
  system: string
  text: string
  image: string // base64, no data: prefix
  mediaType: string
  /** Gemini responseSchema */
  geminiSchema: unknown
  /** the JSON shape in words/example, for Groq (its JSON mode is told the shape in the prompt) */
  jsonShape: string
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")

/** The JSON text of an answer: drops a ```json fence or a <think> block a model may add around it. */
export function parseJsonText<T>(text: string): T | null {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

async function viaGemini<T>(req: PhotoRequest, apiKey: string, totalMs: number): Promise<PhotoRead<T>> {
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: req.mediaType, data: req.image } }, { text: req.text }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: req.geminiSchema,
      // Copying text out of a photo needs little reasoning; low thinking answers much faster.
      thinkingConfig: { thinkingLevel: "low" },
    },
  })
  try {
    const response = await askGemini(payload, apiKey, req.tag, totalMs)
    if (response.ok) return { ok: true, data: await geminiJson<T>(response), via: "gemini" }
    const { reason, why } = await geminiFailure(response)
    console.error(`${req.tag}: Gemini error`, response.status, reason)
    if (reason === "API_KEY_INVALID" || response.status === 401 || response.status === 403) return { ok: false, kind: "key_rejected", why }
    if (response.status === 429) return { ok: false, kind: "limit", why }
    return { ok: false, kind: "failed", why }
  } catch (error) {
    if (isTimeout(error)) return { ok: false, kind: "timeout", why: "google timeout" }
    console.error(`${req.tag}: Gemini request failed`, error)
    return { ok: false, kind: "failed", why: "google unreachable" }
  }
}

async function viaGroq<T>(req: PhotoRequest, apiKey: string, timeoutMs: number): Promise<PhotoRead<T>> {
  const base = process.env.GROQ_BASE_URL || "https://api.groq.com"
  try {
    const response = await fetch(`${base}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || GROQ_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${req.system}\n\nAnswer with JSON only, in exactly this shape:\n${req.jsonShape}` },
          {
            role: "user",
            content: [
              { type: "text", text: req.text },
              { type: "image_url", image_url: { url: `data:${req.mediaType};base64,${req.image}` } },
            ],
          },
        ],
      }),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => null)
      const why = `groq ${response.status} ${String(detail?.error?.code || "")} ${String(detail?.error?.message || "").slice(0, 200)}`.trim()
      console.error(`${req.tag}: Groq error`, response.status, detail?.error?.code)
      if (response.status === 401 || response.status === 403) return { ok: false, kind: "key_rejected", why }
      if (response.status === 429) return { ok: false, kind: "limit", why }
      return { ok: false, kind: "failed", why }
    }
    const data = await response.json().catch(() => null)
    return { ok: true, data: parseJsonText<T>(data?.choices?.[0]?.message?.content || ""), via: "groq" }
  } catch (error) {
    if (isTimeout(error)) return { ok: false, kind: "timeout", why: "groq timeout" }
    console.error(`${req.tag}: Groq request failed`, error)
    return { ok: false, kind: "failed", why: "groq unreachable" }
  }
}

/** Read the photo: Gemini, then Groq as the backup. `data` is null when the answer was not usable JSON. */
export async function readPhoto<T>(req: PhotoRequest): Promise<PhotoRead<T>> {
  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey = process.env.GROQ_API_KEY
  if (!geminiKey && !groqKey) return { ok: false, kind: "not_setup", why: "no key" }
  const start = Date.now()
  let first: PhotoRead<T> | null = null
  if (geminiKey) {
    first = await viaGemini<T>(req, geminiKey, groqKey ? GEMINI_MS_WITH_BACKUP : 50_000)
    if (!groqKey || (first.ok && first.data !== null)) return first
    console.error(`${req.tag}: Google could not read the photo (${first.ok ? "unreadable answer" : first.kind}) - trying Groq`)
  }
  const second = await viaGroq<T>(req, groqKey!, TOTAL_MS - (Date.now() - start))
  if (second.ok || !first) return second
  if (first.ok) return { ok: true, data: null, via: "gemini" } // Google answered, Groq failed: treat as unreadable
  // Both failed: "limit" wins (it tells the person to wait), otherwise Groq's reason.
  const kind = first.kind === "limit" || second.kind === "limit" ? "limit" : second.kind
  return { ok: false, kind, why: `google: ${first.why}; ${second.why}` }
}
