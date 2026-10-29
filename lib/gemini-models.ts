// Google's free models are sometimes "busy" (503 high demand, 429 limit per model, or no answer in time).
// Callers try these in order: GEMINI_MODEL (set in Vercel) or the main free model, then the backup free model.
const MAIN_MODEL = "gemini-3.8-flash"
const BACKUP_MODEL = "gemini-3.6-flash"

export function geminiModels(): string[] {
  return [...new Set([process.env.GEMINI_MODEL || MAIN_MODEL, BACKUP_MODEL])]
}

// Worth trying the next model: Google is overloaded or this model's free limit is used up.
export const geminiBusy = (status: number) => status === 429 || status >= 500
