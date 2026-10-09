// Editing a sales order after delivery permits / returns exist (Batch 2).
//
// A returned item must stay on the order as history and a replacement is added next to it, so an edit may:
//   * add lines freely (the replacement / exchange item),
//   * change quantities, but never below what the customer keeps (delivered - returned) for that item,
//   * delete a line of an item the customer keeps none of (everything delivered was returned); the delivery
//     permit and return records stay untouched as history,
// and may NOT:
//   * delete a line the customer still keeps some of, or turn a line into a different item, once that item is on
//     a delivery permit,
//   * change the customer once delivery permits exist.
// Nothing here writes; the PUT route calls validateSoEdit BEFORE it changes anything.
import { isSOFullyDelivered } from "./delivery-status"
import { computeWholeOrderAmount, loadSoInvoicingState } from "./invoicing"
import { DELIVERED_PERMIT_STATUSES, lineKey, loadReturnLines, returnedByKey } from "./return-lines"

type Db = any // supabase-js client (or a test double)
export type SoEditVerdict = { ok: true } | { ok: false; status: number; error: string }

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const EPS = 1e-6

function incomingKey(item: any): string {
  const rawProduct = item?.productId ?? item?.product_id
  const productId = rawProduct !== undefined && rawProduct !== null && rawProduct !== "" ? Number.parseInt(String(rawProduct), 10) : null
  const name = item?.productName || item?.outsourcedName || item?.outsourced_name || ""
  return lineKey(Number.isNaN(productId as number) ? null : productId, name)
}

export async function validateSoEdit(db: Db, soId: number, input: { customerId?: any; items?: any[] }): Promise<SoEditVerdict> {
  const so = must(await db.from("sales_orders").select("so_id, so_number, customer_id").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so) return { ok: true } // the route reports "not found" itself

  const permits = must(await db.from("delivery_permits").select("permit_id, status").eq("sales_order_id", soId), "load delivery permits") as any[]
  if (permits.length === 0) return { ok: true } // nothing delivered yet: ordinary editing rules

  const soLabel = so.so_number || `#${so.so_id}`
  if (input.customerId !== undefined && input.customerId !== null && input.customerId !== "" && Number(input.customerId) !== so.customer_id) {
    return { ok: false, status: 409, error: `The customer of ${soLabel} cannot be changed once delivery permits exist.` }
  }
  if (!input.items) return { ok: true }

  const permitIds = permits.map((p) => p.permit_id)
  const permitItems = must(
    await db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", permitIds),
    "load delivery permit items",
  ) as any[]
  const stored = must(
    await db.from("sales_order_items").select("so_item_id, product_id, outsourced_name, quantity").eq("so_id", soId),
    "load sales order items",
  ) as any[]
  const returns = returnedByKey(await loadReturnLines(db, permitIds))

  const onPermit = new Set<string>() // items that appear on any permit: their order lines are history
  const delivered = new Map<string, number>()
  for (const item of permitItems) {
    const key = lineKey(item.product_id, item.item_name_snapshot)
    onPermit.add(key)
    const permit = permits.find((p) => p.permit_id === item.permit_id)
    if (permit && DELIVERED_PERMIT_STATUSES.includes(permit.status)) delivered.set(key, (delivered.get(key) || 0) + (Number(item.quantity) || 0))
  }
  const label = (key: string) => key.slice(2) || "this item"
  const kept = (key: string) => Math.max(0, (delivered.get(key) || 0) - (returns.get(key) || 0))

  const incomingById = new Map<number, any>()
  for (const item of input.items) {
    const id = item?.id ?? item?.so_item_id ?? item?.soItemId
    if (id !== undefined && id !== null && id !== "") incomingById.set(Number(id), item)
  }

  for (const row of stored) {
    const key = lineKey(row.product_id, row.outsourced_name)
    if (!onPermit.has(key)) continue
    const incoming = incomingById.get(row.so_item_id)
    if (!incoming) {
      if (kept(key) <= EPS) continue // fully returned: the line may go, its permit and return stay as history
      return { ok: false, status: 409, error: `"${label(key)}" is on a delivery permit of ${soLabel} and cannot be removed while the customer keeps ${kept(key)} of it. Lower the line to ${kept(key)} instead, and add any replacement as a new line.` }
    }
    if (incomingKey(incoming) !== key) {
      return { ok: false, status: 409, error: `"${label(key)}" is on a delivery permit of ${soLabel}; its line cannot be turned into a different item. Add the replacement as a new line.` }
    }
  }

  const orderedAfter = new Map<string, number>()
  for (const item of input.items) {
    const key = incomingKey(item)
    orderedAfter.set(key, (orderedAfter.get(key) || 0) + (Number(item?.quantity) || 0))
  }
  for (const key of onPermit) {
    const keep = kept(key)
    const after = orderedAfter.get(key) || 0
    if (after + EPS < keep) {
      return {
        ok: false,
        status: 409,
        error: `"${label(key)}": ${keep} are kept by the customer (delivered ${delivered.get(key) || 0}, returned ${returns.get(key) || 0}), so the order cannot go below ${keep}.`,
      }
    }
  }
  return { ok: true }
}

/**
 * Keeps the order's CURRENT total return-aware: `net_total` = the order total less the value of returned quantity
 * (what the customer actually keeps and owes); `total` stays the ordered value of the lines. With no returns they are
 * equal. Example: 10 x 10,000, 2 returned -> net 80,000 x 1.14; after the edit "8 x A + 2 x B" -> 104,000 x 1.14.
 * Derived data: it is recomputed from the order, its permits and its (non-rejected) returns, so running it twice,
 * or after any later change, converges to the same value. The returns themselves are never touched.
 */
export async function syncSalesOrderNetTotal(db: Db, soId: number): Promise<number | null> {
  let written: number | null = null
  // Compute, write, then verify against a fresh computation: if a concurrent return / edit changed the inputs in
  // between, write again (a few rounds at most), so the stored value converges on the current state.
  for (let round = 0; round < 3; round++) {
    const state = await loadSoInvoicingState(db, soId)
    if (!state) return null
    const priced = computeWholeOrderAmount(state)
    const net = priced.ok ? priced.amount : 0
    if (written !== null && net === written) return written
    const rows = must(await db.from("sales_orders").update({ net_total: net }).eq("so_id", soId).select("so_id"), "update order net total") as any[]
    if (rows.length !== 1) return null
    written = net
  }
  return written
}

/**
 * After an edit: an order that was marked delivered but now has something outstanding (a replacement line, or a
 * returned quantity that is still owed) goes back to "ready for delivery / partially delivered" so the replacement
 * can be shipped on a new delivery permit. Returns true when the order was re-opened.
 */
export async function reopenIfNotFullyDelivered(db: Db, soId: number): Promise<boolean> {
  const so = must(await db.from("sales_orders").select("so_id, status").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so || so.status !== "delivered") return false
  if (await isSOFullyDelivered(db, soId)) return false
  const rows = must(
    await db
      .from("sales_orders")
      .update({ status: "ready_for_delivery", fulfillment_status: "PARTIALLY_DELIVERED" })
      .eq("so_id", soId)
      .eq("status", "delivered")
      .select("so_id"),
    "re-open sales order",
  ) as any[]
  return rows.length === 1
}
