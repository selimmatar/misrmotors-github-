// The supplier bills (accounts_payable rows) of a purchase order (owner request, 2026-11-11; several bills 2026-11-17).
//
// A PO is "open" (work in progress) until someone closes it: it can be edited, exchanged, returned against and paid an
// advance on. While open, "Bill received items" can make bills for what was received so far (APINV-<po>-B<n>), the PO
// staying open. "Close PO & send to Accounts Payable" makes the closing bill (APINV-<po>) for everything not billed yet,
// except quantities marked "not coming" on the PO lines; then the PO is final. "Reopen PO" removes the LAST bill again
// while nothing has been paid on it. A PO with a closing bill is "closed" (lib/po-bill-number.ts).
//
// Supplier credits reserved on the PO (credits from returns picked when the PO was made, and advances paid on the open
// PO) settle the FIRST bills until they are used up (owner decision "option A", 2026-11-17): each part becomes a
// supplier_payments row with a reference number that marks it as made by the bill, so a reopen can take it off again.
// They are not cash movements at billing: an advance wrote its cash entry when it was paid, a return credit never moves
// cash.
//
// Each bill keeps its lines in ap_invoice_lines (scripts/sql/2026-11-17-ap-invoice-lines.sql). Until that table exists
// the code works as before: only one bill for the whole PO, at close.
import { SUPPLIER_CREDIT_PAYMENT_METHOD, creditedInvoiceFields } from "./supplier-credit-apply"
import { receivedByItem } from "./po-edit"
import { closingBillNumber, closingBillOf, partialBillNo, partialBillNumber, sortBills } from "./po-bill-number"
import { PO_CLOSED_NO_BILL, isClosedWithoutBill, writeCloseMarker } from "./po-closed-marker"

type Db = any

export const ADVANCE_CREDIT_TYPE = "advance"
export { PO_CLOSE_ROLES, PO_CLOSABLE_STATUSES } from "./po-edit"

const today = () => new Date().toISOString().split("T")[0]
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => Number(v) || 0
const EPS = 1e-6

/** Payment rows the bill itself wrote (credits / advances taken off the bill): they are not payments made later. */
export const isClosePayment = (payment: { reference_number?: string | null }, invoiceNumber: string) => {
  const ref = String(payment.reference_number || "")
  return ref === `${invoiceNumber}-CREDIT` || ref.startsWith(`${invoiceNumber}-ADV-`) || ref.startsWith(`${invoiceNumber}-CR-`)
}

/** The method an advance was paid with, kept in its notes ("method=cash; ..."). */
export const advanceMethod = (credit: { notes?: string | null }) => /method=([a-z_]+)/.exec(String(credit.notes || ""))?.[1] || "cash"

export async function billsOf(db: Db, poId: number): Promise<any[]> {
  const { data, error } = await db.from("accounts_payable").select("*").eq("po_id", poId)
  if (error) throw new Error(`read supplier bill: ${error.message}`)
  return data || []
}

/**
 * True when the PO is closed (final): it has its closing bill, or it was closed without one because its bills for
 * received items already took everything (lib/po-closed-marker.ts). Partial bills alone leave it open.
 */
export async function isPoClosed(db: Db, po: { po_id: number; po_number?: string | null }): Promise<boolean> {
  return !!closingBillOf(await billsOf(db, po.po_id), po.po_number) || (await isClosedWithoutBill(db, po.po_id))
}

/** Bill statuses that mean money was paid on it. */
const PAID_STATUSES = new Set(["paid", "partially_paid", "partial"])

/**
 * True when money has been paid on any of these bills (not counting what the bill itself took off): a payment row the
 * bill did not write, a paid schedule entry, months paid, a paid amount above the credits / advances the bill took off
 * itself, or a paid status those do not explain (owner rule, 2026-11-22: a bill with any payment is never deleted or
 * replaced by Reopen / Remove last bill / an exchange).
 */
export async function billHasPayments(db: Db, bills: any[]): Promise<boolean> {
  for (const bill of bills) {
    if ((Number(bill.months_paid) || 0) > 0) return true
    const { data: payments, error } = await db.from("supplier_payments").select("payment_id, reference_number, payment_method, amount").eq("invoice_id", bill.invoice_id)
    if (error) throw new Error(`read supplier payments: ${error.message}`)
    // anything the bill did not write counts as paid, a credit applied by hand from Accounts Payable included
    if ((payments || []).some((p: any) => !isClosePayment(p, bill.invoice_number))) return true
    const own = money((payments || []).filter((p: any) => isClosePayment(p, bill.invoice_number)).reduce((s: number, p: any) => s + num(p.amount), 0))
    if (num(bill.paid_amount) > own + 0.005) return true
    if (PAID_STATUSES.has(String(bill.status || "").toLowerCase()) && own <= 0.005) return true
    const { data: schedules, error: schedulesError } = await db.from("payment_schedules").select("schedule_id, paid_amount, status").eq("invoice_id", bill.invoice_id)
    if (schedulesError) throw new Error(`read payment schedule: ${schedulesError.message}`)
    if ((schedules || []).some((s: any) => (Number(s.paid_amount) || 0) > 0 || s.status === "paid" || s.status === "partial")) return true
  }
  return false
}

/** What a reopen keeps of a removed unpaid closing bill, so closing again makes it with the same number and dates. */
export interface RemovedBillDates {
  invoiceNumber: string
  invoiceDate: string | null
  dueDate: string | null
  supplierInvoiceNumber: string | null
}

export const removedBillDates = (bill: any): RemovedBillDates => ({
  invoiceNumber: String(bill.invoice_number || ""),
  invoiceDate: bill.invoice_date ? String(bill.invoice_date).slice(0, 10) : null,
  dueDate: bill.due_date ? String(bill.due_date).slice(0, 10) : null,
  supplierInvoiceNumber: bill.supplier_invoice_number ?? null,
})

/**
 * The dates of the closing bill the latest reopen removed (owner request, 2026-11-22), while the PO is still open after
 * that reopen; null otherwise. Kept as `removedBill` in the PO_REOPENED event's new_value JSON.
 */
export async function reopenedBillDates(db: Db, poId: number): Promise<RemovedBillDates | null> {
  const { data, error } = await db
    .from("workflow_events")
    .select("event_id, event_type, new_value")
    .eq("entity_type", "PURCHASE_ORDER")
    .eq("entity_id", poId)
    .in("event_type", ["PO_CLOSED", "PO_REOPENED"])
  if (error) return null
  const latest = [...(data || [])].sort((a: any, b: any) => num(b.event_id) - num(a.event_id))[0]
  if (!latest || latest.event_type !== "PO_REOPENED") return null
  try {
    const kept = JSON.parse(latest.new_value || "{}").removedBill
    return kept && kept.invoiceDate ? kept : null
  } catch {
    return null
  }
}

/** True when the error says a table / column does not exist yet (the migration is not applied). */
export const isMissingRelation = (error: any) =>
  !!error &&
  (["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error.code)) || /does not exist|could not find the table|schema cache/i.test(String(error.message || "")))

export interface PoBillLine {
  poItemId: number
  productId: number | null
  name: string
  unitPrice: number
  ordered: number
  received: number
  billed: number
  notComing: number
  /** received and not billed yet: the most a "bill received items" bill can take */
  open: number
  /** not billed yet and not marked "not coming": what the closing bill takes */
  rest: number
}

export interface PoBilling {
  po: any
  items: any[]
  /** oldest first */
  bills: any[]
  closing: any | null
  /** closed with no closing bill: nothing was left to bill (lib/po-closed-marker.ts) */
  closedWithoutBill: boolean
  /** closed = the closing bill, or the no-bill close marker */
  closed: boolean
  /** ap_invoice_lines exists (the 2026-11-17 migration is applied) */
  ready: boolean
  linesByBill: Map<number, any[]>
  lines: PoBillLine[]
  /** PO total / sum of the line values: the VAT (and any other PO-level amount) pro-rated by line value */
  factor: number
  billedAmount: number
  billedPercent: number
}

/** Bill lines of these bills; `ready` false when the table does not exist yet (then there are no lines). */
export async function billLinesOf(db: Db, billIds: number[]): Promise<{ ready: boolean; lines: any[] }> {
  const { data, error } = await db.from("ap_invoice_lines").select("*").in("ap_invoice_id", billIds.length ? billIds : [-1])
  if (error) {
    if (isMissingRelation(error)) return { ready: false, lines: [] }
    throw new Error(`read bill lines: ${error.message}`)
  }
  return { ready: true, lines: data || [] }
}

/** Everything about the billing of a PO: its bills, what each line ordered / received / billed, and what is left. */
export async function loadPoBilling(db: Db, po: any): Promise<PoBilling> {
  const bills = sortBills(await billsOf(db, po.po_id))
  const closing = closingBillOf(bills, po.po_number)
  const { data: itemRows, error: itemsError } = await db.from("purchase_order_items").select("*").eq("po_id", po.po_id)
  if (itemsError) throw new Error(`read PO lines: ${itemsError.message}`)
  const items = [...(itemRows || [])].sort((a: any, b: any) => num(a.po_item_id) - num(b.po_item_id))
  const { ready, lines: billLines } = await billLinesOf(db, bills.map((b) => b.invoice_id))
  const linesByBill = new Map<number, any[]>()
  for (const l of billLines) linesByBill.set(num(l.ap_invoice_id), [...(linesByBill.get(num(l.ap_invoice_id)) || []), l])
  // a closing bill without lines (made before 2026-11-17): the whole PO is billed
  const wholeBilled = !!closing && !(linesByBill.get(num(closing.invoice_id)) || []).length
  const billedById = new Map<number, number>()
  for (const l of billLines) if (l.po_item_id != null) billedById.set(num(l.po_item_id), (billedById.get(num(l.po_item_id)) || 0) + num(l.quantity))
  const received = await receivedByItem(db, items.map((i: any) => i.po_item_id))
  const productIds = [...new Set(items.filter((i: any) => i.product_id && !i.item_name_snapshot && !i.outsourced_name).map((i: any) => i.product_id))]
  const productNames = new Map<number, string>()
  if (productIds.length) {
    const { data: products } = await db.from("products").select("product_id, product_name").in("product_id", productIds)
    for (const p of products || []) productNames.set(num(p.product_id), p.product_name)
  }
  const lines: PoBillLine[] = items
    .filter((i: any) => num(i.quantity) > 0 || (billedById.get(num(i.po_item_id)) || 0) > 0)
    .map((i: any) => {
      const ordered = num(i.quantity)
      const notComing = Math.min(Math.max(0, num(i.quantity_not_coming)), ordered)
      const billed = wholeBilled ? ordered : billedById.get(num(i.po_item_id)) || 0
      const got = received.get(i.po_item_id) || 0
      return {
        poItemId: num(i.po_item_id),
        productId: i.product_id ?? null,
        name: i.outsourced_name || i.item_name_snapshot || productNames.get(num(i.product_id)) || `Item ${i.po_item_id}`,
        unitPrice: num(i.unit_price),
        ordered,
        received: got,
        billed,
        notComing,
        open: money(Math.max(0, Math.min(got, ordered) - billed)),
        rest: money(Math.max(0, ordered - billed - notComing)),
      }
    })
  const subtotal = money(items.reduce((s: number, i: any) => s + money(num(i.quantity) * num(i.unit_price)), 0))
  const factor = subtotal > 0 ? num(po.total) / subtotal : 1
  const billedAmount = money(bills.reduce((s, b) => s + num(b.amount), 0))
  const billedPercent = closing ? 100 : num(po.total) > 0 ? Math.min(100, Math.round((billedAmount / num(po.total)) * 100)) : 0
  const closedWithoutBill = !closing && (await isClosedWithoutBill(db, po.po_id))
  return { po, items, bills, closing, closedWithoutBill, closed: !!closing || closedWithoutBill, ready, linesByBill, lines, factor, billedAmount, billedPercent }
}

/** Quantity billed so far per PO line (only lines with something billed). */
export async function billedByItem(db: Db, po: any): Promise<Map<number, number>> {
  const billing = await loadPoBilling(db, po)
  return new Map(billing.lines.filter((l) => l.billed > 0).map((l) => [l.poItemId, l.billed]))
}

/**
 * Why a change cannot be made because a PO line would go below what its bills already charged (new quantity per
 * po_item_id; a line left out is not changed), or null. The supplier was billed for that quantity: send it back as a
 * credit instead.
 */
export async function belowBilledRefusal(db: Db, po: any, newQtyById: Map<number, number>): Promise<{ code: string; error: string } | null> {
  const billed = await billedByItem(db, po)
  for (const [id, qty] of newQtyById) {
    const b = billed.get(id) || 0
    if (qty < b - EPS) {
      const { data: item } = await db.from("purchase_order_items").select("item_name_snapshot, outsourced_name").eq("po_item_id", id).maybeSingle()
      const name = item?.outsourced_name || item?.item_name_snapshot || "an item"
      return { code: "PO_LINE_BILLED", error: `${b} of "${name}" are already on a supplier bill, so that line cannot go below ${b}` }
    }
  }
  return null
}

/**
 * How a return to the supplier is taken from each PO line (owner rule, 2026-11-22): on an open PO the part not billed
 * yet comes off the line (the bill made at close is then the final one); what a supplier bill already charged — and
 * everything on a closed PO — stays on the PO and its bill and comes back as a supplier credit instead.
 */
export function returnSplit(
  lines: { id: number; taken: number; quantity: number; billed: number }[],
  closed: boolean,
): Map<number, { lower: number; credit: number }> {
  const out = new Map<number, { lower: number; credit: number }>()
  for (const l of lines) {
    const lower = closed ? 0 : money(Math.min(l.taken, Math.max(0, l.quantity - l.billed)))
    out.set(l.id, { lower, credit: money(l.taken - lower) })
  }
  return out
}

/** What the PO's earlier bills already took from each reserved advance (by credit id) and from the return credits. */
async function creditsTakenBefore(db: Db, bills: any[]): Promise<{ advances: Map<number, number>; returns: number }> {
  const advances = new Map<number, number>()
  let returns = 0
  for (const bill of bills) {
    const { data, error } = await db.from("supplier_payments").select("amount, reference_number").eq("invoice_id", bill.invoice_id)
    if (error) throw new Error(`read supplier payments: ${error.message}`)
    for (const p of data || []) {
      const ref = String(p.reference_number || "")
      if (ref === `${bill.invoice_number}-CREDIT`) returns = money(returns + num(p.amount))
      else if (ref.startsWith(`${bill.invoice_number}-ADV-`)) {
        const id = Number(ref.slice(`${bill.invoice_number}-ADV-`.length))
        if (Number.isFinite(id)) advances.set(id, money((advances.get(id) || 0) + num(p.amount)))
      }
    }
  }
  return { advances, returns }
}

/** Supplier invoice number and date typed on a bill (both optional). */
export function billDetails(body: any): { supplierInvoiceNumber: string | null; invoiceDate: string | null } | { error: string } {
  const supplierInvoiceNumber = String(body?.supplierInvoiceNumber ?? "").trim().slice(0, 100) || null
  const raw = String(body?.invoiceDate ?? "").trim()
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "The supplier invoice date must be a date (YYYY-MM-DD)" }
  return { supplierInvoiceNumber, invoiceDate: raw || null }
}

export interface BillOptions {
  /** the closing bill (APINV-<po>); otherwise a bill for received items (APINV-<po>-B<n>) */
  final: boolean
  supplierInvoiceNumber?: string | null
  invoiceDate?: string | null
  /** the bill's due date (a re-close keeps the removed bill's); default: the PO's first due date, else today */
  dueDate?: string | null
}

/**
 * What a bill of these quantities (po_item_id -> quantity) comes to: the quantities x PO prices with the VAT pro-rated
 * (billing.factor); a closing bill that takes everything left is the PO total less the earlier bills.
 */
export function billAmount(billing: PoBilling, qtyById: Map<number, number>, final: boolean): { amount: number; coversAll: boolean } {
  const value = money(
    billing.lines.reduce((s, line) => s + money(money(Math.max(0, qtyById.get(line.poItemId) || 0)) * line.unitPrice), 0),
  )
  // every line fully billed once this bill is made (nothing left out as "not coming")
  const coversAll = billing.lines.every((l) => l.billed + (qtyById.get(l.poItemId) || 0) >= l.ordered - EPS)
  const earlier = money(billing.bills.reduce((s, b) => s + num(b.amount), 0))
  const amount = final && coversAll ? money(Math.max(0, num(billing.po.total) - earlier)) : money(value * billing.factor)
  return { amount, coversAll }
}

/**
 * True when closing with these quantities would make a 0 bill (everything was billed already, or what is left is all
 * "not coming"): then no closing bill is made and the PO is only marked closed (lib/po-closed-marker.ts). The owner
 * wants no 0-amount bills (2026-11-18).
 */
export const closesWithoutBill = (billing: PoBilling, qtyById: Map<number, number>) => billAmount(billing, qtyById, true).amount <= 0

/**
 * Makes one bill of the PO for these quantities (po_item_id -> quantity) at the PO unit prices; the PO's VAT is
 * pro-rated by line value (billing.factor). A closing bill that takes everything left is the PO total less the earlier
 * bills, so the bills add up to the PO total exactly. Reserved credits / advances not used by earlier bills come off it.
 * Returns the error, or the new bill. Everything it wrote is removed again on a failure.
 */
export async function createBill(
  db: Db,
  billing: PoBilling,
  qtyById: Map<number, number>,
  opts: BillOptions,
): Promise<{ error: { message: string } | null; invoice?: any }> {
  const po = billing.po
  const billRows = billing.lines
    .map((line) => ({ line, qty: money(Math.max(0, qtyById.get(line.poItemId) || 0)) }))
    .filter((x) => x.qty > 0)
    .map(({ line, qty }) => ({
      po_item_id: line.poItemId,
      product_id: line.productId,
      description: line.name,
      quantity: qty,
      unit_price: line.unitPrice,
      total: money(qty * line.unitPrice),
    }))
  const { amount, coversAll } = billAmount(billing, qtyById, opts.final)
  // the one bill of the whole PO, as before 2026-11-17: possible without the bill-lines table
  const single = opts.final && billing.bills.length === 0 && coversAll
  if (!billing.ready && !single) {
    return { error: { message: "The bill lines table (ap_invoice_lines) does not exist yet: apply scripts/sql/2026-11-17-ap-invoice-lines.sql" } }
  }

  const { data: reserved, error: reservedError } = await db
    .from("supplier_credits")
    .select("credit_id, amount, credit_type, notes, description")
    .eq("used_in_po_id", po.po_id)
    .eq("status", "used")
  if (reservedError) return { error: { message: `Could not read the supplier credits: ${reservedError.message}` } }
  let taken: { advances: Map<number, number>; returns: number }
  try {
    taken = await creditsTakenBefore(db, billing.bills)
  } catch (e: any) {
    return { error: { message: e.message } }
  }
  const advances = (reserved || [])
    .filter((c: any) => c.credit_type === ADVANCE_CREDIT_TYPE)
    .map((c: any) => ({ credit: c, left: money(num(c.amount) - (taken.advances.get(num(c.credit_id)) || 0)) }))
    .filter((a: any) => a.left > 0)
  const returnsLeft = Math.max(
    0,
    money((reserved || []).filter((c: any) => c.credit_type !== ADVANCE_CREDIT_TYPE).reduce((s: number, c: any) => s + num(c.amount), 0) - taken.returns),
  )
  const available = money(advances.reduce((s: number, a: any) => s + a.left, 0) + returnsLeft)
  const credited = creditedInvoiceFields(amount, available)

  const nextNo = Math.max(0, ...billing.bills.map((b) => partialBillNo(b.invoice_number, po.po_number) || 0)) + 1
  const invoiceNumber = opts.final ? closingBillNumber(po.po_number) : partialBillNumber(po.po_number, nextNo)
  const paymentType = po.payment_type || po.payment_terms || "cash"
  const invoiceData: any = {
    invoice_number: invoiceNumber,
    supplier_id: po.supplier_id,
    po_id: po.po_id,
    invoice_date: opts.invoiceDate || today(),
    due_date: opts.dueDate || po.down_payment_due_date || po.payment_start_date || today(),
    amount,
    paid_amount: credited.paid_amount,
    status: credited.status,
    payment_type: paymentType,
    payment_terms: paymentType,
    installment_months: po.installments || 1,
    months_paid: 0,
    // the PO's own payment plan describes the whole PO: it is copied only onto a bill for the whole PO
    down_payment_amount: single ? po.down_payment_amount || null : null,
    down_payment_percent: single ? po.down_payment_percent || null : null,
    down_payment_type: single ? po.down_payment_type || null : null,
    down_payment_due_date: po.down_payment_due_date || null,
    remaining_amount: single ? po.remaining_amount || null : null,
    remaining_installment_months: single ? po.remaining_installment_months || null : null,
    monthly_amount: single ? po.monthly_amount || null : null,
    payment_start_date: po.payment_start_date || null,
    schedule_entries: single ? po.schedule_entries || null : null,
    schedule_mode: po.schedule_mode || "AUTO",
  }
  if (billing.ready && opts.supplierInvoiceNumber) invoiceData.supplier_invoice_number = opts.supplierInvoiceNumber
  const { data: invoice, error: invoiceError } = await db.from("accounts_payable").insert(invoiceData).select().single()
  if (invoiceError) return { error: invoiceError }
  const removeBill = async () => {
    await db.from("supplier_payments").delete().eq("invoice_id", invoice.invoice_id)
    if (billing.ready) await db.from("ap_invoice_lines").delete().eq("ap_invoice_id", invoice.invoice_id)
    const { error: removeError } = await db.from("accounts_payable").delete().eq("invoice_id", invoice.invoice_id)
    if (removeError) console.error("PO bill: could not remove the bill after a failure", removeError)
  }

  if (billing.ready && billRows.length > 0) {
    const { error: linesError } = await db.from("ap_invoice_lines").insert(billRows.map((r) => ({ ...r, ap_invoice_id: invoice.invoice_id })))
    if (linesError) {
      await removeBill()
      return { error: linesError }
    }
  }
  if (credited.paid_amount <= 0) return { error: null, invoice }

  // What the reserved credits settle, never more than the bill: advances first (real money already paid), then
  // credits from returns. Each is its own payment row so the bill's history shows how it was settled.
  let left = credited.paid_amount
  const rows: any[] = []
  for (const { credit, left: creditLeft } of advances) {
    const part = money(Math.min(creditLeft, left))
    if (part <= 0) continue
    left = money(left - part)
    rows.push({
      invoice_id: invoice.invoice_id,
      supplier_id: po.supplier_id ?? null,
      amount: part,
      payment_date: today(),
      payment_method: advanceMethod(credit),
      reference_number: `${invoice.invoice_number}-ADV-${credit.credit_id}`,
      receipt_url: null,
      recorded_by: null,
    })
  }
  const creditPart = money(Math.min(left, returnsLeft))
  if (creditPart > 0) {
    rows.push({
      invoice_id: invoice.invoice_id,
      supplier_id: po.supplier_id ?? null,
      amount: creditPart,
      payment_date: today(),
      payment_method: SUPPLIER_CREDIT_PAYMENT_METHOD,
      reference_number: `${invoice.invoice_number}-CREDIT`,
      receipt_url: null,
      recorded_by: null,
    })
  }
  const { error: paymentError } = rows.length > 0 ? await db.from("supplier_payments").insert(rows) : { error: null }
  if (paymentError) {
    await removeBill()
    return { error: paymentError }
  }
  return { error: null, invoice }
}

/**
 * Makes the closing bill of a PO unless it is closed already: everything not billed yet, less what is marked
 * "not coming" on its lines. Returns the error, or null when the PO is closed afterwards.
 */
export async function createPoBill(db: Db, po: any, opts: Omit<BillOptions, "final"> = {}): Promise<{ message: string } | null> {
  let billing: PoBilling
  try {
    billing = await loadPoBilling(db, po)
  } catch (e: any) {
    return { message: e.message }
  }
  if (billing.closed) return null
  const rest = new Map(billing.lines.map((l) => [l.poItemId, l.rest]))
  // nothing left to bill after its bills for received items: closed without a 0 bill (owner request, 2026-11-18)
  if (closesWithoutBill(billing, rest)) {
    try {
      await writeCloseMarker(db, po.po_id, { event_type: "PO_CLOSED", new_value: PO_CLOSED_NO_BILL, notes: `${po.po_number} closed; everything was already billed, so no closing bill` })
      return null
    } catch (e: any) {
      return { message: e.message }
    }
  }
  const { error } = await createBill(db, billing, rest, { ...opts, final: true })
  return error
}

/** The last bill of a PO (the newest), or null. Reopen removes only this one. */
export const lastBillOf = (bills: any[]) => {
  const sorted = sortBills(bills)
  return sorted.length ? sorted[sorted.length - 1] : null
}

/**
 * Removes these bill(s) of a PO (Reopen passes only the LAST bill). Only what the bill wrote goes (the bill, its lines,
 * the credit / advance rows it recorded, its unpaid schedule); the credits and advances stay reserved on the PO for the
 * next bill. Supplier credits that point at the bill (e.g. returns credited while it was closed) are unlinked first,
 * because the database refuses to delete a bill they point at; their ids are returned so the next close links them
 * again. The caller has checked that nothing was paid. Any failure puts back everything this call already changed.
 */
export async function removePoBills(db: Db, bills: any[]): Promise<{ unlinkedCreditIds: number[] }> {
  const undo: (() => PromiseLike<unknown>)[] = []
  const unlinkedCreditIds: number[] = []
  // never a bill with a payment on it (owner rule, 2026-11-22), whatever the caller checked
  if (await billHasPayments(db, bills)) throw Object.assign(new Error("A supplier bill with a payment on it cannot be removed"), { code: "PO_PAID" })
  try {
    for (const bill of bills) {
      const { data: linked, error: linkedError } = await db.from("supplier_credits").select("credit_id").eq("invoice_id", bill.invoice_id)
      if (linkedError) throw new Error(`read linked supplier credits: ${linkedError.message}`)
      const ids = (linked || []).map((c: any) => c.credit_id)
      if (ids.length > 0) {
        const { error: e } = await db.from("supplier_credits").update({ invoice_id: null }).in("credit_id", ids)
        if (e) throw new Error(`unlink supplier credits: ${e.message}`)
        undo.push(() => db.from("supplier_credits").update({ invoice_id: bill.invoice_id }).in("credit_id", ids))
        unlinkedCreditIds.push(...ids)
      }
      const { data: payments, error } = await db.from("supplier_payments").select("*").eq("invoice_id", bill.invoice_id)
      if (error) throw new Error(`read supplier payments: ${error.message}`)
      const own = (payments || []).filter((p: any) => isClosePayment(p, bill.invoice_number))
      if (own.length > 0) {
        const { error: e } = await db.from("supplier_payments").delete().in("payment_id", own.map((p: any) => p.payment_id))
        if (e) throw new Error(`remove credit payments: ${e.message}`)
        undo.push(() => db.from("supplier_payments").insert(own))
      }
      const { data: schedules, error: readScheduleError } = await db.from("payment_schedules").select("*").eq("invoice_id", bill.invoice_id)
      if (readScheduleError) throw new Error(`read payment schedule: ${readScheduleError.message}`)
      if ((schedules || []).length > 0) {
        const { error: scheduleError } = await db.from("payment_schedules").delete().eq("invoice_id", bill.invoice_id)
        if (scheduleError) throw new Error(`remove payment schedule: ${scheduleError.message}`)
        undo.push(() => db.from("payment_schedules").insert(schedules))
      }
      // the bill's lines (the database also removes them with the bill; a table not made yet has none)
      const { ready, lines } = await billLinesOf(db, [bill.invoice_id])
      if (ready && lines.length > 0) {
        const { error: linesError } = await db.from("ap_invoice_lines").delete().eq("ap_invoice_id", bill.invoice_id)
        if (linesError) throw new Error(`remove bill lines: ${linesError.message}`)
        undo.push(() => db.from("ap_invoice_lines").insert(lines))
      }
      const { error: billError } = await db.from("accounts_payable").delete().eq("invoice_id", bill.invoice_id)
      if (billError) throw new Error(`remove supplier bill: ${billError.message}`)
    }
    return { unlinkedCreditIds }
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (e) {
        console.error("PO bill: could not undo a reopen step", e)
      }
    }
    throw error
  }
}

/** After a close: credits a reopen unlinked from an old bill point at the newest bill of the PO again. */
export async function relinkCredits(db: Db, poId: number, creditIds: number[]): Promise<void> {
  if (creditIds.length === 0) return
  const { data: bill } = await db.from("accounts_payable").select("invoice_id").eq("po_id", poId).order("invoice_id", { ascending: false }).limit(1).maybeSingle()
  if (!bill) return
  const { error } = await db.from("supplier_credits").update({ invoice_id: bill.invoice_id }).in("credit_id", creditIds).is("invoice_id", null)
  if (error) console.error("PO bill: could not link the supplier credits to the new bill", error)
}

/** After a new bill: the credits earlier reopens / bill removals unlinked point at the newest bill again. */
export async function relinkUnlinkedCredits(db: Db, poId: number): Promise<void> {
  const { data: events } = await db
    .from("workflow_events")
    .select("new_value")
    .eq("entity_type", "PURCHASE_ORDER")
    .eq("entity_id", poId)
    .in("event_type", ["PO_REOPENED", "PO_BILL_REMOVED"])
  const ids = new Set<number>()
  for (const e of events || []) {
    try {
      for (const id of JSON.parse(e.new_value || "{}").unlinkedCreditIds || []) ids.add(Number(id))
    } catch {
      // an older reopen without the list
    }
  }
  await relinkCredits(db, poId, [...ids])
}
