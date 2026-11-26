// Owner request 2026-11-26: the shipping user can take several photos of a signed delivery permit and tick which ones
// are sent for approval. Every photo is saved; the ticked ones keep the file type SIGNED_PERMIT (the approver sees
// them and the invoice e-mail attaches them, lib/eta/signed-permits.ts), the others are kept as SIGNED_PERMIT_UNUSED.
// Sending a new set (e.g. after "sent back to shipping") also retires the photos of the earlier round.
// No new column: only the existing file_type text changes.
export const SIGNED_FILE = "SIGNED_PERMIT"
export const UNUSED_SIGNED_FILE = "SIGNED_PERMIT_UNUSED"

const isSigned = (type: unknown) => {
  const t = String(type || "").toUpperCase()
  return t === SIGNED_FILE || t === UNUSED_SIGNED_FILE
}

/** the chosen file ids from a request: null when none were sent (older screens: every upload counts), "bad" when invalid */
export function chosenFileIds(raw: unknown): number[] | null | "bad" {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return "bad"
  const ids = raw.map((v) => Number(v))
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return "bad"
  return [...new Set(ids)]
}

type Refusal = { ok: false; status: number; error: string; errorAr: string }

/** check the chosen ids belong to this permit's signed uploads; returns the ids to retire */
export async function planSignedChoice(db: any, permitId: number, ids: number[]): Promise<{ ok: true; unused: number[] } | Refusal> {
  const r = await db.from("delivery_permit_files").select("file_id, file_type").eq("permit_id", permitId)
  if (r.error) return { ok: false, status: 500, error: "Could not read the uploaded files. Nothing was changed.", errorAr: "تعذّرت قراءة الملفات المرفوعة. لم يتغيّر شيء." }
  const files = ((r.data || []) as any[]).filter((f) => isSigned(f.file_type))
  const known = new Set(files.map((f) => Number(f.file_id)))
  if (ids.some((id) => !known.has(id))) {
    return { ok: false, status: 400, error: "A chosen file does not belong to this delivery permit.", errorAr: "ملف مختار لا يخص إذن التسليم هذا." }
  }
  const chosen = new Set(ids)
  return { ok: true, unused: files.map((f) => Number(f.file_id)).filter((id) => !chosen.has(id)) }
}

/** apply the choice: the chosen ones are SIGNED_PERMIT, the rest SIGNED_PERMIT_UNUSED */
export async function applySignedChoice(db: any, permitId: number, ids: number[], unused: number[]): Promise<boolean> {
  const a = await db.from("delivery_permit_files").update({ file_type: SIGNED_FILE }).eq("permit_id", permitId).in("file_id", ids)
  const b = unused.length ? await db.from("delivery_permit_files").update({ file_type: UNUSED_SIGNED_FILE }).eq("permit_id", permitId).in("file_id", unused) : { error: null }
  return !a.error && !b.error
}

/** the files the approver sees: the sent ones only */
export const sentSignedFiles = <T extends { fileType?: string }>(files: T[] = []) =>
  files.filter((f) => String(f.fileType || "").toUpperCase() !== UNUSED_SIGNED_FILE)
