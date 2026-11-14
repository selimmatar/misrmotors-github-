// A status for each purchase-order line (owner request, 2026-11-14): not received yet, partly received, received,
// out for delivery, partly delivered, delivered. Received comes from goods receipts; out for delivery / delivered
// from the delivery permits of the sales-order line the PO line is for (signed / approved, less valid returns — the
// same rule as the order overview and the prints). A line not for a sales order (stock) stops at "received".
import { lineKey, loadReturnLines, returnedByKey } from "./return-lines"
import { DP_DELIVERED_STATUSES } from "./delivery-status"

type Db = any
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}
const num = (v: unknown) => Number(v) || 0
const EPS = 1e-6

export type PoLineState = "not_received" | "partly_received" | "received" | "out_for_delivery" | "partly_delivered" | "delivered"

export interface PoLineStatus {
  poItemId: number
  ordered: number
  received: number
  /** null for a line that is not for a sales order */
  delivered: number | null
  outForDelivery: number | null
  soNumber: string | null
  state: PoLineState
}

export async function poLineStatuses(db: Db, poId: number): Promise<PoLineStatus[]> {
  const items = must(await db.from("purchase_order_items").select("po_item_id, quantity, source_so_id, source_so_item_id").eq("po_id", poId), "PO lines") as any[]
  if (!items.length) return []
  const receipts = must(
    await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", items.map((i) => i.po_item_id)),
    "goods receipts",
  ) as any[]
  const received = new Map<number, number>()
  for (const r of receipts) received.set(Number(r.po_item_id), (received.get(Number(r.po_item_id)) || 0) + num(r.quantity_received))

  // the sales-order lines these PO lines are for, and what their delivery permits did with them
  const soItemIds = [...new Set(items.map((i) => Number(i.source_so_item_id)).filter(Boolean))]
  const soItems = soItemIds.length
    ? (must(await db.from("sales_order_items").select("so_item_id, so_id, product_id, outsourced_name").in("so_item_id", soItemIds), "SO lines") as any[])
    : []
  const soIds = [...new Set(soItems.map((s) => Number(s.so_id)))]
  const soNumbers = new Map<number, string>()
  const delivered = new Map<string, number>() // `${soId}|${key}` -> signed / approved, less returns
  const outward = new Map<string, number>() // `${soId}|${key}` -> on a DP that is out for delivery
  if (soIds.length) {
    for (const so of must(await db.from("sales_orders").select("so_id, so_number").in("so_id", soIds), "sales orders") as any[]) soNumbers.set(Number(so.so_id), so.so_number)
    const permits = (must(await db.from("delivery_permits").select("permit_id, sales_order_id, status").in("sales_order_id", soIds), "delivery permits") as any[]).filter(
      (p) => p.status !== "REJECTED",
    )
    const permitSo = new Map(permits.map((p) => [Number(p.permit_id), Number(p.sales_order_id)]))
    const dpItems = permits.length
      ? (must(await db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", permits.map((p) => p.permit_id)), "DP lines") as any[])
      : []
    const statusOf = new Map(permits.map((p) => [Number(p.permit_id), p.status]))
    for (const it of dpItems) {
      const k = `${permitSo.get(Number(it.permit_id))}|${lineKey(it.product_id, it.item_name_snapshot)}`
      const status = statusOf.get(Number(it.permit_id))
      if (DP_DELIVERED_STATUSES.includes(status)) delivered.set(k, (delivered.get(k) || 0) + num(it.quantity))
      else if (status === "OUT_FOR_DELIVERY") outward.set(k, (outward.get(k) || 0) + num(it.quantity))
    }
    const signedIds = permits.filter((p) => DP_DELIVERED_STATUSES.includes(p.status)).map((p) => Number(p.permit_id))
    const returns = await loadReturnLines(db, signedIds)
    for (const pid of signedIds) {
      for (const [key, qty] of returnedByKey(returns, { permitId: pid })) {
        const k = `${permitSo.get(pid)}|${key}`
        delivered.set(k, (delivered.get(k) || 0) - qty)
      }
    }
  }
  const soItemById = new Map(soItems.map((s) => [Number(s.so_item_id), s]))

  return items
    .filter((i) => num(i.quantity) > 0)
    .map((i) => {
      const ordered = num(i.quantity)
      const got = received.get(Number(i.po_item_id)) || 0
      const soItem = soItemById.get(Number(i.source_so_item_id))
      let done: number | null = null
      let out: number | null = null
      if (soItem) {
        // what reached the customer from this line: used up in PO-line order when several lines feed one SO line
        const k = `${soItem.so_id}|${lineKey(soItem.product_id, soItem.outsourced_name)}`
        const d = Math.max(0, Math.min(delivered.get(k) || 0, got))
        delivered.set(k, (delivered.get(k) || 0) - d)
        const o = Math.max(0, Math.min(outward.get(k) || 0, got - d))
        outward.set(k, (outward.get(k) || 0) - o)
        done = d
        out = o
      }
      let state: PoLineState
      if (done !== null && done >= ordered - EPS) state = "delivered"
      else if (done !== null && done > EPS) state = "partly_delivered"
      else if (out !== null && out > EPS) state = "out_for_delivery"
      else if (got >= ordered - EPS) state = "received"
      else if (got > EPS) state = "partly_received"
      else state = "not_received"
      return { poItemId: Number(i.po_item_id), ordered, received: got, delivered: done, outForDelivery: out, soNumber: soItem ? soNumbers.get(Number(soItem.so_id)) || null : null, state }
    })
}
