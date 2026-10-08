// Stock hold (Batch 4E-stock). Decision: "after SO approval it should be ON HOLD, and after DP approval it should be
// DEDUCTED."
//
// The hold is DERIVED, never stored (inventory.pending_outbound is not used):
//   held(product) = sum over sales orders in HOLDING_SO_STATUSES of
//                   max(0, ordered qty of the order's STOCK lines of that product - qty already deducted)
//   deducted      = qty on APPROVED delivery permits of that order for that product. Returns are NOT netted back
//                   in: a returned unit sits in an is_returned inventory row, which is already excluded from
//                   on-hand, so holding it again would subtract it twice. (If it is restocked it re-enters on-hand
//                   through the normal restock path and is simply available again.)
// Outsourced lines (no product_id / item_type 'outsourced') never hold or deduct stock.
//
// available = on-hand (non-returned inventory rows, all warehouses) - held. Returned-goods rows (is_returned) are
// never on-hand here, exactly like the existing availability checks.

type Db = any // supabase-js client (or a test double)

/** sales_orders.status values that put the order's undelivered stock on hold ('approved' = accountant approval). */
export const HOLDING_SO_STATUSES = ["accountant_approved", "ready_for_delivery", "shipped"]

export interface HoldOrder {
  so_id: number
  status: string
}
export interface HoldLine {
  so_id: number
  item_type?: string | null
  product_id: number | null
  quantity: number
}
export interface HoldPermit {
  permit_id: number
  sales_order_id: number
  status: string
}
export interface HoldPermitItem {
  permit_id: number
  product_id: number | null
  quantity: number
}

const num = (v: unknown) => Number(v) || 0

/** Max ids per `.in(...)` request so PostgREST URLs stay short. */
export const IN_CHUNK_SIZE = 100

/** Run `fetch` once per chunk of ids and concatenate the rows. An error in any chunk is thrown by the caller's `must`. */
export async function selectInChunks(ids: any[], fetch: (chunk: any[]) => PromiseLike<{ data?: any[] | null; error?: any }>, what: string): Promise<any[]> {
  const rows: any[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const result = await fetch(ids.slice(i, i + IN_CHUNK_SIZE))
    if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
    rows.push(...(result.data || []))
  }
  return rows
}

/** Pure hold math. Inputs may contain rows of orders that do not hold; those are ignored. */
export function computeHeldByProduct(input: {
  orders: HoldOrder[]
  lines: HoldLine[]
  permits: HoldPermit[]
  permitItems: HoldPermitItem[]
  excludeSoId?: number
}): Map<number, number> {
  const holding = new Set(
    input.orders.filter((o) => HOLDING_SO_STATUSES.includes(o.status) && o.so_id !== input.excludeSoId).map((o) => o.so_id),
  )
  const held = new Map<number, number>()
  if (holding.size === 0) return held

  // ordered per (so, product): stock lines only
  const ordered = new Map<string, number>()
  for (const line of input.lines) {
    if (!holding.has(line.so_id) || !line.product_id) continue
    if (line.item_type && line.item_type !== "stock") continue
    const key = `${line.so_id}:${line.product_id}`
    ordered.set(key, (ordered.get(key) || 0) + num(line.quantity))
  }

  // deducted per (so, product): qty on APPROVED permits (no return adjustment, see the header comment)
  const permitSo = new Map<number, number>()
  for (const p of input.permits) if (p.status === "APPROVED" && holding.has(p.sales_order_id)) permitSo.set(p.permit_id, p.sales_order_id)
  const approved = new Map<string, number>()
  for (const item of input.permitItems) {
    const soId = permitSo.get(item.permit_id)
    if (soId === undefined || !item.product_id) continue
    const key = `${soId}:${item.product_id}`
    approved.set(key, (approved.get(key) || 0) + num(item.quantity))
  }
  for (const [key, qty] of ordered) {
    const deducted = approved.get(key) || 0
    const hold = Math.max(0, qty - deducted)
    if (hold > 0) {
      const productId = Number(key.split(":")[1])
      held.set(productId, (held.get(productId) || 0) + hold)
    }
  }
  return held
}

const must = (result: any, what: string): any[] => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}

/** Held quantity per product id across every holding sales order (optionally ignoring one order). Throws on query errors. */
export async function loadHeldByProduct(db: Db, opts: { excludeSoId?: number } = {}): Promise<Map<number, number>> {
  const orders = must(await db.from("sales_orders").select("so_id, status").in("status", HOLDING_SO_STATUSES), "load holding orders") as HoldOrder[]
  const soIds = orders.map((o) => o.so_id).filter((id) => id !== opts.excludeSoId)
  if (soIds.length === 0) return new Map()
  const lines = (await selectInChunks(
    soIds,
    (chunk) => db.from("sales_order_items").select("so_id, item_type, product_id, quantity").in("so_id", chunk).eq("item_type", "stock"),
    "load order lines",
  )) as HoldLine[]
  const permits = (await selectInChunks(
    soIds,
    (chunk) => db.from("delivery_permits").select("permit_id, sales_order_id, status").in("sales_order_id", chunk).eq("status", "APPROVED"),
    "load approved permits",
  )) as HoldPermit[]
  const permitIds = permits.map((p) => p.permit_id)
  const permitItems = (await selectInChunks(
    permitIds,
    (chunk) => db.from("delivery_permit_items").select("permit_id, product_id, quantity").in("permit_id", chunk),
    "load permit items",
  )) as HoldPermitItem[]
  return computeHeldByProduct({ orders, lines, permits, permitItems, excludeSoId: opts.excludeSoId })
}

/** Non-returned on-hand per product id (all warehouses). */
export async function loadOnHandByProduct(db: Db, productIds?: number[]): Promise<Map<number, number>> {
  const base = () => db.from("inventory").select("product_id, quantity").eq("is_returned", false)
  const rows = productIds ? await selectInChunks(productIds, (chunk) => base().in("product_id", chunk), "load inventory") : must(await base(), "load inventory")
  const map = new Map<number, number>()
  for (const r of rows) if (r.product_id) map.set(Number(r.product_id), (map.get(Number(r.product_id)) || 0) + num(r.quantity))
  return map
}

export interface Availability {
  onHand: number
  held: number
  available: number
}

/** onHand / held / available (never below 0) for the given products. */
export async function loadAvailability(db: Db, productIds: number[], opts: { excludeSoId?: number } = {}): Promise<Map<number, Availability>> {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id)))]
  const result = new Map<number, Availability>()
  if (ids.length === 0) return result
  const [onHand, held] = await Promise.all([loadOnHandByProduct(db, ids), loadHeldByProduct(db, opts)])
  for (const id of ids) {
    const o = onHand.get(id) || 0
    const h = held.get(id) || 0
    result.set(id, { onHand: o, held: h, available: Math.max(0, o - h) })
  }
  return result
}
