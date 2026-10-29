// Google's free models are sometimes "busy" (503 high demand, 429 limit per model, or no answer in time).
// Callers try these in order: GEMINI_MODEL (set in Vercel) or the main free model, then the backup free model.
const MAIN_MODEL = "gemini-3.8-flash"
const BACKUP_MODEL = "gemini-3.6-flash"

export function geminiModels(): string[] {
  return [...new Set([process.env.GEMINI_MODEL || MAIN_MODEL, BACKUP_MODEL])]
}

// Worth trying the next model: Google is overloaded or this model's free limit is used up.
export const geminiBusy = (status: number) => status === 429 || status >= 500

// Stop waiting before the server's own 60-second limit so the screen gets a clear message. The main model gets
// part of that time; if it is busy or slow, the backup model gets the rest.
const GOOGLE_TOTAL_MS = 50_000
const FIRST_MODEL_MS = 28_000

// Sends one generateContent request (payload is the JSON body), trying the backup model when the main one is busy
// or slow. Returns the last answer (ok or not); throws a TimeoutError when no model answered in time.
export async function askGemini(payload: string, apiKey: string, tag: string): Promise<Response> {
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
  const models = geminiModels()
  const deadline = Date.now() + GOOGLE_TOTAL_MS
  let response: Response | null = null
  for (const [i, model] of models.entries()) {
    const last = i === models.length - 1
    const left = deadline - Date.now()
    try {
      response = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(last ? left : Math.min(FIRST_MODEL_MS, left)),
        body: payload,
      })
    } catch (error) {
      if (last || !(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))) throw error
      console.error(`${tag}: no answer in time from`, model, "- trying the backup model")
      continue
    }
    if (response.ok || last || !geminiBusy(response.status)) break
    console.error(`${tag}:`, model, "is busy", response.status, "- trying the backup model")
  }
  if (!response) throw Object.assign(new Error("timeout"), { name: "TimeoutError" })
  return response
}

// Google's reason for a failed answer (never the key), so a failed try can be diagnosed from the screen.
export async function geminiFailure(response: Response): Promise<{ reason: string | undefined; why: string }> {
  const detail = await response.json().catch(() => null)
  const reason = detail?.error?.details?.find((d: { reason?: string }) => d?.reason)?.reason || detail?.error?.status
  return { reason, why: `${response.status} ${reason || ""} ${String(detail?.error?.message || "").slice(0, 200)}`.trim() }
}

// The JSON text of the first answer, parsed; null when Google blocked it or the text is not JSON.
export async function geminiJson<T>(response: Response): Promise<T | null> {
  const data = await response.json()
  if (data?.promptFeedback?.blockReason) return null
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p?.text || "").join("")
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
