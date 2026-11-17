// Item-by-item comparison of ERP supplier bills with the supplier's portal invoices (GET /api/eta/ap-portal/lines) and
// the accountant's line pairs (POST the same route). Read-only toward Accounts Payable and the portal. Writes only:
//   - eta_received_documents.lines of a portal document whose lines were never stored (the portal details, read at the
//     portal's pace, are cached there as lib/eta/receive.ts does);
//   - ap_line_pair_memory (scripts/sql/2026-11-17-ap-line-pairs.sql) when the accountant pairs or takes apart two lines,
//     and the matching workflow_events row. Until that table exists the comparison works without memory and saving a
//     pair is refused with "database update needed".
import { billLinesOf, isMissingRelation } from "../po-bill"
import { knownUserId } from "../po-history"
import { checkPair } from "./ap-portal"
import { compareLines, ourMemoryKey, portalCodeOf, portalLinesOf, portalNameOf, type LineRow, type LineSummary, type OurLine, type PairMemory, type PortalLine } from "./ap-lines"
import { standingDoc, supplierResolver } from "./ap-links"
import { DETAILS_GAP_MS, linesOf } from "./learn"
import { createPortal, credentialsSet, type EtaEnv, type EtaPortal } from "./portal"
import { storedLines } from "./receive"
import { normalizeName } from "./normalize"

type Db = any

export const MEMORY_TABLE = "ap_line_pair_memory"
/** at most this many portal documents are read from the portal in one request (the rest next time) */
export const MAX_DETAIL_READS = 4
export const LINES_BUDGET_MS = 20_000
export const MAX_GROUP_SIDE = 20

const text = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => Number(v) || 0
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

export type Refusal = { ok: false; status: number; code: string; error: string; errorAr?: string }
const refuse = (status: number, code: string, error: string, errorAr?: string): Refusal => ({ ok: false, status, code, error, ...(errorAr ? { errorAr } : {}) })
export const DB_UPDATE_NEEDED = refuse(
  409,
  "DB_UPDATE_NEEDED",
  "Database update needed: line pairs cannot be remembered until scripts/sql/2026-11-17-ap-line-pairs.sql is applied.",
  "يلزم تحديث قاعدة البيانات: لا يمكن حفظ ربط البنود قبل تطبيق scripts/sql/2026-11-17-ap-line-pairs.sql.",
)

// ---------------------------------------------------------------- our lines

export interface BillLines {
  invoiceId: number
  invoiceNumber: string
  /** "bill": its own lines; "po": a bill without lines bills its whole PO; "none": no lines known */
  source: "bill" | "po" | "none"
  lines: OurLine[]
}

/** the lines of these bills: their ap_invoice_lines, else (a bill without lines) its PO lines less what is not coming */
export async function ourLinesOf(db: Db, bills: any[]): Promise<BillLines[]> {
  const { lines } = await billLinesOf(db, bills.map((b) => b.invoice_id))
  const byBill = new Map<number, any[]>()
  for (const l of lines) byBill.set(num(l.ap_invoice_id), [...(byBill.get(num(l.ap_invoice_id)) || []), l])
  const poIds = [...new Set(bills.filter((b) => !(byBill.get(num(b.invoice_id)) || []).length && b.po_id != null).map((b) => num(b.po_id)))]
  const items: any[] = poIds.length ? must(await db.from("purchase_order_items").select("*").in("po_id", poIds), "read PO lines") : []
  const productIds = new Set<number>()
  for (const l of lines) if (l.product_id != null && !text(l.description)) productIds.add(num(l.product_id))
  for (const i of items) if (i.product_id != null && !i.outsourced_name && !i.item_name_snapshot) productIds.add(num(i.product_id))
  const productName = new Map<number, string>()
  if (productIds.size) {
    const rows = must(await db.from("products").select("product_id, product_name").in("product_id", [...productIds]), "read products") as any[]
    for (const p of rows) productName.set(num(p.product_id), text(p.product_name))
  }
  return bills.map((b) => {
    const own = [...(byBill.get(num(b.invoice_id)) || [])].sort((x, y) => num(x.line_id) - num(y.line_id))
    const base = { invoiceId: num(b.invoice_id), invoiceNumber: text(b.invoice_number) }
    if (own.length)
      return {
        ...base,
        source: "bill" as const,
        lines: own.map((l) => ({
          key: `l${l.line_id}`,
          apInvoiceId: num(b.invoice_id),
          poItemId: l.po_item_id ?? null,
          productId: l.product_id ?? null,
          name: text(l.description) || productName.get(num(l.product_id)) || `#${l.line_id}`,
          quantity: num(l.quantity),
          unitPrice: num(l.unit_price),
          total: round2(l.total != null ? num(l.total) : num(l.quantity) * num(l.unit_price)),
        })),
      }
    if (b.po_id == null) return { ...base, source: "none" as const, lines: [] }
    const poLines = items
      .filter((i) => num(i.po_id) === num(b.po_id))
      .sort((x, y) => num(x.po_item_id) - num(y.po_item_id))
      .map((i) => {
        const qty = Math.max(0, num(i.quantity) - Math.min(Math.max(0, num(i.quantity_not_coming)), num(i.quantity)))
        return {
          key: `p${b.invoice_id}-${i.po_item_id}`,
          apInvoiceId: num(b.invoice_id),
          poItemId: num(i.po_item_id),
          productId: i.product_id ?? null,
          name: text(i.outsourced_name) || text(i.item_name_snapshot) || productName.get(num(i.product_id)) || `Item ${i.po_item_id}`,
          quantity: qty,
          unitPrice: num(i.unit_price),
          total: round2(qty * num(i.unit_price)),
        }
      })
      .filter((l) => l.quantity > 0)
    return { ...base, source: "po" as const, lines: poLines }
  })
}

// ---------------------------------------------------------------- portal lines

export interface DocLines {
  receivedId: number
  internalId: string | null
  /** "credit_note" and "withdrawn" documents are not compared line by line */
  skipped: "credit_note" | "withdrawn" | null
  /** the lines are not known yet (the portal could not be read now) */
  unread: boolean
  lines: PortalLine[]
}
export interface LinesDeps {
  portal?: EtaPortal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  budgetMs?: number
}

const linesKnown = (stored: unknown) => Array.isArray(stored) && stored.length > 0

/**
 * The lines of these portal documents: the stored ones, else read from the portal details (at most MAX_DETAIL_READS per
 * call, DETAILS_GAP_MS apart, within the time budget) and stored for next time.
 */
export async function portalLinesFor(db: Db, env: EtaEnv, docs: any[], deps: LinesDeps = {}): Promise<DocLines[]> {
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now || (() => Date.now())
  const started = now()
  const budget = deps.budgetMs ?? LINES_BUDGET_MS
  let portal: EtaPortal | null = deps.portal || null
  const canRead = !!portal || credentialsSet(env)
  let reads = 0
  const out: DocLines[] = []
  for (const d of docs) {
    const base = { receivedId: num(d.received_id), internalId: text(d.internal_id) || null }
    if (d.document_type === "C") { out.push({ ...base, skipped: "credit_note", unread: false, lines: [] }); continue }
    if (!standingDoc(d)) { out.push({ ...base, skipped: "withdrawn", unread: false, lines: [] }); continue }
    let stored = d.lines
    if (!linesKnown(stored) && canRead && text(d.uuid) && reads < MAX_DETAIL_READS && (reads === 0 || now() - started < budget)) {
      try {
        if (reads > 0) await sleep(DETAILS_GAP_MS)
        reads++
        portal ||= createPortal(env)
        const fresh = storedLines(linesOf(await portal.getDetails(text(d.uuid))))
        if (fresh.length) {
          stored = fresh
          const up = await db.from("eta_received_documents").update({ lines: fresh }).eq("received_id", d.received_id)
          if (up.error) console.error(`AP lines: could not store the portal lines of received document ${d.received_id}`, up.error)
        }
      } catch (e) {
        console.error(`AP lines: could not read the portal details of received document ${d.received_id}`, e)
      }
    }
    out.push({ ...base, skipped: null, unread: !linesKnown(stored), lines: portalLinesOf(num(d.received_id), stored) })
  }
  return out
}

// ---------------------------------------------------------------- memory

export async function readMemory(db: Db, supplierId: number): Promise<{ ready: boolean; rows: PairMemory[] }> {
  const r = await db.from(MEMORY_TABLE).select("supplier_id, portal_name, portal_code, our_key, product_id, kind").eq("supplier_id", supplierId)
  if (r.error) {
    if (isMissingRelation(r.error)) return { ready: false, rows: [] }
    throw new Error(`read line pair memory: ${r.error.message || r.error}`)
  }
  return { ready: true, rows: (r.data || []) as PairMemory[] }
}

// ---------------------------------------------------------------- the comparison

export interface LineCompare {
  ok: true
  supplierId: number
  memoryReady: boolean
  bills: { invoiceId: number; invoiceNumber: string; source: BillLines["source"]; lines: number }[]
  docs: { receivedId: number; internalId: string | null; skipped: DocLines["skipped"]; unread: boolean; lines: number }[]
  rows: LineRow[]
  summary: LineSummary
}

const DOC_COLUMNS = "received_id, uuid, document_type, issuer_id, supplier_id, internal_id, status, lines"

async function groupOf(db: Db, env: EtaEnv, apIds: number[], receivedIds: number[]): Promise<{ ok: true; supplierId: number; bills: any[]; docs: any[] } | Refusal> {
  const bills = apIds.length ? (must(await db.from("accounts_payable").select("invoice_id, invoice_number, supplier_id, po_id").in("invoice_id", apIds), "read supplier invoices") as any[]) : []
  const docs = receivedIds.length
    ? (must(await db.from("eta_received_documents").select(DOC_COLUMNS).eq("environment", env).in("received_id", receivedIds), "read received documents") as any[])
    : []
  if (bills.length !== new Set(apIds).size) return refuse(404, "NOT_FOUND", "Supplier invoice not found.", "فاتورة المورد غير موجودة.")
  if (docs.length !== new Set(receivedIds).size) return refuse(404, "NOT_FOUND", "Portal invoice not found.", "فاتورة البوابة غير موجودة.")
  let resolve = (d: any): number | null => d.supplier_id ?? null
  if (docs.some((d) => d.supplier_id == null)) {
    const sup = must(await db.from("suppliers").select("supplier_id, tax_registration_number").not("tax_registration_number", "is", null), "load suppliers") as any[]
    resolve = supplierResolver(sup)
  }
  const ids = new Set<number | null>([...bills.map((b) => b.supplier_id ?? null), ...docs.map(resolve)])
  if (ids.size !== 1 || ids.has(null))
    return refuse(409, "OTHER_SUPPLIER", "The invoices compared must all be of one known supplier.", "يجب أن تكون الفواتير المقارنة كلها لمورد واحد معروف.")
  const order = (xs: any[], key: string, want: number[]) => [...xs].sort((x, y) => want.indexOf(num(x[key])) - want.indexOf(num(y[key])))
  return { ok: true, supplierId: [...ids][0] as number, bills: order(bills, "invoice_id", apIds), docs: order(docs, "received_id", receivedIds) }
}

/** The item-by-item comparison of a group: its bills' lines against its portal invoices' lines. */
export async function loadLineCompare(db: Db, env: EtaEnv, q: { apInvoiceIds: number[]; receivedIds: number[] }, deps: LinesDeps = {}): Promise<LineCompare | Refusal> {
  if (!q.apInvoiceIds.length || !q.receivedIds.length) return refuse(400, "BAD_GROUP", "Choose a supplier invoice and a portal invoice to compare.", "اختر فاتورة مورد وفاتورة بوابة للمقارنة.")
  const g = await groupOf(db, env, q.apInvoiceIds, q.receivedIds)
  if (!g.ok) return g
  const [billLines, docLines, memory] = [await ourLinesOf(db, g.bills), await portalLinesFor(db, env, g.docs, deps), await readMemory(db, g.supplierId)]
  const ours = billLines.flatMap((b) => b.lines)
  const portal = docLines.flatMap((d) => d.lines)
  const { rows, summary } = compareLines(ours, portal, memory.rows)
  return {
    ok: true,
    supplierId: g.supplierId,
    memoryReady: memory.ready,
    bills: billLines.map((b) => ({ invoiceId: b.invoiceId, invoiceNumber: b.invoiceNumber, source: b.source, lines: b.lines.length })),
    docs: docLines.map((d) => ({ receivedId: d.receivedId, internalId: d.internalId, skipped: d.skipped, unread: d.unread, lines: d.lines.length })),
    rows,
    summary,
  }
}

// ---------------------------------------------------------------- pairs the accountant makes or takes apart

export interface PairRequest {
  action: "pair" | "unpair"
  apInvoiceId: number
  ourKey: string
  /** "<received_id>:<index>" */
  portalKey: string
}

export function parsePairRequest(v: any): PairRequest | null {
  const action = v?.action === "pair" || v?.action === "unpair" ? v.action : null
  const apInvoiceId = Number(v?.apInvoiceId)
  const ourKey = text(v?.ourKey)
  const portalKey = text(v?.portalKey)
  if (!action || !Number.isSafeInteger(apInvoiceId) || apInvoiceId <= 0) return null
  if (!/^(l\d+|p\d+-\d+)$/.test(ourKey) || !/^\d+:\d+$/.test(portalKey)) return null
  return { action, apInvoiceId, ourKey, portalKey }
}

/**
 * Remembers a pair for the supplier: "pair" = these two lines are the same item (the portal line's other remembered
 * items are forgotten), "unpair" = never pair them automatically again. Both lines are read again from the database;
 * the two invoices must be of one supplier.
 */
export async function saveLinePair(db: Db, env: EtaEnv, req: PairRequest, rawUserId: unknown): Promise<{ ok: true; changed: number } | Refusal> {
  const receivedId = Number(req.portalKey.split(":")[0])
  const index = Number(req.portalKey.split(":")[1])
  const probe = await db.from(MEMORY_TABLE).select("memory_id").limit(1)
  if (probe.error) {
    if (isMissingRelation(probe.error)) return DB_UPDATE_NEEDED
    throw new Error(`read line pair memory: ${probe.error.message || probe.error}`)
  }
  const checked = await checkPair(db, { receivedId, apInvoiceId: req.apInvoiceId })
  if (!checked.ok) return checked
  const supplierId = num(checked.ap.supplier_id)
  const bill = must(await db.from("accounts_payable").select("invoice_id, invoice_number, supplier_id, po_id").eq("invoice_id", req.apInvoiceId).maybeSingle(), "read supplier invoice")
  const [billLines] = await ourLinesOf(db, [bill])
  const our = billLines.lines.find((l) => l.key === req.ourKey)
  const doc = must(await db.from("eta_received_documents").select("received_id, environment, lines").eq("received_id", receivedId).maybeSingle(), "read received document")
  const portalLine = doc && doc.environment === env ? portalLinesOf(receivedId, doc.lines).find((l) => l.index === index) : undefined
  if (!our || !portalLine) return refuse(404, "LINE_NOT_FOUND", "That line is no longer on the invoice. Reload the comparison.", "هذا البند لم يعد على الفاتورة. أعد تحميل المقارنة.")

  const key = { supplier_id: supplierId, portal_name: portalNameOf(portalLine), portal_code: portalCodeOf(portalLine), our_key: ourMemoryKey(our) }
  if (!key.portal_name && !key.portal_code) return refuse(409, "NO_DESCRIPTION", "The portal line has no description or code to remember.", "بند البوابة بلا وصف أو كود يمكن حفظه.")
  const userId = await knownUserId(db, rawUserId)
  const kind = req.action === "pair" ? "confirmed" : "rejected"
  if (req.action === "pair") {
    // the portal line is this item now: its other remembered items are forgotten
    const others = must(
      await db.from(MEMORY_TABLE).select("memory_id, our_key, kind").eq("supplier_id", supplierId).eq("portal_name", key.portal_name).eq("portal_code", key.portal_code),
      "read line pair memory",
    ) as any[]
    const stale = others.filter((m) => m.our_key !== key.our_key && m.kind === "confirmed").map((m) => m.memory_id)
    if (stale.length) must(await db.from(MEMORY_TABLE).delete().in("memory_id", stale), "update line pair memory")
  }
  const up = await db.from(MEMORY_TABLE).upsert(
    { ...key, product_id: our.productId, our_name: normalizeName(our.name), portal_description: portalLine.description.slice(0, 500), kind, created_by: userId, updated_at: new Date().toISOString() },
    { onConflict: "supplier_id,portal_name,portal_code,our_key" },
  )
  if (up.error) {
    if (isMissingRelation(up.error)) return DB_UPDATE_NEEDED
    return refuse(500, "WRITE_FAILED", "Could not save the line pair.", "تعذر حفظ ربط البنود.")
  }
  const ev = await db.from("workflow_events").insert({
    entity_type: "AP_INVOICE",
    entity_id: req.apInvoiceId,
    event_type: req.action === "pair" ? "AP_LINE_PAIRED" : "AP_LINE_UNPAIRED",
    old_value: null,
    new_value: `${kind}:${receivedId}:${index}`,
    notes: `Portal line "${portalLine.description.slice(0, 120)}" ${req.action === "pair" ? "paired with" : "taken apart from"} "${our.name.slice(0, 120)}" on ${text(bill.invoice_number) || req.apInvoiceId}`,
    performed_by: userId,
  })
  if (ev.error) console.error(`AP lines: could not record the line pair for AP invoice ${req.apInvoiceId}`, ev.error)
  return { ok: true, changed: 1 }
}

/** "1,2,3" -> [1, 2, 3] (positive integers, at most MAX_GROUP_SIDE), or null */
export function parseIds(raw: string | null): number[] | null {
  if (!raw) return []
  const ids = raw.split(",").map((s) => Number(s.trim()))
  if (ids.length > MAX_GROUP_SIDE || ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) return null
  return [...new Set(ids)]
}
