// Outsourced items in our warehouses (owner decisions, 2026-11-17).
//
// PURCHASED for a sales order (lib/goods-receiving.ts storeOutsourced: "Received on <PO> ...", not a return): the row
// is on hold for that order, whole, while the order is open, and the Inventory page shows it on the Pending tab, not
// On hand. Its order delivers it (lib/dp-stock.ts takes the rows of its so_number by name). Once that order is
// cancelled / rejected / delivered / completed nothing holds it (as before).
//
// FREE stock = an outsourced RETURN the customer gave back and that was put into a warehouse (lib/returns.ts), or a
// purchased row whose order is closed: On hand, and any sales order can take it ("add from inventory", create and
// edit). A sales order line that takes it (lib/from-stock-line.ts marker) reserves an inventory row - the picked row
// itself or the part split off it, re-labelled "Taken from stock for <SO>" - held for the line:
//   held(row) = min(row quantity, what the order's from-stock lines on that row still need)
//   still need = their quantity - what the order's signed/approved delivery permits delivered of that name
// Lowering or removing the line releases the rest as free stock; a closed order holds nothing. Items received for an
// order WITHOUT a warehouse go straight to the customer: no inventory row (Pending tab, app/api/inventory/pending).
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

/** A row purchased for a sales order (received into a warehouse by storeOutsourced), not a return or a reserved part. */
export const isPurchasedRow = (r: any) =>
  isStoredOutsourced(r) && !r.is_returned && /^Received on /.test(String(r.outsourced_description ?? ""))

/** The label of a row reserved for an order that took it from stock (no longer "purchased" for its first order). */
export const takenFromStockLabel = (soNumber: string) => `Taken from stock for ${soNumber}`

export interface OutsourcedHold {
  /** units of the row held for an order (0 = all free) */
  held: number
  soNumber: string | null
  customerName: string | null
  /** held because it was purchased for that order (Pending tab), not taken from stock */
  purchased: boolean
}

export interface FromStockLine {
  so_item_id?: number
  so_id: number
  quantity: unknown
  outsourced_name?: string | null
  outsourced_description?: string | null
}

export function computeOutsourcedHolds(input: {
  rows: { inventory_id: number; quantity: unknown; product_id?: unknown; is_outsourced?: unknown; is_returned?: unknown; warehouse_id?: unknown; so_number?: string | null; outsourced_description?: string | null }[]
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

  const openByNumber = new Map([...open.values()].map((o) => [String(o.so_number), o]))
  const customerOf = (order: any) => (order ? (input.customers || []).find((c) => c.customer_id === order.customer_id)?.customer_name ?? null : null)
  const out = new Map<number, OutsourcedHold>()
  for (const r of input.rows) {
    if (!isStoredOutsourced(r)) continue
    const buyer = isPurchasedRow(r) && r.so_number ? openByNumber.get(String(r.so_number)) : undefined
    if (buyer) {
      // purchased for an open order: held for it, whole
      const held = Math.max(0, num(r.quantity))
      out.set(r.inventory_id, { held, soNumber: String(buyer.so_number), customerName: customerOf(buyer), purchased: true })
      continue
    }
    const n = need.get(r.inventory_id)
    const held = n ? Math.min(Math.max(0, num(r.quantity)), n.qty) : 0
    const order = n ? open.get(n.soId) : undefined
    out.set(r.inventory_id, { held, soNumber: held > 0 && order ? String(order.so_number) : null, customerName: held > 0 ? customerOf(order) : null, purchased: false })
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
  // the orders purchased rows were bought for
  const known = new Set(orders.map((o: any) => String(o.so_number)))
  const buyerNumbers = [...new Set(stored.filter((r) => isPurchasedRow(r) && r.so_number && !known.has(String(r.so_number))).map((r) => String(r.so_number)))]
  if (buyerNumbers.length) {
    orders.push(
      ...(await selectInChunks(buyerNumbers, (chunk) => db.from("sales_orders").select("so_id, so_number, status, customer_id").in("so_number", chunk), "load buying orders")),
    )
  }
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
        const moved = must(
          await guard(db.from("inventory").update({ so_number: soNumber, is_returned: false, outsourced_description: takenFromStockLabel(soNumber), last_updated: now })).select(
            "inventory_id",
          ),
          "reserve stored item",
        )
        if (moved.length !== 1) throw new Error(`stored item ${id} changed meanwhile`)
        undo.push(async () => {
          must(
            await db
              .from("inventory")
              .update({ so_number: row.so_number ?? null, is_returned: !!row.is_returned, outsourced_description: row.outsourced_description ?? null })
              .eq("inventory_id", id)
              .eq("so_number", soNumber),
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
            outsourced_description: takenFromStockLabel(soNumber),
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
  /** saved from-stock lines raised by the edit: the extra quantity their reserved row must get */
  topUps: TopUp[]
}

export interface TopUp {
  reservedId: number
  pickedId: number
  quantity: number
  name: string
}

/**
 * A raised from-stock line (owner, 2026-11-17): its reserved row must hold `quantity` more. What is free on the row
 * itself is used first (e.g. after the line was lowered); the rest moves from the row it was picked from, if free
 * there (compare-and-set on both rows). Otherwise the edit is refused with what is available. Call after the order's
 * other reservations; `undo` puts the moved quantity back.
 */
export async function applyTopUps(
  db: Db,
  topUps: TopUp[],
): Promise<{ ok: true; undo: () => Promise<void> } | { ok: false; status: number; error: string; code: string }> {
  const undo: (() => Promise<void>)[] = []
  const fail = async (error: string, code: string, status = 400) => {
    await runUndo(undo)
    return { ok: false as const, status, error, code }
  }
  try {
    for (const t of topUps) {
      const ids = [...new Set([t.reservedId, t.pickedId])]
      const rows = must(await db.from("inventory").select(STORED_COLUMNS).in("inventory_id", ids), "load stored items")
      const holds = await loadOutsourcedHolds(db, rows)
      const byId = new Map<number, any>(rows.map((r: any) => [Number(r.inventory_id), r]))
      const reserved = byId.get(t.reservedId)
      const freeOn = (id: number) => {
        const r = byId.get(id)
        return r && isWarehouseOutsourced(r) ? Math.max(0, num(r.quantity) - (holds.get(id)?.held || 0)) : 0
      }
      const own = reserved ? freeOn(t.reservedId) : 0
      if (own >= t.quantity) continue
      const more = t.quantity - own
      const source = t.pickedId !== t.reservedId ? byId.get(t.pickedId) : undefined
      const there = source ? freeOn(t.pickedId) : 0
      if (!reserved || there < more) {
        return await fail(`Insufficient stock for ${t.name || "the stored item"}. Requested: ${t.quantity} more, Available: ${own + there}`, "STORED_ITEM_SHORT")
      }
      const now = new Date().toISOString()
      const lowered = must(
        await db.from("inventory").update({ quantity: num(source.quantity) - more, last_updated: now }).eq("inventory_id", t.pickedId).eq("quantity", source.quantity).select("inventory_id"),
        "take from stored item",
      )
      if (lowered.length !== 1) return await fail("A stored item on this order was changed by someone else. Nothing was saved; please try again.", "STORED_ITEM_CHANGED", 409)
      undo.push(async () => {
        const cur = must(await db.from("inventory").select("quantity").eq("inventory_id", t.pickedId), "undo top-up: read")[0]
        if (cur) must(await db.from("inventory").update({ quantity: num(cur.quantity) + more }).eq("inventory_id", t.pickedId).eq("quantity", cur.quantity), "undo top-up")
      })
      const raised = must(
        await db.from("inventory").update({ quantity: num(reserved.quantity) + more, last_updated: now }).eq("inventory_id", t.reservedId).eq("quantity", reserved.quantity).select("inventory_id"),
        "add to reserved item",
      )
      if (raised.length !== 1) return await fail("A stored item on this order was changed by someone else. Nothing was saved; please try again.", "STORED_ITEM_CHANGED", 409)
      undo.push(async () => {
        const cur = must(await db.from("inventory").select("quantity").eq("inventory_id", t.reservedId), "undo top-up: read")[0]
        if (cur) must(await db.from("inventory").update({ quantity: num(cur.quantity) - more }).eq("inventory_id", t.reservedId).eq("quantity", cur.quantity), "undo top-up")
      })
    }
  } catch (e: any) {
    await runUndo(undo)
    throw e
  }
  return { ok: true, undo: () => runUndo(undo) }
}

/**
 * Sales order EDIT: what the edit must reserve. `existing` = the order's lines as saved, `items` = what the edit sends.
 *  - a new line with fromInventoryId X reserves its quantity from X, unless the edit drops a saved from-stock line
 *    picked from X with the same name and at least that quantity (the same edit re-sent): it then keeps that line's
 *    reservation;
 *  - a saved from-stock line lowered or removed: its reservation shrinks with it (the rest is free stock again);
 *    raised: its reserved row must get the extra (applyTopUps).
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
  const topUps: TopUp[] = []
  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i]
    const id = idOf(item)
    if (id !== null && saved.has(id)) {
      const line = saved.get(id)!
      const marker = parseFromStock(line.outsourced_description)
      if (marker && num(item.quantity) > num(line.quantity)) {
        topUps.push({ reservedId: marker.reservedId, pickedId: marker.pickedId, quantity: num(item.quantity) - num(line.quantity), name: String(line.outsourced_name || "") })
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
  return { ok: true, picks, reuse, topUps }
}
