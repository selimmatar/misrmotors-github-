// Orders to invoice (owner request, 2026-11-14): for the accountant, one row per sales order that has approved
// delivery permits not invoiced yet. "Ready" = every line delivered (returns taken off) and every DP of the order
// approved, nothing else on its way; otherwise the reasons in plain words. Part of an order can still be invoiced
// (the screen warns first). Uses the order overview (lib/so-overview.ts) so both always agree.
import { buildSoOverview, type OverviewLine } from "./so-overview"

type Db = any
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const EPS = 1e-6

export type NotReadyReason =
  | { kind: "not_delivered"; name: string; quantity: number; state: OverviewLine["state"] }
  | { kind: "waiting_approval"; dp: string }
  | { kind: "dp_on_its_way"; dp: string; status: string }

export interface OrderToInvoice {
  soId: number
  soNumber: string
  customer: string
  total: number
  ready: boolean
  /** approved permits not invoiced yet: what an invoice can take now */
  toInvoice: { permitId: number; number: string; value: number }[]
  value: number
  /** permits of the order already invoiced */
  invoiced: string[]
  lineCount: number
  reasons: NotReadyReason[]
}

export async function ordersToInvoice(db: Db): Promise<OrderToInvoice[]> {
  const approved = must(await db.from("delivery_permits").select("sales_order_id").eq("status", "APPROVED"), "approved permits") as any[]
  const soIds = [...new Set(approved.map((p) => Number(p.sales_order_id)).filter((id) => Number.isInteger(id) && id > 0))]
  const out: OrderToInvoice[] = []
  for (const soId of soIds) {
    const ov = await buildSoOverview(db, soId)
    if (!ov) continue
    const toInvoice = ov.permits.filter((p) => p.status === "APPROVED" && !p.invoiced).map((p) => ({ permitId: p.id, number: p.number, value: p.value }))
    if (toInvoice.length === 0) continue
    const reasons: NotReadyReason[] = []
    for (const l of ov.lines) {
      const left = l.ordered - l.delivered
      if (l.state !== "delivered" && left > EPS) reasons.push({ kind: "not_delivered", name: l.name, quantity: money(left), state: l.state })
    }
    for (const p of ov.permits) {
      if (p.status === "APPROVED") continue
      if (p.status === "SUBMITTED_SIGNED" || p.status === "DELIVERED") reasons.push({ kind: "waiting_approval", dp: p.number })
      else reasons.push({ kind: "dp_on_its_way", dp: p.number, status: p.status })
    }
    out.push({
      soId,
      soNumber: ov.so.number,
      customer: ov.so.customer,
      total: ov.money.total,
      ready: reasons.length === 0,
      toInvoice,
      value: money(toInvoice.reduce((s, p) => s + p.value, 0)),
      invoiced: ov.permits.filter((p) => p.invoiced).map((p) => p.number),
      lineCount: ov.lines.filter((l) => l.ordered > EPS).length,
      reasons,
    })
  }
  // ready first, then the biggest amounts
  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || b.value - a.value)
}
