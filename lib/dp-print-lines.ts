// What a delivery-permit print shows for each line once returns are known (owner request, 2026-11-22): a line the
// driver marked as returned / not received is printed as not delivered ("لم يتم التسليم" / "Not delivered") with
// its quantity; a partly returned line shows delivered and not delivered; the print's total counts only what was
// delivered. Pure; the returned quantity per line key comes from lib/return-lines.ts (returnedByKey for the permit).
import { netLineQuantities } from "./return-lines"

export const NOT_DELIVERED_AR = "لم يتم التسليم"
export const NOT_DELIVERED_EN = "Not delivered"

export interface PermitPrintLine {
  quantity: number
  delivered: number
  notDelivered: number
}

export function permitPrintLines(lines: { key: string; quantity: number }[], returned: Map<string, number>) {
  const net = netLineQuantities(lines, returned)
  const out: PermitPrintLine[] = lines.map((l, i) => ({ quantity: Number(l.quantity) || 0, delivered: net[i], notDelivered: (Number(l.quantity) || 0) - net[i] }))
  const r = (n: number) => Math.round(n * 1000) / 1000
  return {
    lines: out,
    deliveredTotal: r(out.reduce((s, l) => s + l.delivered, 0)),
    notDeliveredTotal: r(out.reduce((s, l) => s + l.notDelivered, 0)),
  }
}
