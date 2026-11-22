// E-invoice (Egyptian Tax Authority) totals - spec §6. Pure, no I/O.
//
// From the go-live moment (company_settings.eta_go_live_at) a new customer invoice is priced line by line, the way the
// portal adds it up: per line  salesTotal = qty x unitPrice, discount = salesTotal x order discount rate,
// netTotal = salesTotal - discount, VAT (T1, 14 %) = netTotal x 14 %, total = netTotal + VAT - each rounded to
// 2 decimals ON THE LINE; the invoice totals are the sums of the rounded line values. Since 2026-11-22 every new
// invoice is priced this way, go-live or not (lib/vat-lines.ts).
import { toMs } from "../return-lines"
import { VAT_RATE, vatPerLine } from "../vat-lines"

export const ETA_VAT_RATE = VAT_RATE

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

/** Per-line totals (lib/vat-lines.ts, the one rule every invoice uses); lines with quantity <= 0 are dropped (a 0-priced line stays, as a 0 line). */
export function etaLines(lines: EtaLineIn[], discountRate: number): { lines: EtaLineOut[]; totals: EtaTotals } {
  const kept = lines.map((line) => ({ ...line, quantity: Number(line.quantity) || 0 })).filter((line) => line.quantity > 0)
  const priced = vatPerLine(kept, discountRate)
  return {
    lines: kept.map((line, i) => {
      const l = priced.lines[i]
      return { ...line, quantity: l.quantity, unitPrice: l.unitPrice, salesTotal: l.sales, discount: l.discount, netTotal: l.net, vat: l.vat, total: l.gross }
    }),
    totals: { sales: priced.sales, discount: priced.discount, net: priced.net, vat: priced.vat, total: priced.total },
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
