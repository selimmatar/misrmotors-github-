// Invoice generation (Batch 1B).
//
// Two supported workflows, never both for the same sales order:
//   A. Sales order -> invoice : one invoice for the WHOLE sales order (accounts_receivable.so_id, no DP links).
//   B. Delivery permit -> invoice : an invoice for only the items on the selected APPROVED delivery permit(s)
//      (linked through invoice_delivery_permits). A sales order may have many such invoices as long as the
//      cumulative invoiced quantity and value never exceed the sales order.
//
// Concurrency note: there is no database transaction here (no RPC/trigger/constraint was added). The only
// DB-enforced guard is UNIQUE(permit_id) on invoice_delivery_permits. Everything else is checked before the
// insert, then re-checked after it with a deterministic rule: among conflicting invoices the one with the
// LOWEST invoice_id survives; a higher-id invoice rolls itself back. See createSoInvoice/createDpInvoices.

import { resolveInstallmentCount } from "./payment-type"
import { excludeReplaced } from "./ar-live"
import { numberTakenMessage } from "./doc-number"
import { invoiceCodeForOrders, invoiceYear2, nextCodedNumber, type InvoiceCode } from "./invoice-codes"
import { pendingMinvNumbers } from "./maintenance-booklets"
import { loadSharedStart, manualNumberHolder, markSlotUsed, recordManualNumber, releaseSlot, releaseSlotOfInvoice, takeSharedNumber } from "./shared-invoice-numbers"
import {
  DELIVERED_PERMIT_STATUSES,
  invoiceablePool,
  lineKey,
  loadReturnLines,
  netLineQuantities,
  returnedByKey,
  toMs,
  type ReturnLine,
} from "./return-lines"
import { etaLines, etaTolerance, type EtaLineIn } from "./eta/totals"
import { pricedPerLine, VAT_RATE, vatPerLine, vatPrintTotals } from "./vat-lines"
import {
  correctionOfPermits, openCorrectionsForOrder, reissueInvoice, ReissueNumberTaken, ReissueRefused, REISSUE_OVERPAID, undoReissue,
  type OpenCorrection,
} from "./eta/correction"

// Batch 2: quantity returned against a delivery permit (valid = non-rejected) reduces what can still be invoiced:
//   ordered - already invoiced - returned = remaining invoiceable (never below zero)
// (see invoiceablePool in return-lines.ts for the exact rule, which also copes with a sales order that was edited
// after a return). Both workflows are return-aware: a delivery-permit invoice bills only the net quantity, and a
// whole-order invoice leaves out the returned quantity. Returns never touch existing invoices; they only change
// what may be invoiced from now on.

export { VAT_RATE }
// Rounding slack when comparing cumulative invoiced value with the sales order total.
export const MONEY_TOLERANCE = 0.05
const QTY_EPSILON = 1e-6
const MAX_NUMBER_ATTEMPTS = 4

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

// Value of a set of items (pre-discount, pre-VAT `rawItemsTotal`) once the sales order's discount rate and
// 14% VAT are applied ON THE TOTAL: the rule of invoices stored before VAT was rounded per line (lib/vat-lines.ts).
// Still used to recompute the value of those older invoices and for return credits; new invoices are priced per line.
export function netInvoiceValue(rawItemsTotal: number, soSubtotal: number, soDiscountAmount: number) {
  const discountRate = soSubtotal > 0 ? soDiscountAmount / soSubtotal : 0
  return rawItemsTotal * (1 - discountRate) * (1 + VAT_RATE)
}
// The amount a delivery-permit invoice stored before VAT was rounded per line (VAT on the total).
export const computeInvoiceAmount = (rawItemsTotal: number, soSubtotal: number, soDiscountAmount: number) =>
  round2(netInvoiceValue(rawItemsTotal, soSubtotal, soDiscountAmount))

export const itemRawTotal = (item: { total?: any; quantity?: any; unit_price?: any }) =>
  item.total != null ? Number(item.total) : Number(item.quantity || 0) * Number(item.unit_price || 0)

// What the sales order's discount_amount is a share of: the order's pre-discount line total. sales_orders.subtotal
// cannot be used for that - the sales-order screen and the quotation-convert dialog store it AFTER the discount,
// the quotation approve route BEFORE it. The stored subtotal is only the fallback for lines that carry no price.
export function soDiscountBase(soItems: { total?: any; quantity?: any; unit_price?: any }[], soSubtotal: number) {
  const gross = soItems.reduce((sum, item) => sum + itemRawTotal(item), 0)
  return gross > 0 ? gross : Number(soSubtotal) || 0
}

// Totals of a delivery-permit invoice under the earlier rule (VAT on the total). The invoice print now uses
// vatPrintTotals (lib/vat-lines.ts: per-line VAT, the stored amount printed when it differs); kept for older callers.
export function dpInvoicePrintTotals(rawItemsTotal: number, discountBase: number, soDiscountAmount: number, storedAmount: number | null | undefined) {
  const computed = computeInvoiceAmount(rawItemsTotal, discountBase, soDiscountAmount)
  const stored = storedAmount == null ? NaN : Number(storedAmount)
  if (Number.isFinite(stored) && Math.abs(stored - computed) > MONEY_TOLERANCE) {
    const totalWithVat = round2(stored)
    const subtotalBeforeVat = round2(totalWithVat / (1 + VAT_RATE))
    return { totalWithVat, subtotalBeforeVat, vatAmount: round2(totalWithVat - subtotalBeforeVat) }
  }
  const discountRate = discountBase > 0 ? soDiscountAmount / discountBase : 0
  const subtotalBeforeVat = round2(rawItemsTotal * (1 - discountRate))
  return { totalWithVat: computed, subtotalBeforeVat, vatAmount: round2(computed - subtotalBeforeVat) }
}

// ---------------------------------------------------------------------------------------------------------
// VAT per line (owner, 2026-11-22) - every invoice created from VAT_PER_LINE_FROM on (and any created after the
// e-invoice go-live, company_settings.eta_go_live_at) is priced line by line (lib/vat-lines.ts: VAT rounded per line,
// totals = sums of the rounded lines) and the over-invoicing checks use etaCheckTolerance (the lines involved). Invoices
// stored earlier keep their stored amount and are recounted with the earlier rule (netInvoiceValue / MONEY_TOLERANCE).
// ---------------------------------------------------------------------------------------------------------
export const ETA_GO_LIVE_KEY = "eta_go_live_at"
const nowIso = () => new Date().toISOString()

/** The order discount rate today's rule applies: discount_amount over the pre-discount line total (0 when that is 0). */
export function orderDiscountRate(soItems: { total?: any; quantity?: any; unit_price?: any }[], soSubtotal: number, soDiscountAmount: number) {
  const base = soDiscountBase(soItems, soSubtotal)
  return base > 0 ? (Number(soDiscountAmount) || 0) / base : 0
}

/** Unit price of a billed line: its unit_price; when that is missing (or 0 on a line that has a value), total / quantity. */
export function etaUnitPrice(item: { total?: any; quantity?: any; unit_price?: any }) {
  const unit = item.unit_price == null || item.unit_price === "" ? Number.NaN : Number(item.unit_price)
  const qty = Number(item.quantity) || 0
  const fromTotal = qty > 0 ? itemRawTotal(item) / qty : 0
  if (!Number.isFinite(unit) || (unit === 0 && fromTotal > 0)) return fromTotal
  return unit
}

/**
 * Totals printed on an invoice created after go-live: the per-line totals of the printed lines. The printed total must
 * equal the stored amount, so when they differ (e.g. the order was edited after invoicing) the stored amount is printed
 * and split into pre-VAT and VAT, as dpInvoicePrintTotals does.
 */
export function etaInvoicePrintTotals(lines: EtaLineIn[], discountRate: number, storedAmount: number | null | undefined) {
  const { totalWithVat, subtotalBeforeVat, vatAmount } = vatPrintTotals(lines, discountRate, storedAmount)
  return { totalWithVat, subtotalBeforeVat, vatAmount }
}

// Postgres "relation does not exist" / PostgREST "table not in the schema cache": no settings table = not live.
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])
/** Whether the "set but not a date" warning was logged in this process (once is enough). */
export const etaGoLiveWarning = { shown: false }

/**
 * The go-live moment (company_settings.eta_go_live_at), or null when it is not set: no row, an empty value, or no
 * company_settings table. Any other read error THROWS - after go-live a guess would store an amount under the wrong
 * rule. A value that is set but cannot be read as a date also means "not live" (warned once).
 */
export async function loadEtaGoLiveAt(db: any): Promise<string | null> {
  const res = await db.from("company_settings").select("setting_key, setting_value").eq("setting_key", ETA_GO_LIVE_KEY)
  if (res?.error) {
    if (MISSING_TABLE_CODES.has(String(res.error.code || ""))) return null
    throw new Error(`load ${ETA_GO_LIVE_KEY}: ${res.error.message || res.error}`)
  }
  const rows: any[] = Array.isArray(res?.data) ? res.data : res?.data ? [res.data] : []
  const value = rows.find((r) => r?.setting_key === ETA_GO_LIVE_KEY)?.setting_value
  const text = value == null ? "" : String(value).trim()
  if (!text) return null
  if (Number.isNaN(toMs(text)) && !etaGoLiveWarning.shown) {
    etaGoLiveWarning.shown = true
    console.warn(`[invoicing] ${ETA_GO_LIVE_KEY} is set but is not a date (${JSON.stringify(text)}); the pre-go-live rule stays in force.`)
  }
  return text
}

// Invoices may not be priced while the go-live setting cannot be read.
const goLiveUnreadable = (state: SoInvoicingState): Verdict | null =>
  state.etaGoLiveError
    ? { ok: false, status: 503, error: `The e-invoice go-live setting could not be read (${state.etaGoLiveError}). Nothing was created; please try again.` }
    : null

/**
 * Over-invoicing slack after go-live: per-line rounding happens on every e-invoice line, and with a discount one line
 * can move by about 0.0107 (discount and VAT both rounded), so the count is the larger of the order's lines and the
 * e-invoice lines of the post-go-live invoices being compared (`etaLineTotal`), at 0.011 a line (never below 0.05).
 */
export function etaCheckTolerance(orderLines: number, etaLineTotal: number) {
  const count = Math.max(orderLines, etaLineTotal)
  return Math.max(etaTolerance(count), Math.round(11 * count) / 1000)
}
// Float slack on the post-go-live comparison, so a sum landing exactly on the limit is not refused.
const ETA_COMPARE_EPSILON = 1e-6

// Same line matching as isSOFullyDelivered in the delivery-permits route: by product, else by name.
// (Defined in return-lines.ts so returns and invoicing can never disagree on what "the same line" means.)
export { lineKey }

// ---------------------------------------------------------------------------------------------------------
// Pure rules (no I/O) - unit tested
// ---------------------------------------------------------------------------------------------------------

export interface DpItem {
  product_id: number | null
  item_name_snapshot: string | null
  quantity: number
  unit_price?: number
  total?: number | null
}
export interface SoInvoicingState {
  so: {
    so_id: number
    so_number?: string
    customer_id?: number | null
    total: number
    subtotal: number
    discount_amount: number
    payment_type?: string | null
    payment_terms?: string | null
    installments?: number | null
  }
  soItems: { product_id: number | null; outsourced_name: string | null; quantity: number; unit_price?: number; total?: number | null }[]
  /** every delivery permit of this sales order */
  permits: { permit_id: number; permit_no?: string; status: string; items: DpItem[] }[]
  /** every invoice attributable to this sales order (so_id = SO, or linked to one of its DPs) */
  invoices: {
    invoice_id: number
    invoice_number?: string
    so_id: number | null
    amount: number
    permit_ids: number[]
    /** accounts_receivable.created_at - decides which returns were already known when the invoice was priced */
    created_at?: string | null
  }[]
  /** valid (non-rejected) return lines against this sales order's delivery permits */
  returns: ReturnLine[]
  /** company_settings.eta_go_live_at (ISO date-time); empty / missing = not live, today's rule everywhere */
  etaGoLiveAt?: string | null
  /** set when the go-live setting could not be read: no invoice may be created (evaluate* refuse with 503) */
  etaGoLiveError?: string
}

export type Verdict = { ok: true; newValue?: number } | { ok: false; status: number; error: string }

const isSoLevelInvoice = (inv: SoInvoicingState["invoices"][number]) => inv.permit_ids.length === 0
const ownPermitIds = (state: SoInvoicingState) => new Set(state.permits.map((p) => p.permit_id))

// How much of an invoice counts against THIS sales order. A normal invoice counts in full; an invoice that
// also covers other sales orders' permits counts only for this order's permits.
// An invoice created after go-live counts its per-line value for this order's permits (net of the returns known
// when it was created, as it was priced); one created before go-live counts as it always did.
function invoiceShare(state: SoInvoicingState, inv: SoInvoicingState["invoices"][number]) {
  const own = ownPermitIds(state)
  if (inv.permit_ids.length > 0 && inv.permit_ids.some((id) => !own.has(id))) {
    if (pricedPerLine(inv.created_at, state.etaGoLiveAt)) {
      return etaLines(dpInvoiceEtaLines(state, inv.permit_ids, invoiceAsOf(inv)), stateDiscountRate(state)).totals.total
    }
    const raw = state.permits
      .filter((p) => inv.permit_ids.includes(p.permit_id))
      .reduce((sum, p) => sum + p.items.reduce((s, it) => s + itemRawTotal(it), 0), 0)
    return netInvoiceValue(raw, soDiscountBase(state.soItems, state.so.subtotal), state.so.discount_amount)
  }
  return Number(inv.amount) || 0
}

function orderedByKey(state: SoInvoicingState) {
  const map = new Map<string, number>()
  for (const line of state.soItems) {
    const key = lineKey(line.product_id, line.outsourced_name)
    map.set(key, (map.get(key) || 0) + (Number(line.quantity) || 0))
  }
  return map
}

interface KeyPool {
  ordered: number
  delivered: number
  returned: number
  pool: number
}
// Per line key: how much may be billed in total (see invoiceablePool). Delivered = gross quantity on permits whose
// goods have left (OUT_FOR_DELIVERY / SUBMITTED_SIGNED / APPROVED).
function poolByKey(state: SoInvoicingState, returned: Map<string, number>) {
  const ordered = orderedByKey(state)
  const delivered = new Map<string, number>()
  for (const permit of state.permits) {
    if (!DELIVERED_PERMIT_STATUSES.includes(permit.status)) continue
    for (const item of permit.items) {
      const key = lineKey(item.product_id, item.item_name_snapshot)
      delivered.set(key, (delivered.get(key) || 0) + (Number(item.quantity) || 0))
    }
  }
  const out = new Map<string, KeyPool>()
  for (const [key, orderedQty] of ordered) {
    const deliveredQty = delivered.get(key) || 0
    const returnedQty = returned.get(key) || 0
    out.set(key, { ordered: orderedQty, delivered: deliveredQty, returned: returnedQty, pool: invoiceablePool(orderedQty, deliveredQty, returnedQty) })
  }
  return out
}

/**
 * Whole-order (Workflow A) invoice amount, leaving out returned quantity: the sales order total scaled by the share
 * of line value that is still billable (so discount and VAT are applied exactly as on the order). Unchanged when
 * nothing was returned.
 */
export function computeWholeOrderAmount(
  state: SoInvoicingState,
  rule: { eta?: boolean } = {},
): { ok: true; amount: number; excluded: Map<string, number> } | { ok: false; status: number; error: string } {
  const total = Number(state.so.total) || 0
  const excludedLeft = excludedByKey(state)
  // rule.eta (only for an invoice created after go-live): the order lines less returns, priced line by line.
  // Default: today's rule - also for net_total and return credits (per-line credit notes are step 2).
  const eta = rule.eta === true
  if (excludedLeft.size === 0 && !eta) return { ok: true, amount: total, excluded: new Map() }

  const excluded = new Map(excludedLeft)
  const billed = billedOrderLines(state, excludedLeft)
  let rawAll = 0
  let rawExcluded = 0
  for (const { qty, take, lineRaw } of billed) {
    rawAll += lineRaw
    if (take > 0) rawExcluded += qty > 0 ? (lineRaw * take) / qty : 0
  }
  if (rawAll <= 0) return { ok: true, amount: total, excluded: new Map() }
  const amount = eta
    ? etaLines(billed.map((b) => orderEtaLine(b).line), stateDiscountRate(state)).totals.total
    : round2(total * (1 - rawExcluded / rawAll))
  if (excluded.size === 0) return { ok: true, amount, excluded }
  if (amount <= 0.005) {
    return { ok: false, status: 409, error: `Nothing to invoice: every item on sales order ${soLabel(state)} has been returned.` }
  }
  return { ok: true, amount, excluded }
}

// Per line key: the ordered quantity a whole-order invoice leaves out because it was returned.
function excludedByKey(state: SoInvoicingState) {
  const pools = poolByKey(state, returnedByKey(state.returns || []))
  const excludedLeft = new Map<string, number>()
  for (const [key, info] of pools) {
    const excluded = Math.max(0, info.ordered - info.pool)
    if (excluded > QTY_EPSILON) excludedLeft.set(key, excluded)
  }
  return excludedLeft
}

// The order lines a whole-order invoice bills: each line with the returned quantity (`take`) taken off it, first lines
// of a key first. Consumes `excludedLeft`.
function billedOrderLines(state: SoInvoicingState, excludedLeft: Map<string, number>) {
  return state.soItems.map((line) => {
    const qty = Number(line.quantity) || 0
    const lineRaw = itemRawTotal({ total: line.total, quantity: line.quantity, unit_price: line.unit_price })
    const key = lineKey(line.product_id, line.outsourced_name)
    const take = Math.min(excludedLeft.get(key) || 0, qty)
    if (take > 0) excludedLeft.set(key, (excludedLeft.get(key) || 0) - take)
    return { line, qty, take, lineRaw }
  })
}

/** An e-invoice line with the product it bills (null for a line without a product, e.g. outsourced). */
export interface BilledEtaLine {
  line: EtaLineIn
  productId: number | null
}

// A billed order line (from billedOrderLines) as an e-invoice line: the quantity less what was returned.
const orderEtaLine = (b: ReturnType<typeof billedOrderLines>[number]): BilledEtaLine => ({
  line: { name: b.line.outsourced_name || "", quantity: b.qty - b.take, unitPrice: etaUnitPrice(b.line) },
  productId: b.line.product_id ?? null,
})

// The lines a whole-order invoice bills given `state.returns` (the order lines less those returns).
const wholeOrderBilledLines = (state: SoInvoicingState): BilledEtaLine[] => billedOrderLines(state, excludedByKey(state)).map(orderEtaLine)

/** The lines a whole-order invoice created now would bill (the order lines less returns), as e-invoice lines. */
export function wholeOrderEtaLines(state: SoInvoicingState): EtaLineIn[] {
  return wholeOrderBilledLines(state).map((b) => b.line)
}

const stateDiscountRate = (state: SoInvoicingState) => orderDiscountRate(state.soItems, state.so.subtotal, state.so.discount_amount)

// The order total once returned quantity is left out (the whole-order invoice amount); 0 when nothing is left to bill.
function effectiveOrderTotal(state: SoInvoicingState, returns: ReturnLine[], rule: { eta?: boolean } = {}) {
  const priced = computeWholeOrderAmount({ ...state, returns }, rule)
  return priced.ok ? priced.amount : 0
}

/** What this order's invoices bill in total (an invoice that also covers other orders counts only for this one). */
export const invoicedTotalForOrder = (state: SoInvoicingState) => round2(state.invoices.reduce((sum, inv) => sum + invoiceShare(state, inv), 0))

/** The order total (discount and VAT applied) once the given return lines are left out. */
export const orderTotalAfterReturns = (state: SoInvoicingState, returns: ReturnLine[]) => effectiveOrderTotal(state, returns)

// Returns that already existed when an invoice was created were taken off that invoice's quantities; an invoice
// without a timestamp is counted gross (the conservative choice).
const invoiceAsOf = (inv: SoInvoicingState["invoices"][number]) => {
  const ms = toMs(inv.created_at)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

// Net quantity of each item on a permit: delivered quantity minus the returns against that permit.
function netPermitQuantities(state: SoInvoicingState, permit: SoInvoicingState["permits"][number], asOfMs?: number) {
  return netLineQuantities(
    permit.items.map((it) => ({ key: lineKey(it.product_id, it.item_name_snapshot), quantity: Number(it.quantity) || 0 })),
    returnedByKey(state.returns || [], { permitId: permit.permit_id, asOfMs }),
  )
}

// One e-invoice line per permit item, at the net quantity billed (`net`, from netPermitQuantities).
const permitEtaLines = (permit: SoInvoicingState["permits"][number], net: number[]): BilledEtaLine[] =>
  permit.items.map((item, idx) => ({
    line: { name: item.item_name_snapshot || "", quantity: net[idx], unitPrice: etaUnitPrice(item) },
    productId: item.product_id ?? null,
  }))

const dpInvoiceBilledLines = (state: SoInvoicingState, permitIds: number[], asOfMs?: number): BilledEtaLine[] =>
  state.permits.filter((p) => permitIds.includes(p.permit_id)).flatMap((p) => permitEtaLines(p, netPermitQuantities(state, p, asOfMs)))

/**
 * The lines a delivery-permit invoice bills for this order's permits among `permitIds`: each permit item at its net
 * quantity (delivered less the returns known at `asOfMs`; all returns when omitted). The same item on two permits
 * stays two lines.
 */
export function dpInvoiceEtaLines(state: SoInvoicingState, permitIds: number[], asOfMs?: number): EtaLineIn[] {
  return dpInvoiceBilledLines(state, permitIds, asOfMs).map((b) => b.line)
}

// The return lines that already existed when `inv` was created (an invoice without a timestamp: none).
const returnsKnownAt = (state: SoInvoicingState, inv: SoInvoicingState["invoices"][number]) =>
  (state.returns || []).filter((r) => returnedByKey([r], { asOfMs: invoiceAsOf(inv) }).size > 0)

/**
 * The lines an existing invoice bills for this order, with their products: a delivery-permit invoice, this order's
 * permit items at the net quantity billed (dpInvoiceEtaLines); a whole-order invoice, the order lines less the returns
 * known when it was created. Lines may carry quantity 0 (returned in full); etaLines drops them.
 */
export function billedLinesForInvoice(state: SoInvoicingState, inv: SoInvoicingState["invoices"][number]): BilledEtaLine[] {
  if (!isSoLevelInvoice(inv)) return dpInvoiceBilledLines(state, inv.permit_ids, invoiceAsOf(inv))
  return wholeOrderBilledLines({ ...state, returns: returnsKnownAt(state, inv) })
}

const countedLines = (lines: EtaLineIn[]) => lines.filter((l) => l.quantity > QTY_EPSILON).length

// E-invoice lines of the post-go-live invoices among `invoices` (a whole-order invoice: the order's lines).
function postGoLiveEtaLineCount(
  state: SoInvoicingState,
  invoices: SoInvoicingState["invoices"],
  createdAt: (inv: SoInvoicingState["invoices"][number]) => string | null | undefined = (inv) => inv.created_at,
) {
  return invoices
    .filter((inv) => pricedPerLine(createdAt(inv), state.etaGoLiveAt))
    .reduce((n, inv) => n + (isSoLevelInvoice(inv) ? state.soItems.length : countedLines(dpInvoiceEtaLines(state, inv.permit_ids, invoiceAsOf(inv)))), 0)
}

// Value of an item for `netQty` units (pro-rata of its stored line total).
const itemNetRawTotal = (item: DpItem, netQty: number) => {
  const qty = Number(item.quantity) || 0
  return qty > 0 ? (itemRawTotal(item) * netQty) / qty : 0
}

// Quantity actually billed per line key by the given invoices.
function invoicedQtyByKey(state: SoInvoicingState, invoices: SoInvoicingState["invoices"]) {
  const map = new Map<string, number>()
  const own = ownPermitIds(state)
  for (const inv of invoices) {
    const asOf = invoiceAsOf(inv)
    for (const permitId of inv.permit_ids) {
      if (!own.has(permitId)) continue
      const permit = state.permits.find((p) => p.permit_id === permitId)
      if (!permit) continue
      const net = netPermitQuantities(state, permit, asOf)
      permit.items.forEach((item, idx) => {
        const key = lineKey(item.product_id, item.item_name_snapshot)
        map.set(key, (map.get(key) || 0) + net[idx])
      })
    }
  }
  return map
}

/**
 * Value the invoices already billed for units the customer no longer keeps, priced like the invoices (order
 * discount + VAT). Per item: units invoiced beyond what can still be billed for it (invoiceablePool). A delivery-
 * permit invoice counts the permit's net quantity when it was created; a whole-order invoice counts what the order
 * could bill then. Example: a gun invoiced on its own delivery permit and then returned is over-billed by the gun,
 * even while other items of the order are still to be delivered and invoiced.
 */
export function overBilledValue(state: SoInvoicingState): number {
  const returns = state.returns || []
  const pools = poolByKey(state, returnedByKey(returns))
  const invoiced = invoicedQtyByKey(state, state.invoices.filter((i) => !isSoLevelInvoice(i)))
  for (const inv of state.invoices.filter(isSoLevelInvoice)) {
    for (const [key, info] of poolByKey(state, returnedByKey(returns, { asOfMs: invoiceAsOf(inv) }))) {
      invoiced.set(key, (invoiced.get(key) || 0) + info.pool)
    }
  }
  const lines = new Map<string, { raw: number; qty: number }>()
  for (const line of state.soItems) {
    const key = lineKey(line.product_id, line.outsourced_name)
    const entry = lines.get(key) || { raw: 0, qty: 0 }
    entry.raw += itemRawTotal(line)
    entry.qty += Number(line.quantity) || 0
    lines.set(key, entry)
  }
  let raw = 0
  for (const [key, qty] of invoiced) {
    const over = qty - (pools.get(key)?.pool ?? 0)
    const line = lines.get(key)
    if (over <= QTY_EPSILON || !line || line.qty <= 0) continue
    raw += (line.raw / line.qty) * over
  }
  return round2(netInvoiceValue(raw, soDiscountBase(state.soItems, state.so.subtotal), state.so.discount_amount))
}

const soLabel = (state: SoInvoicingState) => state.so.so_number || `#${state.so.so_id}`
const invoiceLabels = (invs: SoInvoicingState["invoices"]) => invs.map((i) => i.invoice_number || `#${i.invoice_id}`).join(", ")

// Workflow A guard: a whole-order invoice is only allowed while NOTHING has been invoiced against the order.
export function evaluateSoInvoice(state: SoInvoicingState): Verdict {
  const unreadable = goLiveUnreadable(state)
  if (unreadable) return unreadable
  if (state.invoices.length === 0) return { ok: true }
  const viaDps = state.invoices.filter((i) => !isSoLevelInvoice(i))
  if (viaDps.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Sales order ${soLabel(state)} is already being invoiced through delivery permits (${invoiceLabels(viaDps)}). Invoice the remaining items through their delivery permits.`,
    }
  }
  return {
    ok: false,
    status: 409,
    error: `Sales order ${soLabel(state)} has already been invoiced (${invoiceLabels(state.invoices)}).`,
  }
}

// Workflow B guard for the permits `newPermitIds` (all belonging to this sales order).
export function evaluateDpInvoice(state: SoInvoicingState, newPermitIds: number[]): Verdict {
  const unreadable = goLiveUnreadable(state)
  if (unreadable) return unreadable
  const full = state.invoices.filter(isSoLevelInvoice)
  if (full.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Sales order ${soLabel(state)} has already been invoiced in full (${invoiceLabels(full)}); its delivery permits cannot be invoiced again.`,
    }
  }

  const newPermits = state.permits.filter((p) => newPermitIds.includes(p.permit_id))
  const ordered = orderedByKey(state)
  const prior = invoicedQtyByKey(state, state.invoices)
  const pools = poolByKey(state, returnedByKey(state.returns || []))

  // What the new permits can bill: delivered quantity minus what was returned against them.
  const requested = new Map<string, { qty: number; name: string }>()
  const netByPermit = new Map<number, number[]>()
  for (const permit of newPermits) {
    const net = netPermitQuantities(state, permit)
    netByPermit.set(permit.permit_id, net)
    permit.items.forEach((item, idx) => {
      const key = lineKey(item.product_id, item.item_name_snapshot)
      const entry = requested.get(key) || { qty: 0, name: item.item_name_snapshot || key }
      entry.qty += net[idx]
      requested.set(key, entry)
    })
  }
  let billableQty = 0
  for (const [key, { qty, name }] of requested) {
    // A line that was fully returned has nothing to bill and need not be on the order any more.
    if (qty <= QTY_EPSILON) continue
    const info = pools.get(key)
    if (info === undefined || ordered.get(key) === undefined) {
      return { ok: false, status: 409, error: `"${name}" is not an item on sales order ${soLabel(state)} and cannot be invoiced against it.` }
    }
    billableQty += qty
    const already = prior.get(key) || 0
    if (already + qty > info.pool + QTY_EPSILON) {
      const returnedNote = info.returned > 0 ? ` (${info.returned} returned)` : ""
      return {
        ok: false,
        status: 409,
        error: `"${name}": ${qty} requested, but only ${Math.max(info.pool - already, 0)} of ${info.ordered} ordered remain to be invoiced${returnedNote} on sales order ${soLabel(state)}.`,
      }
    }
  }
  if (billableQty <= QTY_EPSILON) {
    return {
      ok: false,
      status: 409,
      error: `Nothing to invoice: every item on the selected delivery permit(s) of sales order ${soLabel(state)} has been returned.`,
    }
  }

  const priorValue = state.invoices.reduce((sum, inv) => sum + invoiceShare(state, inv), 0)
  // The invoice is created now: priced line by line (lib/vat-lines.ts).
  const eta = pricedPerLine(nowIso(), state.etaGoLiveAt)
  const newLines = eta ? newPermits.flatMap((p) => permitEtaLines(p, netByPermit.get(p.permit_id) || [])).map((b) => b.line) : []
  const newValue = eta
    ? etaLines(newLines, stateDiscountRate(state)).totals.total
    : newPermits.reduce((sum, p) => {
        const net = netByPermit.get(p.permit_id) || []
        const raw = p.items.reduce((s, it, idx) => s + itemNetRawTotal(it, net[idx]), 0)
        return sum + netInvoiceValue(raw, soDiscountBase(state.soItems, state.so.subtotal), state.so.discount_amount)
      }, 0)
  // The order total less the value of what was returned (nothing was credited on existing invoices, so returned
  // goods that were already billed are not billed again).
  const billableTotal = effectiveOrderTotal(state, state.returns || [], { eta })
  const tolerance = eta
    ? etaCheckTolerance(state.soItems.length, postGoLiveEtaLineCount(state, state.invoices) + countedLines(newLines)) + ETA_COMPARE_EPSILON
    : MONEY_TOLERANCE
  if (priorValue + newValue > billableTotal + tolerance) {
    return {
      ok: false,
      status: 409,
      error: `Invoicing ${round2(newValue)} would exceed sales order ${soLabel(state)} (billable total ${round2(billableTotal)}, already invoiced ${round2(priorValue)}).`,
    }
  }
  return { ok: true, newValue }
}

// Post-insert safety net. `myInvoiceId` is the invoice this request just created. Only invoices with an id
// LOWER than mine can displace me, so of any set of racing requests the lowest id always survives.
export function evaluateAfterInsert(state: SoInvoicingState, myInvoiceId: number): Verdict {
  const unreadable = goLiveUnreadable(state)
  if (unreadable) return unreadable
  const mine = state.invoices.find((i) => i.invoice_id === myInvoiceId)
  const earlier = state.invoices.filter((i) => i.invoice_id < myInvoiceId)
  const considered = state.invoices.filter((i) => i.invoice_id <= myInvoiceId)

  if (mine && isSoLevelInvoice(mine) && earlier.length > 0) {
    return { ok: false, status: 409, error: `Sales order ${soLabel(state)} was invoiced at the same time by another request (${invoiceLabels(earlier)}).` }
  }
  const earlierFull = earlier.filter(isSoLevelInvoice)
  if (earlierFull.length > 0) {
    return { ok: false, status: 409, error: `Sales order ${soLabel(state)} was invoiced in full at the same time (${invoiceLabels(earlierFull)}).` }
  }
  const ordered = orderedByKey(state)
  const totals = invoicedQtyByKey(state, considered)
  // Only returns that existed when this invoice was created count against it; a return filed afterwards must
  // never retroactively undo a valid invoice.
  const returnedBefore = mine ? returnedByKey(state.returns || [], { asOfMs: invoiceAsOf(mine) }) : new Map<string, number>()
  const pools = poolByKey(state, returnedBefore)
  for (const [key, qty] of totals) {
    // Same rule as the check before the insert: a line returned in full has nothing billed and need not be on the
    // order any more (owner report, 2026-11-12: SO-2026-742962, a returned line removed from the order).
    if (qty <= QTY_EPSILON) continue
    const orderedQty = ordered.get(key)
    if (orderedQty === undefined || qty > (pools.get(key)?.pool ?? 0) + QTY_EPSILON) {
      return { ok: false, status: 409, error: `Concurrent invoicing would exceed the ordered quantity on sales order ${soLabel(state)}.` }
    }
  }
  const value = considered.reduce((sum, inv) => sum + invoiceShare(state, inv), 0)
  const returnsBefore = mine ? returnsKnownAt(state, mine) : []
  // The rule of the invoice being checked: its own created_at (now when the row carries none).
  const mineAt = mine?.created_at || nowIso()
  const eta = pricedPerLine(mineAt, state.etaGoLiveAt)
  const tolerance = eta
    ? etaCheckTolerance(state.soItems.length, postGoLiveEtaLineCount(state, considered, (inv) => (inv === mine ? mineAt : inv.created_at))) + ETA_COMPARE_EPSILON
    : MONEY_TOLERANCE
  if (value > effectiveOrderTotal(state, returnsBefore, { eta }) + tolerance) {
    return { ok: false, status: 409, error: `Concurrent invoicing would exceed the total of sales order ${soLabel(state)}.` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------
// Data access + the two workflows
// ---------------------------------------------------------------------------------------------------------

type Db = any // supabase-js client (or a test double)
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

export async function loadSoInvoicingState(db: Db, soId: number): Promise<SoInvoicingState | null> {
  const so = must(
    await db
      .from("sales_orders")
      .select("so_id, so_number, customer_id, total, subtotal, discount_amount, payment_type, payment_terms, installments, so_type, notes")
      .eq("so_id", soId)
      .maybeSingle(),
    "load sales order",
  )
  if (!so) return null

  const soItems = must(
    await db.from("sales_order_items").select("product_id, outsourced_name, quantity, unit_price, total").eq("so_id", soId),
    "load sales order items",
  ) as any[]
  const permitRows = must(
    await db.from("delivery_permits").select("permit_id, permit_no, status").eq("sales_order_id", soId),
    "load delivery permits",
  ) as any[]
  const permitIds = permitRows.map((p) => p.permit_id)

  const itemRows = permitIds.length
    ? (must(
        await db
          .from("delivery_permit_items")
          .select("permit_id, product_id, item_name_snapshot, quantity, unit_price, total")
          .in("permit_id", permitIds),
        "load delivery permit items",
      ) as any[])
    : []
  const ownLinks = permitIds.length
    ? (must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("permit_id", permitIds), "load invoice links") as any[])
    : []

  const returns = await loadReturnLines(db, permitIds)

  const bySo = must(
    await excludeReplaced(db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, amount, created_at").eq("so_id", soId)),
    "load invoices by sales order",
  ) as any[]
  const linkedIds = [...new Set(ownLinks.map((l) => l.invoice_id))]
  const byLink = linkedIds.length
    ? (must(await excludeReplaced(db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, amount, created_at").in("invoice_id", linkedIds)), "load linked invoices") as any[])
    : []
  const invoiceRows = new Map<number, any>()
  for (const row of [...bySo, ...byLink]) invoiceRows.set(row.invoice_id, row)

  const allIds = [...invoiceRows.keys()]
  const allLinks = allIds.length
    ? (must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("invoice_id", allIds), "load all invoice links") as any[])
    : []

  return {
    so: {
      ...so,
      total: Number(so.total) || 0,
      subtotal: Number(so.subtotal) || 0,
      discount_amount: Number(so.discount_amount) || 0,
    },
    soItems: soItems.map((i) => ({
      product_id: i.product_id,
      outsourced_name: i.outsourced_name,
      quantity: Number(i.quantity) || 0,
      unit_price: i.unit_price != null ? Number(i.unit_price) : undefined,
      total: i.total != null ? Number(i.total) : null,
    })),
    permits: permitRows.map((p) => ({
      permit_id: p.permit_id,
      permit_no: p.permit_no,
      status: p.status,
      items: itemRows.filter((i) => i.permit_id === p.permit_id).map((i) => ({ ...i, quantity: Number(i.quantity) || 0 })),
    })),
    invoices: [...invoiceRows.values()].map((r) => ({
      invoice_id: r.invoice_id,
      invoice_number: r.invoice_number,
      so_id: r.so_id,
      amount: Number(r.amount) || 0,
      permit_ids: allLinks.filter((l) => l.invoice_id === r.invoice_id).map((l) => l.permit_id),
      created_at: r.created_at ?? null,
    })),
    returns,
    ...(await goLiveFields(db)),
  }
}

// The go-live setting for a loaded state. A read failure is recorded, not thrown: only creating an invoice needs it
// (evaluate* refuse), while the overview, order edits and return credits keep working.
async function goLiveFields(db: Db): Promise<Pick<SoInvoicingState, "etaGoLiveAt" | "etaGoLiveError">> {
  try {
    return { etaGoLiveAt: await loadEtaGoLiveAt(db) }
  } catch (error: any) {
    console.error(`[invoicing] ${error?.message || error}`)
    return { etaGoLiveAt: null, etaGoLiveError: String(error?.message || error) }
  }
}

// INV265567 / MINV265567: code + two-digit year + its own serial (lib/invoice-codes.ts)
async function nextInvoiceNumber(db: Db, attemptOffset: number, code: InvoiceCode = "INV") {
  const year2 = invoiceYear2()
  const rows = must(
    await db.from("accounts_receivable").select("invoice_number").like("invoice_number", `${code}${year2}%`),
    "load invoice numbers",
  ) as any[]
  // MINV is one sequence shared by the office and the workers' booklet (owner, 2026-11-19): cancelled pages and
  // photos still waiting with a number count as taken, so the office takes the next page after them.
  const existing = rows.map((row) => row.invoice_number)
  if (code === "MINV") existing.push(...(await pendingMinvNumbers(db, year2)))
  return nextCodedNumber(code, year2, existing, attemptOffset)
}

// Insert an accounts_receivable row, retrying with the next number if another request took the same one
// (UNIQUE(invoice_number) is the guard).
// A typed invoice number (lib/doc-number.ts) is used as is: if it is taken, nothing is created and the person is told.
class InvoiceNumberTaken extends Error {
  constructor(readonly number: string) {
    super(numberTakenMessage(number))
  }
}

// The shared plain-number sequence (lib/shared-invoice-numbers.ts), once its starting number is set: every new invoice
// takes its number there under one lock, so a worker's booklet page and an office invoice never get the same number.
const slotKind = (code: InvoiceCode) => (code === "MINV" ? "maintenance" : "sales")

async function refuseHeldManualNumber(db: Db, manualNumber: string, code: InvoiceCode) {
  const holder = await manualNumberHolder(db, manualNumber)
  // A worker's photographed page is turned into its invoice with exactly that number.
  if (holder && !(code === "MINV" && holder.kind === "maintenance" && holder.status === "reserved" && holder.draft_id != null)) {
    throw new InvoiceNumberTaken(manualNumber)
  }
}

async function withSharedNumber<T extends { invoice_id: number }>(db: Db, code: InvoiceCode, create: (number: string) => Promise<T | "taken">): Promise<T | null> {
  if (!(await loadSharedStart(db))) return null
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const number = await takeSharedNumber(db, slotKind(code), null, true)
    if (number == null) return null
    let created: T | "taken"
    try {
      created = await create(String(number))
    } catch (error) {
      await releaseSlot(db, number, "invoice not created")
      throw error
    }
    if (created !== "taken") {
      await markSlotUsed(db, number, created.invoice_id)
      return created
    }
    await markSlotUsed(db, number, null)
  }
  throw new Error("create invoice: no free invoice number")
}

async function insertInvoice(db: Db, row: Record<string, any>, manualNumber: string | null = null, code: InvoiceCode = "INV") {
  if (manualNumber) {
    await refuseHeldManualNumber(db, manualNumber, code)
    const { data, error } = await db.from("accounts_receivable").insert({ ...row, invoice_number: manualNumber }).select().single()
    if (error?.code === "23505") throw new InvoiceNumberTaken(manualNumber)
    if (error) throw new Error(`create invoice: ${error.message || error}`)
    await recordManualNumber(db, manualNumber, slotKind(code), data.invoice_id)
    return data
  }
  const shared = await withSharedNumber(db, code, async (number) => {
    const { data, error } = await db.from("accounts_receivable").insert({ ...row, invoice_number: number }).select().single()
    if (error?.code === "23505") return "taken"
    if (error) throw new Error(`create invoice: ${error.message || error}`)
    return data
  })
  if (shared) return shared
  let lastError: any = null
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(db, attempt, code)
    const { data, error } = await db.from("accounts_receivable").insert({ ...row, invoice_number: invoiceNumber }).select().single()
    if (!error) return data
    lastError = error
    if (error.code !== "23505") break
  }
  throw new Error(`create invoice: ${lastError?.message || lastError}`)
}

// Correct and reissue (spec §6.5a): the new invoice of an open correction is created by one database function that
// also moves the old invoice's permit links, payments, schedules and collected amount (lib/eta/correction.ts). The
// number is chosen exactly as insertInvoice does.
async function insertReissue(db: Db, correction: OpenCorrection, row: Record<string, any>, permitIds: number[], manualNumber: string | null, confirmOverpaid: boolean, code: InvoiceCode = "INV") {
  if (manualNumber) {
    await refuseHeldManualNumber(db, manualNumber, code)
    try {
      const created = await reissueInvoice(db, correction.invoiceId, { ...row, invoice_number: manualNumber }, permitIds, confirmOverpaid)
      await recordManualNumber(db, manualNumber, slotKind(code), (created as any).invoice_id)
      return created
    } catch (error) {
      if (error instanceof ReissueNumberTaken) throw new InvoiceNumberTaken(manualNumber)
      throw error
    }
  }
  const shared = await withSharedNumber(db, code, async (number) => {
    try {
      return (await reissueInvoice(db, correction.invoiceId, { ...row, invoice_number: number }, permitIds, confirmOverpaid)) as any
    } catch (error) {
      if (error instanceof ReissueNumberTaken) return "taken"
      throw error
    }
  })
  if (shared) return shared
  let last: unknown = null
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(db, attempt, code)
    try {
      return await reissueInvoice(db, correction.invoiceId, { ...row, invoice_number: invoiceNumber }, permitIds, confirmOverpaid)
    } catch (error) {
      if (!(error instanceof ReissueNumberTaken)) throw error
      last = error
    }
  }
  throw new Error(`create invoice: ${(last as any)?.message || "no free invoice number"}`)
}

// Payments of the old invoice above the new amount stay as the customer's credit only after a confirm.
function overpaidRefusal(correction: OpenCorrection, amount: number): WorkflowResult | null {
  const excess = round2(correction.collected - amount)
  if (!(excess > 0.005)) return null
  return failure(
    409,
    `The payments of ${correction.invoiceNumber || `#${correction.invoiceId}`} (${round2(correction.collected).toFixed(2)}) exceed the new invoice (${amount.toFixed(2)}). Confirm to keep ${excess.toFixed(2)} as the customer's credit.`,
    { code: REISSUE_OVERPAID, collected: round2(correction.collected), amount, excess, replacesInvoiceId: correction.invoiceId },
  )
}

// Every item of a corrected invoice came back (P13): nothing is left to bill, so there is no reissue to move the
// payments to. They stay on the replaced invoice, to be refunded or kept as credit with the existing flows.
const isNothingToInvoice = (error: string) => error.startsWith("Nothing to invoice")
function nothingLeftRefusal(correction: OpenCorrection): WorkflowResult {
  const old = correction.invoiceNumber || `#${correction.invoiceId}`
  return failure(
    409,
    `Nothing is left to invoice: every item of ${old} was returned. Its payments stay on the replaced invoice ${old}; refund them or keep them as the customer's credit with the existing payment and credit screens.`,
    {
      code: "REISSUE_NOTHING_LEFT",
      errorAr: `لا يوجد ما يُفوتر: تم إرجاع كل أصناف ${old}. تبقى مدفوعاتها على الفاتورة المستبدلة ${old}؛ ردّها للعميل أو احتفظ بها رصيداً دائناً له من شاشات المدفوعات والأرصدة الحالية.`,
      replacesInvoiceId: correction.invoiceId,
    },
  )
}

const reissueRefusal = (error: unknown): WorkflowResult | null =>
  error instanceof ReissueRefused ? failure(409, error.message, { code: error.code, ...(error.messageAr ? { errorAr: error.messageAr } : {}) }) : null

export interface CreateInvoiceOptions {
  /** a reissue whose moved payments exceed the new amount: keep the excess as customer credit (spec §6.5a) */
  confirmOverpaid?: boolean
  /** a typed invoice number (a maintenance booklet page); used as is, refused when taken */
  manualNumber?: string | null
}

async function rollbackInvoice(db: Db, invoiceId: number) {
  const steps: [string, any][] = [
    ["unlink delivery permits", await db.from("invoice_delivery_permits").delete().eq("invoice_id", invoiceId)],
    ["clear delivery_permits.invoice_id", await db.from("delivery_permits").update({ invoice_id: null }).eq("invoice_id", invoiceId)],
    ["delete invoice", await db.from("accounts_receivable").delete().eq("invoice_id", invoiceId)],
  ]
  for (const [what, res] of steps) {
    if (res.error) console.error(`[invoicing] ROLLBACK FAILED (${what}) for invoice ${invoiceId}: ${res.error.message}. Manual review needed.`)
  }
  await releaseSlotOfInvoice(db, invoiceId)
}

export interface WorkflowResult {
  status: number
  body: any
}
const failure = (status: number, error: string, extra: Record<string, any> = {}): WorkflowResult => ({ status, body: { error, ...extra } })

// ---- Workflow A: sales order -> invoice -------------------------------------------------------------------
export async function createSoInvoice(db: Db, soId: number, options: CreateInvoiceOptions = {}): Promise<WorkflowResult> {
  try {
    const state = await loadSoInvoicingState(db, soId)
    if (!state) return failure(404, "Sales order not found")

    const verdict = evaluateSoInvoice(state)
    if (!verdict.ok) return failure(verdict.status, verdict.error, { invoiceNumber: state.invoices[0]?.invoice_number, invoiceId: state.invoices[0]?.invoice_id })

    // Return-aware: quantity returned against the order's delivery permits is not billed (existing invoices are
    // never touched - there can be none here, evaluateSoInvoice just checked).
    // A whole-order invoice created now is priced line by line (lib/vat-lines.ts).
    const priced = computeWholeOrderAmount(state, { eta: pricedPerLine(nowIso(), state.etaGoLiveAt) })
    if (!priced.ok) {
      const open = isNothingToInvoice(priced.error) ? (await openCorrectionsForOrder(db, soId))[0] : null
      return open ? nothingLeftRefusal(open) : failure(priced.status, priced.error)
    }

    const paymentType = state.so.payment_type || state.so.payment_terms || "cash"
    const row = {
      customer_id: state.so.customer_id,
      so_id: state.so.so_id,
      invoice_date: new Date().toISOString().split("T")[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      amount: priced.amount, // the order lines less any returned quantity, discount and VAT applied per line
      collected_amount: 0,
      payment_terms: paymentType,
      installment_months: resolveInstallmentCount(paymentType, state.so.installments) || 1,
      months_paid: 0,
      status: "pending",
    }

    // An order with an open correction (spec §6.5a): this invoice is its reissue.
    const corrections = await openCorrectionsForOrder(db, soId)
    if (corrections.length > 1) return failure(409, `Sales order ${soLabel(state)} has more than one invoice being corrected. Create each new invoice from its own delivery permits.`, { code: "REISSUE_AMBIGUOUS" })
    const correction = corrections[0] || null
    // P16: an invoice made from delivery permits is reissued from its permits (their links move with it)
    if (correction && correction.permitIds.length > 0) {
      const old = correction.invoiceNumber || `#${correction.invoiceId}`
      return failure(409, `${old} was made from delivery permits. Create the corrected invoice from the same delivery permits.`, {
        code: "REISSUE_USE_PERMITS",
        errorAr: `الفاتورة ${old} صدرت من أذون تسليم. أنشئ الفاتورة المصححة من أذون التسليم نفسها.`,
      })
    }
    if (correction) {
      const overpaid = options.confirmOverpaid === true ? null : overpaidRefusal(correction, priced.amount)
      if (overpaid) return overpaid
    }
    // A quick maintenance order (no delivery permit) is billed as MINV.
    const invoiceCode = invoiceCodeForOrders([state.so as any])
    const manualNumber = options.manualNumber ?? null
    let invoice: any
    try {
      invoice = correction
        ? await insertReissue(db, correction, row, [], manualNumber, options.confirmOverpaid === true, invoiceCode)
        : await insertInvoice(db, row, manualNumber, invoiceCode)
    } catch (error) {
      if (error instanceof InvoiceNumberTaken) return failure(409, error.message, { code: "NUMBER_TAKEN" })
      const refused = reissueRefusal(error)
      if (refused) return refused
      throw error
    }

    // Safety net against a concurrent request: the lowest invoice_id wins.
    const after = await loadSoInvoicingState(db, soId)
    const check = after ? evaluateAfterInsert(after, invoice.invoice_id) : ({ ok: true } as Verdict)
    if (!check.ok) {
      if (correction) {
        if (!(await undoReissue(db, invoice.invoice_id, []))) return failure(500, `${check.error} The new invoice could not be taken back; contact an administrator.`, { partialFailure: true })
      } else await rollbackInvoice(db, invoice.invoice_id)
      return failure(check.status, check.error)
    }

    const customer = state.so.customer_id
      ? must(await db.from("customers").select("customer_name").eq("customer_id", state.so.customer_id).maybeSingle(), "load customer")
      : null
    return {
      status: 200,
      body: {
        ...invoice,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.customer_id,
        customerName: customer?.customer_name,
        soId: invoice.so_id,
        soNumber: state.so.so_number,
        deliveryPermits: state.permits.map((p) => ({ permit_id: p.permit_id, permit_no: p.permit_no, status: p.status })),
        ...(correction ? { replacesInvoiceId: correction.invoiceId, replacesInvoiceNumber: correction.invoiceNumber } : {}),
      },
    }
  } catch (error: any) {
    console.error("Error creating invoice from SO:", error)
    return failure(500, error?.message || "Failed to create invoice")
  }
}

// ---- Standalone maintenance invoice (MINV) -----------------------------------------------------------------
// Linked to the customer only: no sales order, no delivery permit. Its lines live in ar_invoice_lines.
export interface StandaloneLine {
  description: string
  quantity: number
  unitPrice: number
}
export async function createStandaloneMinv(
  db: Db,
  input: { customerId: number; lines: StandaloneLine[]; manualNumber?: string | null },
): Promise<WorkflowResult> {
  const today = new Date().toISOString().split("T")[0]
  const row = {
    customer_id: input.customerId,
    so_id: null,
    invoice_date: today,
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    // VAT per line: the sum of the line totals (lib/vat-lines.ts)
    amount: vatPerLine(input.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice }))).total,
    collected_amount: 0,
    payment_terms: "cash",
    installment_months: 1,
    months_paid: 0,
    status: "pending",
    is_maintenance: true,
  }
  let invoice: any
  try {
    try {
      invoice = await insertInvoice(db, row, input.manualNumber ?? null, "MINV")
    } catch (error) {
      // Without accounts_receivable.is_maintenance (scripts/sql/2026-11-17-maintenance-role.sql not applied) the
      // invoice is still made: its MINV number alone marks it as maintenance (isMaintenanceNumber).
      if (error instanceof InvoiceNumberTaken || !/is_maintenance/.test(String((error as any)?.message || ""))) throw error
      const { is_maintenance: _flag, ...withoutFlag } = row
      invoice = await insertInvoice(db, withoutFlag, input.manualNumber ?? null, "MINV")
    }
  } catch (error) {
    if (error instanceof InvoiceNumberTaken) return failure(409, error.message, { code: "NUMBER_TAKEN" })
    return failure(500, (error as any)?.message || "Failed to create invoice")
  }
  const { error: linesError } = await db.from("ar_invoice_lines").insert(
    input.lines.map((l, i) => ({
      invoice_id: invoice.invoice_id,
      line_no: i + 1,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      line_total: round2(l.quantity * l.unitPrice),
    })),
  )
  if (linesError) {
    await rollbackInvoice(db, invoice.invoice_id)
    return failure(500, `Could not save the invoice lines: ${linesError.message}`)
  }
  return { status: 200, body: invoice }
}

/** The lines of a standalone invoice (no sales order); empty for any other invoice. */
export async function loadStandaloneLines(db: Db, invoiceId: number): Promise<{ name: string; quantity: number; unitPrice: number }[]> {
  const { data, error } = await db
    .from("ar_invoice_lines")
    .select("line_no, description, quantity, unit_price")
    .eq("invoice_id", invoiceId)
    .order("line_no")
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return []
    throw new Error(`load invoice lines: ${error.message || error}`)
  }
  return (data || []).map((l: any) => ({ name: String(l.description), quantity: Number(l.quantity), unitPrice: Number(l.unit_price) }))
}

// ---- Workflow B: delivery permit(s) -> invoice ------------------------------------------------------------
export async function createDpInvoices(db: Db, permitIds: number[], manualNumber: string | null = null, options: CreateInvoiceOptions = {}): Promise<WorkflowResult> {
  try {
    const permits = must(
      await db.from("delivery_permits").select("permit_id, permit_no, sales_order_id, status").in("permit_id", permitIds),
      "load delivery permits",
    ) as any[]
    if (!permits || permits.length === 0) return failure(404, "Delivery permits not found")
    const missing = permitIds.filter((id) => !permits.some((p) => p.permit_id === id))
    if (missing.length > 0) return failure(404, `Delivery permits not found: ${missing.join(", ")}`)

    const notApproved = permits.filter((p) => p.status !== "APPROVED")
    if (notApproved.length > 0) {
      return failure(
        409,
        `Only APPROVED delivery permits can be invoiced. Not approved: ${notApproved.map((p) => `${p.permit_no} (${p.status})`).join(", ")}`,
        {
          code: "DP_NOT_APPROVED",
          permits: notApproved.map((p) => ({ permit_id: p.permit_id, permit_no: p.permit_no, status: p.status })),
        },
      )
    }

    const soIds = [...new Set(permits.map((p) => p.sales_order_id))]
    const orders = must(
      await db.from("sales_orders").select("so_id, customer_id, payment_type, payment_terms, so_type, notes").in("so_id", soIds),
      "load sales orders",
    ) as any[]
    const orderById = new Map(orders.map((o) => [o.so_id, o]))
    if (soIds.some((id) => !orderById.has(id))) return failure(404, "Sales order not found for a delivery permit")

    const customerIds = new Set(orders.map((o) => o.customer_id))
    if (customerIds.size > 1) return failure(400, "Selected delivery permits belong to different customers. Cannot consolidate.")

    // A permit linked only to an invoice that is open for correction (spec §6.5a) is available: the new invoice is the
    // reissue of that invoice. Any other link means the permit is invoiced.
    const linked = await correctionOfPermits(db, permitIds, soIds)
    if (linked.taken.length > 0) {
      return failure(400, `Delivery permits already invoiced: ${linked.taken.join(", ")}`)
    }
    if (linked.corrections.length > 1) {
      return failure(
        409,
        `These delivery permits belong to more than one invoice being corrected (${linked.corrections.map((c) => c.invoiceNumber || `#${c.invoiceId}`).join(", ")}). Create each new invoice from its own delivery permits.`,
        { code: "REISSUE_AMBIGUOUS" },
      )
    }
    const correction = linked.corrections[0] || null

    const byPaymentType: Record<string, any[]> = {}
    for (const permit of permits) {
      const order = orderById.get(permit.sales_order_id)
      const paymentType = order.payment_type || order.payment_terms || "cash"
      ;(byPaymentType[paymentType] ||= []).push(permit)
    }
    const paymentTypes = Object.keys(byPaymentType)
    if (paymentTypes.length > 1) {
      return {
        status: 200,
        body: {
          requiresSplit: true,
          message: `Selected DPs have ${paymentTypes.length} different payment terms. Will create ${paymentTypes.length} separate invoices.`,
          preview: paymentTypes.map((pt) => ({
            payment_type: pt,
            dp_count: byPaymentType[pt].length,
            permit_ids: byPaymentType[pt].map((p) => p.permit_id),
          })),
        },
      }
    }

    const paymentType = paymentTypes[0]
    const group = byPaymentType[paymentType]
    const groupSoIds = [...new Set(group.map((p) => p.sales_order_id))] as number[]
    // the order decides the code, so a corrected-and-reissued maintenance invoice stays MINV
    const invoiceCode = invoiceCodeForOrders(groupSoIds.map((id) => orderById.get(id)))

    // The reissue takes over every delivery permit of the old invoice (its links move to the new invoice).
    if (correction) {
      // a whole-order invoice (no links) covered every permit of its order (P16)
      const required = correction.permitIds.length > 0
        ? correction.permitIds
        : (must(await db.from("delivery_permits").select("permit_id, status").eq("sales_order_id", correction.soId), "load delivery permits") as any[])
            .filter((p) => p.status !== "REJECTED")
            .map((p) => Number(p.permit_id))
      const missingIds = required.filter((id) => !group.some((p) => p.permit_id === id))
      if (missingIds.length > 0) {
        const rows = must(await db.from("delivery_permits").select("permit_id, permit_no").in("permit_id", missingIds), "load delivery permits") as any[]
        const names = missingIds.map((id) => rows.find((r) => r.permit_id === id)?.permit_no || `#${id}`)
        return failure(
          409,
          `The corrected invoice must include every delivery permit of ${correction.invoiceNumber || `invoice #${correction.invoiceId}`}. Add: ${names.join(", ")}.`,
          { code: "REISSUE_MISSING_PERMITS", missing: missingIds },
        )
      }
    }

    // Pre-check every affected sales order, and price the invoice from the items on the selected permits.
    let amount = 0
    const states = new Map<number, SoInvoicingState>()
    for (const soId of groupSoIds) {
      const state = await loadSoInvoicingState(db, soId)
      if (!state) return failure(404, "Sales order not found")
      const ids = group.filter((p) => p.sales_order_id === soId).map((p) => p.permit_id)
      const verdict = evaluateDpInvoice(state, ids)
      if (!verdict.ok) return correction && isNothingToInvoice(verdict.error) ? nothingLeftRefusal(correction) : failure(verdict.status, verdict.error)
      amount += verdict.newValue || 0
      states.set(soId, state)
    }
    amount = round2(amount)

    const firstState = states.get(group[0].sales_order_id)!
    const row = {
      customer_id: Array.from(customerIds)[0],
      so_id: group[0].sales_order_id,
      // Provenance: a single-DP invoice points at its delivery permit; multi-DP invoices use invoice_delivery_permits.
      source_delivery_permit_id: group.length === 1 ? group[0].permit_id : null,
      invoice_date: new Date().toISOString().split("T")[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      amount,
      collected_amount: 0,
      payment_terms: paymentType,
      installment_months: resolveInstallmentCount(paymentType, firstState.so.installments) || 1,
      months_paid: 0,
      status: "pending",
    }

    if (correction) {
      const overpaid = options.confirmOverpaid === true ? null : overpaidRefusal(correction, amount)
      if (overpaid) return overpaid
      let invoice: any
      try {
        // one transaction: the invoice, its permit links (moved from the old invoice, or new), payments and links both ways
        invoice = await insertReissue(db, correction, row, group.map((p) => p.permit_id), manualNumber, options.confirmOverpaid === true, invoiceCode)
      } catch (error) {
        const refused = reissueRefusal(error)
        if (refused) return refused
        throw error
      }
      for (const soId of groupSoIds) {
        const after = await loadSoInvoicingState(db, soId)
        const check = after ? evaluateAfterInsert(after, invoice.invoice_id) : ({ ok: true } as Verdict)
        if (!check.ok) {
          if (!(await undoReissue(db, invoice.invoice_id, correction.permitIds))) {
            return failure(500, `${check.error} The new invoice could not be taken back; contact an administrator.`, { partialFailure: true })
          }
          return failure(check.status, check.error)
        }
      }
      return {
        status: 200,
        body: {
          success: true,
          invoices: [{ ...invoice, invoiceNumber: invoice.invoice_number, deliveryPermits: group.map((p) => p.permit_no), paymentType }],
          replacesInvoiceId: correction.invoiceId,
          replacesInvoiceNumber: correction.invoiceNumber,
          message: "Invoice created successfully",
        },
      }
    }

    const invoice = await insertInvoice(db, row, manualNumber, invoiceCode)

    const { error: linksError } = await db
      .from("invoice_delivery_permits")
      .insert(group.map((p) => ({ invoice_id: invoice.invoice_id, permit_id: p.permit_id })))
    if (linksError) {
      await rollbackInvoice(db, invoice.invoice_id)
      if (linksError.code === "23505") return failure(409, "One of the delivery permits was invoiced by another request. Nothing was created.")
      return failure(500, "Failed to link delivery permits")
    }

    // Backward-compatible column (the AR screen filters on it).
    const { error: compatError } = await db
      .from("delivery_permits")
      .update({ invoice_id: invoice.invoice_id })
      .in("permit_id", group.map((p) => p.permit_id))
    if (compatError) {
      await rollbackInvoice(db, invoice.invoice_id)
      return failure(500, "Failed to mark delivery permits as invoiced. Nothing was created.")
    }

    // Safety net against concurrent requests: the lowest invoice_id wins.
    for (const soId of groupSoIds) {
      const after = await loadSoInvoicingState(db, soId)
      const check = after ? evaluateAfterInsert(after, invoice.invoice_id) : ({ ok: true } as Verdict)
      if (!check.ok) {
        await rollbackInvoice(db, invoice.invoice_id)
        return failure(check.status, check.error)
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        invoices: [
          {
            ...invoice,
            invoiceNumber: invoice.invoice_number,
            deliveryPermits: group.map((p) => p.permit_no),
            paymentType,
          },
        ],
        message: "Invoice created successfully",
      },
    }
  } catch (error: any) {
    if (error instanceof InvoiceNumberTaken) return failure(409, error.message, { code: "NUMBER_TAKEN" })
    console.error("Error creating invoice from DPs:", error)
    return failure(500, error?.message || "Failed to create invoice")
  }
}

/**
 * Share of a sales order that one invoice covers (1 when it covers the whole order or the order total is unknown).
 * A hybrid order invoiced over several delivery permits shows each invoice this share of the order's down payment
 * and installments, instead of the whole order's schedule on every invoice.
 */
export const scheduleShare = (invoiceAmount: number, soTotal: number) =>
  soTotal > 0 && invoiceAmount > 0 ? Math.min(1, invoiceAmount / soTotal) : 1

/** Scale schedule amounts by `share`, rounding to piasters; the last amount takes the rounding so the sum stays exact. */
export function scaleSchedule(amounts: number[], share: number): number[] {
  if (share === 1 || amounts.length === 0) return amounts
  const scaled = amounts.map((a) => round2(a * share))
  const target = round2(amounts.reduce((s, a) => s + a, 0) * share)
  scaled[scaled.length - 1] = round2(scaled[scaled.length - 1] + target - scaled.reduce((s, a) => s + a, 0))
  return scaled
}
