// After a document is on the ETA portal (spec §6.5 cancel, goal 6 printout, §9 the invoice's e-invoice window):
// cancel on the portal, the portal's cancel window, the portal's own PDF, and the documents shown on an invoice.
import { EtaBusyError, EtaCredentialsError, EtaError, type EtaEnv } from "./portal"
import { plainError } from "./portal-errors"
import {
  cancelAnswerPatch, cancelPending, cancelStateOf, credsOf, etaSendDefaults, FOLLOW_UP_BUDGET_MS, LIVE_STATUSES, portalOf, storedBody,
  type EtaRefusal, type SendDeps,
} from "./send"

type Db = any

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const text = (v: unknown) => (v == null ? "" : String(v).trim())
const envOf = (r: any): EtaEnv => (r?.environment === "test" ? "test" : "real")
const refusal = (code: string, message: string, status: number, extra: Partial<EtaRefusal> = {}): EtaRefusal => ({ ok: false, code, message, status, ...extra })

/** The portal's answer as a refusal in plain words (EN / AR), the document unchanged. */
function portalRefusal(e: any): EtaRefusal {
  if (e instanceof EtaBusyError) return refusal(e.code, e.message, 429, { messageAr: plainError(e.code, undefined, "ar") })
  if (e instanceof EtaCredentialsError) return refusal(e.code, e.message, 409)
  if (e instanceof EtaError) {
    const business = e.status >= 400 && e.status < 500
    return refusal(e.code, e.message, business ? 409 : 502, business ? { messageAr: plainError(e.code, undefined, "ar") } : {})
  }
  return refusal("PortalFailed", "The ETA portal could not be reached. Try again in a minute.", 502)
}

export const CANCEL_REASON_MAX = 500

/**
 * "Cancel on portal" (spec §6.5): only a `valid` document (invoice or credit note) with its portal uuid, a reason is
 * required, and an invoice with an active credit note on the same portal is refused (the portal refuses it too). The
 * portal's refusals (OperationPeriodOver, IncorrectState, ActiveReferencingDocuments, ...) come back in plain words and
 * leave the document as it was. On success the document is `cancelled` with the note "CancelRequested": the receiver
 * may still decline it on the portal, so the follow-up re-checks it (ruling P10) until the portal confirms it.
 */
export async function cancelOnPortal(db: Db, docId: number, reason: string, deps: SendDeps = {}): Promise<{ ok: true } | EtaRefusal> {
  const now = deps.now || etaSendDefaults.now || (() => new Date())
  const why = text(reason)
  if (!why) return refusal("reason_required", "Write the reason for cancelling.", 400)
  if (why.length > CANCEL_REASON_MAX) return refusal("reason_too_long", `The reason can be at most ${CANCEL_REASON_MAX} characters.`, 400)
  if (!Number.isInteger(docId) || docId < 1) return refusal("not_found", "Document not found.", 404)
  const row = must(
    await db.from("eta_documents").select("doc_id, invoice_id, document_type, environment, status, eta_uuid").eq("doc_id", docId).maybeSingle(),
    "load document",
  )
  if (!row) return refusal("not_found", "Document not found.", 404)
  if (row.status !== "valid" || !text(row.eta_uuid)) return refusal("not_valid", "Only a document that is valid on the portal can be cancelled.", 409)
  const env = envOf(row)
  if (row.document_type !== "C") {
    const notes = must(
      await db.from("eta_documents").select("doc_id, environment, status").eq("invoice_id", row.invoice_id).eq("document_type", "C"),
      "load credit notes",
    ) as any[]
    if (notes.some((n) => envOf(n) === env && LIVE_STATUSES.includes(n.status)))
      return refusal("credit_note_active", "This invoice has a credit note on the portal (waiting, sent or valid); it can't be cancelled.", 409, {
        messageAr: plainError("ActiveReferencingDocuments", undefined, "ar"),
      })
  }
  if (!credsOf(deps)(env)) return portalRefusal(new EtaCredentialsError(env))

  try {
    await portalOf(deps, env).cancel(text(row.eta_uuid), why)
  } catch (e: any) {
    console.error(`[eta] cancel of document ${docId} failed: ${e?.code || ""} ${e?.message || e}`)
    return portalRefusal(e)
  }
  must(
    await db
      .from("eta_documents")
      .update({ status: "cancelled", errors: [requested()], checked_at: now().toISOString(), updated_at: now().toISOString() })
      .eq("doc_id", docId)
      .eq("status", "valid"),
    "save cancelled",
  )
  return { ok: true }
}

const requested = () => ({ code: "CancelRequested", message: plainError("CancelRequested", undefined, "en"), messageAr: plainError("CancelRequested", undefined, "ar") })

/**
 * True only when the portal confirms the document is cancelled (for correct-and-reissue, §6.5a). Asks the portal for a
 * cancellation it has not confirmed yet and records the answer (declined -> valid again with "CancelDeclined").
 * False for anything else, including when the portal can't be asked. Bounded by the follow-up budget (8 s).
 */
export async function confirmCancelled(db: Db, docId: number, deps: SendDeps = {}): Promise<boolean> {
  const now = deps.now || etaSendDefaults.now || (() => new Date())
  const row = must(await db.from("eta_documents").select("doc_id, environment, status, eta_uuid, errors").eq("doc_id", docId).maybeSingle(), "load document")
  if (!row || row.status !== "cancelled") return false
  if (!text(row.eta_uuid)) return false
  const env = envOf(row)
  if (!credsOf(deps)(env)) return false
  let state: ReturnType<typeof cancelStateOf>
  const budget = deps.followUpBudgetMs ?? etaSendDefaults.followUpBudgetMs ?? FOLLOW_UP_BUDGET_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const details = await Promise.race([
      portalOf(deps, env, budget).getDetails(text(row.eta_uuid)),
      new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error("out of time")), budget) }),
    ])
    state = cancelStateOf(details)
  } catch (e: any) {
    console.error(`[eta] cancellation check of ${docId} failed: ${e?.message || e}`)
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
  const patch = cancelAnswerPatch(state)
  if (patch && (patch.status || cancelPending(row)))
    must(await db.from("eta_documents").update({ ...patch, checked_at: now().toISOString(), updated_at: now().toISOString() }).eq("doc_id", docId).eq("status", "cancelled"), "save cancellation answer")
  return state === "cancelled"
}

// ---- the cancel window, from the portal's document-type settings ----

/**
 * The portal's document-type ids for GET /api/v1.0/documenttypes/{id} (verify in test: the SDK lists the types with
 * numeric ids; 1 = invoice, 2 = credit note is assumed here).
 */
export const ETA_DOCUMENT_TYPE_IDS = { I: 1, C: 2 } as const
/** A failed read is retried after this long (a success is kept for the function's lifetime). */
export const CANCEL_WINDOW_RETRY_MS = 10 * 60_000
/** The window read never holds up the invoice window longer than this. */
export const CANCEL_WINDOW_TIMEOUT_MS = 5_000

const windowCache = new Map<string, { hours: number | null; until: number }>()
export function resetCancelWindowCache() { windowCache.clear() }

/**
 * The cancel window in hours from a document-type answer: the first positive number under a property whose name
 * mentions "cancel" (days and minutes converted), searched a few levels deep (the SDK does not name the field;
 * verify in test). Null when there is none.
 */
export function windowHoursOf(docType: unknown): number | null {
  const walk = (v: any, depth: number): number | null => {
    if (!v || typeof v !== "object" || depth > 3) return null
    for (const [k, raw] of Object.entries(v)) {
      if (/cancel/i.test(k) && (typeof raw === "number" || (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())))) {
        const n = Number(raw)
        if (Number.isFinite(n) && n > 0) return /day/i.test(k) ? n * 24 : /minute/i.test(k) ? n / 60 : n
      }
    }
    for (const raw of Object.values(v)) {
      const found = walk(raw, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  return walk(docType, 0)
}

/**
 * How many hours after it was validated a document may still be cancelled on this portal, read from the portal's
 * document-type settings and cached in memory per environment (and type). Null when it can't be read: the screen then
 * shows the button and relies on the portal's answer. Never throws.
 */
export async function cancelWindowHours(env: EtaEnv, deps: SendDeps & { clock?: () => number } = {}, type: "I" | "C" = "I"): Promise<number | null> {
  const clock = deps.clock || (() => Date.now())
  const key = `${env}:${type}`
  const hit = windowCache.get(key)
  if (hit && hit.until > clock()) return hit.hours
  if (!credsOf(deps)(env)) return null
  let hours: number | null = null
  try {
    hours = windowHoursOf(await portalOf(deps, env, CANCEL_WINDOW_TIMEOUT_MS).documentType(ETA_DOCUMENT_TYPE_IDS[type]))
  } catch (e: any) {
    console.error(`[eta] cancel window (${env}) could not be read: ${e?.message || e}`)
  }
  windowCache.set(key, { hours, until: hours === null ? clock() + CANCEL_WINDOW_RETRY_MS : Number.POSITIVE_INFINITY })
  return hours
}

// ---- the portal's own printout ----

/** The portal allows one printout every 5 s. */
export const PRINTOUT_EVERY_MS = 5_000
/** A printout that would have to wait longer than this for its turn is refused ("try again") instead. */
export const PRINTOUT_MAX_WAIT_MS = 10_000

// Next free printout slot per environment. In memory: on Vercel each warm instance has its own, so two instances can
// still ask within 5 s; the portal then answers 429, which the portal client waits out (Retry-After) or reports as
// "busy, try again". Good enough for a button pressed by hand.
const printoutSlot = new Map<EtaEnv, number>()
export function resetPrintoutGuard() { printoutSlot.clear() }

export type PrintoutDeps = SendDeps & { clock?: () => number; sleep?: (ms: number) => Promise<void> }

/**
 * The portal's PDF of one of our documents (`valid` or `cancelled`, by doc_id) or of a received supplier document
 * (by received_id). 400 NotReady and the other portal answers come back in plain words.
 */
export async function portalPrintout(
  db: Db,
  which: { docId?: number; receivedId?: number },
  deps: PrintoutDeps = {},
): Promise<{ ok: true; pdf: ArrayBuffer; filename: string } | EtaRefusal> {
  const clock = deps.clock || (() => Date.now())
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let uuid = ""
  let env: EtaEnv
  let name = ""
  if (which.docId != null) {
    const row = must(
      await db.from("eta_documents").select("doc_id, document_type, environment, status, eta_uuid, document").eq("doc_id", which.docId).maybeSingle(),
      "load document",
    )
    if (!row) return refusal("not_found", "Document not found.", 404)
    if (!["valid", "cancelled"].includes(row.status) || !text(row.eta_uuid))
      return refusal("not_on_portal", "The portal printout is available for valid or cancelled documents only.", 409)
    uuid = text(row.eta_uuid)
    env = envOf(row)
    let internalId = ""
    try {
      internalId = text(JSON.parse(storedBody(row) || "{}").internalID)
    } catch {
      internalId = ""
    }
    name = `${row.document_type === "C" ? "credit-note" : "invoice"}-${internalId || uuid}`
  } else if (which.receivedId != null) {
    const row = must(
      await db.from("eta_received_documents").select("received_id, uuid, environment, internal_id").eq("received_id", which.receivedId).maybeSingle(),
      "load received document",
    )
    if (!row || !text(row.uuid)) return refusal("not_found", "Document not found.", 404)
    uuid = text(row.uuid)
    env = envOf(row)
    name = `supplier-${text(row.internal_id) || uuid}`
  } else {
    return refusal("not_found", "Document not found.", 404)
  }
  if (!credsOf(deps)(env)) return portalRefusal(new EtaCredentialsError(env))

  // one printout every 5 s per environment: take the next slot, wait for it
  const t = clock()
  const slot = Math.max(t, printoutSlot.get(env) || 0)
  if (slot - t > PRINTOUT_MAX_WAIT_MS) return refusal("TooManyRequests", plainError("TooManyRequests", undefined, "en"), 429, { messageAr: plainError("TooManyRequests", undefined, "ar") })
  printoutSlot.set(env, slot + PRINTOUT_EVERY_MS)
  if (slot > t) await sleep(slot - t)

  try {
    const pdf = await portalOf(deps, env).printout(uuid)
    return { ok: true, pdf, filename: `${name.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf` }
  } catch (e: any) {
    console.error(`[eta] printout of ${uuid} failed: ${e?.code || ""} ${e?.message || e}`)
    return portalRefusal(e)
  }
}

// ---- what the invoice window shows ----

export interface EtaDocumentView {
  doc_id: number
  document_type: "I" | "C"
  version: number
  status: string
  eta_uuid: string | null
  eta_long_id: string | null
  /** the portal's reasons in plain words */
  errors: { code: string; message: string; messageAr?: string; path?: string }[]
  submitted_at: string | null
  validated_at: string | null
  /** cancelled by us, waiting for the portal to confirm it (P10): "Cancellation requested — waiting for the portal" */
  cancel_pending: boolean
}

/** Every e-invoice document of an invoice (invoice and credit note, every version), per environment, oldest first. */
export async function invoiceDocuments(db: Db, invoiceId: number): Promise<Record<EtaEnv, EtaDocumentView[]>> {
  const rows = must(
    await db
      .from("eta_documents")
      .select("doc_id, document_type, environment, version, status, eta_uuid, eta_long_id, errors, submitted_at, validated_at")
      .eq("invoice_id", invoiceId),
    "load e-invoice documents",
  ) as any[]
  const out: Record<EtaEnv, EtaDocumentView[]> = { test: [], real: [] }
  for (const r of [...rows].sort((a, b) => Number(a.doc_id) - Number(b.doc_id))) {
    out[envOf(r)].push({
      doc_id: r.doc_id,
      document_type: r.document_type === "C" ? "C" : "I",
      version: Number(r.version) || 1,
      status: text(r.status),
      eta_uuid: text(r.eta_uuid) || null,
      eta_long_id: text(r.eta_long_id) || null,
      errors: (Array.isArray(r.errors) ? r.errors : []).map((e: any) => {
        const code = text(e?.code) || "Invalid"
        return {
          code,
          message: text(e?.message) || plainError(code, undefined, "en"),
          ...(text(e?.messageAr) ? { messageAr: text(e.messageAr) } : {}),
          ...(text(e?.path) ? { path: text(e.path) } : {}),
        }
      }),
      submitted_at: r.submitted_at || null,
      validated_at: r.validated_at || null,
      cancel_pending: cancelPending(r),
    })
  }
  return out
}
