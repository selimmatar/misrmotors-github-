// Stock deduction at delivery-permit approval (Batch 4E-stock). Decision: "after DP approval it should be DEDUCTED."
// The matching hold (from sales-order approval until the permit is approved) is derived in lib/stock-hold.ts.
//
// There are no database transactions, so safety comes from:
//   * a once-per-permit claim: a plain INSERT into idempotency_log (operation_type 'dp_stock_deduct', key
//     'dp_stock_deduct_<permitId>') guarded by UNIQUE(operation_type, idempotency_key). No Date.now() in the key.
//   * checking EVERY line before moving any stock (nothing is touched when a line is short);
//   * guarded compare-and-swap updates (quantity must still equal the value read and be >= the quantity taken);
//     stock is NEVER clamped to 0;
//   * an undo (add the quantity back) when a later line, or the permit status update, fails.
// Permits already APPROVED before this batch are never deducted retroactively (the route skips them).
import { selectInChunks } from "./stock-hold"

type Db = any // supabase-js client (or a test double)

export const DP_STOCK_OPERATION = "dp_stock_deduct"
const MAX_CAS_ATTEMPTS = 6
/** A 'processing' claim older than this is treated as abandoned and may be taken over. */
export const STALE_CLAIM_MS = 2 * 60 * 1000

export const dpStockKey = (permitId: number) => `dp_stock_deduct_${permitId}`

export interface StockMove {
  inventoryId: number
  productId: number
  warehouseId: number | null
  quantity: number
  before: number
  after: number
  productName: string
  /** an outsourced item stored for the order (lib/goods-receiving.ts storeOutsourced): no product, no audit row */
  outsourced?: boolean
}

export interface ShortLine {
  productId: number
  productName: string
  warehouseId: number | null
  requested: number
  available: number
  reason: "INSUFFICIENT" | "NO_STOCK_ROW" | "WAREHOUSE_NOT_ALLOCATED"
}

export type DeductResult =
  | { ok: true; state: "deducted"; moves: StockMove[] }
  | { ok: true; state: "nothing" | "already" }
  | { ok: false; status: number; body: { error: string; code?: string; lines?: ShortLine[] } }

const num = (v: unknown) => Number(v) || 0

const shortMessage = (permitNo: string, lines: ShortLine[]) =>
  `Cannot approve ${permitNo}: ` +
  lines
    .map((l) =>
      l.reason === "WAREHOUSE_NOT_ALLOCATED"
        ? `${l.productName}: no warehouse is allocated and several warehouses hold it`
        : `${l.productName}: requested ${l.requested}, in stock ${l.available}${l.warehouseId ? ` (warehouse ${l.warehouseId})` : ""}`,
    )
    .join("; ") +
  ". Nothing was deducted and the permit was not approved."

const insufficient = (permitNo: string, lines: ShortLine[]): DeductResult => ({
  ok: false,
  status: 409,
  body: { error: shortMessage(permitNo, lines), code: "INSUFFICIENT_STOCK", lines },
})

async function finishClaim(db: Db, permitId: number, status: "completed" | "failed" | "partial_failure", message?: string) {
  const { error } = await db
    .from("idempotency_log")
    .update({ status, error_message: message ?? null, completed_at: new Date().toISOString() })
    .eq("operation_type", DP_STOCK_OPERATION)
    .eq("idempotency_key", dpStockKey(permitId))
  if (error) console.error("[dp-stock] could not update idempotency row:", error.message)
}

type Claim = { state: "claimed" } | { state: "already" } | { state: "blocked"; result: DeductResult }

async function claim(db: Db, permitId: number): Promise<Claim> {
  const attempt = await db.from("idempotency_log").insert({
    operation_type: DP_STOCK_OPERATION,
    idempotency_key: dpStockKey(permitId),
    entity_type: "delivery_permits",
    entity_id: permitId,
    status: "processing",
  })
  if (!attempt.error) return { state: "claimed" }
  const blocked = (error: string, status = 409): Claim => ({ state: "blocked", result: { ok: false, status, body: { error } } })
  if (attempt.error.code !== "23505") {
    console.error("[dp-stock] claim failed:", attempt.error.message)
    return blocked("Could not start the stock deduction. Nothing was changed.", 500)
  }
  const { data: previous } = await db
    .from("idempotency_log")
    .select("status, created_at")
    .eq("operation_type", DP_STOCK_OPERATION)
    .eq("idempotency_key", dpStockKey(permitId))
    .limit(1)
    .maybeSingle()
  if (previous?.status === "completed") return { state: "already" }
  if (previous?.status === "partial_failure") {
    return blocked("The stock for this delivery permit was only partly handled earlier. Contact an administrator to review.")
  }
  if (previous?.status === "failed") {
    const { data: reclaimed } = await db
      .from("idempotency_log")
      .update({ status: "processing", error_message: null, completed_at: null })
      .eq("operation_type", DP_STOCK_OPERATION)
      .eq("idempotency_key", dpStockKey(permitId))
      .eq("status", "failed")
      .select("id")
    if (reclaimed && reclaimed.length === 1) return { state: "claimed" }
  }
  if (previous?.status === "processing" && previous.created_at) {
    // A claim stuck in 'processing' (the request died) older than STALE_CLAIM_MS is re-claimable. Compare-and-swap on the
    // exact stale row (status AND created_at) so only one request can take it over; created_at is refreshed on takeover.
    const startedAt = new Date(previous.created_at).getTime()
    if (Number.isFinite(startedAt) && Date.now() - startedAt > STALE_CLAIM_MS) {
      const { data: taken } = await db
        .from("idempotency_log")
        .update({ created_at: new Date().toISOString(), error_message: null, completed_at: null })
        .eq("operation_type", DP_STOCK_OPERATION)
        .eq("idempotency_key", dpStockKey(permitId))
        .eq("status", "processing")
        .eq("created_at", previous.created_at)
        .select("id")
      if (taken && taken.length === 1) return { state: "claimed" }
    }
  }
  return blocked("This delivery permit is already being approved. Try again in a moment.")
}

/** Move `quantity` out of one inventory row with a compare-and-swap. Returns the move, or the quantity found when short. */
export async function takeFromRow(db: Db, inventoryId: number, quantity: number): Promise<{ ok: true; before: number; after: number } | { ok: false; available: number }> {
  let available = 0
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data: row, error } = await db.from("inventory").select("quantity").eq("inventory_id", inventoryId).limit(1).maybeSingle()
    if (error) throw new Error(`read inventory: ${error.message}`)
    available = num(row?.quantity)
    if (!row || available < quantity) return { ok: false, available }
    const { data: updated, error: updateError } = await db
      .from("inventory")
      .update({ quantity: available - quantity, last_updated: new Date().toISOString() })
      .eq("inventory_id", inventoryId)
      .eq("quantity", available)
      .gte("quantity", quantity)
      .select("inventory_id")
    if (updateError) throw new Error(`update inventory: ${updateError.message}`)
    if (updated && updated.length === 1) return { ok: true, before: available, after: available - quantity }
  }
  return { ok: false, available }
}

/** Put moved stock back (undo). Returns the moves that could NOT be restored. */
export async function undoMoves(db: Db, moves: StockMove[]): Promise<StockMove[]> {
  const failed: StockMove[] = []
  for (const move of moves) {
    let restored = false
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS && !restored; attempt++) {
      const { data: row } = await db.from("inventory").select("quantity").eq("inventory_id", move.inventoryId).limit(1).maybeSingle()
      if (!row) break
      const current = num(row.quantity)
      const { data: updated, error } = await db
        .from("inventory")
        .update({ quantity: current + move.quantity, last_updated: new Date().toISOString() })
        .eq("inventory_id", move.inventoryId)
        .eq("quantity", current)
        .select("inventory_id")
      restored = !error && !!updated && updated.length === 1
    }
    if (!restored) {
      console.error(`[dp-stock] could not restore ${move.quantity} units to inventory ${move.inventoryId} (product ${move.productId})`)
      failed.push(move)
    }
  }
  return failed
}

/**
 * Deduct the stock lines of a delivery permit. Call BEFORE the permit status changes to APPROVED, and then call
 * finishDeduction (status change worked) or abortDeduction (status change failed) exactly once when it returned
 * state 'deducted'. States: 'nothing' (no stock lines: nothing claimed), 'already' (this permit was deducted
 * before: nothing moved), 'deducted'.
 */
export async function deductStockForPermit(db: Db, permit: { permit_id: number; permit_no?: string }): Promise<DeductResult> {
  const permitNo = permit.permit_no || `permit ${permit.permit_id}`
  const { data: itemRows, error: itemsError } = await db
    .from("delivery_permit_items")
    .select("item_id, product_id, item_name_snapshot, quantity, warehouse_id")
    .eq("permit_id", permit.permit_id)
  if (itemsError) {
    console.error("[dp-stock] could not load permit items:", itemsError.message)
    return { ok: false, status: 500, body: { error: "Could not read the permit items. Nothing was changed." } }
  }
  const items = ((itemRows || []) as any[]).filter((i) => i.product_id && num(i.quantity) > 0)
  // Outsourced lines take the item stored for this order, if any (owner, 2026-11-04). Never blocks the approval:
  // an item that was not stored (delivered straight from the supplier) simply has nothing to take.
  const outsourcedLines = ((itemRows || []) as any[]).filter((i) => !i.product_id && num(i.quantity) > 0)
  let storedRows: any[] = []
  if (outsourcedLines.length > 0) {
    try {
      storedRows = await storedOutsourcedRows(db, permit.permit_id)
    } catch (error: any) {
      console.error("[dp-stock] could not read stored outsourced items:", error?.message || error)
      return { ok: false, status: 500, body: { error: "Could not read the stored outsourced items. Nothing was changed." } }
    }
  }
  if (items.length === 0 && storedRows.length === 0) return { ok: true, state: "nothing" }

  const claimed = await claim(db, permit.permit_id)
  if (claimed.state === "already") return { ok: true, state: "already" }
  if (claimed.state === "blocked") return claimed.result

  const release = async (message: string) => finishClaim(db, permit.permit_id, "failed", message)
  try {
    const productIds = [...new Set(items.map((i) => Number(i.product_id)))]
    const rows = (await selectInChunks(
      productIds,
      (chunk) => db.from("inventory").select("inventory_id, product_id, warehouse_id, quantity").in("product_id", chunk).eq("is_returned", false),
      "load inventory",
    )) as any[]

    // Resolve each line to one inventory row. Lines without a warehouse fall back to the single row with enough stock.
    const needNoWarehouse = new Map<number, number>()
    for (const i of items) if (!i.warehouse_id) needNoWarehouse.set(Number(i.product_id), (needNoWarehouse.get(Number(i.product_id)) || 0) + num(i.quantity))
    const short: ShortLine[] = []
    const perRow = new Map<number, { row: any; need: number; name: string }>()
    for (const item of items) {
      const productId = Number(item.product_id)
      const need = num(item.quantity)
      const name = item.item_name_snapshot || `product ${productId}`
      let row: any
      if (item.warehouse_id) {
        row = rows.find((r) => Number(r.product_id) === productId && Number(r.warehouse_id) === Number(item.warehouse_id))
        if (!row) {
          short.push({ productId, productName: name, warehouseId: Number(item.warehouse_id), requested: need, available: 0, reason: "NO_STOCK_ROW" })
          continue
        }
      } else {
        const productRows = rows.filter((r) => Number(r.product_id) === productId)
        const enough = productRows.filter((r) => num(r.quantity) >= (needNoWarehouse.get(productId) || need))
        if (enough.length === 0) {
          short.push({
            productId,
            productName: name,
            warehouseId: null,
            requested: need,
            available: productRows.reduce((m, r) => Math.max(m, num(r.quantity)), 0),
            reason: productRows.length === 0 ? "NO_STOCK_ROW" : "INSUFFICIENT",
          })
          continue
        }
        if (enough.length > 1) {
          short.push({ productId, productName: name, warehouseId: null, requested: need, available: 0, reason: "WAREHOUSE_NOT_ALLOCATED" })
          continue
        }
        row = enough[0]
      }
      const entry = perRow.get(row.inventory_id) || { row, need: 0, name }
      entry.need += need
      perRow.set(row.inventory_id, entry)
    }
    // Sufficiency of EVERY row before anything moves.
    for (const { row, need, name } of perRow.values()) {
      if (num(row.quantity) < need) {
        short.push({ productId: Number(row.product_id), productName: name, warehouseId: row.warehouse_id ?? null, requested: need, available: num(row.quantity), reason: "INSUFFICIENT" })
      }
    }
    if (short.length > 0) {
      await release("insufficient stock")
      return insufficient(permitNo, short)
    }

    const moves: StockMove[] = []
    for (const { row, need, name } of perRow.values()) {
      const taken = await takeFromRow(db, row.inventory_id, need)
      if (!taken.ok) {
        const failedUndo = await undoMoves(db, moves)
        await (failedUndo.length ? finishClaim(db, permit.permit_id, "partial_failure", "stock changed during approval and the undo failed") : release("stock changed during approval"))
        return insufficient(permitNo, [
          { productId: Number(row.product_id), productName: name, warehouseId: row.warehouse_id ?? null, requested: need, available: taken.available, reason: "INSUFFICIENT" },
        ])
      }
      moves.push({ inventoryId: row.inventory_id, productId: Number(row.product_id), warehouseId: row.warehouse_id ?? null, quantity: need, before: taken.before, after: taken.after, productName: name })
    }
    // Outsourced: take up to what was delivered from the rows stored for this order with the same name (never more
    // than stored, never negative). A row changed by someone else in the meantime is skipped, not an error.
    for (const line of outsourcedLines) {
      let need = num(line.quantity)
      const name = sameName(line.item_name_snapshot)
      for (const row of storedRows) {
        if (need <= 0) break
        if (sameName(row.outsourced_name) !== name || num(row.quantity) <= 0) continue
        const take = Math.min(need, num(row.quantity))
        const taken = await takeFromRow(db, row.inventory_id, take)
        if (!taken.ok) continue
        row.quantity = taken.after
        need -= take
        moves.push({ inventoryId: row.inventory_id, productId: 0, warehouseId: row.warehouse_id ?? null, quantity: take, before: taken.before, after: taken.after, productName: line.item_name_snapshot || "", outsourced: true })
      }
    }
    if (moves.length === 0) {
      await finishClaim(db, permit.permit_id, "completed")
      return { ok: true, state: "nothing" }
    }
    return { ok: true, state: "deducted", moves }
  } catch (error: any) {
    console.error("[dp-stock] deduction failed:", error?.message || error)
    await release(error?.message || "deduction failed")
    return { ok: false, status: 500, body: { error: "Could not deduct the stock. The permit was not approved." } }
  }
}

const sameName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()

/** Non-returned outsourced inventory rows stored for the permit's sales order (matched by so_number). */
async function storedOutsourcedRows(db: Db, permitId: number): Promise<any[]> {
  const { data: p, error } = await db.from("delivery_permits").select("sales_order_id").eq("permit_id", permitId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!p?.sales_order_id) return []
  const { data: so, error: soError } = await db.from("sales_orders").select("so_number").eq("so_id", p.sales_order_id).maybeSingle()
  if (soError) throw new Error(soError.message)
  if (!so?.so_number) return []
  const { data: rows, error: rowsError } = await db
    .from("inventory")
    .select("inventory_id, warehouse_id, quantity, outsourced_name")
    .eq("is_outsourced", true)
    .eq("is_returned", false)
    .eq("so_number", so.so_number)
    .order("inventory_id", { ascending: true })
  if (rowsError) throw new Error(rowsError.message)
  return (rows || []).filter((r: any) => num(r.quantity) > 0)
}

export { STOCK_OUT_DP_STATUSES } from "./stock-hold"

/**
 * The permit is now SIGNED (or approved): audit rows ('sale') and close the claim. The moves are also kept in the
 * permit's history so a later rejection can put exactly that stock back. A failed audit insert never undoes the deduction.
 */
export async function finishDeduction(db: Db, permit: { permit_id: number; permit_no?: string }, moves: StockMove[], userId?: unknown) {
  try {
    const { error: logError } = await db.from("workflow_events").insert({
      entity_type: "DELIVERY_PERMIT",
      entity_id: permit.permit_id,
      event_type: "DP_STOCK_DEDUCTED",
      new_value: JSON.stringify(moves),
      notes: `Stock out for ${permit.permit_no || `permit ${permit.permit_id}`}`,
    })
    if (logError) console.error("[dp-stock] could not keep the moves in the permit history:", logError.message)
  } catch (error: any) {
    console.error("[dp-stock] could not keep the moves in the permit history:", error?.message || error)
  }
  try {
    const stock = moves.filter((m) => !m.outsourced)
    if (stock.length === 0) return await finishClaim(db, permit.permit_id, "completed")
    const { error } = await db.from("inventory_transactions").insert(
      stock.map((m) => ({
        product_id: m.productId,
        transaction_type: "sale",
        reference_type: "DELIVERY_PERMIT",
        reference_id: permit.permit_id,
        reference_number: permit.permit_no ?? null,
        quantity_change: -m.quantity,
        quantity_before: m.before,
        quantity_after: m.after,
        notes: `Delivery permit approval${m.warehouseId ? ` - warehouse ${m.warehouseId}` : ""}${userId ? ` - by user ${userId}` : ""}`,
        created_by: null,
      })),
    )
    if (error) console.error("[dp-stock] audit insert failed (stock stays deducted):", error.message)
  } catch (error: any) {
    console.error("[dp-stock] audit insert failed (stock stays deducted):", error?.message || error)
  }
  await finishClaim(db, permit.permit_id, "completed")
}

/** The permit status update failed after the deduction: give the stock back. Returns true when fully restored. */
export async function abortDeduction(db: Db, permit: { permit_id: number }, moves: StockMove[], reason: string): Promise<boolean> {
  const failed = await undoMoves(db, moves)
  if (failed.length > 0) {
    await finishClaim(db, permit.permit_id, "partial_failure", `${reason}; stock could not be restored`)
    return false
  }
  await finishClaim(db, permit.permit_id, "failed", reason)
  return true
}

/**
 * A signed permit was rejected (owner rule, 2026-11-12: stock leaves at signing): put back exactly the stock it took,
 * as kept in its history, log it ('return'), and mark its claim "reversed". Returns false when something could not be
 * put back (reported to the user; the claim is then left for an administrator).
 */
export async function reverseDeduction(db: Db, permit: { permit_id: number; permit_no?: string }, userId?: unknown): Promise<boolean> {
  const { data: claimRow } = await db
    .from("idempotency_log")
    .select("status")
    .eq("operation_type", DP_STOCK_OPERATION)
    .eq("idempotency_key", dpStockKey(permit.permit_id))
    .limit(1)
    .maybeSingle()
  if (claimRow?.status !== "completed") return true // nothing was taken (or it was already put back)
  const { data: events, error } = await db
    .from("workflow_events")
    .select("new_value")
    .eq("entity_type", "DELIVERY_PERMIT")
    .eq("entity_id", permit.permit_id)
    .eq("event_type", "DP_STOCK_DEDUCTED")
  if (error) {
    console.error("[dp-stock] could not read the permit's stock moves:", error.message)
    return false
  }
  const moves: StockMove[] = []
  for (const e of events || []) {
    try {
      moves.push(...(JSON.parse(e.new_value || "[]") as StockMove[]))
    } catch {
      // unreadable entry: skipped
    }
  }
  const failed = await undoMoves(db, moves)
  if (failed.length > 0) {
    console.error("[dp-stock] rejected permit: some stock could not be put back", permit.permit_id, failed)
    return false
  }
  const stock = moves.filter((m) => !m.outsourced)
  if (stock.length > 0) {
    const { error: auditError } = await db.from("inventory_transactions").insert(
      stock.map((m) => ({
        product_id: m.productId,
        transaction_type: "return",
        reference_type: "DELIVERY_PERMIT",
        reference_id: permit.permit_id,
        reference_number: permit.permit_no ?? null,
        quantity_change: m.quantity,
        quantity_before: m.after,
        quantity_after: m.before,
        notes: `Delivery permit rejected: stock put back${m.warehouseId ? ` - warehouse ${m.warehouseId}` : ""}${userId ? ` - by user ${userId}` : ""}`,
        created_by: null,
      })),
    )
    if (auditError) console.error("[dp-stock] audit insert failed (stock was put back):", auditError.message)
  }
  await db
    .from("idempotency_log")
    .update({ status: "reversed", error_message: "permit rejected: stock put back", completed_at: new Date().toISOString() })
    .eq("operation_type", DP_STOCK_OPERATION)
    .eq("idempotency_key", dpStockKey(permit.permit_id))
  await db.from("workflow_events").insert({
    entity_type: "DELIVERY_PERMIT",
    entity_id: permit.permit_id,
    event_type: "DP_STOCK_RETURNED",
    new_value: JSON.stringify(moves),
    notes: `Rejected after signing: stock put back`,
  })
  return true
}
