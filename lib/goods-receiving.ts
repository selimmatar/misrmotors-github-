// Goods receiving (Batch 4A): POST /api/goods-receipts.
//
// The server is the authority. A receipt is accepted only when:
//   * the PO exists and is receivable (approved | partially_received),
//   * every line names a PO item that belongs to that PO and a positive whole quantity,
//   * for every PO item:  already received (all earlier GRN lines, read from the database) + this request
//     <= ordered quantity. There is no tolerance and the PO is never grown to fit the goods.
// Many GRNs per PO are normal. The PO becomes `received` only when EVERY PO item is fully received (cumulative
// quantities, never the status of the latest GRN); otherwise it is `partially_received` and stays receivable.
//
// Concurrency model. There is NO database transaction, RPC, lock table or new constraint here (Batch 4A forbids
// schema changes). Safety comes from three layers that only use existing tables:
//   1. A per-PO mutex: a plain INSERT into idempotency_log (operation_type 'po_receive', key
//      'po_receive_lock_<poId>') guarded by the table's UNIQUE(operation_type, idempotency_key). Only one receiving
//      request per PO can hold it; the others wait (up to LOCK_WAIT_MS) and then re-read the database, so the
//      remaining quantity is always computed from committed state. A lock older than LOCK_STALE_MS (crashed
//      request) is taken over with a guarded DELETE of that exact row.
//   2. Replay protection: the client sends an idempotency key; the claim is a plain INSERT as well
//      (operation_type 'po_receive', key 'po_receive_<poId>_<clientKey>'). The same key never creates a second GRN.
//   3. A post-write re-check of the cumulative quantity (defence in depth, e.g. after a stale-lock takeover).
// Inventory increments are compare-and-swap UPDATEs (WHERE quantity = <value read>), so even two different POs
// receiving the same product at the same moment cannot lose or double an increment.
//
// Every write is checked. If a step fails, the steps already done by THIS request are undone (best effort) and the
// request fails (never HTTP 200). If an undo itself fails the response carries partialFailure: true and the
// idempotency row is parked as `partial_failure` so the key cannot be replayed into a second stock increase.

type Db = any // supabase-js client (or a test double)

export const RECEIVABLE_PO_STATUSES = ["approved", "partially_received"]
export const DISCREPANCY_TYPES = ["missing", "damaged", "wrong_item", "quantity_mismatch", "other"]
export const RECEIVE_OPERATION = "po_receive"
export const LOCK_WAIT_MS = 10_000
export const LOCK_STALE_MS = 60_000
const MAX_LINES = 500
const MAX_QTY = 1_000_000
const MAX_CAS_ATTEMPTS = 6
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/

export interface WorkflowResult {
  status: number
  body: any
}
const failure = (status: number, error: string, extra: Record<string, any> = {}): WorkflowResult => ({
  status,
  body: { error, message: error, ...extra },
})
const errText = (e: any) => e?.message || String(e)
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const today = () => new Date().toISOString().split("T")[0]

class Rejection extends Error {
  constructor(public result: WorkflowResult) {
    super(result.body?.error || "rejected")
  }
}
const reject = (status: number, error: string, extra: Record<string, any> = {}): never => {
  throw new Rejection(failure(status, error, extra))
}

type Undo = { what: string; run: () => Promise<void> }
async function runUndo(undo: Undo[]): Promise<string[]> {
  const failed: string[] = []
  for (const step of [...undo].reverse()) {
    try {
      await step.run()
    } catch (e) {
      console.error(`[receiving] UNDO FAILED (${step.what}): ${errText(e)}`)
      failed.push(step.what)
    }
  }
  return failed
}

// ---------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------
export function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 && raw < 1_000_000_000 ? raw : null
  if (typeof raw === "string" && /^\d{1,9}$/.test(raw.trim())) {
    const n = Number(raw.trim())
    return n > 0 ? n : null
  }
  return null
}
/** A whole, positive, finite quantity (the quantity columns are integers). Never clamps; null = invalid. */
export function parseQuantity(raw: unknown): number | null {
  let n: number
  if (typeof raw === "number") n = raw
  else if (typeof raw === "string" && /^\d{1,7}(\.0+)?$/.test(raw.trim())) n = Number(raw.trim())
  else return null
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > MAX_QTY) return null
  return n
}
function parseCost(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

interface ParsedLine {
  index: number
  poItemId: number
  quantity: number
  warehouseId: number | null
  discrepancyType: string | null
  discrepancyNotes: string | null
  unitCost: number | undefined
  productName: string | null
}
interface Parsed {
  poId: number
  lines: ParsedLine[]
  receivedBy: number | null
  notes: string | null
  idempotencyKey: string | null
}

function parseRequest(body: any): Parsed {
  if (!body || typeof body !== "object") return reject(400, "Invalid request body")
  const poId = parsePositiveInt(body.poId)
  if (!poId) return reject(400, "A valid purchase order id (poId) is required")
  if (!Array.isArray(body.lines) || body.lines.length === 0) return reject(400, "At least one receipt line is required")
  if (body.lines.length > MAX_LINES) return reject(400, `Too many receipt lines (maximum ${MAX_LINES})`)
  // Required: without it a double submit would create a second GRN and a second stock increment.
  if (body.idempotencyKey === undefined || body.idempotencyKey === null || body.idempotencyKey === "") {
    return reject(400, "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)")
  }
  if (typeof body.idempotencyKey !== "string" || !KEY_PATTERN.test(body.idempotencyKey)) {
    return reject(400, "idempotencyKey must be 8-100 characters (letters, digits, _ . : -)")
  }
  const idempotencyKey: string = body.idempotencyKey
  const lines: ParsedLine[] = body.lines.map((raw: any, index: number): ParsedLine => {
    const n = index + 1
    if (!raw || typeof raw !== "object") return reject(400, `Line ${n}: invalid line`)
    const poItemId = parsePositiveInt(raw.poItemId)
    if (!poItemId) return reject(400, `Line ${n}: a valid purchase order item (poItemId) is required`)
    const quantity = parseQuantity(raw.quantityReceived)
    if (quantity === null) return reject(400, `Line ${n}: received quantity must be a whole number greater than zero`)
    let warehouseId: number | null = null
    if (raw.warehouseId !== undefined && raw.warehouseId !== null && raw.warehouseId !== "") {
      warehouseId = parsePositiveInt(raw.warehouseId)
      if (!warehouseId) return reject(400, `Line ${n}: invalid warehouse`)
    }
    const discrepancyType = raw.discrepancyType ? String(raw.discrepancyType) : null
    if (discrepancyType && !DISCREPANCY_TYPES.includes(discrepancyType)) return reject(400, `Line ${n}: invalid discrepancy type`)
    const unitCost = parseCost(raw.unitCost)
    if (unitCost === null) return reject(400, `Line ${n}: invalid unit cost`)
    return {
      index,
      poItemId,
      quantity,
      warehouseId,
      discrepancyType,
      discrepancyNotes: raw.discrepancyNotes ? String(raw.discrepancyNotes).slice(0, 2000) : null,
      unitCost,
      productName: raw.productName ? String(raw.productName).slice(0, 200) : null,
    }
  })
  return {
    poId,
    lines,
    receivedBy: parsePositiveInt(body.receivedBy),
    notes: body.notes ? String(body.notes).slice(0, 4000) : null,
    idempotencyKey,
  }
}

// ---------------------------------------------------------------------------------------------------------
// Idempotency (replay protection) and the per-PO mutex: both are plain INSERTs into idempotency_log
// ---------------------------------------------------------------------------------------------------------
type Claim = { state: "claimed" } | { state: "duplicate"; receiptId: number } | { state: "blocked"; result: WorkflowResult }

async function claimReplayKey(db: Db, key: string, poId: number): Promise<Claim> {
  const claim = await db.from("idempotency_log").insert({
    operation_type: RECEIVE_OPERATION,
    idempotency_key: key,
    entity_type: "purchase_orders",
    entity_id: poId,
    status: "processing",
  })
  if (!claim.error) return { state: "claimed" }
  if (claim.error.code !== "23505") {
    console.error("[receiving] idempotency claim failed:", claim.error.message)
    return { state: "blocked", result: failure(500, "Could not start the receipt. Nothing was recorded.") }
  }
  const { data: previous } = await db
    .from("idempotency_log")
    .select("status, entity_type, entity_id")
    .eq("operation_type", RECEIVE_OPERATION)
    .eq("idempotency_key", key)
    .maybeSingle()
  if (previous?.status === "completed" && previous.entity_type === "goods_receipts") {
    return { state: "duplicate", receiptId: previous.entity_id }
  }
  if (previous?.status === "partial_failure") {
    return {
      state: "blocked",
      result: failure(409, "This receipt was only partly recorded and will not be repeated. Contact an administrator to review.", { partialFailure: true }),
    }
  }
  if (previous?.status === "failed") {
    // Rejected / undone before anything was kept: the same key may be retried. Re-claim atomically.
    const { data: reclaimed } = await db
      .from("idempotency_log")
      .update({ status: "processing", error_message: null, completed_at: null })
      .eq("operation_type", RECEIVE_OPERATION)
      .eq("idempotency_key", key)
      .eq("status", "failed")
      .select("id")
    if (reclaimed && reclaimed.length === 1) return { state: "claimed" }
  }
  return { state: "blocked", result: failure(409, "This receipt is already being processed") }
}

async function finishReplayKey(
  db: Db,
  key: string,
  status: "completed" | "failed" | "partial_failure",
  message?: string,
  receiptId?: number,
) {
  const { error } = await db
    .from("idempotency_log")
    .update({
      status,
      error_message: message ?? null,
      completed_at: new Date().toISOString(),
      ...(receiptId ? { entity_type: "goods_receipts", entity_id: receiptId } : {}),
    })
    .eq("operation_type", RECEIVE_OPERATION)
    .eq("idempotency_key", key)
  if (error) console.error("[receiving] could not update idempotency row:", error.message)
}

export async function acquirePoLock(db: Db, poId: number): Promise<number | null> {
  const lockKey = `po_receive_lock_${poId}`
  const deadline = Date.now() + LOCK_WAIT_MS
  let delay = 20
  for (;;) {
    const attempt = await db
      .from("idempotency_log")
      .insert({ operation_type: RECEIVE_OPERATION, idempotency_key: lockKey, entity_type: "purchase_orders", entity_id: poId, status: "processing" })
      .select("id")
      .single()
    if (!attempt.error && attempt.data) return attempt.data.id
    if (attempt.error && attempt.error.code !== "23505") throw new Error(`lock: ${attempt.error.message}`)
    // somebody holds it: take it over only if it is stale (guarded delete of that exact row)
    const { data: held } = await db
      .from("idempotency_log")
      .select("id, created_at")
      .eq("operation_type", RECEIVE_OPERATION)
      .eq("idempotency_key", lockKey)
      .maybeSingle()
    if (held && Date.now() - new Date(held.created_at).getTime() > LOCK_STALE_MS) {
      await db.from("idempotency_log").delete().eq("id", held.id).select("id")
      continue
    }
    if (Date.now() > deadline) return null
    await sleep(delay)
    delay = Math.min(delay * 1.5, 250)
  }
}
export async function releasePoLock(db: Db, lockId: number) {
  const { error } = await db.from("idempotency_log").delete().eq("id", lockId)
  if (error) console.error("[receiving] could not release PO lock (it expires on its own):", error.message)
}

// ---------------------------------------------------------------------------------------------------------
// Inventory (compare-and-swap on quantity)
// ---------------------------------------------------------------------------------------------------------
const whereQuantity = (query: any, old: unknown) => (old === null || old === undefined ? query.is("quantity", null) : query.eq("quantity", old))
const warehouseFilter = (query: any, warehouseId: number | null) =>
  warehouseId === null ? query.is("warehouse_id", null) : query.eq("warehouse_id", warehouseId)

/**
 * Weighted-average unit cost after adding `recvQty` @ `recvCost` to `oldQty` @ `oldCost` (2 decimals).
 * No stock on hand (or an unknown old cost) means the receipt cost is the cost.
 */
export function weightedAverageCost(oldQty: unknown, oldCost: unknown, recvQty: number, recvCost: number): number {
  const q = Number(oldQty)
  const c = oldCost === null || oldCost === undefined ? NaN : Number(oldCost)
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || recvQty <= 0) return Math.round(recvCost * 100) / 100
  return Math.round(((q * c + recvQty * recvCost) / (q + recvQty)) * 100) / 100
}

async function addStock(
  db: Db,
  productId: number,
  warehouseId: number | null,
  quantity: number,
  unitCost: number,
  undo: Undo[],
) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    // Newly received stock only ever merges into the normal on-hand row, never the returned-holding row.
    const row = must(
      await warehouseFilter(db.from("inventory").select("inventory_id, quantity, unit_cost").eq("product_id", productId).eq("is_returned", false), warehouseId).maybeSingle(),
      "read inventory",
    )
    if (row) {
      const before = row.quantity
      // weighted average, computed from the same quantity the guarded update below compares against
      const newCost = weightedAverageCost(before, row.unit_cost, quantity, unitCost)
      const updated = must(
        await whereQuantity(
          db
            .from("inventory")
            .update({ quantity: (Number(before) || 0) + quantity, unit_cost: newCost, last_updated: new Date().toISOString() })
            .eq("inventory_id", row.inventory_id),
          before,
        ).select("inventory_id"),
        "update inventory",
      )
      if (updated && updated.length === 1) {
        undo.push({ what: `inventory ${row.inventory_id} +${quantity}`, run: () => takeStock(db, row.inventory_id, quantity, false, { from: newCost, to: row.unit_cost }) })
        return
      }
      continue // lost a race on the same row: re-read and try again
    }
    const inserted = await db
      .from("inventory")
      .insert({ product_id: productId, quantity, unit_cost: unitCost, warehouse_id: warehouseId, reorder_point: 0, is_returned: false, last_updated: new Date().toISOString() })
      .select("inventory_id")
      .single()
    if (!inserted.error && inserted.data) {
      const id = inserted.data.inventory_id
      undo.push({ what: `inventory ${id} created`, run: () => takeStock(db, id, quantity, true) })
      return
    }
    if (inserted.error && inserted.error.code !== "23505") throw new Error(`create inventory: ${inserted.error.message}`)
  }
  throw new Error("inventory is being changed by other requests; try again")
}

/** Undo of addStock: subtract what this request added (deleting the row if this request created it and it is empty). */
async function takeStock(db: Db, inventoryId: number, quantity: number, created = false, cost?: { from: number; to: unknown }) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const row = must(await db.from("inventory").select("inventory_id, quantity, unit_cost").eq("inventory_id", inventoryId).maybeSingle(), "undo: read inventory")
    if (!row) return // already gone
    const left = (Number(row.quantity) || 0) - quantity
    if (created && left <= 0) {
      const gone = must(await whereQuantity(db.from("inventory").delete().eq("inventory_id", inventoryId), row.quantity).select("inventory_id"), "undo: delete inventory")
      if (gone && gone.length === 1) return
      continue
    }
    // put the previous average cost back only if nobody changed it since this request set it
    const patch: Record<string, unknown> = { quantity: Math.max(0, left), last_updated: new Date().toISOString() }
    if (cost && Number(row.unit_cost) === cost.from && cost.to !== undefined) patch.unit_cost = cost.to
    const done = must(
      await whereQuantity(db.from("inventory").update(patch).eq("inventory_id", inventoryId), row.quantity).select("inventory_id"),
      "undo: update inventory",
    )
    if (done && done.length === 1) return
  }
  throw new Error(`could not take ${quantity} back out of inventory ${inventoryId}`)
}

// ---------------------------------------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------------------------------------
interface PoItem {
  po_item_id: number
  quantity: number
  unit_price: number | string | null
  product_id: number | null
  item_type: string | null
  outsourced_name: string | null
  item_name_snapshot: string | null
  source_so_item_id: number | null
}

const sumByItem = (rows: any[]) => {
  const totals = new Map<number, number>()
  for (const r of rows || []) totals.set(r.po_item_id, (totals.get(r.po_item_id) || 0) + (Number(r.quantity_received) || 0))
  return totals
}

export async function receiveGoods(db: Db, body: any): Promise<WorkflowResult> {
  let parsed: Parsed
  try {
    parsed = parseRequest(body)
  } catch (e) {
    if (e instanceof Rejection) return e.result
    throw e
  }
  const { poId, idempotencyKey } = parsed
  const replayKey = idempotencyKey ? `po_receive_${poId}_${idempotencyKey}` : null

  if (replayKey) {
    const claim = await claimReplayKey(db, replayKey, poId)
    if (claim.state === "blocked") return claim.result
    if (claim.state === "duplicate") {
      const { data: receipt } = await db.from("goods_receipts").select("receipt_id, grn_number, status").eq("receipt_id", claim.receiptId).maybeSingle()
      return {
        status: 200,
        body: {
          success: true,
          replayed: true,
          receipt: { id: String(claim.receiptId), grnNumber: receipt?.grn_number ?? null, status: receipt?.status ?? null },
        },
      }
    }
  }

  let lockId: number | null = null
  const undo: Undo[] = []
  let receiptId: number | null = null
  try {
    lockId = await acquirePoLock(db, poId)
    if (lockId === null) {
      return await settle(db, replayKey, failure(409, "Another receipt for this purchase order is being processed. Please try again in a moment."), "lock timeout", undo)
    }
    const result = await receiveLocked(db, parsed, undo, (id) => (receiptId = id))
    if (replayKey) await finishReplayKey(db, replayKey, "completed", undefined, receiptId ?? undefined)
    return result
  } catch (e: any) {
    if (e instanceof Rejection) {
      // refused before anything was kept (receiveLocked undoes its own partial work before rethrowing)
      if (replayKey) await finishReplayKey(db, replayKey, e.result.body?.partialFailure ? "partial_failure" : "failed", e.message)
      return e.result
    }
    const failedUndo = await runUndo(undo)
    console.error(`[receiving] PO ${poId} failed: ${errText(e)}`)
    if (failedUndo.length > 0) {
      if (replayKey) await finishReplayKey(db, replayKey, "partial_failure", errText(e))
      return failure(
        500,
        "The goods receipt failed and could not be fully undone. Contact an administrator before retrying.",
        { partialFailure: true, poId, notUndone: failedUndo },
      )
    }
    if (replayKey) await finishReplayKey(db, replayKey, "failed", errText(e))
    return failure(500, `Failed to create goods receipt: ${errText(e)}. Nothing was recorded.`)
  } finally {
    if (lockId !== null) await releasePoLock(db, lockId)
  }
}

async function settle(db: Db, replayKey: string | null, result: WorkflowResult, reason: string, _undo: Undo[]) {
  if (replayKey) await finishReplayKey(db, replayKey, "failed", reason)
  return result
}

async function receiveLocked(db: Db, parsed: Parsed, undo: Undo[], onReceipt: (id: number) => void): Promise<WorkflowResult> {
  const { poId, lines } = parsed

  // ---- 1. The PO must exist and be open for receiving --------------------------------------------------
  const po = must(await db.from("purchase_orders").select("po_id, po_number, status").eq("po_id", poId).maybeSingle(), "read purchase order")
  if (!po) return reject(404, "Purchase order not found")
  if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
    return reject(409, `Purchase order ${po.po_number} is "${po.status}" and cannot receive goods (only approved or partially received orders can).`, { code: "PO_NOT_RECEIVABLE", poStatus: po.status })
  }

  // ---- 2. Every line must belong to this PO; remaining quantity comes from the database --------------
  const items: PoItem[] = must(
    await db
      .from("purchase_order_items")
      .select("po_item_id, quantity, unit_price, product_id, item_type, outsourced_name, item_name_snapshot, source_so_item_id")
      .eq("po_id", poId),
    "read purchase order items",
  )
  const itemById = new Map<number, PoItem>((items || []).map((i) => [i.po_item_id, i]))
  for (const line of lines) {
    if (!itemById.has(line.poItemId)) {
      return reject(400, `Line ${line.index + 1}: purchase order item ${line.poItemId} does not belong to purchase order ${po.po_number}`)
    }
  }
  const previous = sumByItem(
    must(await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", [...itemById.keys()]), "read previous receipts"),
  )
  const requested = new Map<number, number>()
  for (const line of lines) requested.set(line.poItemId, (requested.get(line.poItemId) || 0) + line.quantity)
  const problems: any[] = []
  for (const [itemId, qty] of requested) {
    const item = itemById.get(itemId)!
    const ordered = Number(item.quantity) || 0
    const already = previous.get(itemId) || 0
    const remaining = Math.max(0, ordered - already)
    if (qty > remaining) problems.push({ poItemId: itemId, ordered, alreadyReceived: already, remaining, requested: qty })
  }
  if (problems.length > 0) {
    const p = problems[0]
    return reject(
      409,
      `Cannot receive ${p.requested} of PO item ${p.poItemId}: ordered ${p.ordered}, already received ${p.alreadyReceived}, remaining ${p.remaining}. Nothing was recorded.`,
      { code: "OVER_RECEIPT", items: problems },
    )
  }

  // ---- 3. Cumulative position after this receipt -------------------------------------------------------
  const after = new Map<number, number>()
  for (const item of items) after.set(item.po_item_id, (previous.get(item.po_item_id) || 0) + (requested.get(item.po_item_id) || 0))
  const poFullyReceived = items.length > 0 && items.every((i) => (after.get(i.po_item_id) || 0) >= (Number(i.quantity) || 0))
  const hasDiscrepancy = lines.some((l) => l.discrepancyType)
  // GRN status keeps its meaning (partial | complete | discrepancy); the PO status never follows it.
  const receiptStatus = hasDiscrepancy ? "discrepancy" : poFullyReceived ? "complete" : "partial"
  const newPoStatus = poFullyReceived ? "received" : "partially_received"

  // ---- 4. Stock items typed in by hand get a catalogue product (existing behaviour) -------------------
  const productByItem = new Map<number, number>()
  for (const item of items) if (item.product_id) productByItem.set(item.po_item_id, item.product_id)
  for (const line of lines) {
    const item = itemById.get(line.poItemId)!
    if (item.item_type === "outsourced" || productByItem.has(line.poItemId)) continue
    const sku = must(await db.rpc("generate_product_sku"), "generate product sku")
    if (!sku) throw new Error("Failed to generate product SKU")
    const product = must(
      await db
        .from("products")
        .insert({
          product_name: item.item_name_snapshot || line.productName || `PO Item ${line.poItemId}`,
          sku: sku as string,
          unit_price: Number(item.unit_price) || 0,
          unit: "pcs",
          is_active: true,
        })
        .select("product_id")
        .single(),
      "create catalogue product",
    )
    must(await db.from("purchase_order_items").update({ product_id: product.product_id }).eq("po_item_id", line.poItemId), "link catalogue product")
    productByItem.set(line.poItemId, product.product_id)
  }

  // ---- 5. GRN header + lines -----------------------------------------------------------------------------
  const grnSeq = await db.rpc("get_next_grn_number")
  const grnNumber = `GRN-${new Date().getFullYear()}-${String(grnSeq?.data || 1).padStart(4, "0")}`
  const receipt = must(
    await db
      .from("goods_receipts")
      .insert({
        grn_number: grnNumber,
        po_id: poId,
        po_number: po.po_number,
        receipt_date: today(),
        status: receiptStatus,
        received_by: parsed.receivedBy,
        notes: parsed.notes,
      })
      .select()
      .single(),
    "create goods receipt",
  )
  onReceipt(receipt.receipt_id)
  undo.push({
    what: `goods receipt ${receipt.receipt_id}`,
    run: async () => {
      must(await db.from("goods_receipt_lines").delete().eq("receipt_id", receipt.receipt_id), "undo: delete receipt lines")
      must(await db.from("goods_receipts").delete().eq("receipt_id", receipt.receipt_id), "undo: delete receipt")
    },
  })

  const lineRows = lines.map((line) => {
    const item = itemById.get(line.poItemId)!
    const outsourced = item.item_type === "outsourced"
    return {
      receipt_id: receipt.receipt_id,
      po_item_id: line.poItemId,
      product_id: outsourced ? null : productByItem.get(line.poItemId) ?? null,
      outsourced_name: outsourced ? item.outsourced_name : null,
      item_type: outsourced ? "outsourced" : "stock",
      source_so_item_id: item.source_so_item_id ?? null,
      quantity_ordered: Number(item.quantity) || 0,
      quantity_received: line.quantity,
      discrepancy_type: line.discrepancyType,
      discrepancy_notes: line.discrepancyNotes,
      warehouse_id: outsourced ? null : line.warehouseId,
      unit_cost: line.unitCost ?? (Number(item.unit_price) || 0),
      received_date: today(),
    }
  })
  must(await db.from("goods_receipt_lines").insert(lineRows), "create goods receipt lines")

  // ---- 6. Re-check the cumulative quantity now that our rows are visible ---------------------------------
  const recheck = sumByItem(
    must(await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", [...requested.keys()]), "re-check receipts"),
  )
  for (const [itemId] of requested) {
    if ((recheck.get(itemId) || 0) > (Number(itemById.get(itemId)!.quantity) || 0)) {
      throw await rollbackAndReject(db, undo, 409, "Another receipt for this item was recorded at the same moment; the quantity would now exceed the order. Nothing was recorded.", { code: "OVER_RECEIPT_RACE" })
    }
  }

  // ---- 7. Inventory (stock lines only) and batches --------------------------------------------------------
  for (let i = 0; i < lines.length; i++) {
    const row = lineRows[i]
    if (row.item_type === "outsourced" || !row.product_id) continue
    await addStock(db, row.product_id, row.warehouse_id, row.quantity_received, Number(row.unit_cost) || 0, undo)
    const last = must(
      await db.from("inventory_batches").select("batch_sequence").eq("product_id", row.product_id).order("batch_sequence", { ascending: false }).limit(1).maybeSingle(),
      "read batch sequence",
    )
    const batch = must(
      await db
        .from("inventory_batches")
        .insert({
          product_id: row.product_id,
          po_id: poId,
          po_number: po.po_number,
          quantity_received: row.quantity_received,
          quantity_available: row.quantity_received,
          unit_cost: Number(row.unit_cost) || 0,
          landed_cost_per_unit: Number(row.unit_cost) || 0,
          received_date: today(),
          warehouse_id: row.warehouse_id,
          batch_sequence: (last?.batch_sequence || 0) + 1,
        })
        .select("batch_id")
        .single(),
      "create inventory batch",
    )
    undo.push({ what: `inventory batch ${batch.batch_id}`, run: async () => must(await db.from("inventory_batches").delete().eq("batch_id", batch.batch_id), "undo: delete batch") })
  }

  // ---- 8. Sales-order linkage (an SO item is fulfilled once the received quantity of its PO item(s) reaches the SO quantity) ----
  await markSalesOrderFulfilment(db, items, new Set(requested.keys()), undo)

  // ---- 9. PO status from cumulative quantities (guarded: the PO must still be open) ---------------------
  if (po.status !== newPoStatus) {
    const moved = must(
      await db.from("purchase_orders").update({ status: newPoStatus }).eq("po_id", poId).in("status", RECEIVABLE_PO_STATUSES).select("po_id"),
      "update purchase order status",
    )
    if (!moved || moved.length !== 1) {
      throw await rollbackAndReject(db, undo, 409, "The purchase order changed while the goods were being received. Nothing was recorded.", { code: "PO_CHANGED" })
    }
    undo.push({
      what: `purchase order ${poId} status`,
      run: async () => must(await db.from("purchase_orders").update({ status: po.status }).eq("po_id", poId).eq("status", newPoStatus), "undo: restore PO status"),
    })
  }

  return {
    status: 200,
    body: {
      success: true,
      receipt: { id: String(receipt.receipt_id), grnNumber: receipt.grn_number || grnNumber, status: receiptStatus },
      poStatus: newPoStatus,
      remaining: items.map((i) => ({ poItemId: i.po_item_id, ordered: Number(i.quantity) || 0, received: after.get(i.po_item_id) || 0 })),
    },
  }
}

/** Undo everything this request did so far and refuse. If an undo fails the refusal becomes a partial failure. */
async function rollbackAndReject(db: Db, undo: Undo[], status: number, error: string, extra: Record<string, any>): Promise<Rejection> {
  const failed = await runUndo(undo.splice(0, undo.length))
  if (failed.length > 0) {
    return new Rejection(failure(500, "The goods receipt was refused but could not be fully undone. Contact an administrator.", { partialFailure: true, notUndone: failed }))
  }
  return new Rejection(failure(status, error, extra))
}

/**
 * An SO item is "fulfilled" once the goods sourced for it have arrived: the quantity received across ALL PO items that
 * point at it (one PO or several) reaches the SO item's quantity. A partial receipt never marks it. Only SO items that
 * this request touched are considered, and a sales order that is already being delivered is never moved back.
 */
async function markSalesOrderFulfilment(db: Db, items: PoItem[], touched: Set<number>, undo: Undo[]) {
  const candidates = [...new Set(items.filter((i) => i.source_so_item_id && touched.has(i.po_item_id)).map((i) => i.source_so_item_id as number))]
  if (candidates.length === 0) return
  const soItems = must(await db.from("sales_order_items").select("so_item_id, so_id, quantity, fulfilled_at").in("so_item_id", candidates), "read sales order items")
  const linked = must(await db.from("purchase_order_items").select("po_item_id, quantity, source_so_item_id").in("source_so_item_id", candidates), "read linked purchase order items")
  const receivedLines = must(
    await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", (linked || []).map((l: any) => l.po_item_id)),
    "read received quantities",
  )
  const receivedByPoItem = sumByItem(receivedLines)
  const fulfilled = (soItem: any) => {
    const mine = (linked || []).filter((l: any) => l.source_so_item_id === soItem.so_item_id)
    const received = mine.reduce((sum: number, l: any) => sum + (receivedByPoItem.get(l.po_item_id) || 0), 0)
    const required = Number(soItem.quantity) > 0 ? Number(soItem.quantity) : mine.reduce((sum: number, l: any) => sum + (Number(l.quantity) || 0), 0)
    return required > 0 && received >= required
  }
  const toMark = (soItems || []).filter((s: any) => !s.fulfilled_at && fulfilled(s))
  if (toMark.length > 0) {
    const ids = toMark.map((s: any) => s.so_item_id)
    must(await db.from("sales_order_items").update({ fulfilled_at: new Date().toISOString() }).in("so_item_id", ids).is("fulfilled_at", null), "mark sales order items fulfilled")
    undo.push({
      what: `sales order items ${ids.join(",")} fulfilled_at`,
      run: async () => must(await db.from("sales_order_items").update({ fulfilled_at: null }).in("so_item_id", ids), "undo: clear fulfilled_at"),
    })
  }
  const soIds = [...new Set(toMark.map((s: any) => s.so_id))] as number[]
  for (const soId of soIds) {
    const all = must(await db.from("sales_order_items").select("so_item_id, fulfilled_at").eq("so_id", soId), "read sales order lines")
    if (!(all || []).length || !(all || []).every((i: any) => i.fulfilled_at)) continue
    const so = must(await db.from("sales_orders").select("so_id, fulfillment_status").eq("so_id", soId).maybeSingle(), "read sales order")
    // never move an order that is already being delivered back to "ready for fulfilment"
    if (!so || ["READY_FOR_FULFILLMENT", "PARTIALLY_DELIVERED", "DELIVERED"].includes(so.fulfillment_status)) continue
    must(await db.from("sales_orders").update({ fulfillment_status: "READY_FOR_FULFILLMENT" }).eq("so_id", soId), "mark sales order ready for fulfilment")
    undo.push({
      what: `sales order ${soId} fulfillment_status`,
      run: async () => must(await db.from("sales_orders").update({ fulfillment_status: so.fulfillment_status ?? null }).eq("so_id", soId), "undo: restore fulfillment_status"),
    })
  }
}
