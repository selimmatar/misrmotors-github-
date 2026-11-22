// VAT per invoice line (owner request, 2026-11-22: "make sure all invoices have tax calculated row by row"). Pure, no I/O.
//
// Every customer invoice - sales INV (whole order or delivery permits), standalone / quick MINV, work-order maintenance
// invoices, reissues - is priced the way the e-invoice (ETA) document adds it up, line by line:
//   sales    = quantity x unit price                (rounded to 2 decimals on the line)
//   discount = sales x order discount rate          (rounded on the line)
//   net      = sales - discount
//   VAT      = net x 14 %                            (rounded on the line)
//   gross    = net + VAT
// and the invoice totals are the sums of the rounded line values: invoice VAT = sum of line VATs, invoice total = sum
// of line nets + sum of line VATs. lib/eta/totals.ts (etaLines) is this same function under the portal's names.
//
// Invoices stored before this rule keep their stored amount. Prints keep their layout (no VAT column); their before-VAT,
// VAT and total figures are the per-line sums, and when those differ from the stored amount (VAT was rounded once on
// the total, or the order was edited after invoicing) the stored amount is printed as the total (vatPrintTotals:
// storedDiffers).
import { toMs } from "./return-lines"

export const VAT_RATE = 0.14

/**
 * From this moment every new invoice is priced line by line, go-live or not; an existing invoice created at or after
 * it (or after the e-invoice go-live) counts as priced line by line when the over-invoicing checks recompute its value.
 * Earlier invoices keep the value they were stored with.
 */
export const VAT_PER_LINE_FROM = "2026-11-22T00:00:00Z"

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export interface VatLineIn {
  name?: string
  quantity: number
  unitPrice: number
}
export interface VatLine {
  quantity: number
  unitPrice: number
  /** quantity x unit price, before the discount */
  sales: number
  discount: number
  /** after the discount, before VAT */
  net: number
  vat: number
  /** net + VAT */
  gross: number
}
export interface VatTotals {
  sales: number
  discount: number
  net: number
  vat: number
  /** sum of line nets + sum of line VATs */
  total: number
}

const cleanRate = (rate: number) => (Number.isFinite(rate) && rate > 0 ? rate : 0)

/** One line priced. A line with quantity <= 0 (or a bad number) is a 0 line. */
export function vatLine(line: VatLineIn, discountRate = 0): VatLine {
  const quantity = Number(line.quantity) || 0
  const unitPrice = Number(line.unitPrice) || 0
  if (!(quantity > 0)) return { quantity, unitPrice, sales: 0, discount: 0, net: 0, vat: 0, gross: 0 }
  const sales = round2(quantity * unitPrice)
  const discount = round2(sales * cleanRate(discountRate))
  const net = round2(sales - discount)
  const vat = round2(net * VAT_RATE)
  return { quantity, unitPrice, sales, discount, net, vat, gross: round2(net + vat) }
}

/**
 * Every line priced (index-aligned with `lines`; a line with quantity <= 0 stays as a 0 line) and the invoice totals,
 * the sums of the rounded line values.
 */
export function vatPerLine(lines: VatLineIn[], discountRate = 0): VatTotals & { lines: VatLine[] } {
  const out = lines.map((l) => vatLine(l, discountRate))
  const sum = (key: keyof VatTotals) => round2(out.reduce((s, l) => s + (key === "total" ? l.gross : l[key]), 0))
  return { lines: out, sales: sum("sales"), discount: sum("discount"), net: sum("net"), vat: sum("vat"), total: sum("total") }
}

export interface VatPrintTotals {
  lines: VatLine[]
  /** what the print shows under the lines */
  subtotalBeforeVat: number
  vatAmount: number
  totalWithVat: number
  /** the per-line sums */
  perLine: VatTotals
  /**
   * true when the stored amount differs from the per-line sum (an invoice stored before VAT was rounded per line, or
   * an order edited after invoicing): the stored amount is printed as the total, split into before-VAT and VAT, and
   * `lines` still carry the per-line VAT. Legal amounts never change silently.
   */
  storedDiffers: boolean
  /** stored amount - per-line total (0 unless storedDiffers) */
  difference: number
}

/** Totals printed on an invoice: the per-line sums, or the stored amount when it differs from them (see storedDiffers). */
export function vatPrintTotals(lines: VatLineIn[], discountRate: number, storedAmount: number | null | undefined): VatPrintTotals {
  const priced = vatPerLine(lines, discountRate)
  const perLine: VatTotals = { sales: priced.sales, discount: priced.discount, net: priced.net, vat: priced.vat, total: priced.total }
  const stored = storedAmount == null ? Number.NaN : Number(storedAmount)
  if (Number.isFinite(stored) && Math.abs(stored - perLine.total) > 0.005) {
    const totalWithVat = round2(stored)
    // VAT rounded once on the same net (the earlier rule): that net is the before-VAT figure; otherwise the stored
    // amount is split back into before-VAT + VAT
    const sameNet = round2(perLine.net * (1 + VAT_RATE)) === totalWithVat
    const subtotalBeforeVat = sameNet ? perLine.net : round2(totalWithVat / (1 + VAT_RATE))
    return {
      lines: priced.lines,
      subtotalBeforeVat,
      vatAmount: round2(totalWithVat - subtotalBeforeVat),
      totalWithVat,
      perLine,
      storedDiffers: true,
      difference: round2(totalWithVat - perLine.total),
    }
  }
  return { lines: priced.lines, subtotalBeforeVat: perLine.net, vatAmount: perLine.vat, totalWithVat: perLine.total, perLine, storedDiffers: false, difference: 0 }
}

/**
 * Whether an invoice created at `createdAt` was priced line by line: at or after VAT_PER_LINE_FROM, or at or after the
 * e-invoice go-live. An invoice without a readable timestamp counts as the earlier rule.
 */
export function pricedPerLine(createdAt: string | null | undefined, goLiveAt?: string | null): boolean {
  const at = toMs(createdAt)
  if (Number.isNaN(at)) return false
  if (at >= toMs(VAT_PER_LINE_FROM)) return true
  const live = goLiveAt && String(goLiveAt).trim() ? toMs(String(goLiveAt)) : Number.NaN
  return !Number.isNaN(live) && at >= live
}
