// Sales returns (Batch 2).
//
//   create   : POST /api/returns   -> validate against the real delivery permit, then insert (idempotent)
//   process  : PUT  /api/returns   -> warehouse receives a return exactly once; good items go to the holding row
//   reject   : PUT  /api/returns   -> pending_warehouse -> rejected (reason required, no inventory, frees the quantity)
//   restock  : POST /api/inventory/restock-returned -> holding row -> sellable stock, exactly once
//   remove   : POST /api/inventory/remove-returned  -> holding row written off (+ supplier credit), exactly once
//
// Concurrency model. There is NO database transaction, lock, RPC or new constraint here (Batch 2 forbids schema
// changes). Safety comes from guarded single-statement writes whose WHERE clause carries the state we read:
//   * return creation : check -> insert -> re-check; of racing requests the lowest return_id survives and the
//                       others delete themselves (same pattern as Batch 1B invoicing).
//   * processing      : UPDATE ... WHERE status = 'pending_warehouse' ... RETURNING (only one request wins),
//                       moving the return to `assigned_warehouse` (= "being processed") before any stock moves.
//   * restock/remove  : the holding row is CLAIMED by a guarded DELETE (WHERE is_returned AND quantity = <read>)
//                       before anything is added/credited, so only one request can ever consume it.
// Every inventory write is checked; a failure undoes what this request already did (best effort) and is reported,
// never reported as success. If an undo itself fails the failure is flagged `partialFailure` for manual review.
//
// Returns never touch invoices, accounts_receivable, payments, balance_entries or schedules.

import { DELIVERED_PERMIT_STATUSES, lineKey, loadReturnLines, returnedByKey } from "./return-lines"
import { syncSalesOrderNetTotal } from "./so-edit"

type Db = any // supabase-js client (or a test double)

// A customer may refuse an item when the driver arrives (OUT_FOR_DELIVERY) or return it later (SUBMITTED_SIGNED /
// APPROVED). The DP does not have to be delivered first.
export const RETURNABLE_DP_STATUSES = DELIVERED_PERMIT_STATUSES
export const RETURN_CONDITIONS = ["good", "damaged", "defective", "unsellable"]
export const RETURN_REASONS = ["damaged", "wrong_item", "customer_refused", "excess_quantity", "quality_issue", "other"]
/** Marker written to inventory_batches.po_number so a return's batch can be told apart from purchase batches. */
export const RETURN_BATCH_PREFIX = "RET-"
const IDEMPOTENCY_OPERATION = "return_create"
const MAX_ATTEMPTS = 3
const QTY_EPSILON = 1e-6

export interface WorkflowResult {
  status: number
  body: any
}
// `message` mirrors `error` because the inventory screens read error.message and the returns screens error.error.
const failure = (status: number, error: string, extra: Record<string, any> = {}): WorkflowResult => ({
  status,
  body: { error, message: error, ...extra },
})
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const errText = (e: any) => e?.message || String(e)
// Optional lookups (supplier / cost hints) never block a write-off: a failed lookup behaves like "not found",
// exactly as the endpoint did before.
const soft = (result: any, what: string): any => {
  if (result.error) {
    console.warn(`[returns] ${what} lookup failed (ignored): ${result.error.message || result.error}`)
    return null
  }
  return result.data
}

type Undo = { what: string; run: () => Promise<void> }
async function runUndo(undo: Undo[]): Promise<string[]> {
  const failed: string[] = []
  for (const step of [...undo].reverse()) {
    try {
      await step.run()
    } catch (e) {
      console.error(`[returns] UNDO FAILED (${step.what}): ${errText(e)}`)
      failed.push(step.what)
    }
  }
  return failed
}

// compare-and-swap helper for a nullable numeric column
const whereQuantity = (query: any, old: number | null | undefined) =>
  old === null || old === undefined ? query.is("quantity", null) : query.eq("quantity", old)

// ---------------------------------------------------------------------------------------------------------
// Idempotency (plain INSERT guarded by UNIQUE(operation_type, idempotency_key), as in Batch 1A)
// ---------------------------------------------------------------------------------------------------------
type Claim =
  | { state: "claimed" }
  | { state: "duplicate"; entityId: number }
  | { state: "blocked"; result: WorkflowResult }

async function claimIdempotency(db: Db, key: string, entityType: string, entityId: number): Promise<Claim> {
  const claim = await db.from("idempotency_log").insert({
    operation_type: IDEMPOTENCY_OPERATION,
    idempotency_key: key,
    entity_type: entityType,
    entity_id: entityId,
    status: "processing",
  })
  if (!claim.error) return { state: "claimed" }
  if (claim.error.code !== "23505") {
    console.error("[returns] idempotency claim failed:", claim.error.message)
    return { state: "blocked", result: failure(500, "Could not start the return. Nothing was recorded.") }
  }
  const { data: previous } = await db
    .from("idempotency_log")
    .select("status, entity_id")
    .eq("operation_type", IDEMPOTENCY_OPERATION)
    .eq("idempotency_key", key)
    .maybeSingle()
  if (previous?.status === "completed") return { state: "duplicate", entityId: previous.entity_id }
  if (previous?.status === "partial_failure") {
    return {
      state: "blocked",
      result: failure(409, "This return was only partly recorded. It will not be repeated; contact an administrator to review.", { partialFailure: true }),
    }
  }
  if (previous?.status === "failed") {
    // Rejected before anything was kept: the same key may be retried. Re-claim atomically.
    const { data: reclaimed } = await db
      .from("idempotency_log")
      .update({ status: "processing", error_message: null, completed_at: null })
      .eq("operation_type", IDEMPOTENCY_OPERATION)
      .eq("idempotency_key", key)
      .eq("status", "failed")
      .select("id")
    if (reclaimed && reclaimed.length === 1) return { state: "claimed" }
  }
  return { state: "blocked", result: failure(409, "This return is already being processed") }
}

async function finishIdempotency(
  db: Db,
  key: string,
  status: "completed" | "failed" | "partial_failure",
  message?: string,
  entity?: { type: string; id: number },
) {
  const { error } = await db
    .from("idempotency_log")
    .update({
      status,
      error_message: message ?? null,
      completed_at: new Date().toISOString(),
      ...(entity ? { entity_type: entity.type, entity_id: entity.id } : {}),
    })
    .eq("operation_type", IDEMPOTENCY_OPERATION)
    .eq("idempotency_key", key)
  if (error) console.error("[returns] could not update idempotency row:", error.message)
}

// ---------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------
function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 && raw < 1_000_000_000 ? raw : null
  if (typeof raw === "string" && /^\d{1,9}$/.test(raw.trim())) {
    const n = Number(raw.trim())
    return n > 0 ? n : null
  }
  return null
}

export async function createReturn(db: Db, body: any): Promise<WorkflowResult> {
  // ---- request shape (nothing is read or written yet) ----
  const permitId = parsePositiveInt(body?.permitId)
  if (permitId === null) return failure(400, "A valid delivery permit id (permitId) is required")

  const clientKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(clientKey)) {
    return failure(400, "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)")
  }
  const idempotencyKey = `ret_${permitId}_${clientKey}`

  const rawItems: any[] = Array.isArray(body?.items) ? body.items : []
  if (rawItems.length === 0) return failure(400, "At least one item to return is required")
  const requestedLines: { raw: any; qty: number; condition: string; reason: string }[] = []
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]
    const label = raw?.productName ? `"${raw.productName}"` : `item ${i + 1}`
    const qty = parsePositiveInt(raw?.quantityReturned)
    if (qty === null) return failure(400, `${label}: quantityReturned must be a whole number greater than zero`)
    const condition = raw?.condition === undefined || raw?.condition === null || raw?.condition === "" ? "good" : String(raw.condition)
    if (!RETURN_CONDITIONS.includes(condition)) return failure(400, `${label}: condition must be one of ${RETURN_CONDITIONS.join(", ")}`)
    requestedLines.push({ raw, qty, condition, reason: RETURN_REASONS.includes(raw?.reason) ? raw.reason : "other" })
  }

  // ---- claim the idempotency key ----
  const claim = await claimIdempotency(db, idempotencyKey, "delivery_permit", permitId)
  if (claim.state === "duplicate") {
    return { status: 200, body: { success: true, isDuplicate: true, returnId: claim.entityId, message: "This return was already recorded" } }
  }
  if (claim.state === "blocked") return claim.result

  const reject = async (status: number, error: string, extra: Record<string, any> = {}) => {
    await finishIdempotency(db, idempotencyKey, "failed", error)
    return failure(status, error, extra)
  }

  let createdReturnId: number | null = null
  try {
    // ---- the delivery permit is the source of truth for SO, customer and items ----
    const dp = must(
      await db.from("delivery_permits").select("permit_id, permit_no, sales_order_id, customer_id, status").eq("permit_id", permitId).maybeSingle(),
      "load delivery permit",
    )
    if (!dp) return await reject(404, "Delivery permit not found")
    if (!RETURNABLE_DP_STATUSES.includes(dp.status)) {
      return await reject(
        409,
        `Returns are only allowed for permits that are out for delivery or delivered (${RETURNABLE_DP_STATUSES.join(", ")}). ${dp.permit_no} is ${dp.status}.`,
      )
    }
    const so = must(
      await db.from("sales_orders").select("so_id, so_number, customer_id").eq("so_id", dp.sales_order_id).maybeSingle(),
      "load sales order",
    )
    if (!so) return await reject(404, "The sales order of this delivery permit was not found")
    const customerId = dp.customer_id ?? so.customer_id ?? null

    if (body?.soId !== undefined && body?.soId !== null && body?.soId !== "" && Number(body.soId) !== so.so_id) {
      return await reject(400, "soId does not match the delivery permit")
    }
    if (body?.customerId !== undefined && body?.customerId !== null && body?.customerId !== "" && Number(body.customerId) !== customerId) {
      return await reject(400, "customerId does not match the delivery permit")
    }
    const customer = customerId
      ? must(await db.from("customers").select("customer_id, customer_name").eq("customer_id", customerId).maybeSingle(), "load customer")
      : null

    const dpItems = must(
      await db
        .from("delivery_permit_items")
        .select("item_id, product_id, item_name_snapshot, sku_snapshot, quantity, unit_price, supplier_id, outsourced_name")
        .eq("permit_id", permitId),
      "load delivery permit items",
    ) as any[]
    const supplierIds = [...new Set(dpItems.map((i) => i.supplier_id).filter(Boolean))]
    const supplierNames = new Map<number, string>()
    if (supplierIds.length > 0) {
      for (const s of must(await db.from("suppliers").select("supplier_id, supplier_name").in("supplier_id", supplierIds), "load suppliers") as any[]) {
        supplierNames.set(s.supplier_id, s.supplier_name)
      }
    }

    // ---- every returned line must be a line of THIS permit ----
    const resolved: { dpItem: any; qty: number; condition: string; reason: string }[] = []
    for (const line of requestedLines) {
      const { raw } = line
      const label = raw?.productName ? `"${raw.productName}"` : "An item"
      let dpItem: any
      if (raw?.permitItemId !== undefined && raw?.permitItemId !== null && raw?.permitItemId !== "") {
        dpItem = dpItems.find((i) => String(i.item_id) === String(raw.permitItemId))
        if (dpItem && raw?.productId && dpItem.product_id && Number(raw.productId) !== dpItem.product_id) dpItem = undefined
      } else if (raw?.productId) {
        dpItem = dpItems.find((i) => i.product_id === Number(raw.productId))
      } else {
        const name = String(raw?.productName || "").trim()
        dpItem = name ? dpItems.find((i) => !i.product_id && String(i.item_name_snapshot || "").trim() === name) : undefined
      }
      if (!dpItem) return await reject(400, `${label} is not an item on delivery permit ${dp.permit_no}`)
      resolved.push({ dpItem, qty: line.qty, condition: line.condition, reason: line.reason })
    }

    // ---- cumulative quantity per line key ----
    const deliveredByKey = new Map<string, number>()
    for (const i of dpItems) {
      const key = lineKey(i.product_id, i.item_name_snapshot)
      deliveredByKey.set(key, (deliveredByKey.get(key) || 0) + (Number(i.quantity) || 0))
    }
    const requestedByKey = new Map<string, { qty: number; name: string }>()
    for (const r of resolved) {
      const key = lineKey(r.dpItem.product_id, r.dpItem.item_name_snapshot)
      const entry = requestedByKey.get(key) || { qty: 0, name: r.dpItem.item_name_snapshot || key }
      entry.qty += r.qty
      requestedByKey.set(key, entry)
    }
    const priorByKey = returnedByKey(await loadReturnLines(db, [permitId]), { permitId })
    for (const [key, { qty, name }] of requestedByKey) {
      const delivered = deliveredByKey.get(key) || 0
      const already = priorByKey.get(key) || 0
      if (already + qty > delivered + QTY_EPSILON) {
        return await reject(
          409,
          `"${name}": ${qty} requested, but only ${Math.max(delivered - already, 0)} of ${delivered} delivered on ${dp.permit_no} can still be returned.`,
        )
      }
    }

    // ---- insert: return row, then items. Any failure removes what was just created. ----
    const inserted = must(
      await db
        .from("product_returns")
        .insert({
          permit_id: String(permitId), // the real delivery permit id (never "RET-<timestamp>")
          so_id: so.so_id,
          so_number: so.so_number,
          customer_id: customerId,
          customer_name: customer?.customer_name ?? null,
          notes: typeof body?.notes === "string" ? body.notes : "",
          initiated_by: body?.createdBy || "shipping",
          courier_name: body?.courierName || "",
          status: "pending_warehouse",
          total_items_returned: resolved.length,
        })
        .select()
        .single(),
      "create return",
    )
    createdReturnId = inserted.return_id

    const itemsResult = await db.from("return_items").insert(
      resolved.map((r) => ({
        return_id: inserted.return_id,
        product_id: r.dpItem.product_id ?? null,
        product_name: r.dpItem.item_name_snapshot || "Unknown Item",
        sku: r.dpItem.sku_snapshot || "",
        original_quantity: Math.round(Number(r.dpItem.quantity) || 0),
        returned_quantity: r.qty,
        return_reason: r.reason,
        item_condition: r.condition,
        restocked: false,
        is_outsourced: !r.dpItem.product_id,
        supplier_name: supplierNames.get(r.dpItem.supplier_id) || r.dpItem.outsourced_name || null,
        unit_cost: Number(r.dpItem.unit_price) || null,
      })),
    )
    if (itemsResult.error) throw new Error(`create return items: ${itemsResult.error.message}`)

    // ---- re-check: of racing requests the lowest return_id wins; this one deletes itself ----
    const after = await loadReturnLines(db, [permitId])
    const upToMe = returnedByKey(after, { permitId, maxReturnId: inserted.return_id })
    for (const [key, { name }] of requestedByKey) {
      if ((upToMe.get(key) || 0) > (deliveredByKey.get(key) || 0) + QTY_EPSILON) {
        const removed = await removeReturnRow(db, inserted.return_id)
        if (!removed) {
          await finishIdempotency(db, idempotencyKey, "partial_failure", `return ${inserted.return_id} lost a race but could not be removed`)
          return failure(500, "This return conflicted with another one and could not be cleaned up. Contact an administrator.", {
            partialFailure: true,
            returnId: inserted.return_id,
          })
        }
        createdReturnId = null
        await syncOrderNetTotal(db, so.so_id) // the order may have counted this row while it briefly existed
        return await reject(409, `"${name}" was returned by another request at the same time; the quantity is no longer available. Nothing was recorded.`, {
          conflict: true,
        })
      }
    }

    await syncOrderNetTotal(db, so.so_id)
    await finishIdempotency(db, idempotencyKey, "completed", undefined, { type: "product_return", id: inserted.return_id })
    return { status: 200, body: { success: true, returnId: inserted.return_id, permitId, soId: so.so_id } }
  } catch (error: any) {
    console.error("[returns] create failed:", errText(error))
    if (createdReturnId !== null) {
      const removed = await removeReturnRow(db, createdReturnId)
      if (!removed) {
        await finishIdempotency(db, idempotencyKey, "partial_failure", `return ${createdReturnId} was created but could not be cleaned up after: ${errText(error)}`)
        return failure(500, "The return could not be completed and its partial record could not be removed. Contact an administrator.", {
          partialFailure: true,
          returnId: createdReturnId,
        })
      }
    }
    await finishIdempotency(db, idempotencyKey, "failed", errText(error))
    return failure(500, "The return could not be recorded. Nothing was saved.")
  }
}

// The order's current (net) total follows its returns. Derived data: a failure here is logged and never undoes or
// fails the return itself; the next return / reject / order edit recomputes it from scratch.
async function syncOrderNetTotal(db: Db, soId: number | null | undefined) {
  if (!soId) return // historical returns carry no order link and are never used to touch an order
  try {
    await syncSalesOrderNetTotal(db, soId)
  } catch (e) {
    console.error(`[returns] could not refresh the net total of sales order ${soId}: ${errText(e)}`)
  }
}

// Removes a still-pending return created by THIS request (items first, then the guarded header delete).
async function removeReturnRow(db: Db, returnId: number): Promise<boolean> {
  const items = await db.from("return_items").delete().eq("return_id", returnId)
  if (items.error) {
    console.error(`[returns] could not delete items of return ${returnId}: ${items.error.message}`)
    return false
  }
  const header = await db.from("product_returns").delete().eq("return_id", returnId).eq("status", "pending_warehouse").select("return_id")
  if (header.error || !header.data || header.data.length !== 1) {
    console.error(`[returns] could not delete return ${returnId}: ${header.error?.message || "not pending any more"}`)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------------------------------------
// Holding inventory helpers
// ---------------------------------------------------------------------------------------------------------
async function addToHolding(
  db: Db,
  p: { productId: number; warehouseId: number; quantity: number; unitCost: number; supplierName: string | null; soNumber: string | null },
  undo: Undo[],
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = must(
      await db.from("inventory").select("*").eq("product_id", p.productId).eq("warehouse_id", p.warehouseId).eq("is_returned", true).maybeSingle(),
      "read holding row",
    )
    if (existing) {
      const rows = must(
        await whereQuantity(
          db
            .from("inventory")
            .update({
              quantity: (Number(existing.quantity) || 0) + p.quantity,
              unit_cost: p.unitCost || existing.unit_cost,
              supplier_name: p.supplierName || existing.supplier_name,
              so_number: p.soNumber || existing.so_number,
              last_updated: new Date().toISOString(),
            })
            .eq("inventory_id", existing.inventory_id),
          existing.quantity,
        ).select("inventory_id"),
        "update holding row",
      ) as any[]
      if (rows.length === 1) {
        undo.push({ what: `subtract ${p.quantity} from holding row ${existing.inventory_id}`, run: () => subtractFromRow(db, existing.inventory_id, p.quantity) })
        return
      }
      continue // another request changed the row between our read and write: re-read
    }
    const insert = await db
      .from("inventory")
      .insert({
        product_id: p.productId,
        warehouse_id: p.warehouseId,
        quantity: p.quantity,
        unit_cost: p.unitCost,
        reorder_point: 10,
        is_outsourced: false,
        supplier_name: p.supplierName,
        is_returned: true,
        so_number: p.soNumber,
      })
      .select("inventory_id")
      .single()
    if (insert.error) {
      if (insert.error.code === "23505") continue // someone created the holding row first: update it instead
      throw new Error(`insert holding row: ${insert.error.message}`)
    }
    undo.push({ what: `delete new holding row ${insert.data.inventory_id}`, run: () => deleteInventoryRow(db, insert.data.inventory_id) })
    return
  }
  throw new Error("The holding stock kept changing; please try again")
}

async function subtractFromRow(db: Db, inventoryId: number, quantity: number) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = must(await db.from("inventory").select("inventory_id, quantity").eq("inventory_id", inventoryId).maybeSingle(), "read row for undo")
    if (!row) throw new Error(`inventory row ${inventoryId} no longer exists`)
    const rows = must(
      await whereQuantity(
        db.from("inventory").update({ quantity: Math.max((Number(row.quantity) || 0) - quantity, 0) }).eq("inventory_id", inventoryId),
        row.quantity,
      ).select("inventory_id"),
      "undo quantity",
    ) as any[]
    if (rows.length === 1) return
  }
  throw new Error(`could not subtract ${quantity} from inventory row ${inventoryId}`)
}

async function deleteInventoryRow(db: Db, inventoryId: number) {
  const res = await db.from("inventory").delete().eq("inventory_id", inventoryId)
  if (res.error) throw new Error(res.error.message)
}

// ---------------------------------------------------------------------------------------------------------
// Process (warehouse receives a return) - exactly once
// ---------------------------------------------------------------------------------------------------------
export async function processReturn(db: Db, input: any): Promise<WorkflowResult> {
  const returnId = parsePositiveInt(input?.returnId)
  if (returnId === null) return failure(400, "A valid returnId is required")
  // Only the warehouse "process" transition exists on this endpoint (the UI sends `completed`).
  if (input?.status !== "completed" && input?.status !== "received") {
    return failure(400, "Unsupported status change. A pending return can only be processed (completed/received).")
  }
  const processedBy = input?.processedBy || "warehouse_manager"
  const assignments: any[] = Array.isArray(input?.warehouseAssignments) ? input.warehouseAssignments : []

  try {
    const ret = must(await db.from("product_returns").select("*").eq("return_id", returnId).maybeSingle(), "load return")
    if (!ret) return failure(404, "Return not found")
    if (ret.status !== "pending_warehouse") {
      return failure(409, `This return has already been processed (status: ${ret.status}). No stock was changed.`, { currentStatus: ret.status })
    }
    const items = must(await db.from("return_items").select("*").eq("return_id", returnId), "load return items") as any[]
    if (items.length === 0) return failure(400, "This return has no items")

    // The server decides quantity, product and condition from the stored return; the client only chooses warehouses.
    const plan: { item: any; warehouseId: number | null }[] = []
    for (const item of items) {
      if (item.item_condition !== "good") {
        plan.push({ item, warehouseId: null })
        continue
      }
      const assignment = assignments.find((a) => String(a?.returnItemId) === String(item.return_item_id))
      const warehouseId = parsePositiveInt(assignment?.warehouseId)
      if (warehouseId === null) return failure(400, `Select a warehouse for "${item.product_name}" before processing.`)
      plan.push({ item, warehouseId })
    }
    const warehouseIds = [...new Set(plan.map((p) => p.warehouseId).filter((id): id is number => id !== null))]
    if (warehouseIds.length > 0) {
      const found = must(await db.from("warehouses").select("warehouse_id").in("warehouse_id", warehouseIds), "load warehouses") as any[]
      const missing = warehouseIds.filter((id) => !found.some((w) => w.warehouse_id === id))
      if (missing.length > 0) return failure(400, `Warehouse not found: ${missing.join(", ")}`)
    }

    // ---- claim: only one request can move pending_warehouse -> assigned_warehouse ----
    const claimed = must(
      await db
        .from("product_returns")
        .update({ status: "assigned_warehouse", assigned_by: processedBy, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("return_id", returnId)
        .eq("status", "pending_warehouse")
        .select("return_id"),
      "claim return",
    ) as any[]
    if (claimed.length !== 1) {
      return failure(409, "This return is already being processed or was processed by another request. No stock was changed.")
    }

    // ---- inventory + item writes (all checked, all undoable) ----
    const undo: Undo[] = []
    const soNumber = ret.so_number || (ret.so_id ? `SO-${ret.so_id}` : null)
    let heldItems = 0
    let notRestockable = 0
    try {
      for (const { item, warehouseId } of plan) {
        if (warehouseId === null) {
          notRestockable += 1 // damaged / defective / unsellable: stays tracked on the return, never enters stock
          continue
        }
        const quantity = Number(item.returned_quantity) || 0
        if (quantity <= 0) throw new Error(`"${item.product_name}" has an invalid returned quantity`)
        const unitCost = Number(item.unit_cost) || 0

        if (!item.product_id) {
          // Outsourced line: always its own holding row
          const inserted = must(
            await db
              .from("inventory")
              .insert({
                product_id: null,
                warehouse_id: warehouseId,
                quantity,
                unit_cost: unitCost,
                reorder_point: 0,
                is_outsourced: true,
                outsourced_name: item.product_name || "Outsourced Item",
                outsourced_description: `Returned from ${soNumber || "order"} — ${item.return_reason || "customer return"}`,
                supplier_name: item.supplier_name || null,
                is_returned: true,
                so_number: soNumber,
              })
              .select("inventory_id")
              .single(),
            "insert outsourced holding row",
          )
          undo.push({ what: `delete outsourced holding row ${inserted.inventory_id}`, run: () => deleteInventoryRow(db, inserted.inventory_id) })
        } else {
          let cost = unitCost
          if (!cost) {
            const lastBatch = must(
              await db.from("inventory_batches").select("unit_cost").eq("product_id", item.product_id).order("received_date", { ascending: false }).limit(1).maybeSingle(),
              "read last batch cost",
            )
            cost = lastBatch?.unit_cost ? Number(lastBatch.unit_cost) : 0
          }
          await addToHolding(
            db,
            { productId: item.product_id, warehouseId, quantity, unitCost: cost, supplierName: item.supplier_name || null, soNumber },
            undo,
          )

          // A batch row for the returned stock, tagged with the return so it can be settled later.
          const lastSeq = must(
            await db.from("inventory_batches").select("batch_sequence").eq("product_id", item.product_id).order("batch_sequence", { ascending: false }).limit(1).maybeSingle(),
            "read batch sequence",
          )
          const batch = must(
            await db
              .from("inventory_batches")
              .insert({
                product_id: item.product_id,
                po_number: `${RETURN_BATCH_PREFIX}${returnId}`,
                quantity_received: quantity,
                quantity_available: quantity,
                unit_cost: cost,
                landed_cost_per_unit: cost,
                received_date: new Date().toISOString().split("T")[0],
                warehouse_id: warehouseId,
                batch_sequence: (lastSeq?.batch_sequence || 0) + 1,
                is_returned: true,
                supplier_name: item.supplier_name || null,
              })
              .select("batch_id")
              .single(),
            "insert returned batch",
          )
          undo.push({ what: `delete returned batch ${batch.batch_id}`, run: async () => {
            const res = await db.from("inventory_batches").delete().eq("batch_id", batch.batch_id)
            if (res.error) throw new Error(res.error.message)
          } })
        }

        const marked = must(
          await db
            .from("return_items")
            .update({ restocked: true, restocked_at: new Date().toISOString(), restocked_warehouse_id: warehouseId })
            .eq("return_item_id", item.return_item_id)
            .select("return_item_id"),
          "mark return item",
        ) as any[]
        if (marked.length !== 1) throw new Error(`could not mark return item ${item.return_item_id}`)
        undo.push({ what: `unmark return item ${item.return_item_id}`, run: async () => {
          const res = await db.from("return_items").update({ restocked: false, restocked_at: null, restocked_warehouse_id: null }).eq("return_item_id", item.return_item_id)
          if (res.error) throw new Error(res.error.message)
        } })
        heldItems += 1
      }

      const finalRows = must(
        await db
          .from("product_returns")
          .update({ status: "received", received_by: processedBy, received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("return_id", returnId)
          .eq("status", "assigned_warehouse")
          .select(),
        "finish return",
      ) as any[]
      if (finalRows.length !== 1) throw new Error("the return changed while it was being processed")

      return { status: 200, body: { success: true, data: finalRows[0], heldItems, notRestockable } }
    } catch (error: any) {
      console.error(`[returns] processing return ${returnId} failed:`, errText(error))
      const undoFailures = await runUndo(undo)
      if (undoFailures.length > 0) {
        // Leave the return in `assigned_warehouse` (visible, not retryable) - stock may be partly changed.
        return failure(500, `Processing failed and could not be fully undone (${undoFailures.join("; ")}). Contact an administrator.`, {
          partialFailure: true,
          returnId,
        })
      }
      const reverted = await db
        .from("product_returns")
        .update({ status: "pending_warehouse", assigned_by: null, assigned_at: null, updated_at: new Date().toISOString() })
        .eq("return_id", returnId)
        .eq("status", "assigned_warehouse")
        .select("return_id")
      if (reverted.error || !reverted.data || reverted.data.length !== 1) {
        return failure(500, "Processing failed; stock was restored but the return could not be reset. Contact an administrator.", { partialFailure: true, returnId })
      }
      return failure(500, `The return could not be processed: ${errText(error)}. No stock was changed.`)
    }
  } catch (error: any) {
    console.error(`[returns] process return ${returnId} error:`, errText(error))
    return failure(500, "The return could not be processed. No stock was changed.")
  }
}

// ---------------------------------------------------------------------------------------------------------
// Reject (pending_warehouse -> rejected). No inventory is touched; the returned quantity becomes available again
// because rejected returns never count (return-lines.ts).
// ---------------------------------------------------------------------------------------------------------
export async function rejectReturn(db: Db, input: any): Promise<WorkflowResult> {
  const returnId = parsePositiveInt(input?.returnId)
  if (returnId === null) return failure(400, "A valid returnId is required")
  const reason = typeof input?.reason === "string" ? input.reason.trim() : ""
  if (reason.length < 3) return failure(400, "A reason is required to reject a return")
  const rejectedBy = input?.rejectedBy || input?.processedBy || "warehouse_manager"
  try {
    const ret = must(await db.from("product_returns").select("return_id, status, so_id").eq("return_id", returnId).maybeSingle(), "load return")
    if (!ret) return failure(404, "Return not found")
    if (ret.status !== "pending_warehouse") {
      return failure(409, `Only a pending return can be rejected (status: ${ret.status}). Nothing was changed.`, { currentStatus: ret.status })
    }
    const rows = must(
      await db
        .from("product_returns")
        .update({ status: "rejected", warehouse_notes: `Rejected by ${rejectedBy}: ${reason}`, updated_at: new Date().toISOString() })
        .eq("return_id", returnId)
        .eq("status", "pending_warehouse")
        .select(),
      "reject return",
    ) as any[]
    if (rows.length !== 1) {
      return failure(409, "This return was processed or rejected by another request. Nothing was changed.")
    }
    await syncOrderNetTotal(db, ret.so_id) // the rejected quantity counts again
    return { status: 200, body: { success: true, data: rows[0] } }
  } catch (error: any) {
    console.error(`[returns] reject return ${returnId} error:`, errText(error))
    return failure(500, "The return could not be rejected. Nothing was changed.")
  }
}

// ---------------------------------------------------------------------------------------------------------
// Holding row -> restock / write-off (exactly one final disposition)
// ---------------------------------------------------------------------------------------------------------
type HoldingClaim = { ok: true; row: any } | { ok: false; result: WorkflowResult }

async function claimHoldingRow(db: Db, inventoryId: number): Promise<HoldingClaim> {
  const row = must(await db.from("inventory").select("*").eq("inventory_id", inventoryId).maybeSingle(), "load returned item")
  if (!row) return { ok: false, result: failure(404, "Returned item not found (it may already have been restocked or removed)") }
  if (!row.is_returned) return { ok: false, result: failure(400, "This item is not a pending return") }
  const deleted = must(
    await whereQuantity(db.from("inventory").delete().eq("inventory_id", inventoryId).eq("is_returned", true), row.quantity).select("*"),
    "claim returned item",
  ) as any[]
  if (deleted.length !== 1) {
    return { ok: false, result: failure(409, "This returned item was already processed or changed by another request. Refresh and try again.") }
  }
  return { ok: true, row: deleted[0] }
}

// Put a claimed holding row back after a failure (same id when possible).
async function restoreHoldingRow(db: Db, row: any): Promise<boolean> {
  const first = await db.from("inventory").insert(row)
  if (!first.error) return true
  const { inventory_id: _drop, ...withoutId } = row
  const second = await db.from("inventory").insert(withoutId)
  if (second.error) {
    console.error(`[returns] COULD NOT RESTORE holding row ${row.inventory_id}: ${second.error.message}. Row data: ${JSON.stringify(row)}`)
    return false
  }
  return true
}

// Returned batches carry the RET-<id> marker; historical returned batches (no marker) are never touched.
async function settleReturnedBatches(db: Db, productId: number, warehouseId: number | null, mode: "restock" | "remove") {
  let query = db.from("inventory_batches").select("batch_id").eq("product_id", productId).eq("is_returned", true).like("po_number", `${RETURN_BATCH_PREFIX}%`)
  if (warehouseId !== null) query = query.eq("warehouse_id", warehouseId)
  const batches = must(await query, "read returned batches") as any[]
  if (batches.length === 0) return
  const patch = mode === "restock" ? { is_returned: false } : { quantity_available: 0 }
  const res = await db.from("inventory_batches").update(patch).in("batch_id", batches.map((b) => b.batch_id))
  if (res.error) throw new Error(`settle returned batches: ${res.error.message}`)
}

export async function restockReturnedItem(db: Db, input: any): Promise<WorkflowResult> {
  const inventoryId = parsePositiveInt(input?.inventoryId)
  if (inventoryId === null) return failure(400, "inventoryId is required")
  try {
    const claim = await claimHoldingRowOrFlag(db, inventoryId)
    if (!claim.ok) return claim.result
    if (claim.outsourcedDone) return { status: 200, body: { message: "Item restocked to warehouse" } }
    const row = claim.row

    // Add the claimed quantity to the sellable row (guarded by the quantity we read; unique key is the backstop).
    let added = false
    let lastError: any = null
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !added; attempt++) {
        const main = must(
          await db.from("inventory").select("*").eq("product_id", row.product_id).eq("warehouse_id", row.warehouse_id).eq("is_returned", false).maybeSingle(),
          "read sellable stock row",
        )
        if (main) {
          const rows = must(
            await whereQuantity(
              db
                .from("inventory")
                .update({ quantity: (Number(main.quantity) || 0) + (Number(row.quantity) || 0), last_updated: new Date().toISOString() })
                .eq("inventory_id", main.inventory_id),
              main.quantity,
            ).select("inventory_id"),
            "update sellable stock",
          ) as any[]
          added = rows.length === 1
        } else {
          const insert = await db.from("inventory").insert({
            product_id: row.product_id,
            warehouse_id: row.warehouse_id,
            quantity: row.quantity || 0,
            unit_cost: row.unit_cost || 0,
            reorder_point: 10,
            is_outsourced: false,
            is_returned: false,
            location: row.location || null,
            last_updated: new Date().toISOString(),
          })
          if (insert.error && insert.error.code !== "23505") throw new Error(`create sellable stock row: ${insert.error.message}`)
          added = !insert.error
        }
      }
      if (!added) throw new Error("The sellable stock kept changing; please try again")
    } catch (e) {
      lastError = e
    }
    if (!added) {
      const restored = await restoreHoldingRow(db, row)
      if (!restored) {
        return failure(500, "Restock failed and the returned item could not be put back. Contact an administrator.", { partialFailure: true, inventoryId })
      }
      return failure(500, `Failed to restock item: ${errText(lastError)}. Nothing was changed.`)
    }

    try {
      await settleReturnedBatches(db, row.product_id, row.warehouse_id, "restock")
    } catch (e) {
      console.error(`[returns] restock ${inventoryId}: stock moved but batches not settled: ${errText(e)}`)
      return failure(500, "The item was restocked but its returned-batch record could not be updated. Do not repeat the restock; contact an administrator.", {
        partialFailure: true,
        stockMoved: true,
      })
    }
    return { status: 200, body: { message: "Item restocked to warehouse" } }
  } catch (error: any) {
    console.error("[returns] restock error:", errText(error))
    return failure(500, "Failed to restock item. Nothing was changed.")
  }
}

// Outsourced rows have no sellable row to merge into: restocking just clears the flag (guarded flip).
async function claimHoldingRowOrFlag(
  db: Db,
  inventoryId: number,
): Promise<{ ok: false; result: WorkflowResult } | { ok: true; row: any; outsourcedDone?: false } | { ok: true; row: null; outsourcedDone: true }> {
  const row = must(await db.from("inventory").select("*").eq("inventory_id", inventoryId).maybeSingle(), "load returned item")
  if (!row) return { ok: false, result: failure(404, "Returned item not found (it may already have been restocked or removed)") }
  if (!row.is_returned) return { ok: false, result: failure(400, "This item is not a pending return") }
  if (!row.product_id) {
    const flipped = must(
      await db.from("inventory").update({ is_returned: false, last_updated: new Date().toISOString() }).eq("inventory_id", inventoryId).eq("is_returned", true).select("inventory_id"),
      "restock outsourced return",
    ) as any[]
    if (flipped.length !== 1) return { ok: false, result: failure(409, "This returned item was already processed. Refresh and try again.") }
    return { ok: true, row: null, outsourcedDone: true }
  }
  const claim = await claimHoldingRow(db, inventoryId)
  return claim.ok ? { ok: true, row: claim.row } : claim
}

export async function removeReturnedItem(db: Db, input: any): Promise<WorkflowResult> {
  const inventoryId = parsePositiveInt(input?.inventoryId)
  if (inventoryId === null) return failure(400, "inventoryId is required")
  try {
    const claim = await claimHoldingRow(db, inventoryId)
    if (!claim.ok) return claim.result
    const row = claim.row
    // The quantity written off is the quantity actually held, never the one the browser sent.
    const quantity = Number(row.quantity) || 0
    const productName: string = input?.productName || ""
    const soNumber: string | null = input?.soNumber || null

    let supplierId: number | null = null
    let creditId: number | null = null
    try {
      supplierId = await resolveSupplierId(db, input, row, productName, soNumber)
      if (supplierId) {
        const trueUnitCost = await resolveCreditUnitCost(db, supplierId, productName, row, input)
        const credit = must(
          await db
            .from("supplier_credits")
            .insert({
              supplier_id: supplierId,
              amount: quantity * trueUnitCost,
              credit_type: "return",
              reference_type: "inventory",
              reference_id: inventoryId,
              description: `Return of ${productName || "item"} (Qty: ${quantity} @ ${trueUnitCost})${soNumber ? ` from ${soNumber}` : ""}`,
              status: "active",
              created_at: new Date().toISOString(),
            })
            .select("credit_id")
            .single(),
          "create supplier credit",
        )
        creditId = credit.credit_id
      }
      if (row.product_id) await settleReturnedBatches(db, row.product_id, row.warehouse_id, "remove")
    } catch (e) {
      // Undo: put the item back and drop a credit created by this request, so the write-off can be retried cleanly.
      let clean = true
      if (creditId !== null) {
        const res = await db.from("supplier_credits").delete().eq("credit_id", creditId)
        if (res.error) clean = false
      }
      if (!(await restoreHoldingRow(db, row))) clean = false
      console.error(`[returns] remove ${inventoryId} failed: ${errText(e)}`)
      if (!clean) {
        return failure(500, "Write-off failed and could not be fully undone. Contact an administrator.", { partialFailure: true, inventoryId })
      }
      return failure(500, `Failed to remove the returned item: ${errText(e)}. Nothing was changed.`)
    }
    return { status: 200, body: { message: "Returned item removed successfully", supplierId } }
  } catch (error: any) {
    console.error("[returns] remove error:", errText(error))
    return failure(500, "Failed to remove the returned item. Nothing was changed.")
  }
}

async function resolveSupplierId(db: Db, input: any, row: any, productName: string, soNumber: string | null): Promise<number | null> {
  if (input?.supplierNameId) return Number(input.supplierNameId) || null
  if (input?.supplierName) {
    const supplier = soft(
      await db.from("suppliers").select("supplier_id").ilike("supplier_name", `%${input.supplierName}%`).limit(1).maybeSingle(),
      "supplier by name",
    )
    if (supplier) return supplier.supplier_id
  }
  if (soNumber) {
    const poRows = soft(
      await db.from("purchase_orders").select("supplier_id, purchase_order_items!inner(outsourced_name)").eq("purchase_order_items.outsourced_name", productName || "").limit(1),
      "supplier by purchase order",
    ) as any[] | null
    if (poRows && poRows.length > 0 && poRows[0].supplier_id) return poRows[0].supplier_id
    const poRows2 = soft(
      await db.from("purchase_order_items").select("po_id, purchase_orders!inner(supplier_id)").ilike("outsourced_name", `%${(productName || "").trim()}%`).limit(1),
      "supplier by item",
    ) as any[] | null
    if (poRows2 && poRows2.length > 0) return (poRows2[0].purchase_orders as any)?.supplier_id || null
  }
  return null
}

// Cost actually paid to the supplier (never the selling price): PO item first, then the latest batch cost.
async function resolveCreditUnitCost(db: Db, supplierId: number, productName: string, row: any, input: any): Promise<number> {
  if (productName) {
    const poItem = soft(
      await db
        .from("purchase_order_items")
        .select("unit_price, created_at, purchase_orders!inner(supplier_id)")
        .eq("purchase_orders.supplier_id", supplierId)
        .ilike("outsourced_name", `%${productName.trim()}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "purchase order cost",
    )
    if (poItem?.unit_price != null) return Number(poItem.unit_price)
  }
  if (row.product_id) {
    const lastBatch = soft(
      await db.from("inventory_batches").select("unit_cost").eq("product_id", row.product_id).order("received_date", { ascending: false }).limit(1).maybeSingle(),
      "batch cost",
    )
    if (lastBatch?.unit_cost != null) return Number(lastBatch.unit_cost)
  }
  return Number(input?.unitCost) || 0
}
