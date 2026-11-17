// Outsourced items in our warehouses (owner, 2026-11-17).
//
// An outsourced item received INTO a warehouse (lib/goods-receiving.ts storeOutsourced) or an outsourced return put
// into a warehouse (lib/returns.ts) is ordinary free stock: On hand, no hold for the order it was bought for, and any
// sales order can take it ("add from inventory", create and edit). The order it was bought for still delivers it as
// before (lib/dp-stock.ts takes the rows of its so_number by name).
//
// A sales order line that TAKES such an item (lib/from-stock-line.ts marker) reserves an inventory row: the picked row
// itself (its so_number moves to the order) or the part split off it. That row is held for the line:
//   held(row) = min(row quantity, what the order's from-stock lines on that row still need)
//   still need = their quantity - what the order's signed/approved delivery permits delivered of that name
// Lowering or removing the line on an edit therefore releases the rest as free stock; a cancelled / rejected /
// delivered / completed order holds nothing. Items received for an order WITHOUT a warehouse go straight to the
// customer: they are not inventory rows (the Inventory page lists them on the Pending tab, app/api/inventory/pending).
import { STOCK_OUT_DP_STATUSES, selectInChunks } from "./stock-hold"
import { fromStockDescription, parseFromStock } from "./from-stock-line"

type Db = any // supabase-js client (or a test double)

export const CLOSED_SO_STATUSES = ["cancelled", "rejected", "delivered", "completed"]

export const sameName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()
const num = (v: unknown) => Number(v) || 0

/** An outsourced row with no product (stored on receipt, a reserved part, or an outsourced return). */
export const isStoredOutsourced = (r: any) => !!r && !r.product_id && !!r.is_outsourced
/** Free-stock candidate: stored outsourced, not a return still waiting outside a warehouse. */
export const isWarehouseOutsourced = (r: any) => isStoredOutsourced(r) && (!r.is_returned || r.warehouse_id !== null && r.warehouse_id !== undefined)

export interface OutsourcedHold {
  /** units of the row held for a sales order line that took it (0 = all free) */
  held: number
  soNumber: string | null
  customerName: string | null
}

export interface FromStockLine {
  so_item_id?: number
  so_id: number
  quantity: unknown
  outsourced_name?: string | null
  outsourced_description?: string | null
}

export function computeOutsourcedHolds(input: {
  rows: { inventory_id: number; quantity: unknown; product_id?: unknown; is_outsourced?: unknown; is_returned?: unknown; warehouse_id?: unknown }[]
  orders: { so_id: number; so_number: string; status: string; customer_id?: number | null }[]
  lines: FromStockLine[]
  permits: { permit_id: number; sales_order_id: number; status: string }[]
  permitItems: { permit_id: number; product_id?: unknown; item_name_snapshot?: string | null; quantity: unknown }[]
  customers?: { customer_id: number; customer_name: string }[]
}): Map<number, OutsourcedHold> {
  const open = new Map<number, (typeof input.orders)[number]>()
  for (const o of input.orders) if (!CLOSED_SO_STATUSES.includes(o.status)) open.set(o.so_id, o)

  // delivered per (order, name) on signed / approved permits
  const delivered = new Map<string, number>()
  const key = (soId: number, name: unknown) => `${soId}\u0000${sameName(name)}`
  const permitSo = new Map<number, number>()
  for (const p of input.permits) if (STOCK_OUT_DP_STATUSES.includes(p.status) && open.has(p.sales_order_id)) permitSo.set(p.permit_id, p.sales_order_id)
  for (const i of input.permitItems) {
    const soId = permitSo.get(i.permit_id)
    if (soId === undefined || i.product_id) continue
    delivered.set(key(soId, i.item_name_snapshot), (delivered.get(key(soId, i.item_name_snapshot)) || 0) + num(i.quantity))
  }

  // what each reserved row is still needed for (lines in id order; deliveries come off the first lines first)
  const need = new Map<number, { qty: number; soId: number }>()
  const lines = [...input.lines].sort((a, b) => num(a.so_item_id) - num(b.so_item_id))
  for (const l of lines) {
    const marker = parseFromStock(l.outsourced_description)
    if (!marker || !open.has(l.so_id)) continue
    const k = key(l.so_id, l.outsourced_name)
    const done = delivered.get(k) || 0
    const take = Math.min(done, num(l.quantity))
    delivered.set(k, done - take)
    const left = num(l.quantity) - take
    if (left <= 0) continue
    const entry = need.get(marker.reservedId) || { qty: 0, soId: l.so_id }
    entry.qty += left
    need.set(marker.reservedId, entry)
  }

  const out = new Map<number, OutsourcedHold>()
  for (const r of input.rows) {
    if (!isStoredOutsourced(r)) continue
    const n = need.get(r.inventory_id)
    const held = n ? Math.min(Math.max(0, num(r.quantity)), n.qty) : 0
    const order = n ? open.get(n.soId) : undefined
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
  if (stored.length === 0) return new Map()
  const lines = must(
    await db
      .from("sales_order_items")
      .select("so_item_id, so_id, quantity, outsourced_name, outsourced_description")
      .like("outsourced_description", "From stock (inventory #%"),
    "load from-stock order lines",
  ) as FromStockLine[]
  const soIds = [...new Set(lines.map((l) => l.so_id))]
  const orders = soIds.length
    ? await selectInChunks(soIds, (chunk) => db.from("sales_orders").select("so_id, so_number, status, customer_id").in("so_id", chunk), "load orders")
    : []
  const live = orders.filter((o: any) => !CLOSED_SO_STATUSES.includes(o.status))
  const liveIds = live.map((o: any) => o.so_id)
  const permits = liveIds.length
    ? await selectInChunks(liveIds, (chunk) => db.from("delivery_permits").select("permit_id, sales_order_id, status").in("sales_order_id", chunk).in("status", STOCK_OUT_DP_STATUSES), "load permits")
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

const STORED_COLUMNS =
  "inventory_id, product_id, warehouse_id, quantity, unit_cost, is_outsourced, is_returned, outsourced_name, outsourced_description, supplier_name, so_number"

/**
 * Lines taken from free stored stock (fromInventoryId): every picked row must be an outsourced item in a warehouse and
 * the quantity (summed per row) must fit what no other line holds. Read-only.
 */
export async function checkStoredPicks(db: Db, picks: StoredPick[]): Promise<ReserveCheck> {
  if (picks.length === 0) return { ok: true, rows: new Map() }
  for (const p of picks) {
    if (!Number.isInteger(p.inventoryId) || p.inventoryId <= 0 || !(p.quantity > 0)) {
      return { ok: false, status: 400, error: "Invalid stored item on the order.", code: "STORED_ITEM_INVALID" }
    }
  }
  const ids = [...new Set(picks.map((p) => p.inventoryId))]
  const rows = must(await db.from("inventory").select(STORED_COLUMNS).in("inventory_id", ids), "load stored items")
  const byId = new Map<number, any>(rows.map((r: any) => [Number(r.inventory_id), r]))
  const holds = await loadOutsourcedHolds(db, rows)
  const wanted = new Map<number, number>()
  for (const p of picks) wanted.set(p.inventoryId, (wanted.get(p.inventoryId) || 0) + p.quantity)
  for (const [id, qty] of wanted) {
    const row = byId.get(id)
    if (!isWarehouseOutsourced(row)) return { ok: false, status: 400, error: `Inventory item ${id} is not an outsourced item in a warehouse.`, code: "STORED_ITEM_INVALID" }
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

export interface Reservation {
  /** picked row id -> the row reserved for the order (the picked row, or the part split off it) */
  reserved: Map<number, number>
  undo: () => Promise<void>
}

/**
 * Reserve checked picks for the order `soNumber`: a whole row moves to the order (its so_number changes), a part is
 * split off into a new row of the order (same item, warehouse and cost). A reserved return is stock again
 * (is_returned false: it is sold now, no longer a return to settle). Every write is compare-and-set on the row as it
 * was checked; on a lost race this undoes what it did and throws.
 */
export async function reserveStoredPicks(db: Db, soNumber: string, picks: StoredPick[], rows: Map<number, any>): Promise<Reservation> {
  const wanted = new Map<number, number>()
  for (const p of picks) wanted.set(p.inventoryId, (wanted.get(p.inventoryId) || 0) + p.quantity)
  const undo: (() => Promise<void>)[] = []
  const reserved = new Map<number, number>()
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
        const moved = must(await guard(db.from("inventory").update({ so_number: soNumber, is_returned: false, last_updated: now })).select("inventory_id"), "reserve stored item")
        if (moved.length !== 1) throw new Error(`stored item ${id} changed meanwhile`)
        undo.push(async () => {
          must(
            await db.from("inventory").update({ so_number: row.so_number ?? null, is_returned: !!row.is_returned }).eq("inventory_id", id).eq("so_number", soNumber),
            "undo reserve",
          )
        })
        reserved.set(id, id)
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
      if (!newId) throw new Error("split stored item: no new row")
      undo.push(async () => {
        must(await db.from("inventory").delete().eq("inventory_id", newId), "undo split: delete row")
      })
      reserved.set(id, Number(newId))
    }
  } catch (e) {
    await runUndo(undo)
    throw e
  }
  return { reserved, undo: () => runUndo(undo) }
}

async function runUndo(undo: (() => Promise<void>)[]) {
  for (const step of [...undo].reverse()) {
    try {
      await step()
    } catch (undoError: any) {
      console.error("[outsourced-hold] could not undo a reservation step:", undoError?.message || undoError)
    }
  }
  undo.length = 0
}

/** The outsourced rows the given ids name (to name the lines taken from them), keyed by id. */
export async function loadStoredRows(db: Db, ids: number[]): Promise<Map<number, any>> {
  const clean = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
  if (clean.length === 0) return new Map()
  const rows = must(await db.from("inventory").select(STORED_COLUMNS).in("inventory_id", clean), "load stored items")
  return new Map(rows.filter(isStoredOutsourced).map((r: any) => [Number(r.inventory_id), r]))
}

/** The sales_order_items fields of a line taken from stored row `row`, reserved as `reservedId`. */
export function fromStockLineFields(row: any, reservedId: number) {
  return {
    product_id: null,
    item_type: "outsourced",
    outsourced_name: row.outsourced_name,
    outsourced_description: fromStockDescription(reservedId, row.inventory_id),
    cost_estimate: Number(row.unit_cost) || 0,
    fulfilled_at: new Date().toISOString(),
  }
}

const idOf = (item: any): number | null => {
  const raw = item?.id ?? item?.so_item_id ?? item?.soItemId
  return raw === undefined || raw === null || raw === "" ? null : Number(raw)
}
const pickedOf = (item: any): number | null => {
  const raw = item?.fromInventoryId
  return raw === undefined || raw === null || raw === "" ? null : Number(raw)
}

export interface EditPlan {
  ok: true
  /** rows to reserve now */
  picks: StoredPick[]
  /** new line index -> the saved line's marker it reuses (the same edit saved twice: nothing is taken again) */
  reuse: Map<number, string>
}

/**
 * Sales order EDIT: what the edit must reserve. `existing` = the order's lines as saved, `items` = what the edit sends.
 *  - a new line with fromInventoryId X reserves its quantity from X, unless the edit drops a saved from-stock line
 *    picked from X with the same name and at least that quantity (the same edit re-sent): it then keeps that line's
 *    reservation;
 *  - a saved from-stock line may be lowered or removed (its reservation shrinks with it: the rest is free stock again)
 *    but not raised: more of the item is a new line.
 */
export function planEditPicks(
  existing: { so_item_id: number; quantity: unknown; outsourced_name?: string | null; outsourced_description?: string | null }[],
  items: any[],
): EditPlan | { ok: false; status: number; error: string; code: string } {
  const saved = new Map(existing.map((l) => [Number(l.so_item_id), l]))
  const kept = new Set((items || []).map(idOf).filter((id): id is number => id !== null && saved.has(id)))
  const dropped = existing.filter((l) => !kept.has(Number(l.so_item_id)) && parseFromStock(l.outsourced_description))
  const picks: StoredPick[] = []
  const reuse = new Map<number, string>()
  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i]
    const id = idOf(item)
    if (id !== null && saved.has(id)) {
      const line = saved.get(id)!
      if (parseFromStock(line.outsourced_description) && num(item.quantity) > num(line.quantity)) {
        return {
          ok: false,
          status: 400,
          error: `"${line.outsourced_name || "Stored item"}" was taken from stock: it cannot be raised above ${num(line.quantity)}. Add a new line for more.`,
          code: "FROM_STOCK_RAISE",
        }
      }
      continue
    }
    const picked = pickedOf(item)
    if (picked === null) continue
    const same = dropped.findIndex(
      (l) => parseFromStock(l.outsourced_description)!.pickedId === picked && num(l.quantity) >= num(item.quantity),
    )
    if (same >= 0) {
      reuse.set(i, String(dropped[same].outsourced_description))
      dropped.splice(same, 1)
      continue
    }
    picks.push({ inventoryId: picked, quantity: num(item.quantity) })
  }
  return { ok: true, picks, reuse }
}
