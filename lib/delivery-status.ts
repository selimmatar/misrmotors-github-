// "Is this sales order fully delivered?" - shared by the delivery-permit workflow and by sales-order edits
// (Batch 2: an order edited after a return must drop back to "not fully delivered" if something is still owed).
import { loadReturnLines, subtractReturns } from "./return-lines"

type Db = any // supabase-js client (or a test double)

// Statuses that count as "delivered" for a single delivery permit
export const DP_DELIVERED_STATUSES = ["SUBMITTED_SIGNED", "DELIVERED", "APPROVED"]

/**
 * Determines whether every item on a sales order has been fully covered (by quantity) across all of its delivery
 * permits that count as delivered, net of goods returned against those permits.
 *
 * A sales order can have multiple partial delivery permits (e.g. DP-06 may only ship 4 of 30 line items). Marking
 * the SO as "delivered" just because every DP created SO FAR has reached a delivered status is WRONG when those DPs
 * don't cover the full order - the SO should stay non-delivered (and be reported as "partially delivered") until
 * every line item's ordered quantity has been shipped (and kept).
 *
 * `overridePermitId`/`overrideStatus` let the caller check what the outcome WOULD be after the current PUT
 * request's status change is applied, before that change is persisted.
 */
export async function isSOFullyDelivered(
  supabase: Db,
  salesOrderId: number,
  overridePermitId?: number,
  overrideStatus?: string,
): Promise<boolean> {
  const { data: soItems } = await supabase
    .from("sales_order_items")
    .select("so_item_id, product_id, quantity, outsourced_name")
    .eq("so_id", salesOrderId)

  if (!soItems || soItems.length === 0) return true

  const { data: permits } = await supabase.from("delivery_permits").select("permit_id, status").eq("sales_order_id", salesOrderId)

  const deliveredPermitIds = (permits || [])
    .map((p: any) => (p.permit_id === overridePermitId ? { ...p, status: overrideStatus || p.status } : p))
    .filter((p: any) => DP_DELIVERED_STATUSES.includes(p.status))
    .map((p: any) => p.permit_id)

  if (deliveredPermitIds.length === 0) return false

  const { data: dpItems } = await supabase
    .from("delivery_permit_items")
    .select("product_id, item_name_snapshot, quantity")
    .in("permit_id", deliveredPermitIds)

  const deliveredByProduct = new Map<number, number>()
  const deliveredByName = new Map<string, number>()

  for (const dpItem of dpItems || []) {
    const qty = Number(dpItem.quantity) || 0
    if (dpItem.product_id) {
      deliveredByProduct.set(dpItem.product_id, (deliveredByProduct.get(dpItem.product_id) || 0) + qty)
    } else {
      const name = (dpItem.item_name_snapshot || "").trim()
      if (name) deliveredByName.set(name, (deliveredByName.get(name) || 0) + qty)
    }
  }

  // Batch 2: goods returned against these permits are no longer delivered.
  subtractReturns(deliveredByProduct, deliveredByName, await loadReturnLines(supabase, deliveredPermitIds))

  return soItems.every((soItem: any) => {
    const orderedQty = Number(soItem.quantity) || 0
    if (orderedQty <= 0) return true
    const deliveredQty = soItem.product_id
      ? deliveredByProduct.get(soItem.product_id) || 0
      : deliveredByName.get((soItem.outsourced_name || "").trim()) || 0
    return deliveredQty >= orderedQty
  })
}
