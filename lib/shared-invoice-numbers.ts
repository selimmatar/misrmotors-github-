// One invoice number sequence for sales invoices (made in the system) and maintenance invoices (pre-printed carbon
// booklet, photo upload). Owner, 2026-11-21. Table and lock: scripts/sql/2026-11-21-shared-invoice-numbers.sql.
// Until the accountant sets the starting number (company_settings.shared_invoice_start) the old INV/MINV numbering stays.

type Db = any

export const START_KEY = "shared_invoice_start"
export type SlotKind = "sales" | "maintenance"
export type SlotStatus = "reserved" | "used" | "released"
export interface Slot {
  number: number
  kind: SlotKind
  status: SlotStatus
  link_id: number | null
  draft_id: number | null
  invoice_id: number | null
  note: string | null
  created_at: string
  updated_at: string
}

const missing = (error: any) => ["42P01", "PGRST205", "42883", "PGRST202"].includes(error?.code)
/** Plain invoice numbers only: digits, no letters (owner, 2026-11-21). */
export const isSharedNumber = (value: unknown) => /^[1-9]\d{0,14}$/.test(String(value ?? ""))

export async function loadSharedStart(db: Db): Promise<number | null> {
  try {
    const { data, error } = await db.from("company_settings").select("setting_value").eq("setting_key", START_KEY).maybeSingle()
    if (error) {
      if (missing(error)) return null
      throw new Error(`load ${START_KEY}: ${error.message}`)
    }
    const n = Number(String(data?.setting_value ?? "").trim())
    return Number.isInteger(n) && n > 0 ? n : null
  } catch (error: any) {
    if (String(error?.message || "").startsWith(`load ${START_KEY}`)) throw error
    return null
  }
}

/** The next number under one database lock. Null when the starting number is not set. */
export async function takeSharedNumber(db: Db, kind: SlotKind, linkId: number | null, reuse: boolean): Promise<number | null> {
  const { data, error } = await db.rpc("take_invoice_number", { p_kind: kind, p_link_id: linkId, p_reuse: reuse })
  // The starting number saved but scripts/sql/2026-11-21-shared-invoice-numbers.sql not applied: keep the old numbering.
  if (error && missing(error)) {
    console.error(`[shared-numbers] take_invoice_number is missing (${error.message}); using the INV/MINV numbering`)
    return null
  }
  if (error) throw new Error(`take invoice number: ${error.message}`)
  return data == null ? null : Number(data)
}

async function updateSlot(db: Db, number: number, patch: Partial<Slot>) {
  const { error } = await db
    .from("invoice_number_slots")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("number", number)
  if (error) console.error(`[shared-numbers] ${number}: ${error.message}`)
}

export const markSlotUsed = (db: Db, number: number, invoiceId: number | null) =>
  updateSlot(db, number, invoiceId ? { status: "used", invoice_id: invoiceId } : { status: "used", note: "already on an invoice" })

/** An invoice taken back right after it was made: its number goes back to the next sales invoice. */
export async function releaseSlotOfInvoice(db: Db, invoiceId: number) {
  try {
    const { error } = await db
      .from("invoice_number_slots")
      .update({ status: "released", invoice_id: null, note: "invoice taken back", updated_at: new Date().toISOString() })
      .eq("invoice_id", invoiceId)
    if (error && !missing(error)) console.error(`[shared-numbers] invoice ${invoiceId}: ${error.message}`)
  } catch {
    // no shared numbering here (old tests' fake database)
  }
}
export const releaseSlot = (db: Db, number: number, note: string) =>
  updateSlot(db, number, { status: "released", draft_id: null, invoice_id: null, note })

/** A photo rejected before its invoice was made: its number is free again (owner, 2026-11-22). */
export async function releaseSlotOfDraft(db: Db, draftId: number, note: string) {
  try {
    const { error } = await db
      .from("invoice_number_slots")
      .update({ status: "released", draft_id: null, invoice_id: null, note, updated_at: new Date().toISOString() })
      .eq("draft_id", draftId)
      .eq("status", "reserved")
    if (error && !missing(error)) console.error(`[shared-numbers] draft ${draftId}: ${error.message}`)
  } catch {
    // no shared numbering here
  }
}

// ---- Freed numbers (owner, 2026-11-22) ---------------------------------------------------------------------
// A number cancelled before its invoice was made (spoiled page, rejected photo, cancelled by the office, invoice not
// created) is free again: the next maintenance number is the lowest freed one, then the sequence goes on. A number that
// was on a made invoice is never handed to a worker again ("invoice taken back" keeps its old sales-only rule).
export const TAKEN_BACK_NOTE = "invoice taken back"
const FREED_SCAN = 50

/** Freed numbers a worker may get, lowest first. Numbers on any invoice (also a cancelled "X<id>-<n>") are left out. */
export async function freedSharedNumbers(db: Db, start: number): Promise<number[]> {
  const { data, error } = await db
    .from("invoice_number_slots")
    .select("number, note")
    .eq("status", "released")
    .gte("number", start)
    .order("number")
    .limit(FREED_SCAN)
  if (error) {
    if (missing(error)) return []
    throw new Error(`load freed numbers: ${error.message}`)
  }
  const candidates = ((data || []) as Slot[]).filter((s) => s.note !== TAKEN_BACK_NOTE).map((s) => Number(s.number))
  if (!candidates.length) return []
  const texts = candidates.map(String)
  const [live, cancelled] = await Promise.all([
    db.from("accounts_receivable").select("invoice_number").in("invoice_number", texts),
    // cancelled_number comes with the MINV cancel script; without it a cancelled invoice keeps its slot "used" anyway
    db.from("accounts_receivable").select("cancelled_number").in("cancelled_number", texts),
  ])
  if (live.error) throw new Error(`load freed numbers: ${live.error.message}`)
  const used = new Set<string>([
    ...(live.data || []).map((r: any) => String(r.invoice_number)),
    ...(cancelled.error ? [] : (cancelled.data || []).map((r: any) => String(r.cancelled_number))),
  ])
  return candidates.filter((n) => !used.has(String(n)))
}

/**
 * The worker's number: his open reservation, else the lowest freed number, else the next new one, all under the same
 * database lock as takeSharedNumber (take_maintenance_number, scripts/sql/2026-11-22-worker-sent-list.sql). Until that
 * script is applied, a freed number is claimed with a guarded update (status must still be "released"), so two workers
 * can never both get it, and the next new number still comes from take_invoice_number.
 */
export async function takeWorkerNumber(db: Db, linkId: number): Promise<number | null> {
  const { data, error } = await db.rpc("take_maintenance_number", { p_link_id: linkId })
  if (!error) return data == null ? null : Number(data)
  if (!missing(error)) throw new Error(`take invoice number: ${error.message}`)

  const start = await loadSharedStart(db)
  if (!start) return null
  if (await workerHoldsNumber(db, linkId)) return takeSharedNumber(db, "maintenance", linkId, false)
  for (const number of await freedSharedNumbers(db, start)) {
    const { data: claimed } = await db
      .from("invoice_number_slots")
      .update({ kind: "maintenance", status: "reserved", link_id: linkId, draft_id: null, invoice_id: null, note: "reused", updated_at: new Date().toISOString() })
      .eq("number", number)
      .eq("status", "released")
      .select("number")
    if (claimed?.length) return number
  }
  return takeSharedNumber(db, "maintenance", linkId, false)
}

/** The number the next worker would get now (shown to the office): the lowest freed one, else the next new one. */
export async function nextSharedNumber(db: Db, start: number, highestExisting: number | null): Promise<number> {
  const freed = await freedSharedNumbers(db, start)
  if (freed.length) return freed[0]
  const { data } = await db.from("invoice_number_slots").select("number").order("number", { ascending: false }).limit(1)
  const top = Number(data?.[0]?.number) || 0
  return Math.max(start, top + 1, (highestExisting ?? 0) + 1)
}

/**
 * A number typed by hand on a sales invoice, while the shared sequence is on: refused when a worker holds it or it is
 * on an invoice; otherwise recorded as a sales number once the invoice exists.
 */
export async function manualNumberHolder(db: Db, number: string): Promise<Slot | null> {
  if (!isSharedNumber(number)) return null
  const { data } = await db.from("invoice_number_slots").select("*").eq("number", Number(number)).maybeSingle()
  return data && data.status !== "released" ? (data as Slot) : null
}
export async function recordManualNumber(db: Db, number: string, kind: SlotKind, invoiceId: number) {
  if (!isSharedNumber(number)) return
  const { error } = await db
    .from("invoice_number_slots")
    .upsert({ number: Number(number), kind, status: "used", invoice_id: invoiceId, note: "typed", updated_at: new Date().toISOString() })
  if (error && !missing(error)) console.error(`[shared-numbers] typed ${number}: ${error.message}`)
}

// ---- The worker's screen ---------------------------------------------------------------------------------

export interface WorkerNumberState {
  enabled: boolean
  /** The number he holds and has not photographed yet. */
  reserved: number | null
  /** Pages before his number that the office used: he crosses them out and writes ملغاة. */
  crossOut: number[]
  /** A number he cancelled today that nobody took since: he may take it back. */
  undoable: number | null
}

const MAX_CROSS_OUT = 30

export async function workerNumberState(db: Db, linkId: number): Promise<WorkerNumberState> {
  const start = await loadSharedStart(db)
  if (!start) return { enabled: false, reserved: null, crossOut: [], undoable: null }
  const { data: mine, error } = await db
    .from("invoice_number_slots")
    .select("number, status, draft_id, note, updated_at")
    .eq("link_id", linkId)
    .eq("kind", "maintenance")
    .order("number", { ascending: false })
    .limit(20)
  if (error) throw new Error(`load numbers: ${error.message}`)
  const rows = (mine || []) as Slot[]
  const reserved = rows.find((r) => r.status === "reserved" && r.draft_id == null)?.number ?? null
  const todayStart = new Date(new Date().toISOString().slice(0, 10)).getTime()
  const undoable =
    reserved == null
      ? rows.find((r) => r.status === "released" && r.note === "spoiled" && new Date(r.updated_at).getTime() >= todayStart)?.number ?? null
      : null
  return { enabled: true, reserved: Number(reserved) || null, crossOut: reserved ? await crossOutBefore(db, Number(reserved)) : [], undoable: Number(undoable) || null }
}

/** Sales numbers between the last maintenance page before `number` and `number`. */
async function crossOutBefore(db: Db, number: number): Promise<number[]> {
  const { data: prev } = await db
    .from("invoice_number_slots")
    .select("number")
    .eq("kind", "maintenance")
    .lt("number", number)
    .order("number", { ascending: false })
    .limit(1)
  const from = Number(prev?.[0]?.number) || 0
  const { data } = await db
    .from("invoice_number_slots")
    .select("number")
    .eq("kind", "sales")
    .gt("number", from)
    .lt("number", number)
    .order("number")
    .limit(MAX_CROSS_OUT)
  return (data || []).map((r: any) => Number(r.number))
}

export type WorkerAction = "take" | "cancel" | "undo"

export async function workerNumberAction(db: Db, linkId: number, action: WorkerAction): Promise<{ ok: true } | { ok: false; code: string }> {
  const state = await workerNumberState(db, linkId)
  if (!state.enabled) return { ok: false, code: "off" }
  if (action === "take") {
    await takeWorkerNumber(db, linkId)
    return { ok: true }
  }
  if (action === "cancel") {
    if (!state.reserved) return { ok: false, code: "none" }
    const { data } = await db
      .from("invoice_number_slots")
      .update({ status: "released", note: "spoiled", updated_at: new Date().toISOString() })
      .eq("number", state.reserved)
      .eq("link_id", linkId)
      .eq("status", "reserved")
      .is("draft_id", null)
      .select("number")
    return data?.length ? { ok: true } : { ok: false, code: "none" }
  }
  if (!state.undoable) return { ok: false, code: "taken" }
  const { data } = await db
    .from("invoice_number_slots")
    .update({ status: "reserved", note: null, updated_at: new Date().toISOString() })
    .eq("number", state.undoable)
    .eq("link_id", linkId)
    .eq("status", "released")
    .eq("note", "spoiled")
    .select("number")
  return data?.length ? { ok: true } : { ok: false, code: "taken" }
}

/** The worker's held number for a new photo, linked to the draft. Null when he holds none. */
export async function attachPhotoToReservation(db: Db, linkId: number, draftId: number): Promise<number | null> {
  const { data: held } = await db
    .from("invoice_number_slots")
    .select("number")
    .eq("link_id", linkId)
    .eq("kind", "maintenance")
    .eq("status", "reserved")
    .is("draft_id", null)
    .order("number")
    .limit(1)
  const number = Number(held?.[0]?.number) || null
  if (!number) return null
  const { data } = await db
    .from("invoice_number_slots")
    .update({ draft_id: draftId, updated_at: new Date().toISOString() })
    .eq("number", number)
    .is("draft_id", null)
    .select("number")
  return data?.length ? number : null
}

/** The worker holds a number: true when the shared sequence is on and he has one without a photo. */
export async function workerHoldsNumber(db: Db, linkId: number): Promise<boolean> {
  const { data } = await db
    .from("invoice_number_slots")
    .select("number")
    .eq("link_id", linkId)
    .eq("kind", "maintenance")
    .eq("status", "reserved")
    .is("draft_id", null)
    .limit(1)
  return (data || []).length > 0
}

// ---- The accountant's panel ------------------------------------------------------------------------------

export interface OfficeNumbersView {
  start: number | null
  /** Highest plain invoice number already in the system, as a hint for the starting number. */
  highestExisting: number | null
  recent: Array<Slot & { worker_name: string | null }>
  /** Maintenance numbers held since before today without a photo. */
  overdue: number[]
  /** The number the next worker gets: the lowest freed one first (2026-11-22). Null while the sequence is off. */
  nextNumber: number | null
}

export async function officeNumbersView(db: Db): Promise<OfficeNumbersView> {
  const start = await loadSharedStart(db)
  const { data: ar } = await db
    .from("accounts_receivable")
    .select("invoice_number")
    .filter("invoice_number", "match", "^[0-9]{1,15}$")
    .order("invoice_id", { ascending: false })
    .limit(1000)
  const plain = (ar || []).map((r: any) => String(r.invoice_number)).filter(isSharedNumber).map(Number)
  const highestExisting = plain.length ? Math.max(...plain) : null
  if (!start) return { start, highestExisting, recent: [], overdue: [], nextNumber: null }

  const { data: slots, error } = await db.from("invoice_number_slots").select("*").order("number", { ascending: false }).limit(40)
  if (error) throw new Error(`load numbers: ${error.message}`)
  const { data: links } = await db.from("maintenance_upload_links").select("id, worker_name")
  const names = new Map<number, string>((links || []).map((l: any) => [Number(l.id), String(l.worker_name)]))
  const recent = ((slots || []) as Slot[]).map((s) => ({ ...s, number: Number(s.number), worker_name: s.link_id ? names.get(Number(s.link_id)) ?? null : null }))
  const todayStart = new Date(new Date().toISOString().slice(0, 10)).getTime()
  const overdue = recent
    .filter((s) => s.kind === "maintenance" && s.status === "reserved" && s.draft_id == null && new Date(s.created_at).getTime() < todayStart)
    .map((s) => s.number)
  const nextNumber = await nextSharedNumber(db, start, highestExisting).catch((error: any) => {
    console.error("[shared-numbers] next number:", error?.message || error)
    return null
  })
  return { start, highestExisting, recent, overdue, nextNumber }
}

export async function setSharedStart(db: Db, start: number, userId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(start) || start <= 0 || start > 999_999_999_999) return { ok: false, error: "Enter a whole number above 0" }
  const current = await loadSharedStart(db)
  if (current) {
    const { count } = await db.from("invoice_number_slots").select("number", { count: "exact", head: true })
    if ((count ?? 0) > 0) return { ok: false, error: "Numbers were already handed out; the starting number can no longer change" }
  }
  const { error } = await db
    .from("company_settings")
    .upsert({ setting_key: START_KEY, setting_value: String(start), updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "setting_key" })
  if (error) return { ok: false, error: `Could not save: ${error.message}` }
  return { ok: true }
}

/** The office cancels a number a worker held and never photographed (spoiled or forgotten). */
export async function officeReleaseReservation(db: Db, number: number): Promise<boolean> {
  const { data } = await db
    .from("invoice_number_slots")
    .update({ status: "released", note: "cancelled by office", updated_at: new Date().toISOString() })
    .eq("number", number)
    .eq("kind", "maintenance")
    .eq("status", "reserved")
    .is("draft_id", null)
    .select("number")
  return (data || []).length > 0
}
