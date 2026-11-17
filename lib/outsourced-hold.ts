// Outsourced items stored in a warehouse for a sales order (lib/goods-receiving.ts storeOutsourced: inventory rows with
// is_outsourced, no product, so_number + outsourced_name). Owner, 2026-11-17: the hold is decided per ORDER LINE, not
// just "the order is still open":
//   remaining(order, name) = max(0, quantity of the order's outsourced lines with that name
//                                   - quantity of that name on the order's signed/approved delivery permits)
//   the order's stored rows with that name (oldest first) are held up to `remaining`; the rest is free stock.
// So when the line is removed from the order, or lowered below what is stored, the extra becomes free stock that any
// sales order can take (app/api/sales-orders POST, fromInventoryId). A cancelled / rejected / delivered / completed
// order holds nothing (unchanged). Names compare like the delivery permit does (lib/dp-stock.ts): trimmed, spaces
// collapsed, case-insensitive.
import { STOCK_OUT_DP_STATUSES, selectInChunks } from "./stock-hold"

type Db = any // supabase-js client (or a test double)

export const CLOSED_SO_STATUSES = ["cancelled", "rejected", "delivered", "completed"]

export const sameName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()
const num = (v: unknown) => Number(v) || 0

/** A non-returned outsourced row with no product: the kind storeOutsourced writes. */
export const isStoredOutsourced = (r: any) => !!r && !r.product_id && !!r.is_outsourced && !r.is_returned

export interface OutsourcedHold {
  /** units of the row held for its order (0 = all free) */
  held: number
  soNumber: string | null
  customerName: string | null
}

export function computeOutsourcedHolds(input: {
  rows: { inventory_id: number; quantity: unknown; so_number?: string | null; outsourced_name?: string | null; product_id?: unknown; is_outsourced?: unknown; is_returned?: unknown }[]
  orders: { so_id: number; so_number: string; status: string; customer_id?: number | null }[]
  lines: { so_id: number; product_id?: unknown; item_type?: string | null; outsourced_name?: string | null; quantity: unknown }[]
  permits: { permit_id: number; sales_order_id: number; status: string }[]
  permitItems: { permit_id: number; product_id?: unknown; item_name_snapshot?: string | null; quantity: unknown }[]
  customers?: { customer_id: number; customer_name: string }[]
}): Map<number, OutsourcedHold> {
  const out = new Map<number, OutsourcedHold>()
  const openByNumber = new Map<string, (typeof input.orders)[number]>()
  for (const o of input.orders) if (!CLOSED_SO_STATUSES.includes(o.status)) openByNumber.set(String(o.so_number), o)
  const open = new Set([...openByNumber.values()].map((o) => o.so_id))

  const remaining = new Map<string, number>()
  const key = (soId: number, name: unknown) => `${soId}\u0000${sameName(name)}`
  for (const l of input.lines) {
    if (!open.has(l.so_id) || l.product_id || (l.item_type && l.item_type !== "outsourced")) continue
    remaining.set(key(l.so_id, l.outsourced_name), (remaining.get(key(l.so_id, l.outsourced_name)) || 0) + num(l.quantity))
  }
  const permitSo = new Map<number, number>()
  for (const p of input.permits) if (STOCK_OUT_DP_STATUSES.includes(p.status) && open.has(p.sales_order_id)) permitSo.set(p.permit_id, p.sales_order_id)
  for (const i of input.permitItems) {
    const soId = permitSo.get(i.permit_id)
    if (soId === undefined || i.product_id) continue
    const k = key(soId, i.item_name_snapshot)
    if (remaining.has(k)) remaining.set(k, (remaining.get(k) || 0) - num(i.quantity))
  }

  const rows = input.rows.filter(isStoredOutsourced).sort((a, b) => a.inventory_id - b.inventory_id)
  for (const r of rows) {
    const order = r.so_number ? openByNumber.get(String(r.so_number)) : undefined
    let held = 0
    if (order) {
      const k = key(order.so_id, r.outsourced_name)
      const left = Math.max(0, remaining.get(k) || 0)
      held = Math.min(Math.max(0, num(r.quantity)), left)
      remaining.set(k, left - held)
    }
    const customer = order ? (input.customers || []).find((c) => c.customer_id === order.customer_id) : undefined
    out.set(r.inventory_id, { held, soNumber: held > 0 && order ? String(order.so_number) : null, customerName: held > 0 ? customer?.customer_name ?? null : null })
  }
  return out
}

const must = (result: any, what: string): any[] => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}

/** Loads what computeOutsourcedHolds needs for the given inventory rows. Throws on query errors. */
export async function loadOutsourcedHolds(db: Db, rows: any[]): Promise<Map<number, OutsourcedHold>> {
  const stored = (rows || []).filter(isStoredOutsourced)
  const numbers = [...new Set(stored.filter((r) => r.so_number).map((r) => String(r.so_number)))]
  if (numbers.length === 0) return computeOutsourcedHolds({ rows: stored, orders: [], lines: [], permits: [], permitItems: [] })
  const orders = await selectInChunks(numbers, (chunk) => db.from("sales_orders").select("so_id, so_number, status, customer_id").in("so_number", chunk), "load orders of stored outsourced items")
  const live = orders.filter((o: any) => !CLOSED_SO_STATUSES.includes(o.status))
  const soIds = live.map((o: any) => o.so_id)
  const lines = soIds.length
    ? await selectInChunks(soIds, (chunk) => db.from("sales_order_items").select("so_id, product_id, item_type, outsourced_name, quantity").in("so_id", chunk), "load order lines")
    : []
  const permits = soIds.length
    ? await selectInChunks(soIds, (chunk) => db.from("delivery_permits").select("permit_id, sales_order_id, status").in("sales_order_id", chunk).in("status", STOCK_OUT_DP_STATUSES), "load permits")
    : []
  const permitItems = permits.length
    ? await selectInChunks(permits.map((p: any) => p.permit_id), (chunk) => db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", chunk), "load permit items")
    : []
  const customerIds = [...new Set(live.map((o: any) => o.customer_id).filter(Boolean))]
  const customers = customerIds.length ? must(await db.from("customers").select("customer_id, customer_name").in("customer_id", customerIds), "load customers") : []
  return computeOutsourcedHolds({ rows: stored, orders: live, lines, permits, permitItems, customers })
}

export interface StoredPick {
  inventoryId: number
  quantity: number
}
export type ReserveCheck =
  | { ok: true; rows: Map<number, any> }
  | { ok: false; status: number; error: string; code: string }

/**
 * A sales order line taken from a FREE stored outsourced item (fromInventoryId): the row must be a stored outsourced
 * item and the requested quantity (summed per row) must fit what is not held for an order. Read-only.
 */
export async function checkStoredPicks(db: Db, picks: StoredPick[]): Promise<ReserveCheck> {
  if (picks.length === 0) return { ok: true, rows: new Map() }
  for (const p of picks) {
    if (!Number.isInteger(p.inventoryId) || p.inventoryId <= 0 || !(p.quantity > 0)) {
      return { ok: false, status: 400, error: "Invalid stored item on the order.", code: "STORED_ITEM_INVALID" }
    }
  }
  const ids = [...new Set(picks.map((p) => p.inventoryId))]
  const rows = must(
    await db
      .from("inventory")
      .select("inventory_id, product_id, warehouse_id, quantity, unit_cost, is_outsourced, is_returned, outsourced_name, outsourced_description, supplier_name, so_number")
      .in("inventory_id", ids),
    "load stored items",
  )
  const byId = new Map<number, any>(rows.map((r: any) => [Number(r.inventory_id), r]))
  const holds = await loadOutsourcedHolds(db, rows)
  const wanted = new Map<number, number>()
  for (const p of picks) wanted.set(p.inventoryId, (wanted.get(p.inventoryId) || 0) + p.quantity)
  for (const [id, qty] of wanted) {
    const row = byId.get(id)
    if (!isStoredOutsourced(row)) return { ok: false, status: 400, error: `Inventory item ${id} is not a stored outsourced item.`, code: "STORED_ITEM_INVALID" }
    const free = Math.max(0, num(row.quantity) - (holds.get(id)?.held || 0))
    if (qty > free) {
      return {
        ok: false,
        status: 400,
        error: `Insufficient stock for ${row.outsourced_name || "the stored item"}. Requested: ${qty}, Available: ${free}`,
        code: "STORED_ITEM_SHORT",
      }
    }
  }
  return { ok: true, rows: byId }
}

/**
 * Reserve checked picks for the new order `soNumber`: a whole row moves to the order (its so_number changes), a part
 * is split off into a new row of the order (same item, warehouse and cost). Every write is compare-and-set on the row
 * as it was checked; on a lost race this undoes what it did and throws. The order's hold and its delivery permit
 * (lib/dp-stock.ts, by so_number + name) then work as for any stored outsourced item.
 */
export async function reserveStoredPicks(db: Db, soNumber: string, picks: StoredPick[], rows: Map<number, any>): Promise<void> {
  const wanted = new Map<number, number>()
  for (const p of picks) wanted.set(p.inventoryId, (wanted.get(p.inventoryId) || 0) + p.quantity)
  const undo: (() => Promise<void>)[] = []
  try {
    for (const [id, qty] of wanted) {
      const row = rows.get(id)
      const before = num(row.quantity)
      const guard = (q: any) => {
        const w = q.eq("inventory_id", id).eq("quantity", row.quantity)
        return row.so_number === null || row.so_number === undefined ? w.is("so_number", null) : w.eq("so_number", row.so_number)
      }
      const now = new Date().toISOString()
      if (qty >= before) {
        const moved = must(await guard(db.from("inventory").update({ so_number: soNumber, last_updated: now })).select("inventory_id"), "reserve stored item")
        if (moved.length !== 1) throw new Error(`stored item ${id} changed meanwhile`)
        undo.push(async () => {
          must(await db.from("inventory").update({ so_number: row.so_number ?? null }).eq("inventory_id", id).eq("so_number", soNumber), "undo reserve")
        })
        continue
      }
      const lowered = must(await guard(db.from("inventory").update({ quantity: before - qty, last_updated: now })).select("inventory_id"), "split stored item")
      if (lowered.length !== 1) throw new Error(`stored item ${id} changed meanwhile`)
      undo.push(async () => {
        const cur = must(await db.from("inventory").select("quantity").eq("inventory_id", id), "undo split: read")[0]
        if (cur) must(await db.from("inventory").update({ quantity: num(cur.quantity) + qty }).eq("inventory_id", id).eq("quantity", cur.quantity), "undo split")
      })
      const inserted = must(
        await db
          .from("inventory")
          .insert({
            product_id: null,
            warehouse_id: row.warehouse_id ?? null,
            quantity: qty,
            unit_cost: row.unit_cost ?? 0,
            reorder_point: 0,
            is_outsourced: true,
            is_returned: false,
            outsourced_name: row.outsourced_name,
            outsourced_description: row.outsourced_description,
            supplier_name: row.supplier_name ?? null,
            so_number: soNumber,
            last_updated: now,
          })
          .select("inventory_id"),
        "split stored item: new row",
      )
      const newId = inserted[0]?.inventory_id
      undo.push(async () => {
        if (newId) must(await db.from("inventory").delete().eq("inventory_id", newId), "undo split: delete row")
      })
    }
  } catch (e) {
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (undoError: any) {
        console.error("[outsourced-hold] could not undo a reservation step:", undoError?.message || undoError)
      }
    }
    throw e
  }
}
