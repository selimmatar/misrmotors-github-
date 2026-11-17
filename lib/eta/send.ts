// Sending to the ETA portal (spec §6.1): the send queue, the signer's hand-out and hand-back, the portal submission and
// the follow-up. Never sends a document twice: a row leaves `pending_signature` once (a guarded update claims it before
// the portal is called), and nothing here ever submits a row that is already `submitted`.
import { buildEtaPreview, type EtaPreview } from "./preview"
import { buildCreditNoteDocument, buildInvoiceDocument } from "./document"
import { canonicalize, toEtaJson } from "./serialize"
import { readEtaSettings } from "./store"
import { checkSignature } from "./cms"
import { createPortal, credentialsSet, resetPortalTokens, EtaBusyError, EtaCredentialsError, EtaError, REQUEST_TIMEOUT_MS, type EtaEnv, type EtaPortal, type FetchFn } from "./portal"
import { plainError } from "./portal-errors"
import { rememberPortalLines, SEARCH_GAP_MS } from "./learn"

export { ETA_LIVE_MESSAGE, clearRemovableDocuments, liveRealDocument } from "./live"

type Db = any

/** At most this many documents per signer delivery and per portal submission (spec §6.1). */
export const SIGNER_BATCH = 20
/** A submission is checked on the portal at most once in this time. */
export const FOLLOW_UP_EVERY_MS = 30_000
/** Submissions checked per follow-up run (keeps each request short and inside the portal's rate limits). */
export const FOLLOW_UP_MAX_SUBMISSIONS = 5

/** A document that is waiting to be signed, sent or valid on its portal (an "active" one). */
export const LIVE_STATUSES = ["pending_signature", "submitted", "valid"]

export interface EtaDocError {
  code: string
  message: string
  messageAr?: string
  path?: string
  step?: string
}

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const text = (v: unknown) => (v == null ? "" : String(v).trim())
const known = (code: string, details?: Partial<EtaDocError>): EtaDocError => ({
  code,
  message: plainError(code, undefined, "en"),
  messageAr: plainError(code, undefined, "ar"),
  ...details,
})

/** The portal the settings point at; unset counts as the test portal (as the settings screen shows it). */
export function etaEnvironment(settings: Record<string, string>): EtaEnv {
  return settings.eta_environment === "real" ? "real" : "test"
}

/** The exact body text stored for a row (P5: jsonb string), or null. */
export function storedBody(row: { document?: unknown }): string | null {
  return typeof row?.document === "string" && row.document.startsWith("{") ? row.document : null
}

function parsedBody(row: { document?: unknown }): any | null {
  const body = storedBody(row)
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/** Why an invoice can't go to the given portal now (empty when it can), from its preview. */
function previewReasons(preview: EtaPreview, env: EtaEnv): string[] {
  const reasons: string[] = [...preview.missing]
  if (env === "real" && preview.handledManually) reasons.push("handled_manually")
  // the preview skips the amount check for handled-manually invoices; a test send still must bill what the ERP billed
  if (env === "test" && !reasons.includes("amount_mismatch") && Math.abs(preview.totals.total - preview.storedAmount) > 0.005) reasons.push("amount_mismatch")
  return reasons
}

/** P6: the invoice's creation time, never in the future. */
function issueTime(createdAt: unknown, now: Date): string | null {
  const ms = Date.parse(text(createdAt))
  if (!text(createdAt) || !Number.isFinite(ms)) return null
  return new Date(Math.min(ms, now.getTime())).toISOString()
}

export interface QueueRefusal {
  invoiceId: number
  reasons: string[]
  /** plain words for the new portal-check reasons (EN / AR) */
  message?: string
  messageAr?: string
  /** pressing Send again later may succeed (the portal could not be asked, or this request ran out of time) */
  retryable?: boolean
  /** already_on_portal: the portal ID of the hand-typed document */
  etaUuid?: string
}
export interface QueueResult {
  queued: number[]
  refused: QueueRefusal[]
}

/** The portal checks of one Send request stop starting after this long; the rest is refused "press Send again". */
export const PORTAL_CHECK_BUDGET_MS = 20_000
const DAY_MS = 86_400_000
/** the portal's search covers at most about 30 days per call */
const SEARCH_WINDOW_MS = 29 * DAY_MS

export const PORTAL_CHECK_MESSAGES = {
  already_on_portal: {
    message: "This invoice is already on the portal (entered by hand). It was marked so and not sent again.",
    messageAr: "هذه الفاتورة موجودة بالفعل على البوابة (أُدخلت يدويًا). تم تعليمها بذلك ولم تُرسل مرة أخرى.",
  },
  portal_check_failed: {
    message: "The tax portal could not be checked for this invoice, so it was not sent. Press Send again in a minute.",
    messageAr: "تعذّر التحقق من البوابة الضريبية لهذه الفاتورة، لذلك لم تُرسل. اضغط إرسال مرة أخرى بعد دقيقة.",
  },
  portal_check_later: {
    message: "Still checking the portal for this invoice. Press Send again to continue.",
    messageAr: "ما زال التحقق من البوابة جاريًا لهذه الفاتورة. اضغط إرسال مرة أخرى للمتابعة.",
  },
} as const

class CheckOutOfTime extends Error {}

/** The search windows (each at most ~30 days) that cover the invoice's creation time and today. */
export function portalSearchWindows(createdAt: unknown, now: Date): { from: string; to: string }[] {
  const nowMs = now.getTime()
  const end = nowMs + 3600_000
  const created = Date.parse(text(createdAt))
  const start = Number.isFinite(created) ? Math.min(created, nowMs) - DAY_MS : nowMs - SEARCH_WINDOW_MS
  const out: { from: number; to: number }[] = [{ from: start, to: Math.min(start + SEARCH_WINDOW_MS, end) }]
  if (out[0].to < end) out.push({ from: Math.max(out[0].to, end - SEARCH_WINDOW_MS), to: end })
  return out.map((w) => ({ from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() }))
}

/** A search result that is our own invoice with this internal number, valid or still being validated. */
function onPortal(x: any, internalId: string, rin: string): boolean {
  if (text(x?.internalId ?? x?.internalID) !== internalId || !text(x?.uuid)) return false
  const issuer = text(x?.issuerId ?? x?.issuerID)
  if (issuer && rin && issuer !== rin) return false
  const t = searchType(x)
  if (t && t !== "i") return false
  return ["valid", "submitted"].includes(text(x?.status).toLowerCase())
}

/**
 * "Send to portal": builds each invoice's document from its preview and puts it in the waiting-to-be-signed list.
 * Refused: anything missing, amount mismatch, handled manually (real portal only), or a document already live.
 */
export async function queueSend(db: Db, invoiceIds: number[], env: EtaEnv, userId: number | null, deps: SendDeps = {}): Promise<QueueResult> {
  const d = { ...etaSendDefaults, ...deps }
  const now = d.now || (() => new Date())
  const out: QueueResult = { queued: [], refused: [] }
  const settings = await readEtaSettings(db)

  // the real portal is asked before every send whether the invoice is already there (typed by hand), within a time budget
  const clock = d.clock || (() => Date.now())
  const sleep = d.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const started = clock()
  const budget = d.portalCheckBudgetMs ?? PORTAL_CHECK_BUDGET_MS
  let searched = false
  let portal: EtaPortal | null = null
  const call = async <T>(fn: (p: EtaPortal) => Promise<T>): Promise<T> => {
    const left = budget - (clock() - started)
    if (left <= 0) throw new CheckOutOfTime()
    if (!portal) portal = portalOf(d, env, Math.min(left, REQUEST_TIMEOUT_MS))
    const p = portal
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([fn(p), new Promise<T>((_r, reject) => { timer = setTimeout(() => reject(new CheckOutOfTime()), left) })])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  /** the portal's own valid / submitted document with this internal number, or null; throws when it can't be asked */
  const findOnPortal = async (internalId: string, createdAt: unknown): Promise<any | null> => {
    if (!credsOf(d)(env)) throw new EtaCredentialsError(env)
    for (const w of portalSearchWindows(createdAt, now())) {
      // the portal allows about one search every 2 s
      if (searched) {
        if (clock() - started + SEARCH_GAP_MS >= budget) throw new CheckOutOfTime()
        await sleep(SEARCH_GAP_MS)
      }
      searched = true
      const res: any = await call((p) => p.searchSent({ internalId, ...w }))
      const hit = (Array.isArray(res?.result) ? res.result : []).find((x: any) => onPortal(x, internalId, text(settings.eta_rin)))
      if (hit) return hit
    }
    return null
  }

  for (const invoiceId of [...new Set(invoiceIds)]) {
    const refuse = (...reasons: string[]) => out.refused.push({ invoiceId, reasons })
    const refuseCheck = (reason: keyof typeof PORTAL_CHECK_MESSAGES, extra: Partial<QueueRefusal> = {}) =>
      out.refused.push({ invoiceId, reasons: [reason], ...PORTAL_CHECK_MESSAGES[reason], ...extra })
    if (!Number.isInteger(invoiceId) || invoiceId < 1) { refuse("not_found"); continue }
    const invoice = must(await db.from("accounts_receivable").select("invoice_id, invoice_number, created_at").eq("invoice_id", invoiceId).maybeSingle(), "load invoice")
    const preview = invoice ? await buildEtaPreview(db, invoiceId) : null
    if (!invoice || !preview) { refuse("not_found"); continue }

    const rows = must(await db.from("eta_documents").select("doc_id, document_type, environment, version, status").eq("invoice_id", invoiceId), "load e-invoice documents") as any[]
    const mine = rows.filter((r) => (r.environment || "real") === env)
    if (mine.some((r) => LIVE_STATUSES.includes(r.status) && (r.document_type === "I" || env === "real"))) { refuse("already_live"); continue }
    // a cancelled / rejected real document or a credit note is final: correct and reissue instead (spec §6.5a)
    if (env === "real" && mine.some((r) => r.document_type === "C" || (r.document_type === "I" && ["cancelled", "rejected"].includes(r.status)))) { refuse("final"); continue }

    if (env === "real" && !preview.handledManually) {
      // never send blind: an invoice the accountant already typed on the portal is marked, not sent a second time
      const internalId = text(invoice.invoice_number) || preview.invoiceNumber
      let found: any
      try {
        found = await findOnPortal(internalId, invoice.created_at)
      } catch (e: any) {
        if (e instanceof CheckOutOfTime) { refuseCheck("portal_check_later", { retryable: true }); continue }
        console.error(`[eta] portal check of invoice ${invoiceId} failed: ${e?.code || ""} ${e?.message || e}`)
        refuseCheck("portal_check_failed", { retryable: true })
        continue
      }
      if (found) {
        const uuid = text(found.uuid)
        const at = now().toISOString()
        const version = Math.max(0, ...mine.filter((r) => r.document_type === "I").map((r) => Number(r.version) || 0)) + 1
        const { error } = await db.from("eta_documents").insert({
          invoice_id: invoiceId, document_type: "I", environment: "real", version, status: "manual", eta_uuid: uuid || null,
          eta_long_id: text(found.longId) || null, created_by: userId, created_at: at, updated_at: at,
        })
        if (error && error.code !== "23505") throw new Error(`mark the invoice as already on the portal: ${error.message || error}`)
        refuseCheck("already_on_portal", { etaUuid: uuid })
        // the accountant's codes on that document teach the memory (a differing learned row is replaced; confirmed rows stay)
        try {
          await rememberPortalLines(db, await call((p) => p.getDetails(uuid)), userId)
        } catch (e: any) {
          console.error(`[eta] reading the codes of portal document ${uuid} failed: ${e?.message || e}`)
        }
        continue
      }
    }

    const reasons = previewReasons(preview, env)
    if (reasons.length) { refuse(...reasons); continue }
    const issuedAt = issueTime(invoice.created_at, now())
    if (!issuedAt) { refuse("no_issue_date"); continue }

    let body: string
    let canonical: string
    let doc
    try {
      doc = buildInvoiceDocument(preview, settings, issuedAt)
      body = toEtaJson(doc)
      canonical = canonicalize(body)
    } catch (e: any) {
      refuse("build_failed")
      console.error(`[eta] could not build the document of invoice ${invoiceId}: ${e?.message || e}`)
      continue
    }
    const version = Math.max(0, ...mine.filter((r) => r.document_type === "I").map((r) => Number(r.version) || 0)) + 1
    const at = now().toISOString()
    const { error } = await db.from("eta_documents").insert({
      invoice_id: invoiceId,
      document_type: "I",
      environment: env,
      version,
      status: "pending_signature",
      document: body,
      canonical,
      lines: doc.invoiceLines,
      totals: { sales: doc.totalSalesAmount, discount: doc.totalDiscountAmount, net: doc.netAmount, vat: doc.taxTotals[0]?.amount ?? 0, total: doc.totalAmount },
      errors: null,
      created_by: userId,
      created_at: at,
      updated_at: at,
    })
    if (error?.code === "23505") { refuse("already_live"); continue }
    if (error) throw new Error(`save e-invoice document: ${error.message || error}`)
    out.queued.push(invoiceId)
  }
  return out
}

/** A request refused before anything was saved or sent: a code for the screen plus plain English (API errors). */
export interface EtaRefusal { ok: false; code: string; message: string; messageAr?: string; reasons?: string[]; /** HTTP status for the route */ status?: number }
const refusal = (code: string, message: string, extra: Partial<EtaRefusal> = {}): EtaRefusal => ({ ok: false, code, message, ...extra })

/** The totals column of a row, from its document. */
function rowTotals(doc: any) {
  return { sales: doc.totalSalesAmount, discount: doc.totalDiscountAmount, net: doc.netAmount, vat: doc.taxTotals?.[0]?.amount ?? 0, total: doc.totalAmount }
}

/**
 * "Credit note for the whole invoice" (spec §6.4): only on an invoice whose document on this portal is `valid`, and
 * only while the invoice has no active credit note (waiting, sent or valid) on this portal. The credit note repeats the
 * invoice's SENT document (the stored body text, ruling P5) - never the invoice as it is now - with documentType "c",
 * references = [the invoice's portal uuid] and the same internal number. It waits for the signer like any document
 * (version 1; after an invalid credit note the next one is version 2).
 */
export async function queueCreditNote(
  db: Db,
  invoiceId: number,
  env: EtaEnv,
  userId: number | null,
  deps: { now?: () => Date } = {},
): Promise<{ ok: true; docId: number; version: number } | EtaRefusal> {
  const now = deps.now || (() => new Date())
  if (!Number.isInteger(invoiceId) || invoiceId < 1) return refusal("not_found", "Invoice not found.")
  const invoice = must(await db.from("accounts_receivable").select("invoice_id").eq("invoice_id", invoiceId).maybeSingle(), "load invoice")
  if (!invoice) return refusal("not_found", "Invoice not found.")
  const rows = must(
    await db.from("eta_documents").select("doc_id, document_type, environment, version, status, eta_uuid, document").eq("invoice_id", invoiceId),
    "load e-invoice documents",
  ) as any[]
  const mine = rows.filter((r) => (r.environment || "real") === env)
  if (mine.some((r) => r.document_type === "C" && LIVE_STATUSES.includes(r.status)))
    return refusal("credit_note_active", "This invoice already has a credit note on the portal (waiting to be signed, sent or valid).")
  const valid = mine.filter((r) => r.document_type === "I" && r.status === "valid").sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))[0]
  if (!valid) return refusal("not_valid", "A credit note can only be made for an invoice that is valid on the portal.")
  const uuid = text(valid.eta_uuid)
  const snapshot = parsedBody(valid)
  if (!uuid || !snapshot) return refusal("snapshot_unreadable", "The invoice's sent document or its portal ID is missing, so a credit note can't be built.")

  let body: string
  let canonical: string
  let doc
  try {
    doc = buildCreditNoteDocument(snapshot, uuid, now().toISOString())
    body = toEtaJson(doc)
    canonical = canonicalize(body)
  } catch (e: any) {
    console.error(`[eta] could not build the credit note of invoice ${invoiceId}: ${e?.message || e}`)
    return refusal("build_failed", "The credit note could not be built from the sent invoice.")
  }
  const version = Math.max(0, ...mine.filter((r) => r.document_type === "C").map((r) => Number(r.version) || 0)) + 1
  const at = now().toISOString()
  const { data, error } = await db
    .from("eta_documents")
    .insert({
      invoice_id: invoiceId,
      document_type: "C",
      environment: env,
      version,
      status: "pending_signature",
      document: body,
      canonical,
      references: [uuid],
      lines: doc.invoiceLines,
      totals: rowTotals(doc),
      errors: null,
      created_by: userId,
      created_at: at,
      updated_at: at,
    })
    .select("doc_id")
  // another request made the credit note first
  if (error?.code === "23505") return refusal("credit_note_active", "This invoice already has a credit note on the portal (waiting to be signed, sent or valid).")
  if (error) throw new Error(`save credit note: ${error.message || error}`)
  const docId = Array.isArray(data) ? data[0]?.doc_id : data?.doc_id
  return { ok: true, docId, version }
}

/**
 * "Send again" (spec §6.1): only when the invoice's latest document on this portal is `invalid` (the portal refused it,
 * or never received it - ruling P8), and nothing of the same kind is still live there. An invalid invoice is rebuilt
 * from the invoice as it is now (after the fix); an invalid credit note is rebuilt from the invoice's sent snapshot.
 * Either way a new row with the next version; the invalid one stays as history.
 */
export async function sendAgain(
  db: Db,
  invoiceId: number,
  env: EtaEnv,
  userId: number | null,
  deps: SendDeps = {},
): Promise<{ ok: true; documentType: "I" | "C"; docId: number; version: number } | EtaRefusal> {
  if (!Number.isInteger(invoiceId) || invoiceId < 1) return refusal("not_found", "Invoice not found.")
  const rows = must(
    await db.from("eta_documents").select("doc_id, document_type, environment, version, status, errors, eta_uuid, submitted_at, updated_at, document").eq("invoice_id", invoiceId),
    "load e-invoice documents",
  ) as any[]
  const mine = rows.filter((r) => (r.environment || "real") === env && r.status !== "manual")
  const latest = [...mine].sort((a, b) => Number(b.doc_id) - Number(a.doc_id))[0]
  if (!latest) return refusal("not_sent", "This invoice has not been sent to this portal yet.")
  const type: "I" | "C" = latest.document_type === "C" ? "C" : "I"
  if (mine.some((r) => r.document_type === type && LIVE_STATUSES.includes(r.status)))
    return refusal("still_live", "The earlier version is still waiting, sent or valid on the portal; it can't be sent again.")
  if (latest.status !== "invalid") return refusal("not_invalid", "Only a document the portal marked invalid can be sent again.")

  // "never received" is only our guess: look once more before making a second document (ruling P8)
  if (Array.isArray(latest.errors) && latest.errors.some((e: any) => e?.code === "NotReceived")) {
    const internalId = text(parsedBody(latest)?.internalID)
    const attemptMs = Date.parse(text(latest.submitted_at) || text(latest.updated_at))
    const attempt = Number.isFinite(attemptMs) ? attemptMs : (deps.now || (() => new Date()))().getTime()
    const nowMs = (deps.now || (() => new Date()))().getTime()
    let found: any[]
    try {
      const res = await portalOf(deps, env).searchSent({
        internalId,
        from: new Date(attempt - 60 * 60_000).toISOString(),
        to: new Date(Math.max(nowMs, attempt) + 60_000).toISOString(),
      })
      found = Array.isArray(res?.result) ? res.result : []
    } catch (e: any) {
      console.error(`[eta] search before sending again failed: ${e?.message || e}`)
      return refusal("portal_search_failed", "The tax portal could not be asked whether it already has this document. Try again in a minute.", { status: 503 })
    }
    const taken = new Set(rows.filter((r) => r.doc_id !== latest.doc_id && text(r.eta_uuid)).map((r) => text(r.eta_uuid)))
    const s = pickLost(found, internalId, latest.document_type, attempt, taken)
    if (s) {
      // adopt it: back to submitted with the portal's ids, so the follow-up records its real state
      must(
        await db
          .from("eta_documents")
          .update({
            status: "submitted", eta_uuid: text(s.uuid) || null, eta_long_id: text(s.longId) || null,
            submission_uuid: text(s.submissionUUID || s.submissionUuid) || null, errors: null, checked_at: null, updated_at: new Date(nowMs).toISOString(),
          })
          .eq("doc_id", latest.doc_id)
          .eq("status", "invalid"),
        "adopt the portal document",
      )
      return refusal("found_on_portal", "The portal already has this document. It was found and is being followed up; it was not sent again.")
    }
  }

  if (type === "C") {
    const r = await queueCreditNote(db, invoiceId, env, userId, deps)
    return r.ok ? { ok: true, documentType: "C", docId: r.docId, version: r.version } : r
  }
  const q = await queueSend(db, [invoiceId], env, userId, deps)
  if (!q.queued.length) {
    const reasons = q.refused[0]?.reasons || ["refused"]
    return refusal(reasons[0], "The invoice can't be sent yet: something is still missing or changed.", { reasons })
  }
  const added = must(
    await db.from("eta_documents").select("doc_id, version").eq("invoice_id", invoiceId).eq("environment", env).eq("document_type", "I").eq("status", "pending_signature"),
    "load the new version",
  ) as any[]
  const row = added.sort((a, b) => Number(b.version) - Number(a.version))[0]
  return { ok: true, documentType: "I", docId: row?.doc_id, version: row?.version }
}

const CHANGED: EtaDocError = {
  code: "CHANGED_AFTER_SEND",
  message: "The invoice, its lines, the customer or the company details changed after Send. Check it and send again.",
  messageAr: "تغيّرت الفاتورة أو بنودها أو بيانات العميل أو الشركة بعد الإرسال. راجعها ثم أرسلها مرة أخرى.",
}

/** Rebuilds a waiting invoice document; true when it is still exactly what was stored at Send. */
async function stillSame(db: Db, row: any, settings: Record<string, string>): Promise<boolean> {
  const body = storedBody(row)
  if (!body || !row.canonical || canonicalize(body) !== row.canonical) return false
  if (row.document_type !== "I") return true // credit notes are built from the sent snapshot, which can't change
  const doc = JSON.parse(body)
  const preview = await buildEtaPreview(db, row.invoice_id)
  if (!preview || previewReasons(preview, (row.environment || "real") as EtaEnv).length) return false
  try {
    return canonicalize(toEtaJson(buildInvoiceDocument(preview, settings, doc.dateTimeIssued))) === row.canonical
  } catch {
    return false
  }
}

/**
 * What the signer signs next: up to `limit` waiting documents of the selected portal. Each is rebuilt first; one that
 * changed since Send goes to `needs_review` and is not handed out. Nothing is handed out while the portal login for
 * that environment is not set (the documents wait, visibly, instead of being signed for nothing).
 */
export async function nextForSigner(
  db: Db,
  _signerId: number,
  limit = SIGNER_BATCH,
  deps: { now?: () => Date; credentialsSet?: (env: EtaEnv) => boolean } = {},
): Promise<{ docId: number; canonical: string }[]> {
  const now = deps.now || (() => new Date())
  const settings = await readEtaSettings(db)
  const env = etaEnvironment(settings)
  if (!credsOf(deps)(env)) return []
  const rows = must(
    await db
      .from("eta_documents")
      .select("doc_id, invoice_id, document_type, environment, status, document, canonical")
      .eq("status", "pending_signature")
      .eq("environment", env)
      .order("doc_id", { ascending: true })
      .limit(Math.min(Math.max(1, limit), SIGNER_BATCH)),
    "load waiting documents",
  ) as any[]
  const out: { docId: number; canonical: string }[] = []
  for (const row of rows) {
    if (await stillSame(db, row, settings)) {
      out.push({ docId: row.doc_id, canonical: row.canonical })
      continue
    }
    must(
      await db.from("eta_documents").update({ status: "needs_review", errors: [CHANGED], updated_at: now().toISOString() }).eq("doc_id", row.doc_id).eq("status", "pending_signature"),
      "mark needs review",
    )
  }
  return out
}

export interface SendDeps {
  now?: () => Date
  fetch?: FetchFn
  /** the portal client per environment (tests inject a fake) */
  portalFor?: (env: EtaEnv) => EtaPortal
  credentialsSet?: (env: EtaEnv) => boolean
  /** follow-up time budget in ms (default FOLLOW_UP_BUDGET_MS) */
  followUpBudgetMs?: number
  /** time budget of the portal checks of one Send request in ms (default PORTAL_CHECK_BUDGET_MS) */
  portalCheckBudgetMs?: number
  /** ms clock and pause between portal searches (tests) */
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
}
/** Defaults the route handlers use (tests set a fake portal here; the app leaves it empty). */
export const etaSendDefaults: SendDeps = {}
/** The portal client for an environment, honouring injected test portals (also used by ./after-send). */
export const portalOf = (deps: SendDeps, env: EtaEnv, timeoutMs?: number) => {
  const d = { ...etaSendDefaults, ...deps }
  return d.portalFor ? d.portalFor(env) : createPortal(env, { ...(d.fetch ? { fetch: d.fetch } : {}), ...(timeoutMs ? { timeoutMs } : {}) })
}
export const credsOf = (deps: SendDeps) => deps.credentialsSet || etaSendDefaults.credentialsSet || credentialsSet

export interface AcceptResult {
  /** sent to the portal and accepted (status submitted, with its portal ids) */
  submitted: number[]
  /** the portal refused it (status invalid, with the reasons) */
  invalid: number[]
  /** sent, but the portal's answer is not known (status submitted; never sent again automatically) */
  unconfirmed: number[]
  /** not sent; the row is unchanged */
  refused: { docId: number; reason: string }[]
}

/** The signed body: the stored text with the signature appended - nothing else in it changes. */
export function signedBody(body: string, signature: string): string {
  const trimmed = body.trimEnd()
  if (!trimmed.endsWith("}")) throw new Error("The stored document is not a JSON object")
  return `${trimmed.slice(0, -1)},"signatures":[{"signatureType":"I","value":${JSON.stringify(signature)}}]}`
}

function rejectionErrors(rejected: any): EtaDocError[] {
  const e = rejected?.error || {}
  const list: EtaDocError[] = []
  const details = Array.isArray(e.details) ? e.details : []
  for (const d of details) list.push({ code: text(d?.code) || "Invalid", message: text(d?.message) || plainError(text(d?.code) || "Invalid"), path: text(d?.target || d?.propertyPath) || undefined })
  if (!list.length) list.push({ code: text(e.code) || "Invalid", message: text(e.message) || plainError(text(e.code) || "Invalid"), path: text(e.target) || undefined })
  return list
}

/** Groups into portal submissions of at most SIGNER_BATCH, never two documents with the same internalID in one. */
function batches<T extends { internalId: string }>(items: T[]): T[][] {
  const out: T[][] = []
  for (const item of items) {
    const slot = out.find((b) => b.length < SIGNER_BATCH && !b.some((x) => x.internalId === item.internalId))
    if (slot) slot.push(item)
    else out.push([item])
  }
  return out
}

/**
 * The signer hands back signatures. Each is checked (detached CMS over exactly the stored canonical text, by the
 * company's certificate); good ones are submitted to the portal in one submission per delivery (at most 20).
 */
export async function acceptSignatures(db: Db, items: { docId: number; signature: string }[], deps: SendDeps = {}): Promise<AcceptResult> {
  const now = deps.now || (() => new Date())
  const result: AcceptResult = { submitted: [], invalid: [], unconfirmed: [], refused: [] }
  const list = Array.isArray(items) ? items : []
  const seen = new Set<number>()
  const wanted: { docId: number; signature: string }[] = []
  for (const [i, it] of list.entries()) {
    const docId = Number(it?.docId)
    if (!Number.isInteger(docId) || docId < 1) { result.refused.push({ docId: Number.isFinite(docId) ? docId : 0, reason: "Invalid document id." }); continue }
    if (i >= SIGNER_BATCH) { result.refused.push({ docId, reason: `At most ${SIGNER_BATCH} documents per delivery.` }); continue }
    if (seen.has(docId)) { result.refused.push({ docId, reason: "The same document was sent twice in one delivery." }); continue }
    seen.add(docId)
    if (typeof it?.signature !== "string" || !it.signature.trim()) { result.refused.push({ docId, reason: "The signature is missing." }); continue }
    wanted.push({ docId, signature: it.signature.replace(/\s+/g, "") })
  }
  if (!wanted.length) return result

  const rows = must(
    await db
      .from("eta_documents")
      .select("doc_id, invoice_id, document_type, environment, status, document, canonical")
      .in("doc_id", wanted.map((w) => w.docId)),
    "load documents",
  ) as any[]
  const byId = new Map<number, any>(rows.map((r) => [r.doc_id, r]))
  const hasCreds = credsOf(deps)
  const settings = await readEtaSettings(db)

  const good: { row: any; signature: string; env: EtaEnv; internalId: string; body: string }[] = []
  for (const w of wanted) {
    const row = byId.get(w.docId)
    if (!row || row.status !== "pending_signature") { result.refused.push({ docId: w.docId, reason: "This document is not waiting to be signed." }); continue }
    const body = storedBody(row)
    const doc = parsedBody(row)
    if (!body || !doc || !row.canonical) { result.refused.push({ docId: w.docId, reason: "The stored document is unreadable." }); continue }
    const env = (row.environment === "test" ? "test" : "real") as EtaEnv
    if (!hasCreds(env)) { result.refused.push({ docId: w.docId, reason: new EtaCredentialsError(env).message }); continue }
    const check = await checkSignature(w.signature, row.canonical, text(doc?.issuer?.id), now())
    if (!check.ok) { result.refused.push({ docId: w.docId, reason: check.reason }); continue }
    // the same check as at hand-out: the invoice may have changed while the signer waited (e.g. for the PIN)
    if (!(await stillSame(db, row, settings))) {
      must(
        await db.from("eta_documents").update({ status: "needs_review", errors: [CHANGED], updated_at: now().toISOString() }).eq("doc_id", row.doc_id).eq("status", "pending_signature"),
        "mark needs review",
      )
      result.refused.push({ docId: w.docId, reason: CHANGED.message })
      continue
    }
    good.push({ row, signature: w.signature, env, internalId: text(doc.internalID), body })
  }

  for (const env of ["test", "real"] as EtaEnv[]) {
    const mine = good.filter((g) => g.env === env)
    if (!mine.length) continue
    const portal = portalOf(deps, env)
    for (const batch of batches(mine)) {
      // claim: only rows still waiting go out, and they leave `pending_signature` before the portal is called
      const claimed: typeof batch = []
      for (const g of batch) {
        const at = now().toISOString()
        const rowsClaimed = must(
          await db
            .from("eta_documents")
            .update({ status: "submitted", signature: g.signature, submitted_at: at, checked_at: null, errors: null, updated_at: at })
            .eq("doc_id", g.row.doc_id)
            .eq("status", "pending_signature")
            .select("doc_id"),
          "claim document",
        ) as any[]
        if (rowsClaimed?.length) claimed.push(g)
        else result.refused.push({ docId: g.row.doc_id, reason: "This document is not waiting to be signed." })
      }
      if (!claimed.length) continue
      await submitBatch(db, portal, claimed, result, now)
    }
  }
  return result
}

async function submitBatch(
  db: Db,
  portal: EtaPortal,
  batch: { row: any; signature: string; internalId: string; body: string }[],
  result: AcceptResult,
  now: () => Date,
) {
  const ids = batch.map((g) => g.row.doc_id)
  const update = async (docId: number, patch: Record<string, any>) =>
    must(await db.from("eta_documents").update({ ...patch, updated_at: now().toISOString() }).eq("doc_id", docId).eq("status", "submitted"), "save portal answer")

  let res: Awaited<ReturnType<EtaPortal["submit"]>>
  try {
    res = await portal.submit(batch.map((g) => signedBody(g.body, g.signature)))
  } catch (e: any) {
    if (e instanceof EtaBusyError || e instanceof EtaCredentialsError) {
      // the portal took nothing: back to the waiting list, to be signed again
      for (const id of ids) {
        must(
          await db.from("eta_documents").update({ status: "pending_signature", signature: null, submitted_at: null, updated_at: now().toISOString() }).eq("doc_id", id).eq("status", "submitted"),
          "return to waiting",
        )
        result.refused.push({ docId: id, reason: e.message })
      }
      return
    }
    if (e instanceof EtaError && e.status === 422 && e.code === "DuplicateSubmission") {
      // already submitted - check status; never resubmitted
      for (const id of ids) await update(id, { errors: [known("DuplicateSubmission")] })
      result.unconfirmed.push(...ids)
      return
    }
    if (e instanceof EtaError && (e.status === 401 || e.status === 403)) {
      // our login was refused: nothing reached the portal, so the batch is not invalid - back to the waiting list
      if (e.status === 401) resetPortalTokens()
      for (const id of ids) {
        must(
          await db.from("eta_documents").update({ status: "pending_signature", signature: null, submitted_at: null, updated_at: now().toISOString() }).eq("doc_id", id).eq("status", "submitted"),
          "return to waiting",
        )
        result.refused.push({ docId: id, reason: e.message })
      }
      return
    }
    if (e instanceof EtaError && e.status >= 400 && e.status < 500) {
      // the portal refused the whole submission: nothing of it is on the portal
      const errors = [{ ...known(e.code), message: e.message }]
      for (const id of ids) await update(id, { status: "invalid", errors })
      result.invalid.push(...ids)
      return
    }
    // timeout, network or a portal fault: it may or may not have arrived. Kept as submitted, never sent again by itself.
    const errors: EtaDocError[] = [{
      code: "Unconfirmed",
      message: "The portal did not confirm this submission yet. The ERP is looking for it on the portal; it is not sent again meanwhile.",
      messageAr: "لم تؤكد البوابة استلام هذا الإرسال بعد. يبحث النظام عنه على البوابة ولن يُعاد إرساله في الأثناء.",
    }]
    for (const id of ids) await update(id, { errors })
    result.unconfirmed.push(...ids)
    return
  }

  const accepted = Array.isArray(res.acceptedDocuments) ? res.acceptedDocuments : []
  const rejected = Array.isArray(res.rejectedDocuments) ? res.rejectedDocuments : []
  for (const g of batch) {
    const id = g.row.doc_id
    const a = accepted.find((d: any) => text(d?.internalId) === g.internalId)
    const r = rejected.find((d: any) => text(d?.internalId) === g.internalId)
    if (a) {
      await update(id, { submission_uuid: text(res.submissionUUID) || null, eta_uuid: text(a.uuid) || null, eta_long_id: text(a.longId) || null })
      result.submitted.push(id)
    } else if (r) {
      await update(id, { status: "invalid", submission_uuid: text(res.submissionUUID) || null, errors: rejectionErrors(r) })
      result.invalid.push(id)
    } else {
      // not listed either way: the follow-up finds it in the submission
      await update(id, { submission_uuid: text(res.submissionUUID) || null })
      result.submitted.push(id)
    }
  }
}

/** The portal's validation errors of an invalid document, in its own words (EN / AR). */
export function validationErrors(details: any): EtaDocError[] {
  const steps = details?.validationResults?.validationSteps
  const out: EtaDocError[] = []
  for (const step of Array.isArray(steps) ? steps : []) {
    if (text(step?.status).toLowerCase() !== "invalid") continue
    const e = step?.error || {}
    const inner = Array.isArray(e.innerError) && e.innerError.length ? e.innerError : [e]
    for (const x of inner) {
      out.push({
        code: text(x?.errorCode) || "Invalid",
        message: text(x?.error) || "The portal marked this document invalid.",
        ...(text(x?.errorAr) ? { messageAr: text(x.errorAr) } : {}),
        ...(text(x?.propertyPath) ? { path: text(x.propertyPath) } : {}),
        ...(text(step?.name) ? { step: text(step.name) } : {}),
      })
    }
  }
  return out
}

/** A cancellation is re-checked on the portal (the receiver may decline it) for this long after it was requested (P10). */
export const CANCEL_CONFIRM_DAYS = 8

/** A row cancelled by us whose cancellation the portal has not confirmed yet (ruling P10). */
export function cancelPending(row: { status?: unknown; errors?: unknown }): boolean {
  return row?.status === "cancelled" && Array.isArray(row.errors) && row.errors.some((e: any) => e?.code === "CancelRequested")
}
/** A cancelled row whose cancellation stands (confirmed by the portal, or cancelled by the portal itself). */
export function cancelConfirmed(row: { status?: unknown; errors?: unknown }): boolean {
  return row?.status === "cancelled" && !cancelPending(row)
}
/**
 * What the portal's document details say about a requested cancellation: "cancelled" (it stands), "declined" (the
 * document is valid again), "pending" (requested, the receiver has not answered) or "unknown".
 */
export function cancelStateOf(details: any): "cancelled" | "declined" | "pending" | "unknown" {
  const status = text(details?.status).toLowerCase()
  if (status === "cancelled") return "cancelled"
  if (status !== "valid") return "unknown"
  if (text(details?.declineCancelRequestDate)) return "declined"
  if (text(details?.cancelRequestDate)) return "pending"
  return "declined"
}
/** The row change for a cancellation answer (P10), or null when nothing changes. */
export function cancelAnswerPatch(state: ReturnType<typeof cancelStateOf>): Record<string, any> | null {
  if (state === "cancelled") return { errors: null }
  if (state === "declined") return { status: "valid", errors: [known("CancelDeclined")] }
  return null
}

/** Follow-up stops starting portal calls after this much time, so it never holds up the request it rides on. */
export const FOLLOW_UP_BUDGET_MS = 8_000
/** A send whose portal answer was lost is given this long to show up in the portal's search before it counts as never received. */
export const NOT_RECEIVED_AFTER_MS = 30 * 60_000

class OutOfBudget extends Error {}

/** "i" / "c" when a portal search result says its type (typeName "I" / "C", or a name such as "Credit Note"), else "". */
function searchType(x: any): string {
  const t = text(x?.typeName).toLowerCase()
  if (t === "i" || t === "c") return t
  if (t.includes("credit")) return "c"
  if (t.includes("invoice")) return "i"
  return ""
}

/**
 * The portal document that is a lost send: same internal number, not held by another row, the right type, and (only
 * when the portal says when it received it) received about when we sent it. A result with no dateTimeReceived is not
 * filtered by time - its issue date is the invoice's old date, never the time of the send.
 */
function pickLost(found: any[], internalId: string, documentType: string, attempt: number, taken: Set<string>): any {
  const received = (x: any) => Date.parse(text(x?.dateTimeReceived))
  return found
    .filter((x) => text(x?.internalId) === internalId && text(x?.uuid) && !taken.has(text(x.uuid)))
    // an invoice and its credit note share the internal number: when the portal says the type, it must match
    .filter((x) => { const t = searchType(x); return !t || t === (documentType === "C" ? "c" : "i") })
    .filter((x) => !Number.isFinite(received(x)) || received(x) >= attempt - 15 * 60_000)
    .sort((a, b) => (received(b) || 0) - (received(a) || 0))[0]
}

/**
 * Follow-up (spec §6.1): asks the portal about `submitted` documents, each at most once every 30 s, and records
 * valid / invalid (with the portal's reasons) / cancelled / rejected. A failed check leaves the row as it is.
 * Rows with no submission id (the portal's answer was lost: 422 duplicate, timeout, portal fault, or the request was
 * cut off between claiming the row and the answer) are reconciled by searching the portal's sent documents for the
 * invoice number (ruling P8): found -> its uuid / longId / status are adopted; not found 30 min after the attempt ->
 * invalid "NotReceived", so it can be sent again. Every portal call is bounded by a time budget (default 8 s in
 * total); when it runs out, the rest waits for the next run. It never submits anything.
 */
export async function followUp(
  db: Db,
  deps: SendDeps = {},
  opts: { now?: Date | number; budgetMs?: number; clock?: () => number } = {},
): Promise<{ checked: number; changed: number }> {
  const d = { ...etaSendDefaults, ...deps }
  const at = opts.now != null ? new Date(opts.now) : d.now ? d.now() : new Date()
  const clock = opts.clock || (() => Date.now())
  const started = clock()
  const budget = opts.budgetMs ?? d.followUpBudgetMs ?? FOLLOW_UP_BUDGET_MS
  // one portal call, given at most what is left of the budget (the call itself may go on; its answer is then dropped)
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    const left = budget - (clock() - started)
    if (left <= 0) throw new OutOfBudget()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([fn(), new Promise<T>((_r, reject) => { timer = setTimeout(() => reject(new OutOfBudget()), left) })])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const cutoff = at.getTime() - FOLLOW_UP_EVERY_MS
  const stamp = at.toISOString()
  const rows = must(
    await db
      .from("eta_documents")
      .select("doc_id, invoice_id, document_type, environment, status, submission_uuid, eta_uuid, eta_long_id, checked_at, submitted_at, updated_at, document")
      .eq("status", "submitted"),
    "load submitted documents",
  ) as any[]
  const lastCheck = (r: any) => {
    const t = Date.parse(text(r.checked_at))
    return Number.isFinite(t) ? t : 0
  }
  const envOf = (r: any): EtaEnv => (r.environment === "test" ? "test" : "real")
  const due = rows.filter((r) => lastCheck(r) <= cutoff).sort((a, b) => lastCheck(a) - lastCheck(b))

  // jobs, oldest check first: one per submission, one per lost send
  type Job = { env: EtaEnv; submissionUuid: string | null; rows: any[] }
  const jobs: Job[] = []
  for (const r of due) {
    const sub = text(r.submission_uuid)
    const job = sub ? jobs.find((j) => j.submissionUuid === sub && j.env === envOf(r)) : undefined
    if (job) job.rows.push(r)
    else jobs.push({ env: envOf(r), submissionUuid: sub || null, rows: [r] })
  }

  let checked = 0
  let changed = 0
  const portals = new Map<EtaEnv, EtaPortal>()
  const portal = (env: EtaEnv) => {
    if (!portals.has(env)) portals.set(env, portalOf(d, env, Math.min(budget, FOLLOW_UP_BUDGET_MS)))
    return portals.get(env)!
  }
  const save = async (row: any, patch: Record<string, any>) => {
    must(await db.from("eta_documents").update({ ...patch, updated_at: stamp }).eq("doc_id", row.doc_id).eq("status", "submitted"), "save portal status")
    if (patch.status) changed++
  }
  // what the portal says about one document -> the row's new state
  const apply = async (row: any, env: EtaEnv, s: any, submissionUuid?: string) => {
    const ids: Record<string, any> = { eta_uuid: text(s.uuid) || row.eta_uuid || null, eta_long_id: text(s.longId) || row.eta_long_id || null }
    if (submissionUuid) ids.submission_uuid = submissionUuid
    const status = text(s.status).toLowerCase()
    if (status === "valid") return save(row, { ...ids, status: "valid", validated_at: stamp, errors: null })
    if (status === "invalid") {
      let errors: EtaDocError[] = []
      try {
        errors = validationErrors(await call(() => portal(env).getDetails(ids.eta_uuid || "")))
      } catch (e: any) {
        if (e instanceof OutOfBudget) throw e
        console.error(`[eta] details of ${ids.eta_uuid} failed: ${e?.message || e}`)
      }
      return save(row, { ...ids, status: "invalid", errors: errors.length ? errors : [{ code: "Invalid", message: "The portal marked this document invalid. Open it on the portal for the reasons." }] })
    }
    if (status === "cancelled" || status === "rejected") return save(row, { ...ids, status })
    const lost = !text(row.submission_uuid)
    if (lost || ids.eta_uuid !== row.eta_uuid || ids.eta_long_id !== row.eta_long_id) return save(row, { ...ids, ...(lost ? { errors: null } : {}) })
  }

  try {
    for (const job of jobs.slice(0, FOLLOW_UP_MAX_SUBMISSIONS)) {
      if (clock() - started >= budget) break
      // throttle first, so a failing check is not repeated before 30 s either
      must(await db.from("eta_documents").update({ checked_at: stamp }).in("doc_id", job.rows.map((r) => r.doc_id)).eq("status", "submitted"), "stamp check")
      checked++
      if (job.submissionUuid) {
        let summary: any[]
        try {
          const sub = await call(() => portal(job.env).getSubmission(job.submissionUuid!))
          summary = Array.isArray(sub?.documentSummary) ? sub.documentSummary : []
        } catch (e: any) {
          if (e instanceof OutOfBudget) throw e
          console.error(`[eta] follow-up of submission ${job.submissionUuid} failed: ${e?.message || e}`)
          continue
        }
        for (const row of job.rows) {
          const internalId = text(parsedBody(row)?.internalID)
          const s = summary.find((x: any) => row.eta_uuid && text(x?.uuid) === text(row.eta_uuid)) || (!row.eta_uuid ? summary.find((x: any) => text(x?.internalId) === internalId) : undefined)
          if (s) await apply(row, job.env, s)
        }
        continue
      }
      await reconcileLost(job.rows[0], job.env)
    }
    // P10: our cancellations the portal has not confirmed yet (the receiver may decline them), within 8 days
    const since = new Date(at.getTime() - CANCEL_CONFIRM_DAYS * 24 * 3600_000).toISOString()
    const cancelled = must(
      await db
        .from("eta_documents")
        .select("doc_id, environment, status, eta_uuid, errors, checked_at, updated_at")
        .eq("status", "cancelled")
        .gte("updated_at", since),
      "load cancelled documents",
    ) as any[]
    const waiting = cancelled.filter((r) => cancelPending(r) && text(r.eta_uuid) && lastCheck(r) <= cutoff).sort((a, b) => lastCheck(a) - lastCheck(b))
    for (const row of waiting.slice(0, FOLLOW_UP_MAX_SUBMISSIONS)) {
      if (clock() - started >= budget) break
      // throttle stamp only: updated_at stays the time of the cancel request
      must(await db.from("eta_documents").update({ checked_at: stamp }).eq("doc_id", row.doc_id).eq("status", "cancelled"), "stamp check")
      checked++
      let state: ReturnType<typeof cancelStateOf>
      try {
        state = cancelStateOf(await call(() => portal(envOf(row)).getDetails(text(row.eta_uuid))))
      } catch (e: any) {
        if (e instanceof OutOfBudget) throw e
        console.error(`[eta] cancellation check of ${row.doc_id} failed: ${e?.message || e}`)
        continue
      }
      const patch = cancelAnswerPatch(state)
      if (!patch) continue
      must(await db.from("eta_documents").update({ ...patch, updated_at: stamp }).eq("doc_id", row.doc_id).eq("status", "cancelled"), "save cancellation answer")
      if (patch.status) changed++
    }
  } catch (e: any) {
    if (!(e instanceof OutOfBudget)) throw e
  }
  return { checked, changed }

  // P8: a send with no submission id - look for it among the portal's sent documents
  async function reconcileLost(row: any, env: EtaEnv) {
    const internalId = text(parsedBody(row)?.internalID)
    const attemptMs = Date.parse(text(row.submitted_at) || text(row.updated_at))
    const attempt = Number.isFinite(attemptMs) ? attemptMs : at.getTime()
    let found: any[]
    try {
      const res = await call(() =>
        portal(env).searchSent({
          internalId,
          from: new Date(attempt - 60 * 60_000).toISOString(),
          to: new Date(Math.max(at.getTime(), attempt) + 60_000).toISOString(),
        }),
      )
      found = Array.isArray(res?.result) ? res.result : []
    } catch (e: any) {
      if (e instanceof OutOfBudget) throw e
      console.error(`[eta] search for lost send ${row.doc_id} failed: ${e?.message || e}`)
      return
    }
    // never adopt a portal document another row already holds (an earlier version of the same invoice)
    const held = must(await db.from("eta_documents").select("doc_id, eta_uuid").eq("invoice_id", row.invoice_id), "load invoice documents") as any[]
    const taken = new Set(held.filter((h) => h.doc_id !== row.doc_id && text(h.eta_uuid)).map((h) => text(h.eta_uuid)))
    const s = pickLost(found, internalId, row.document_type, attempt, taken)
    if (s) return apply(row, env, s, text(s.submissionUUID || s.submissionUuid) || undefined)
    if (at.getTime() - attempt >= NOT_RECEIVED_AFTER_MS) return save(row, { status: "invalid", errors: [known("NotReceived")] })
  }
}

/** Runs the follow-up and never fails the caller (it piggybacks on other requests, after their own work). */
export async function followUpQuietly(db: Db, deps: SendDeps = {}): Promise<void> {
  try {
    await followUp(db, deps)
  } catch (e: any) {
    console.error(`[eta] follow-up failed: ${e?.message || e}`)
  }
}
