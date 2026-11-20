// The AI services every AI feature uses (owner, 2026-11-21: "remove the gemini api ... use the claude api ... and use
// the grok one as a backup for all AI needed operations"). Claude answers first; when Claude has no key, is busy,
// refuses the key or is too slow, the backup answers instead.
// Backup: an xAI key (starts with "xai-") uses Grok; any other key in grokAPI / GROQ_API_KEY uses Groq as before.

export const CLAUDE_MODEL = "claude-sonnet-5-5"
export const GROK_MODEL = "grok-4.3"
export const GROQ_MODEL = "qwen/qwen3.8-27b"

export const claudeKey = () => process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ""

export interface Backup {
  name: "grok" | "groq"
  url: string
  key: string
  model: string
}

/** The backup service, or null when no backup key is set in Vercel. */
export function backup(): Backup | null {
  const xai = process.env.XAI_API_KEY || [process.env.grokAPI, process.env.GROQ_API_KEY].find((k) => k?.startsWith("xai-"))
  if (xai) {
    return { name: "grok", url: `${process.env.XAI_BASE_URL || "https://api.x.ai"}/v1/chat/completions`, key: xai, model: process.env.XAI_MODEL || GROK_MODEL }
  }
  const groq = process.env.GROQ_API_KEY || process.env.grokAPI
  if (groq) {
    return { name: "groq", url: `${process.env.GROQ_BASE_URL || "https://api.groq.com"}/openai/v1/chat/completions`, key: groq, model: process.env.GROQ_MODEL || GROQ_MODEL }
  }
  return null
}

/** At least one AI service has a key. */
export const aiReady = () => Boolean(claudeKey() || backup())

export const NOT_SETUP_MESSAGE = "AI is not set up yet (add CLAUDE_API_KEY in Vercel; grokAPI is the backup)"

export type AiFailure = "not_setup" | "key_rejected" | "limit" | "failed" | "timeout"

export const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")

export function failureKind(status: number): AiFailure {
  if (status === 401 || status === 403) return "key_rejected"
  if (status === 429) return "limit"
  return "failed"
}

/** One Claude Messages request. `body` has everything except the model and max_tokens defaults. */
export function askClaude(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": claudeKey(), "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || CLAUDE_MODEL, max_tokens: 4096, ...body }),
  })
}

/** One chat-completions request to the backup (Grok and Groq share the same format). */
export function askBackup(b: Backup, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return fetch(b.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.key}` },
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    body: JSON.stringify({ model: b.model, ...body }),
  })
}

/** The service's reason for a failed answer (never the key), for the logs and the screen's diagnosis line. */
export async function failureWhy(service: string, response: Response): Promise<string> {
  const detail = await response.json().catch(() => null)
  const error = detail?.error
  const type = typeof error === "string" ? "" : String(error?.type || error?.code || "")
  const message = typeof error === "string" ? error : String(error?.message || "")
  return `${service} ${response.status} ${type} ${message.slice(0, 200)}`.replace(/\s+/g, " ").trim()
}

/** The text blocks of a Claude answer joined together. */
export const claudeText = (data: any): string =>
  (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => String(b.text || ""))
    .join("")
    .trim()

/** The JSON in a model's text: drops a ```json fence or a <think> block a model may add around it. */
export function parseJsonText<T>(text: string): T | null {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }
}

/** Plain text answer: Claude, then the backup. Throws when neither answered. */
export async function generateText({ system, prompt, timeoutMs = 55_000 }: { system?: string; prompt: string; timeoutMs?: number }): Promise<{ text: string; via: string }> {
  const b = backup()
  if (!claudeKey() && !b) throw new Error(NOT_SETUP_MESSAGE)
  const start = Date.now()
  let why = ""
  if (claudeKey()) {
    try {
      const response = await askClaude({ ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] }, b ? Math.round(timeoutMs * 0.55) : timeoutMs)
      if (response.ok) {
        const text = claudeText(await response.json())
        if (text) return { text, via: "claude" }
        why = "claude empty answer"
      } else why = await failureWhy("claude", response)
    } catch (error) {
      why = isTimeout(error) ? "claude timeout" : "claude unreachable"
    }
    console.error("AI text: Claude did not answer -", why, b ? "- trying the backup" : "")
  }
  if (!b) throw new Error(why)
  const response = await askBackup(
    b,
    { temperature: 0.4, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] },
    timeoutMs - (Date.now() - start),
  )
  if (!response.ok) throw new Error(`${why}; ${await failureWhy(b.name, response)}`)
  const data = await response.json()
  const text = String(data?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()
  return { text, via: b.name }
}
