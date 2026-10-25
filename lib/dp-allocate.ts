// Warehouse allocation of a delivery permit's lines (Warehouse Delivery, "split across warehouses").
// A permit line has one warehouse_id, and approval deducts each line's quantity from its own warehouse
// (lib/dp-stock.ts). So a line split across warehouses becomes one line per warehouse: the first share stays on
// the original row and every other share is a copy of it with its own quantity and total. Every per-product sum
// (invoices, returns, holds, delivered quantities) is unchanged by the split.

export interface AllocationInput {
  itemId: unknown
  warehouseId: unknown
  quantity: unknown
}

export interface AllocationPlan {
  updates: { itemId: number; patch: Record<string, unknown> }[]
  inserts: Record<string, unknown>[]
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const QTY_EPSILON = 1e-9

/** Check the allocations against the permit's own lines and turn them into row updates and inserts. */
export function planAllocation(
  items: Record<string, any>[],
  allocations: AllocationInput[],
  notes: string | null,
): { ok: true; plan: AllocationPlan } | { ok: false; error: string } {
  const byItem = new Map<number, { warehouseId: number; quantity: number }[]>()
  for (const alloc of allocations) {
    const itemId = Number(alloc.itemId)
    const warehouseId = Number(alloc.warehouseId)
    const quantity = Number(alloc.quantity)
    const item = items.find((i) => Number(i.item_id) === itemId)
    if (!item) return { ok: false, error: `Item ${String(alloc.itemId)} is not a line of this delivery permit.` }
    if (!Number.isInteger(warehouseId) || warehouseId <= 0) return { ok: false, error: `Choose a warehouse for ${item.item_name_snapshot || "every item"}.` }
    if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: `The quantity for ${item.item_name_snapshot || "an item"} is not valid.` }
    if (quantity === 0) continue
    const list = byItem.get(itemId) || []
    const same = list.find((a) => a.warehouseId === warehouseId)
    if (same) same.quantity += quantity
    else list.push({ warehouseId, quantity })
    byItem.set(itemId, list)
  }

  const plan: AllocationPlan = { updates: [], inserts: [] }
  for (const [itemId, shares] of byItem) {
    const item = items.find((i) => Number(i.item_id) === itemId)!
    const lineQty = Number(item.quantity) || 0
    const allocated = shares.reduce((s, a) => s + a.quantity, 0)
    if (Math.abs(allocated - lineQty) > QTY_EPSILON) {
      return { ok: false, error: `${item.item_name_snapshot || "An item"}: ${allocated} allocated but the permit needs ${lineQty}.` }
    }
    const base = { allocation_notes: notes }
    if (shares.length === 1) {
      plan.updates.push({ itemId, patch: { ...base, warehouse_id: shares[0].warehouseId, allocated_quantity: shares[0].quantity } })
      continue
    }
    // Split: line totals in proportion to quantity, the last share takes the rounding remainder.
    const lineTotal = Number(item.total) || round2((Number(item.unit_price) || 0) * lineQty)
    let totalLeft = lineTotal
    shares.forEach((share, index) => {
      const last = index === shares.length - 1
      const total = last ? round2(totalLeft) : round2((lineTotal * share.quantity) / lineQty)
      totalLeft -= total
      const fields = { ...base, warehouse_id: share.warehouseId, allocated_quantity: share.quantity, quantity: share.quantity, total }
      if (index === 0) {
        plan.updates.push({ itemId, patch: fields })
      } else {
        const { item_id: _id, created_at: _created, suppliers: _joined, ...copy } = item
        plan.inserts.push({ ...copy, ...fields })
      }
    })
  }
  return { ok: true, plan }
}
