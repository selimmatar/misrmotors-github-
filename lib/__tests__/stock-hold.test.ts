// Batch 4E-stock tests: stock is ON HOLD from sales-order approval and DEDUCTED at delivery-permit approval.
// Real handlers (sales-orders POST, delivery-permits PUT, inventory GET) on the in-memory FakeDb.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as soRoute from "../../app/api/sales-orders/route"
import * as inventoryRoute from "../../app/api/inventory/route"
import { computeHeldByProduct, loadAvailability, loadHeldByProduct } from "../stock-hold"
import { lineKey } from "../return-lines"

const so = (so_id: number, status: string): Row => ({ so_id, so_number: `SO-T-${so_id}`, customer_id: 5, status, fulfillment_status: "PENDING", total: 0 })
const line = (so_item_id: number, so_id: number, product_id: number | null, quantity: number, item_type = "stock"): Row => ({
  so_item_id, so_id, product_id, quantity, item_type, outsourced_name: product_id ? null : "Outsourced thing", unit_price: 100, total: 100 * quantity,
})
const permit = (permit_id: number, sales_order_id: number, status: string): Row => ({ permit_id, permit_no: `DP-T-${permit_id}`, sales_order_id, customer_id: 5, status })
const pitem = (item_id: number, permit_id: number, product_id: number | null, quantity: number, warehouse_id: number | null = 1): Row => ({
  item_id, permit_id, product_id, item_name_snapshot: product_id ? `Product ${product_id}` : "Outsourced thing", quantity, unit_price: 100, total: 100 * quantity, warehouse_id,
})
const inv = (inventory_id: number, product_id: number, warehouse_id: number, quantity: number, is_returned = false): Row => ({
  inventory_id, product_id, warehouse_id, quantity, is_returned, unit_cost: 50, reorder_point: 5,
})

function mk(seed: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    sales_orders: [], sales_order_items: [], delivery_permits: [], delivery_permit_items: [], inventory: [],
    inventory_transactions: [], idempotency_log: [], product_returns: [], return_items: [], workflow_events: [], ...seed,
  })
  db.rpcHandlers.generate_so_number = () => "SO-NEW-1"
  useDb(db)
  return db
}
const approve = (permitId: number) => call(dpRoute.PUT, "PUT", { permitId: String(permitId), action: "APPROVE" })
const qty = (db: FakeDb, id: number) => db.tables.inventory.find((r) => r.inventory_id === id)!.quantity
const dpStatus = (db: FakeDb, id: number) => db.tables.delivery_permits.find((r) => r.permit_id === id)!.status

// ---------------------------------------------------------------------------------------------------------
// hold math
// ---------------------------------------------------------------------------------------------------------
const holdInput = (over: Partial<Parameters<typeof computeHeldByProduct>[0]> = {}) => ({
  orders: [{ so_id: 1, status: "accountant_approved" }],
  lines: [{ so_id: 1, item_type: "stock", product_id: 7, quantity: 10 }] as any[],
  permits: [] as any[],
  permitItems: [] as any[],
  returns: [] as any[],
  ...over,
})

test("hold: an accountant-approved order holds its whole stock quantity", () => {
  assert.equal(computeHeldByProduct(holdInput()).get(7), 10)
})

test("hold: ready_for_delivery and shipped hold too; draft/pending/rejected/cancelled/delivered hold nothing", () => {
  for (const status of ["ready_for_delivery", "shipped"]) assert.equal(computeHeldByProduct(holdInput({ orders: [{ so_id: 1, status }] })).get(7), 10, status)
  for (const status of ["draft", "pending", "pending_accountant", "approved_quotation", "rejected_quotation", "draft_quotation", "cancelled", "delivered"]) {
    assert.equal(computeHeldByProduct(holdInput({ orders: [{ so_id: 1, status }] })).size, 0, status)
  }
})

test("hold: an APPROVED permit reduces the hold; permits in other statuses do not", () => {
  const permits = [
    { permit_id: 1, sales_order_id: 1, status: "APPROVED" },
    { permit_id: 2, sales_order_id: 1, status: "SUBMITTED_SIGNED" },
    { permit_id: 3, sales_order_id: 1, status: "READY_FOR_PICKUP" },
  ]
  const permitItems = [
    { permit_id: 1, product_id: 7, quantity: 4 },
    { permit_id: 2, product_id: 7, quantity: 3 },
    { permit_id: 3, product_id: 7, quantity: 2 },
  ]
  assert.equal(computeHeldByProduct(holdInput({ permits, permitItems })).get(7), 6) // 10 - 4
})

test("hold: fully covered by approved permits = no hold; over-delivery never goes negative", () => {
  const permits = [{ permit_id: 1, sales_order_id: 1, status: "APPROVED" }]
  assert.equal(computeHeldByProduct(holdInput({ permits, permitItems: [{ permit_id: 1, product_id: 7, quantity: 10 }] })).size, 0)
  assert.equal(computeHeldByProduct(holdInput({ permits, permitItems: [{ permit_id: 1, product_id: 7, quantity: 12 }] })).size, 0)
})

test("hold: outsourced lines (no product / item_type outsourced) never hold", () => {
  const lines = [
    { so_id: 1, item_type: "outsourced", product_id: null, quantity: 5 },
    { so_id: 1, item_type: "outsourced", product_id: 9, quantity: 5 },
    { so_id: 1, item_type: "stock", product_id: 7, quantity: 2 },
  ]
  const held = computeHeldByProduct(holdInput({ lines }))
  assert.deepEqual([...held], [[7, 2]])
})

test("hold: goods returned against an approved permit are held again (10 ordered, 4 delivered, 1 returned -> 7)", () => {
  const permits = [{ permit_id: 1, sales_order_id: 1, status: "APPROVED" }]
  const permitItems = [{ permit_id: 1, product_id: 7, quantity: 4 }]
  const returns = [{ return_id: 1, permit_id: 1, key: lineKey(7, "x"), quantity: 1, created_at: null }]
  assert.equal(computeHeldByProduct(holdInput({ permits, permitItems, returns })).get(7), 7)
})

test("hold: several orders add up per product; excludeSoId removes the order being edited", () => {
  const input = holdInput({
    orders: [{ so_id: 1, status: "accountant_approved" }, { so_id: 2, status: "ready_for_delivery" }],
    lines: [{ so_id: 1, item_type: "stock", product_id: 7, quantity: 10 }, { so_id: 2, item_type: "stock", product_id: 7, quantity: 5 }],
  })
  assert.equal(computeHeldByProduct(input).get(7), 15)
  assert.equal(computeHeldByProduct({ ...input, excludeSoId: 1 }).get(7), 5)
})

test("hold loader (FakeDb) gives the same answer; returned-goods rows are not on-hand", async () => {
  const db = mk({
    sales_orders: [so(1, "accountant_approved"), so(2, "pending"), so(3, "ready_for_delivery")],
    sales_order_items: [line(1, 1, 7, 10), line(2, 2, 7, 99), line(3, 3, 7, 5), line(4, 3, null, 3, "outsourced")],
    delivery_permits: [permit(1, 3, "APPROVED")],
    delivery_permit_items: [pitem(1, 1, 7, 2)],
    inventory: [inv(1, 7, 1, 20), inv(2, 7, 2, 5), inv(3, 7, 1, 100, true)],
  })
  assert.equal((await loadHeldByProduct(db)).get(7), 13) // 10 (SO 1) + (5 - 2) (SO 3)
  const a = (await loadAvailability(db, [7])).get(7)!
  assert.deepEqual(a, { onHand: 25, held: 13, available: 12 })
  assert.equal((await loadAvailability(db, [7], { excludeSoId: 1 })).get(7)!.available, 22)
})

// ---------------------------------------------------------------------------------------------------------
// SO creation uses available = on hand - held
// ---------------------------------------------------------------------------------------------------------
const createSo = (quantity: number) =>
  call(soRoute.POST, "POST", {
    customerId: "5", total: 100, subtotal: 100, paymentType: "bank_transfer", status: "draft",
    items: [{ productId: "7", productName: "Product 7", quantity, unitPrice: 10, total: quantity * 10, itemType: "stock" }],
  })

test("SO creation: 10 on hand, 8 held by an approved SO -> 5 refused (Available: 2), 2 accepted", async () => {
  const db = mk({
    sales_orders: [so(1, "accountant_approved")],
    sales_order_items: [line(1, 1, 7, 8)],
    inventory: [inv(1, 7, 1, 10)],
  })
  const refused = await createSo(5)
  assert.equal(refused.status, 400)
  assert.equal(refused.body.error, "Insufficient inventory for Product 7. Requested: 5, Available: 2")
  assert.equal(db.tables.sales_orders.length, 1)
  const ok = await createSo(2)
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
})

test("SO creation: a pending order holds nothing, so 10 of 10 is still sellable", async () => {
  mk({ sales_orders: [so(1, "pending_accountant")], sales_order_items: [line(1, 1, 7, 8)], inventory: [inv(1, 7, 1, 10)] })
  assert.equal((await createSo(10)).status, 200)
})

// ---------------------------------------------------------------------------------------------------------
// DP approval deducts
// ---------------------------------------------------------------------------------------------------------
function dpDb(extra: Record<string, Row[]> = {}) {
  return mk({
    sales_orders: [so(1, "ready_for_delivery")],
    sales_order_items: [line(1, 1, 7, 10), line(2, 1, 8, 4), line(3, 1, null, 2, "outsourced")],
    delivery_permits: [permit(1, 1, "SUBMITTED_SIGNED")],
    delivery_permit_items: [pitem(1, 1, 7, 6), pitem(2, 1, 8, 4, 2), pitem(3, 1, null, 2, null)],
    inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 4), inv(3, 7, 1, 100, true)],
    ...extra,
  })
}

test("APPROVE deducts each stock line from its warehouse row once: 20 - 6 = 14, 4 - 4 = 0; outsourced and returned rows untouched", async () => {
  const db = dpDb()
  const r = await approve(1)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(dpStatus(db, 1), "APPROVED")
  assert.equal(qty(db, 1), 14)
  assert.equal(qty(db, 2), 0)
  assert.equal(qty(db, 3), 100)
  assert.equal(db.tables.inventory.length, 3)
  const claim = db.tables.idempotency_log.find((l) => l.operation_type === "dp_stock_deduct")!
  assert.equal(claim.idempotency_key, "dp_stock_deduct_1")
  assert.equal(claim.status, "completed")
})

test("APPROVE writes one 'sale' audit row per line (DELIVERY_PERMIT, permit id, before/after)", async () => {
  const db = dpDb()
  await approve(1)
  const rows = db.tables.inventory_transactions
  assert.equal(rows.length, 2)
  assert.ok(rows.every((t) => t.transaction_type === "sale" && t.reference_type === "DELIVERY_PERMIT" && t.reference_id === 1 && t.reference_number === "DP-T-1"))
  const p7 = rows.find((t) => t.product_id === 7)!
  assert.deepEqual([p7.quantity_change, p7.quantity_before, p7.quantity_after], [-6, 20, 14])
})

test("a failed audit insert is logged and does not undo the deduction", async () => {
  const db = dpDb()
  db.failOn["inventory_transactions:insert"] = "audit down"
  const r = await approve(1)
  assert.equal(r.status, 200)
  assert.equal(dpStatus(db, 1), "APPROVED")
  assert.equal(qty(db, 1), 14)
  assert.equal(db.tables.inventory_transactions.length, 0)
})

test("repeating APPROVE does not deduct twice", async () => {
  const db = dpDb()
  await approve(1)
  const again = await approve(1)
  assert.equal(again.status, 200)
  assert.equal(qty(db, 1), 14)
  assert.equal(db.tables.inventory_transactions.length, 2)
})

test("a repeated APPROVE after the status was reset (claim already completed) still does not deduct twice", async () => {
  const db = dpDb()
  await approve(1)
  db.tables.delivery_permits[0].status = "SUBMITTED_SIGNED"
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(db, 1), 14)
  assert.equal(db.tables.inventory_transactions.length, 2)
})

test("concurrent APPROVE requests deduct exactly once", async () => {
  const db = dpDb()
  const results = await Promise.all([approve(1), approve(1), approve(1)])
  assert.ok(results.some((r) => r.status === 200))
  assert.ok(results.every((r) => r.status === 200 || r.status === 409 || r.status === 400), JSON.stringify(results.map((r) => r.status)))
  assert.equal(qty(db, 1), 14)
  assert.equal(qty(db, 2), 0)
  assert.equal(db.tables.inventory_transactions.length, 2)
})

test("insufficient stock: 409 INSUFFICIENT_STOCK, nothing changes, the permit keeps its status; works after restocking", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 5), inv(2, 8, 2, 4)] })
  const before = JSON.stringify(db.tables.inventory)
  const r = await approve(1)
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "INSUFFICIENT_STOCK")
  assert.equal(r.body.lines.length, 1)
  assert.deepEqual([r.body.lines[0].productId, r.body.lines[0].requested, r.body.lines[0].available], [7, 6, 5])
  assert.match(r.body.error, /Product 7: requested 6, in stock 5/)
  assert.equal(dpStatus(db, 1), "SUBMITTED_SIGNED")
  assert.equal(JSON.stringify(db.tables.inventory), before)
  assert.equal(db.tables.inventory_transactions.length, 0)
  assert.equal(db.tables.sales_orders[0].payment_active, undefined) // no APPROVE side effect
  db.tables.inventory[0].quantity = 6
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(db, 1), 0)
})

test("multi-line: the short line comes LAST, nothing is moved for the earlier lines", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 3)] })
  const r = await approve(1)
  assert.equal(r.status, 409)
  assert.equal(r.body.lines[0].productId, 8)
  assert.equal(qty(db, 1), 20)
  assert.equal(qty(db, 2), 3)
  assert.equal(dpStatus(db, 1), "SUBMITTED_SIGNED")
})

test("the same product on two lines is checked as a sum (4 + 4 against 7 is refused)", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 7)], delivery_permit_items: [pitem(1, 1, 7, 4), pitem(2, 1, 7, 4)] })
  assert.equal((await approve(1)).status, 409)
  assert.equal(qty(db, 1), 7)
})

test("stock is never clamped to 0: exactly the quantity is taken, no negative stock", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 6), inv(2, 8, 2, 4)] })
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(db, 1), 0)
})

test("line without a warehouse falls back to the single row with enough stock; ambiguous or missing -> refused", async () => {
  const one = dpDb({ inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 4)], delivery_permit_items: [pitem(1, 1, 7, 6, null), pitem(2, 1, 8, 4, 2)] })
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(one, 1), 14)

  const two = dpDb({ inventory: [inv(1, 7, 1, 20), inv(5, 7, 2, 20), inv(2, 8, 2, 4)], delivery_permit_items: [pitem(1, 1, 7, 6, null), pitem(2, 1, 8, 4, 2)] })
  const r = await approve(1)
  assert.equal(r.status, 409)
  assert.equal(r.body.lines[0].reason, "WAREHOUSE_NOT_ALLOCATED")
  assert.equal(qty(two, 1), 20)

  const none = dpDb({ inventory: [inv(2, 8, 2, 4)], delivery_permit_items: [pitem(1, 1, 7, 6, 1), pitem(2, 1, 8, 4, 2)] })
  const missing = await approve(1)
  assert.equal(missing.status, 409)
  assert.equal(missing.body.lines[0].reason, "NO_STOCK_ROW")
  assert.equal(qty(none, 2), 4)
})

test("undo: if the permit status update fails after the deduction, the stock is put back and the claim is released", async () => {
  const db = dpDb()
  db.failOn["delivery_permits:update"] = "db down"
  const r = await approve(1)
  assert.equal(r.status, 500)
  assert.match(r.body.error, /stock was put back/)
  assert.equal(qty(db, 1), 20)
  assert.equal(qty(db, 2), 4)
  assert.equal(dpStatus(db, 1), "SUBMITTED_SIGNED")
  assert.equal(db.tables.inventory_transactions.length, 0)
  assert.equal(db.tables.idempotency_log.find((l) => l.operation_type === "dp_stock_deduct")!.status, "failed")
  delete db.failOn["delivery_permits:update"]
  assert.equal((await approve(1)).status, 200) // retry works and deducts once
  assert.equal(qty(db, 1), 14)
})

test("historical APPROVED permits are never deducted: re-approving one, or approving a newer one, leaves them alone", async () => {
  const db = dpDb({
    delivery_permits: [permit(1, 1, "SUBMITTED_SIGNED"), permit(2, 1, "APPROVED")],
    delivery_permit_items: [pitem(1, 1, 7, 6), pitem(2, 1, 8, 4, 2), pitem(4, 2, 7, 3)],
  })
  assert.equal((await approve(2)).status, 200) // already APPROVED: no deduction, no claim
  assert.equal(qty(db, 1), 20)
  assert.equal(db.tables.idempotency_log.filter((l) => l.operation_type === "dp_stock_deduct").length, 0)
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(db, 1), 14) // only the newly approved permit moved stock
  assert.equal(db.tables.inventory_transactions.every((t) => t.reference_id === 1), true)
})

test("SO delivered logic unchanged: partial approval -> PARTIALLY_DELIVERED, last approval -> delivered; payment activated", async () => {
  const db = mk({
    sales_orders: [so(1, "ready_for_delivery")],
    sales_order_items: [line(1, 1, 7, 10)],
    delivery_permits: [permit(1, 1, "SUBMITTED_SIGNED"), permit(2, 1, "READY_FOR_PICKUP")],
    delivery_permit_items: [pitem(1, 1, 7, 4), pitem(2, 2, 7, 6)],
    inventory: [inv(1, 7, 1, 20)],
  })
  await approve(1)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PARTIALLY_DELIVERED")
  assert.equal(db.tables.sales_orders[0].status, "ready_for_delivery")
  assert.equal(db.tables.sales_orders[0].payment_active, true)
  assert.equal((await loadHeldByProduct(db)).get(7), 6) // 10 - 4 deducted
  await approve(2)
  assert.equal(db.tables.sales_orders[0].status, "delivered")
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "DELIVERED")
  assert.equal(qty(db, 1), 10)
  assert.equal((await loadHeldByProduct(db)).size, 0)
})

test("other actions (MARK_*) never touch stock", async () => {
  const db = dpDb()
  await call(dpRoute.PUT, "PUT", { permitId: "1", action: "MARK_PRINTED" })
  assert.equal(qty(db, 1), 20)
  assert.equal(db.tables.inventory_transactions.length, 0)
})

// ---------------------------------------------------------------------------------------------------------
// GET /api/inventory exposes onHold / available
// ---------------------------------------------------------------------------------------------------------
test("GET /api/inventory: onHold and available are additive fields; existing fields are kept", async () => {
  mk({
    sales_orders: [so(1, "accountant_approved")],
    sales_order_items: [line(1, 1, 7, 8)],
    inventory: [inv(1, 7, 1, 6), inv(2, 7, 2, 4), inv(3, 7, 1, 2, true), inv(4, 9, 1, 3)],
  })
  const res = await inventoryRoute.GET()
  const rows = (await res.json()) as any[]
  const row1 = rows.find((r) => r.inventoryId === 1)
  assert.equal(row1.quantity, 6)
  assert.equal(row1.onHold, 8)
  assert.equal(row1.available, 2) // 10 on hand - 8 held
  assert.equal(rows.find((r) => r.inventoryId === 2).onHold, 8)
  assert.equal(rows.find((r) => r.inventoryId === 3).onHold, 0) // returned-goods row
  assert.equal(rows.find((r) => r.inventoryId === 4).onHold, 0)
  assert.equal(rows.find((r) => r.inventoryId === 4).available, 3)
  assert.ok("warehouseId" in row1 && "unitCost" in row1 && "isReturned" in row1)
})
