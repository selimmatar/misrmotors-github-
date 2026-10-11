// Print-only totals (Batch 3). Pure functions, no I/O. Used by the quotation / sales order print paths so that every
// printed document follows the same arithmetic:
//
//   subtotal - discount = net subtotal;   net subtotal x VAT rate = VAT;   net subtotal + VAT = total
//
// Every step is rounded to 2 decimals (half away from zero) on integer cents, so the printed lines always add up
// exactly (net subtotal + VAT = total, to the cent) and no 0.1 + 0.2 style float noise can reach a document.
// Nothing here changes stored values: it only decides what a printout shows.

export const VAT_RATE = 0.14

/** Round to 2 decimals without float artefacts (1.005 -> 1.01, 2.675 -> 2.68). Non-finite input becomes 0. */
export function round2(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const sign = n < 0 ? -1 : 1
  // (abs * 100) can sit a hair under the true half (1.005 * 100 = 100.49999999999999): 15 significant digits removes that noise
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)))
  return (sign * cents) / 100
}

export interface PrintTotalsInput {
  /** sum of quantity x unit price of the lines, before any discount (VAT exclusive) */
  subtotal: number
  /** "percentage" | "fixed" | "none" (anything else behaves like none unless discountAmount is given) */
  discountType?: string | null
  /** percent (0-100) for "percentage", an amount for "fixed" */
  discountValue?: number | null
  /** a stored discount amount; wins over type/value when it is > 0 */
  discountAmount?: number | null
  /** default 14% */
  vatRate?: number
}

export interface PrintTotals {
  subtotal: number
  discount: number
  netSubtotal: number
  vat: number
  total: number
}

export function computeTotals(input: PrintTotalsInput): PrintTotals {
  const subtotal = Math.max(0, round2(input.subtotal))
  let discount = 0
  const stored = Number(input.discountAmount)
  if (Number.isFinite(stored) && stored > 0) {
    discount = round2(stored)
  } else {
    const value = Number(input.discountValue)
    if (Number.isFinite(value) && value > 0) {
      if (input.discountType === "percentage") discount = round2((subtotal * Math.min(value, 100)) / 100)
      else if (input.discountType === "fixed") discount = round2(value)
    }
  }
  discount = Math.min(discount, subtotal) // a discount can never push the document below zero
  const netSubtotal = round2(subtotal - discount)
  const vat = round2(netSubtotal * (input.vatRate ?? VAT_RATE))
  const total = round2(netSubtotal + vat)
  return { subtotal, discount, netSubtotal, vat, total }
}

export interface SoPrintTotals extends PrintTotals {
  /** the order's recorded gross total (what it was worth before any return) */
  originalTotal: number
  /** net - original; negative when goods were returned, 0 otherwise */
  returnsAdjustment: number
  /** the order's current net total (Batch 2: sales_orders.net_total, which already reflects returns) */
  currentNetTotal: number
  /** false when the stored total does not equal what the lines compute to: then only the stored figures are shown */
  breakdownConsistent: boolean
  /** the stored gross total split back into before-VAT + 14% VAT (it always includes VAT); printed when the lines disagree */
  storedPreVat: number
  storedVat: number
}

/**
 * Totals for a printed sales order. The stored `total` (gross) and `net_total` (current, return-aware; Batch 2) are
 * authoritative and are printed as they are. The subtotal / discount / VAT breakdown is derived from the lines and is
 * shown only when it reproduces the stored gross total to the cent; otherwise the stored total (which always includes
 * 14% VAT) is split back into before-VAT + VAT, so the VAT line is always printed and still adds up to the stored total.
 */
export function computeSoPrintTotals(input: PrintTotalsInput & { storedTotal: number; storedNetTotal?: number | null }): SoPrintTotals {
  const base = computeTotals(input)
  const originalTotal = round2(input.storedTotal)
  const storedPreVat = round2(originalTotal / (1 + (input.vatRate ?? VAT_RATE)))
  const net = input.storedNetTotal === null || input.storedNetTotal === undefined ? originalTotal : round2(input.storedNetTotal)
  return {
    ...base,
    originalTotal,
    currentNetTotal: net,
    returnsAdjustment: round2(net - originalTotal),
    breakdownConsistent: Math.abs(base.total - originalTotal) <= 0.01,
    storedPreVat,
    storedVat: round2(originalTotal - storedPreVat),
  }
}
