// E-invoice (Egyptian Tax Authority) totals - spec §6. Pure, no I/O.
//
// From the go-live moment (company_settings.eta_go_live_at) a new customer invoice is priced line by line, the way the
// portal adds it up: per line  salesTotal = qty x unitPrice, discount = salesTotal x order discount rate,
// netTotal = salesTotal - discount, VAT (T1, 14 %) = netTotal x 14 %, total = netTotal + VAT - each rounded to
// 2 decimals ON THE LINE; the invoice totals are the sums of the rounded line values. Invoices created before go-live
// keep today's rule (lib/invoicing.ts: VAT on the total).
import { toMs } from "../return-lines"

export const ETA_VAT_RATE = 0.14

export interface EtaLineIn {
  name: string
  quantity: number
  unitPrice: number
}
export interface EtaLineOut extends EtaLineIn {
  salesTotal: number
  discount: number
  netTotal: number
  vat: number
  total: number
}
export interface EtaTotals {
  sales: number
  discount: number
  net: number
  vat: number
  total: number
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** Per-line totals; lines with quantity <= 0 are dropped (a 0-priced line stays, as a 0 line). */
export function etaLines(lines: EtaLineIn[], discountRate: number): { lines: EtaLineOut[]; totals: EtaTotals } {
  const rate = Number.isFinite(discountRate) && discountRate > 0 ? discountRate : 0
  const out: EtaLineOut[] = []
  const sums = { sales: 0, discount: 0, net: 0, vat: 0, total: 0 }
  for (const line of lines) {
    const quantity = Number(line.quantity) || 0
    if (!(quantity > 0)) continue
    const unitPrice = Number(line.unitPrice) || 0
    const salesTotal = round2(quantity * unitPrice)
    const discount = round2(salesTotal * rate)
    const netTotal = round2(salesTotal - discount)
    const vat = round2(netTotal * ETA_VAT_RATE)
    const total = round2(netTotal + vat)
    out.push({ ...line, quantity, unitPrice, salesTotal, discount, netTotal, vat, total })
    sums.sales += salesTotal
    sums.discount += discount
    sums.net += netTotal
    sums.vat += vat
    sums.total += total
  }
  return {
    lines: out,
    totals: { sales: round2(sums.sales), discount: round2(sums.discount), net: round2(sums.net), vat: round2(sums.vat), total: round2(sums.total) },
  }
}

/** True when `createdAt` is at or after the go-live moment. No (or an unreadable) go-live = not live. */
export function isAfterGoLive(createdAt: string | null | undefined, goLiveAt: string | null | undefined): boolean {
  if (!goLiveAt || !String(goLiveAt).trim()) return false
  const live = toMs(String(goLiveAt))
  const at = toMs(createdAt)
  if (Number.isNaN(live) || Number.isNaN(at)) return false
  return at >= live
}

/** Slack when comparing invoiced value with the order total: per-line rounding moves a total by up to half a piaster a line. */
export const etaTolerance = (lineCount: number) => Math.max(0.05, 0.01 * (Number(lineCount) || 0))
