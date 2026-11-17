// Supplier e-invoices from the ETA portal (spec §6.6, plan Task 8): searches the documents RECEIVED by the company in
// 30-day windows (paged by continuationToken), reads the details of new ones only, and stores each portal uuid once per
// environment in eta_received_documents. A document seen again with another status (the supplier cancelled it) has its
// status overwritten. The supplier is the card whose tax number is the issuer's id. Read-only toward the portal and
// toward Accounts Payable. Long ranges run in time-budgeted parts with a cursor (the server cuts requests at 60 s).
import { createPortal, type EtaEnv, type EtaPortal } from "./portal"
import { DETAILS_GAP_MS, SEARCH_GAP_MS } from "./learn"

type Db = any

export const RECEIVE_WINDOW_DAYS = 30
/** the longest range one "Check now" may ask for */
export const RECEIVE_MAX_DAYS = 400
/** one request stops starting new portal reads after this long; the screen / cron calls again with the cursor */
export const RECEIVE_BUDGET_MS = 40_000
const MAX_PAGES = 200 // safety stop per window

/** where the next call continues: the window's first day and the page token inside it (null = its first page) */
export interface ReceiveCursor { windowFrom: string; token: string | null }
export interface ReceiveResult {
  added: number
  updated: number
  unchanged: number
  /** documents seen in this call whose issuer tax number is on no supplier card */
  unknownSuppliers: number
  /** the issuer ids behind unknownSuppliers (at most 50) */
  unknownIssuers: { issuerId: string; issuerName: string }[]
  /** windows finished in this call */
  windows: number
  /** windows in the whole range */
  totalWindows: number
  cursor: ReceiveCursor | null
}
export interface ReceiveDeps { portal?: EtaPortal; sleep?: (ms: number) => Promise<void>; now?: () => number; budgetMs?: number; clock?: () => Date }

const DAY_MS = 86_400_000
const DAY = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (d: string) => (DAY.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const text = (v: unknown) => (v == null ? "" : String(v).trim())
const digits = (v: unknown) => text(v).replace(/\D/g, "")
const num = (v: unknown): number | null => {
  const n = Number(v)
  return v == null || v === "" || !Number.isFinite(n) ? null : Math.round(n * 100000) / 100000
}

/** both dates real YYYY-MM-DD days, from <= to, at most RECEIVE_MAX_DAYS. Returns an error text, or null. */
export function rangeError(from: unknown, to: unknown, maxDays = RECEIVE_MAX_DAYS): string | null {
  const a = dayMs(String(from)), b = dayMs(String(to))
  if (Number.isNaN(a) || Number.isNaN(b) || iso(a) !== from || iso(b) !== to) return "Dates must look like 2026-01-31."
  if (b < a) return "The start date must not be after the end date."
  if ((b - a) / DAY_MS + 1 > maxDays) return `Check at most ${maxDays} days at a time.`
  return null
}

/** the 30-day windows of a range, oldest first */
export function receiveWindows(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  const end = dayMs(to)
  for (let a = dayMs(from); a <= end; a += RECEIVE_WINDOW_DAYS * DAY_MS) out.push({ from: iso(a), to: iso(Math.min(a + (RECEIVE_WINDOW_DAYS - 1) * DAY_MS, end)) })
  return out
}

/** the document out of a details answer: the portal may give it as JSON text, as an object, or as the body itself */
function documentOf(body: any): any {
  let doc = body?.document ?? body
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc)
    } catch {
      doc = {}
    }
  }
  return doc && typeof doc === "object" ? doc : {}
}

/** "I" invoice, "C" credit note, "D" debit note (from typeName "I" / "C" / "D", or the document's documentType) */
export function documentTypeOf(summary: any, doc: any = {}): "I" | "C" | "D" {
  const t = text(summary?.typeName ?? summary?.documentType ?? doc?.documentType ?? "i").toUpperCase()
  return t.startsWith("C") ? "C" : t.startsWith("D") ? "D" : "I"
}

/** the stored row for one portal document (search summary + details); field names per the ETA SDK search / details answers */
export function receivedRow(summary: any, details: any, env: EtaEnv, supplierId: number | null): Record<string, any> {
  const doc = documentOf(details)
  const total = num(summary?.total ?? doc?.totalAmount ?? details?.totalAmount)
  const net = num(summary?.netAmount ?? doc?.netAmount ?? details?.netAmount)
  const taxTotals: any[] = Array.isArray(doc?.taxTotals) ? doc.taxTotals : Array.isArray(details?.taxTotals) ? details.taxTotals : []
  const t1 = taxTotals.filter((t) => text(t?.taxType).toUpperCase() === "T1")
  const vat = t1.length ? num(t1.reduce((s, t) => s + (Number(t?.amount) || 0), 0)) : total != null && net != null ? num(total - net) : null
  const lines = Array.isArray(doc?.invoiceLines) ? doc.invoiceLines : Array.isArray(details?.invoiceLines) ? details.invoiceLines : []
  const issuer = doc?.issuer || details?.issuer || {}
  return {
    uuid: text(summary?.uuid ?? details?.uuid),
    environment: env,
    document_type: documentTypeOf(summary, doc),
    issuer_id: text(summary?.issuerId ?? issuer?.id) || null,
    issuer_name: text(summary?.issuerName ?? issuer?.name) || null,
    supplier_id: supplierId,
    internal_id: text(summary?.internalId ?? doc?.internalID ?? details?.internalId) || null,
    date_issued: text(summary?.dateTimeIssued ?? doc?.dateTimeIssued ?? details?.dateTimeIssued) || null,
    net,
    vat,
    total,
    status: text(summary?.status ?? details?.status) || null,
    lines: storedLines(lines),
    raw: summary ? { ...summary, ...referencesOf(doc) } : null,
  }
}

/** the portal lines as stored on eta_received_documents.lines (also used to cache details read later) */
export function storedLines(lines: any[]): Record<string, any>[] {
  return (Array.isArray(lines) ? lines : []).map((l: any) => ({
    description: l?.description ?? null,
    itemCode: l?.itemCode ?? null,
    internalCode: l?.internalCode ?? null,
    unitType: l?.unitType ?? null,
    quantity: num(l?.quantity),
    unitPrice: num(l?.unitValue?.amountEGP),
    netTotal: num(l?.netTotal),
    total: num(l?.total),
  }))
}

/** the document's own references to the buyer's numbers (PO / sales order / referenced documents), when it has them */
export function referencesOf(doc: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of ["purchaseOrderReference", "purchaseOrderDescription", "salesOrderReference", "salesOrderDescription"]) if (text(doc?.[k])) out[k] = text(doc[k])
  if (Array.isArray(doc?.references) && doc.references.length) out.references = doc.references.map((x: unknown) => text(x)).filter(Boolean)
  return out
}

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

/** supplier card tax number (digits only) -> supplier_id */
export async function supplierByTaxNumber(db: Db): Promise<Map<string, number>> {
  const rows = must(await db.from("suppliers").select("supplier_id, tax_registration_number"), "load suppliers") as any[]
  const map = new Map<string, number>()
  for (const s of rows) {
    const d = digits(s.tax_registration_number)
    if (d && !map.has(d)) map.set(d, s.supplier_id)
  }
  return map
}

export async function receiveSupplierDocuments(
  db: Db,
  env: EtaEnv,
  range: { from: string; to: string; cursor?: ReceiveCursor | null },
  deps: ReceiveDeps = {},
): Promise<ReceiveResult> {
  const bad = rangeError(range.from, range.to)
  if (bad) throw new Error(bad)
  const portal = deps.portal || createPortal(env)
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now || (() => Date.now())
  const started = now()
  const budget = deps.budgetMs ?? RECEIVE_BUDGET_MS
  const clock = deps.clock || (() => new Date())
  const outOfTime = () => now() - started > budget

  const windows = receiveWindows(range.from, range.to)
  const resume = range.cursor && typeof range.cursor === "object" ? range.cursor : null
  let w = resume ? windows.findIndex((x) => x.from === resume.windowFrom) : 0
  if (w < 0) w = 0
  let token: string | null = resume ? resume.token ?? null : null

  const suppliers = await supplierByTaxNumber(db)
  const result: ReceiveResult = { added: 0, updated: 0, unchanged: 0, unknownSuppliers: 0, unknownIssuers: [], windows: 0, totalWindows: windows.length, cursor: null }
  const unknown = new Map<string, string>()
  let portalCalls = 0
  const gap = async (ms: number) => {
    if (portalCalls++ > 0) await sleep(ms)
  }

  for (; w < windows.length; w++) {
    const win = windows[w]
    for (let page = 0; page < MAX_PAGES; page++) {
      // a new portal read only while there is time left; the first read of a call always runs
      if (portalCalls > 0 && outOfTime()) {
        result.cursor = { windowFrom: win.from, token }
        return finish(result, unknown)
      }
      await gap(SEARCH_GAP_MS)
      const body: any = await portal.searchReceived({ from: `${win.from}T00:00:00Z`, to: `${win.to}T23:59:59Z`, continuationToken: token ?? undefined })
      const docs: any[] = Array.isArray(body?.result) ? body.result : []
      const uuids = docs.map((d) => text(d?.uuid)).filter(Boolean)
      const existing = uuids.length
        ? (must(await db.from("eta_received_documents").select("received_id, uuid, status, supplier_id").eq("environment", env).in("uuid", uuids), "load received documents") as any[])
        : []
      const byUuid = new Map(existing.map((r) => [String(r.uuid), r]))
      for (const d of docs) {
        const uuid = text(d?.uuid)
        if (!uuid) continue
        const issuer = digits(d?.issuerId)
        const supplierId = suppliers.get(issuer) ?? null
        if (supplierId == null) {
          result.unknownSuppliers++
          if (issuer && !unknown.has(issuer)) unknown.set(issuer, text(d?.issuerName))
        }
        const have = byUuid.get(uuid)
        const at = clock().toISOString()
        if (have) {
          // seen before: the status (and a supplier card added since) is all that changes
          const patch: Record<string, any> = {}
          const status = text(d?.status) || null
          if (status && status !== have.status) patch.status = status
          if (have.supplier_id == null && supplierId != null) patch.supplier_id = supplierId
          if (Object.keys(patch).length === 0) {
            result.unchanged++
            continue
          }
          patch.updated_at = at
          must(await db.from("eta_received_documents").update(patch).eq("received_id", have.received_id), "update received document")
          result.updated++
          continue
        }
        if (outOfTime()) {
          // continue from this page next time: what was stored is then "unchanged"
          result.cursor = { windowFrom: win.from, token }
          return finish(result, unknown)
        }
        await gap(DETAILS_GAP_MS)
        const details = await portal.getDetails(uuid)
        const row: Record<string, any> = { ...receivedRow(d, details, env, supplierId), first_seen_at: at, updated_at: at }
        must(await db.from("eta_received_documents").upsert(row, { onConflict: "uuid,environment" }), "save received document")
        byUuid.set(uuid, { received_id: null, uuid, status: row.status, supplier_id: supplierId })
        result.added++
      }
      const next = body?.metadata?.continuationToken
      if (!next || next === "EndofResultSet" || next === token) break
      token = String(next)
    }
    token = null
    result.windows++
  }
  return finish(result, unknown)
}

function finish(result: ReceiveResult, unknown: Map<string, string>): ReceiveResult {
  result.unknownIssuers = [...unknown.entries()].slice(0, 50).map(([issuerId, issuerName]) => ({ issuerId, issuerName }))
  return result
}
