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
import * as pendingRoute from "../../app/api/inventory/pending/route"
import { computeHeldByProduct, loadAvailability, loadHeldByProduct } from "../stock-hold"
import { computeOutsourcedHolds } from "../outsourced-hold"
import { fromStockDescription, isFromStockLine, parseFromStock } from "../from-stock-line"
import { computeDirectPending, computeOutsourcedLineCosts } from "../outsourced-pending"
import { isOnHandRow } from "../inventory-stock-filter"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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

test("hold: a SIGNED or APPROVED permit reduces the hold (stock left at signing, 2026-11-12); earlier statuses do not", () => {
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
  assert.equal(computeHeldByProduct(holdInput({ permits, permitItems })).get(7), 3) // 10 - 4 approved - 3 signed
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

test("hold: goods returned against an approved permit are NOT held again (10 ordered, 4 delivered, 1 returned -> 6)", () => {
  // The returned unit lives in an is_returned row that is already excluded from on-hand; holding it too would count it twice.
  const permits = [{ permit_id: 1, sales_order_id: 1, status: "APPROVED" }]
  const permitItems = [{ permit_id: 1, product_id: 7, quantity: 4 }]
  assert.equal(computeHeldByProduct(holdInput({ permits, permitItems })).get(7), 6)
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
    delivery_permits: [permit(1, 1, "SUBMITTED_SIGNED"), permit(2, 1, "OUT_FOR_DELIVERY")],
    delivery_permit_items: [pitem(1, 1, 7, 4), pitem(2, 2, 7, 6)],
    inventory: [inv(1, 7, 1, 20)],
  })
  await approve(1)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PARTIALLY_DELIVERED")
  assert.equal(db.tables.sales_orders[0].status, "ready_for_delivery")
  assert.equal(db.tables.sales_orders[0].payment_active, true)
  assert.equal((await loadHeldByProduct(db)).get(7), 6) // 10 - 4 deducted
  await call(dpRoute.PUT, "PUT", { permitId: "2", action: "MARK_SUBMITTED_SIGNED" }) // the real flow signs before approving
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

// ---------------------------------------------------------------------------------------------------------
// Outsourced items stored in a warehouse, on hold for their order (owner, 2026-11-04)
// ---------------------------------------------------------------------------------------------------------
const held = (inventory_id: number, warehouse_id: number, quantity: number, so_number = "SO-T-1", outsourced_name = "Outsourced thing"): Row => ({
  inventory_id, product_id: null, warehouse_id, quantity, is_returned: false, is_outsourced: true, unit_cost: 0, reorder_point: 0, outsourced_name, so_number,
  // a restocked customer return (free stock): a row that only names an open order is that order's since 2026-11-18
  outsourced_description: `Returned from ${so_number} — customer return`,
})

test("outsourced: APPROVE takes the stored item out of its warehouse row; stock lines as before", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 4), held(9, 3, 2, "SO-T-1", "  outsourced THING ")] })
  const r = await approve(1)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 9), 0)
  assert.equal(qty(db, 1), 14)
  const audit = db.tables.inventory_transactions
  assert.ok(audit.every((a) => a.product_id), "no audit row without a product")
})

test("outsourced: only the item stored for THIS order is taken; never more than stored; nothing stored = approval still works", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 4), held(9, 3, 1), held(10, 3, 5, "SO-T-2")] })
  const r = await approve(1)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 9), 0, "1 stored, 2 delivered: takes the 1, never negative")
  assert.equal(qty(db, 10), 5, "another order's item is untouched")
  const none = dpDb({ inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 4)] })
  assert.equal((await approve(1)).status, 200)
  void none
})

test("outsourced only permit: taken once, a repeated APPROVE does not take again", async () => {
  const db = dpDb({
    delivery_permit_items: [pitem(3, 1, null, 2, null)],
    inventory: [held(9, 3, 5)],
  })
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(db, 9), 3)
  db.tables.delivery_permits[0].status = "SUBMITTED_SIGNED"
  assert.equal((await approve(1)).status, 200)
  assert.equal(qty(db, 9), 3)
})

test("outsourced: undo puts the stored item back when the permit status update fails", async () => {
  const db = dpDb({ inventory: [inv(1, 7, 1, 20), inv(2, 8, 2, 4), held(9, 3, 2)] })
  db.failOn["delivery_permits:update"] = "db down"
  assert.notEqual((await approve(1)).status, 200)
  assert.equal(qty(db, 9), 2)
  assert.equal(qty(db, 1), 20)
})

// Owner decisions, 2026-11-17: an outsourced item PURCHASED for an order (storeOutsourced: "Received on ...") stays on
// hold for that order (Pending tab) even in a warehouse; a customer return put into a warehouse (or the item of a closed
// order) is free stock, held only by a sales order line that TOOK it from stock (lib/from-stock-line.ts marker).
const purchased = (inventory_id: number, warehouse_id: number, quantity: number, so_number: string, name = "Outsourced thing"): Row => ({
  ...held(inventory_id, warehouse_id, quantity, so_number, name), outsourced_description: `Received on PO-T-1 for ${so_number}`,
})
const returnedRow = (inventory_id: number, warehouse_id: number | null, quantity: number, name = "Outsourced thing"): Row => ({
  ...held(inventory_id, warehouse_id as any, quantity, "SO-OLD", name), is_returned: true, outsourced_description: "Returned from SO-OLD — customer return",
})

test("GET /api/inventory: a purchased item is held for its open order (Pending, not On hand); closed order or a return = free", async () => {
  mk({
    customers: [{ customer_id: 5, customer_name: "Al Kasrawy" }],
    sales_orders: [so(1, "accountant_approved"), so(2, "cancelled")],
    sales_order_items: [line(1, 1, null, 1, "outsourced")],
    inventory: [purchased(9, 3, 4, "SO-T-1"), purchased(10, 3, 2, "SO-T-2"), returnedRow(11, 3, 1)],
  })
  const rows = (await (await inventoryRoute.GET()).json()) as any[]
  const r9 = rows.find((x) => x.inventoryId === 9)
  assert.equal(r9.onHold, 4, "held whole, even when its order line was lowered")
  assert.equal(r9.available, 0)
  assert.deepEqual(r9.heldFor, { soNumber: "SO-T-1", customerName: "Al Kasrawy" })
  assert.equal(r9.purchasedFor, true)
  assert.equal(isOnHandRow({ ...r9, productId: "" }), false, "Pending tab, not On hand")
  for (const id of [10, 11]) {
    const r = rows.find((x) => x.inventoryId === id)
    assert.equal(r.onHold, 0, `row ${id}`)
    assert.equal(r.available, r.quantity, `row ${id}`)
    assert.equal(r.heldFor, null, `row ${id}`)
    assert.equal(r.purchasedFor, false, `row ${id}`)
    assert.equal(r.reorderPoint, 0, "an outsourced item is never 'low stock'")
    assert.equal(isOnHandRow({ ...r, productId: "" }), true, `row ${id} is On hand`)
  }
})

test("SO POST: an item purchased for another open order cannot be taken; its customer return can", async () => {
  const db = mk({
    sales_orders: [so(1, "accountant_approved")],
    inventory: [purchased(9, 3, 4, "SO-T-1"), returnedRow(11, 3, 1)],
  })
  const r = await soPost([storedLine(9, 1)])
  assert.equal(r.status, 400)
  assert.equal(r.body.code, "STORED_ITEM_SHORT")
  const ok = await soPost([storedLine(11, 1)])
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  const row = db.tables.inventory.find((i) => i.inventory_id === 11)!
  assert.equal(row.is_returned, false)
  assert.equal(row.outsourced_description, "Taken from stock for SO-NEW-1")
})

const fsLine = (so_item_id: number, so_id: number, quantity: number, reservedId: number, pickedId = reservedId, name = "Outsourced thing"): Row => ({
  ...line(so_item_id, so_id, null, quantity, "outsourced"), outsourced_name: name, outsourced_description: fromStockDescription(reservedId, pickedId), fulfilled_at: "2026-11-17",
})
const holdsOf = (over: Partial<Parameters<typeof computeOutsourcedHolds>[0]> = {}) =>
  computeOutsourcedHolds({
    rows: [held(9, 3, 4, "SO-T-1")] as any[],
    orders: [{ so_id: 1, so_number: "SO-T-1", status: "accountant_approved", customer_id: 5 }],
    lines: [fsLine(1, 1, 4, 9)] as any[],
    permits: [],
    permitItems: [],
    ...over,
  })

test("from-stock hold: the line that took the row holds it; lowered -> only that much; removed or another order's line -> free", () => {
  assert.equal(holdsOf().get(9)!.held, 4)
  assert.equal(holdsOf().get(9)!.soNumber, "SO-T-1")
  assert.equal(holdsOf({ lines: [fsLine(1, 1, 1, 9)] as any[] }).get(9)!.held, 1)
  const removed = holdsOf({ lines: [] }).get(9)!
  assert.equal(removed.held, 0)
  assert.equal(removed.soNumber, null)
  assert.equal(holdsOf({ lines: [{ ...line(1, 1, null, 4, "outsourced") }] as any[] }).get(9)!.held, 0, "an ordinary outsourced line holds nothing")
  assert.equal(holdsOf({ lines: [fsLine(1, 1, 4, 12)] as any[] }).get(9)!.held, 0, "a line holds only the row reserved for it")
})

test("from-stock hold: delivered (signed/approved) no longer holds; closed orders hold nothing; the marker parses", () => {
  const delivered = holdsOf({
    permits: [{ permit_id: 1, sales_order_id: 1, status: "APPROVED" }, { permit_id: 2, sales_order_id: 1, status: "DRAFT" }],
    permitItems: [pitem(1, 1, null, 3), pitem(2, 2, null, 1)] as any[],
  })
  assert.equal(delivered.get(9)!.held, 1, "4 taken - 3 delivered (a draft permit delivers nothing)")
  for (const status of ["cancelled", "rejected", "delivered", "completed"]) {
    assert.equal(holdsOf({ orders: [{ so_id: 1, so_number: "SO-T-1", status, customer_id: 5 }] }).get(9)!.held, 0, status)
  }
  assert.deepEqual(parseFromStock(fromStockDescription(15, 9)), { reservedId: 15, pickedId: 9 })
  assert.deepEqual(parseFromStock("From stock (inventory #9)"), { reservedId: 9, pickedId: 9 })
  assert.equal(parseFromStock("Supplier: ACME"), null)
  assert.equal(isFromStockLine({ outsourcedDescription: fromStockDescription(3) }), true)
})

// A free stored item taken on a new sales order (POST /api/sales-orders with fromInventoryId)
const soPost = (items: any[]) =>
  call(soRoute.POST, "POST", { customerId: 5, status: "draft", paymentType: "cash", total: 100, items })
const storedLine = (fromInventoryId: any, quantity: number) => ({ productId: "", productName: "whatever the screen said", quantity, unitPrice: 900, total: 900 * quantity, itemCategory: "OUTSOURCED", fromInventoryId })

test("SO POST: a whole free stored item moves to the new order; its line is named like it, received, and holds it", async () => {
  const db = mk({
    sales_orders: [so(2, "accountant_approved")],
    inventory: [{ ...held(10, 3, 2, "SO-T-2", "Gearbox"), unit_cost: 880 }],
  })
  const r = await soPost([storedLine(10, 2)])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const order = db.tables.sales_orders.find((o) => o.so_number === "SO-NEW-1")!
  assert.equal(db.tables.inventory.find((i) => i.inventory_id === 10)!.so_number, "SO-NEW-1")
  const l = db.tables.sales_order_items.find((i) => i.so_id === order.so_id)!
  assert.equal(l.product_id, null)
  assert.equal(l.item_type, "outsourced")
  assert.equal(l.outsourced_name, "Gearbox", "named like the stored row, so the delivery permit finds it")
  assert.equal(l.outsourced_description, fromStockDescription(10, 10))
  assert.ok(l.fulfilled_at, "already in hand")
  assert.equal(l.cost_estimate, 880)
  const rows = (await (await inventoryRoute.GET()).json()) as any[]
  const r10 = rows.find((x) => x.inventoryId === 10)
  assert.equal(r10.heldFor.soNumber, "SO-NEW-1")
  assert.equal(r10.available, 0)
})

test("SO POST: part of a free stored item is split off for the new order (same cost / warehouse); the rest stays free", async () => {
  const db = mk({
    sales_orders: [so(1, "accountant_approved")],
    sales_order_items: [line(1, 1, null, 4, "outsourced")],
    inventory: [{ ...held(9, 3, 4, "SO-T-1"), unit_cost: 50 }],
  })
  const r = await soPost([storedLine(9, 3)])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 9), 1)
  assert.equal(db.tables.inventory.find((i) => i.inventory_id === 9)!.so_number, "SO-T-1")
  const split = db.tables.inventory.find((i) => i.so_number === "SO-NEW-1")!
  assert.equal(split.quantity, 3)
  assert.equal(split.unit_cost, 50)
  assert.equal(split.warehouse_id, 3)
  assert.equal(split.is_outsourced, true)
  const l = db.tables.sales_order_items.find((i) => i.outsourced_description)!
  assert.equal(l.outsourced_description, fromStockDescription(split.inventory_id, 9), "the line holds the split row")
})

test("SO POST: more than is free is refused; a row held by another line cannot be taken; nothing is written", async () => {
  const db = mk({
    sales_orders: [so(1, "accountant_approved")],
    sales_order_items: [fsLine(1, 1, 3, 9)],
    inventory: [held(9, 3, 4, "SO-T-1"), inv(4, 9, 1, 3)],
  })
  const before = JSON.stringify(db.tables.inventory)
  const r = await soPost([storedLine(9, 2)])
  assert.equal(r.status, 400)
  assert.equal(r.body.code, "STORED_ITEM_SHORT")
  assert.match(r.body.error, /Available: 1/)
  assert.equal(JSON.stringify(db.tables.inventory), before)
  assert.equal(db.tables.sales_orders.length, 1)
  const notStored = await soPost([storedLine(4, 1)])
  assert.equal(notStored.status, 400, "a catalogue stock row is not a stored outsourced item")
  assert.equal(notStored.body.code, "STORED_ITEM_INVALID")
})

test("SO POST: an outsourced return put into a warehouse can be taken (it is stock again); one outside a warehouse cannot", async () => {
  const db = mk({
    inventory: [{ ...held(20, 3, 1, "SO-OLD"), is_returned: true }, { ...held(21, null as any, 1, "SO-OLD"), is_returned: true }],
  })
  const r = await soPost([storedLine(20, 1)])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.tables.inventory.find((i) => i.inventory_id === 20)!
  assert.equal(row.is_returned, false)
  assert.equal(row.so_number, "SO-NEW-1")
  assert.equal((await soPost([storedLine(21, 1)])).status, 400)
})

test("SO POST: a reservation that loses a race undoes the order", async () => {
  const db = mk({ sales_orders: [so(2, "cancelled")], inventory: [held(10, 3, 2, "SO-T-2")] })
  db.failOn["inventory:update"] = "conflict"
  const r = await soPost([storedLine(10, 2)])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "STORED_ITEM_CHANGED")
  assert.equal(db.tables.sales_orders.length, 1, "the new order is removed again")
  assert.equal(db.tables.sales_order_items.length, 0)
  assert.equal(db.tables.inventory.find((i) => i.inventory_id === 10)!.so_number, "SO-T-2")
})

// Sales order EDIT (owner, 2026-11-17)
const soPut = (items: any[]) => call(soRoute.PUT, "PUT", { id: "7", notes: "edited", items })
const editDb = (extra: Record<string, Row[]> = {}) =>
  mk({
    sales_orders: [{ ...so(7, "accountant_approved"), so_number: "SO-T-7" }],
    sales_order_items: [line(70, 7, null, 1, "outsourced")],
    inventory: [{ ...held(30, 3, 5, "SO-OTHER", "Pump"), unit_cost: 40 }],
    ...extra,
  })
const keepLine = { id: "70", productId: "", productName: "Outsourced thing", quantity: 1, unitPrice: 100, total: 100, itemType: "outsourced" }
const stockPick = (qty: number, extra: Row = {}) => ({ productId: "", productName: "Pump", quantity: qty, unitPrice: 60, total: 60 * qty, itemType: "stock", fromInventoryId: "30", ...extra })

test("SO edit: adding a stored item reserves it (split), the line points at the reserved row", async () => {
  const db = editDb()
  const r = await soPut([keepLine, stockPick(2)])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 30), 3)
  const split = db.tables.inventory.find((i) => i.so_number === "SO-T-7")!
  assert.equal(split.quantity, 2)
  const l = db.tables.sales_order_items.find((i) => i.so_id === 7 && i.outsourced_description)!
  assert.equal(l.outsourced_name, "Pump")
  assert.equal(l.outsourced_description, fromStockDescription(split.inventory_id, 30))
  assert.ok(l.fulfilled_at)
})

test("SO edit: the same edit saved twice (new line re-sent without its id) does not reserve twice", async () => {
  const db = editDb()
  assert.equal((await soPut([keepLine, stockPick(2)])).status, 200)
  const again = await soPut([keepLine, stockPick(2)])
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.equal(qty(db, 30), 3, "nothing more taken")
  assert.equal(db.tables.inventory.filter((i) => i.so_number === "SO-T-7").length, 1)
  const lines = db.tables.sales_order_items.filter((i) => i.so_id === 7 && i.outsourced_description)
  assert.equal(lines.length, 1)
})

test("SO edit: lowering or removing a from-stock line releases it as free stock; raising it reserves more", async () => {
  const db = editDb()
  await soPut([keepLine, stockPick(2)])
  const l = db.tables.sales_order_items.find((i) => i.so_id === 7 && i.outsourced_description)!
  const splitId = db.tables.inventory.find((i) => i.so_number === "SO-T-7")!.inventory_id
  const saved = { id: String(l.so_item_id), productId: "", productName: "Pump", quantity: 1, unitPrice: 60, total: 60, itemType: "outsourced" }
  assert.equal((await soPut([keepLine, saved])).status, 200)
  assert.equal(db.tables.sales_order_items.find((i) => i.so_item_id === l.so_item_id)!.outsourced_description, fromStockDescription(splitId, 30), "the marker is kept")
  let rows = (await (await inventoryRoute.GET()).json()) as any[]
  assert.equal(rows.find((x) => x.inventoryId === splitId).onHold, 1)
  assert.equal(rows.find((x) => x.inventoryId === splitId).available, 1, "lowered: 1 free again")
  // raised 1 -> 3: the 1 free on its own row first, then 1 more moved over from the row it was picked from
  const raised = await soPut([keepLine, { ...saved, quantity: 3 }])
  assert.equal(raised.status, 200, JSON.stringify(raised.body))
  assert.equal(qty(db, splitId), 3)
  assert.equal(qty(db, 30), 2)
  rows = (await (await inventoryRoute.GET()).json()) as any[]
  assert.equal(rows.find((x) => x.inventoryId === splitId).onHold, 3)
  // more than is free: a clear refusal, nothing moves
  const tooMuch = await soPut([keepLine, { ...saved, quantity: 10 }])
  assert.equal(tooMuch.status, 400)
  assert.equal(tooMuch.body.code, "STORED_ITEM_SHORT")
  assert.match(tooMuch.body.error, /Pump\. Requested: 7 more, Available: 2/)
  assert.equal(qty(db, splitId), 3)
  assert.equal(qty(db, 30), 2)
  assert.equal(db.tables.sales_order_items.find((i) => i.so_item_id === l.so_item_id)!.quantity, 3)
  assert.equal((await soPut([keepLine])).status, 200)
  rows = (await (await inventoryRoute.GET()).json()) as any[]
  assert.equal(rows.find((x) => x.inventoryId === splitId).onHold, 0, "removed: all free")
  assert.equal(rows.find((x) => x.inventoryId === splitId).available, 3)
})

test("SO edit: a raise that fails to save gives the moved quantity back", async () => {
  const db = editDb()
  await soPut([keepLine, stockPick(2)])
  const l = db.tables.sales_order_items.find((i) => i.so_id === 7 && i.outsourced_description)!
  const splitId = db.tables.inventory.find((i) => i.so_number === "SO-T-7")!.inventory_id
  db.failOn["sales_orders:update"] = "boom"
  const r = await soPut([keepLine, { id: String(l.so_item_id), productId: "", productName: "Pump", quantity: 4, unitPrice: 60, total: 240, itemType: "outsourced" }])
  assert.notEqual(r.status, 200)
  assert.equal(qty(db, splitId), 2)
  assert.equal(qty(db, 30), 3)
})

test("SO edit: a failed save undoes the reservation; more than is free is refused before anything is written", async () => {
  const db = editDb()
  db.failOn["sales_orders:update"] = "boom"
  const r = await soPut([keepLine, stockPick(2)])
  assert.notEqual(r.status, 200)
  assert.equal(qty(db, 30), 5)
  assert.equal(db.tables.inventory.length, 1, "the split row is removed again")
  delete db.failOn["sales_orders:update"]
  const tooMany = await soPut([keepLine, stockPick(6)])
  assert.equal(tooMany.status, 400)
  assert.equal(tooMany.body.code, "STORED_ITEM_SHORT")
  assert.equal(qty(db, 30), 5)
})

test("delivery permit of the new order takes the reserved stored item (lib/dp-stock.ts by so_number + name)", async () => {
  const db = mk({
    sales_orders: [{ ...so(7, "ready_for_delivery"), so_number: "SO-T-7" }],
    sales_order_items: [{ ...line(70, 7, null, 2, "outsourced"), outsourced_name: "Gearbox" }],
    delivery_permits: [permit(1, 7, "SUBMITTED_SIGNED")],
    delivery_permit_items: [{ ...pitem(1, 1, null, 2, 3), item_name_snapshot: "Gearbox" }],
    inventory: [held(10, 3, 2, "SO-T-7", "Gearbox")],
  })
  const r = await approve(1)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 10), 0)
})

test("a line taken from stock is never offered for a purchase order and needs no PO in the missing-items report", () => {
  const read = (p: string) => readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), p), "utf8")
  const po = read("components/modules/purchase-order-module.tsx")
  assert.match(po, /\.filter\(\(it: any\) => \(it\.itemType \|\| it\.item_type\) === "outsourced" && it\.id && !isFromStockLine\(it\)\)/)
  assert.match(po, /if \(!isOutsourced \|\| isFromStockLine\(item\)\) return false/)
  const mi = read("lib/missing-items.ts")
  assert.match(mi, /if \(fromStock && allPoLines\.length === 0\) procurementStatus = "Taken from stock — No PO Needed"/)
  assert.match(read("lib/missing-items-html.ts"), /"Taken from stock — No PO Needed", "مأخوذ من المخزون — لا يحتاج أمر شراء"/)
})

test("sales order screens: free stored items are offered by name with cost and available quantity (create, mixed layout, edit)", () => {
  const read = (p: string) => readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), p), "utf8")
  const s = read("components/modules/sales-order-module.tsx")
  assert.match(s, /const storedHere = freeStoredItems\(selectedWarehouseId\)/)
  assert.match(s, /isFreeStoredRow\(inv\) && \(warehouseId === "any" \|\| inv\.warehouseId === warehouseId\)/)
  assert.match(s, /fromInventoryId: item\.fromInventoryId,/)
  assert.match(s, /fromInventoryId: item\.productId\.slice\("stored-"\.length\)/, "mixed layout")
  assert.equal((s.match(/\{storedOptions\(\)\}/g) || []).length, 2, "equipment and maintenance selects")
  assert.match(s, /t\("so\.stored-item-label"\)/)
  const d = read("components/sales-order/edit-approved-order-dialog.tsx")
  assert.match(d, /fromInventoryId: item\.fromInventoryId, itemCategory: item\.itemCategory/)
  assert.match(d, /id: `stored-\$\{inv\.inventoryId \?\? inv\.id\}`/)
})

test("GET /api/inventory: a stored outsourced item shows its cost and stock value (owner, 2026-11-17)", async () => {
  mk({
    sales_orders: [so(1, "accountant_approved")],
    inventory: [{ ...held(9, 3, 4, "SO-T-1"), unit_cost: 880 }, { ...held(10, 3, 2, "SO-T-1"), unit_cost: "12.5" }, inv(4, 9, 1, 3)],
  })
  const rows = (await (await inventoryRoute.GET()).json()) as any[]
  const r9 = rows.find((r) => r.inventoryId === 9)
  assert.equal(r9.isOutsourced, true)
  assert.equal(r9.unitCost, 880)
  assert.equal(r9.totalValue, 3520)
  assert.equal(rows.find((r) => r.inventoryId === 10).unitCost, 12.5, "a numeric string from the database is a number")
  assert.equal(rows.find((r) => r.inventoryId === 10).totalValue, 25)
})

test("Sold tab: returned quantity is not sold; a line returned in full is not listed", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(process.env.REPO_ROOT || process.cwd(), "components/modules/inventory-module.tsx"), "utf8")
  assert.match(src, /const sold = \(Number\(item\.quantity\) \|\| 0\) - returned\s+if \(sold <= 0\) return/)
  assert.match(src, /quantity: sold,/)
})

// Inventory page tabs (owner, 2026-11-17)
test("On hand: catalogue stock and every outsourced item in a warehouse; used-up outsourced rows and returns outside a warehouse are not", () => {
  assert.equal(isOnHandRow({ productId: "7", quantity: 0 }), true, "catalogue stock at 0 is still listed (out of stock)")
  assert.equal(isOnHandRow({ productId: "7", quantity: 3, isReturned: true }), false, "returned catalogue goods wait on the Returns tab")
  assert.equal(isOnHandRow({ productId: "", isOutsourced: true, quantity: 2, warehouseId: 3 }), true)
  assert.equal(isOnHandRow({ productId: "", isOutsourced: true, quantity: 0, warehouseId: 3 }), false, "used up = gone, not out of stock")
  assert.equal(isOnHandRow({ productId: "", isOutsourced: true, isReturned: true, quantity: 1, warehouseId: 3 }), true, "an outsourced return in a warehouse is stock")
  assert.equal(isOnHandRow({ productId: "", isOutsourced: true, isReturned: true, quantity: 1, warehouseId: null }), false)
  const src = readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), "components/modules/inventory-module.tsx"), "utf8")
  assert.match(src, /filtered = filtered\.filter\(\(item\) => isOnHandRow\(item\)\)/)
})

const pendingInput = (over: Partial<Parameters<typeof computeDirectPending>[0]> = {}) =>
  computeDirectPending({
    grnLines: [{ po_item_id: 2, source_so_item_id: 28, quantity_received: 5, warehouse_id: null, item_type: "outsourced" }],
    poItems: [{ po_item_id: 2, po_id: 1, quantity: 5, unit_price: 2000, landed_cost: 10500, source_so_item_id: 28 }],
    pos: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, cost_finalized: false }],
    suppliers: [{ supplier_id: 1, supplier_name: "Supp A" }],
    soItems: [{ so_item_id: 28, so_id: 3, quantity: 5, unit_price: 2500, outsourced_name: "Gearbox", product_id: null }],
    orders: [{ so_id: 3, so_number: "SO-T-3", status: "accountant_approved", customer_id: 5 }],
    customers: [{ customer_id: 5, customer_name: "Al Kasrawy" }],
    permits: [],
    permitItems: [],
    ...over,
  })

test("Pending: an outsourced item received straight to the customer is pending for its order, with cost and supplier", () => {
  const [p] = pendingInput()
  assert.equal(p.quantity, 5)
  assert.equal(p.soNumber, "SO-T-3")
  assert.equal(p.customerName, "Al Kasrawy")
  assert.equal(p.name, "Gearbox")
  assert.equal(p.unitCost, 2000)
  assert.equal(p.unitPrice, 2500)
  assert.equal(p.supplierName, "Supp A")
  assert.equal(pendingInput({ pos: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, cost_finalized: true }] })[0].unitCost, 2100, "landed once finalized")
})

test("Pending: purchased into a warehouse is pending too (until its permit is signed); a permit takes it off; closed order = none", () => {
  const inWarehouse = (rowQty: number, permits: any[] = [], permitItems: any[] = []) =>
    pendingInput({
      grnLines: [{ po_item_id: 2, source_so_item_id: 28, quantity_received: 5, warehouse_id: 3, item_type: "outsourced" }],
      storedRows: [{ ...purchased(40, 3, rowQty, "SO-T-3", "Gearbox"), unit_cost: 2000 }] as any[],
      permits,
      permitItems,
    })
  const [w] = inWarehouse(5)
  assert.equal(w.quantity, 5)
  assert.equal(w.inWarehouse, 5)
  assert.equal(w.unitCost, 2000)
  const signed = inWarehouse(2, [{ permit_id: 1, sales_order_id: 3, status: "APPROVED" }], [{ permit_id: 1, product_id: null, item_name_snapshot: "Gearbox", quantity: 3 }])
  assert.equal(signed[0].quantity, 2, "3 delivered (taken from the row): 2 left")
  assert.equal(inWarehouse(0, [{ permit_id: 1, sales_order_id: 3, status: "APPROVED" }], [{ permit_id: 1, product_id: null, item_name_snapshot: "Gearbox", quantity: 5 }]).length, 0)
  // the order's line was removed: the purchased row is still the order's, still listed
  const orphan = pendingInput({ grnLines: [], soItems: [], storedRows: [{ ...purchased(40, 3, 2, "SO-T-3", "Gearbox"), unit_cost: 2000, supplier_name: "Supp A" }] as any[] })
  assert.equal(orphan.length, 1)
  assert.equal(orphan[0].quantity, 2)
  assert.equal(orphan[0].unitCost, 2000)
  const onDp = pendingInput({
    permits: [{ permit_id: 1, sales_order_id: 3, status: "DRAFT" }, { permit_id: 2, sales_order_id: 3, status: "REJECTED" }],
    permitItems: [{ permit_id: 1, product_id: null, item_name_snapshot: "gearbox ", quantity: 2 }, { permit_id: 2, product_id: null, item_name_snapshot: "Gearbox", quantity: 3 }],
  })
  assert.equal(onDp[0].quantity, 3, "5 received - 2 on a live permit (a rejected permit carries nothing)")
  assert.equal(pendingInput({ soItems: [{ so_item_id: 28, so_id: 3, quantity: 2, unit_price: 2500, outsourced_name: "Gearbox" }] })[0].quantity, 2)
  assert.equal(pendingInput({ orders: [{ so_id: 3, so_number: "SO-T-3", status: "cancelled", customer_id: 5 }] }).length, 0)
})

test("GET /api/inventory/pending lists the straight-to-customer items (FakeDb)", async () => {
  mk({
    goods_receipt_lines: [{ line_id: 1, po_item_id: 2, source_so_item_id: 28, quantity_received: 4, warehouse_id: null, item_type: "outsourced" }],
    purchase_order_items: [{ po_item_id: 2, po_id: 1, quantity: 5, unit_price: 100, landed_cost: null, source_so_item_id: 28 }],
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, cost_finalized: false }],
    suppliers: [{ supplier_id: 1, supplier_name: "Supp A" }],
    sales_orders: [so(3, "accountant_approved")],
    sales_order_items: [{ so_item_id: 28, so_id: 3, quantity: 5, unit_price: 150, outsourced_name: "Gearbox", product_id: null, item_type: "outsourced" }],
    customers: [{ customer_id: 5, customer_name: "Al Kasrawy" }],
  })
  const res = await pendingRoute.GET()
  const rows = (await res.json()) as any[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0].quantity, 4)
  assert.equal(rows[0].supplierName, "Supp A")
})

test("Sold cost of outsourced lines comes from the purchase order (landed when finalized), not the order's estimate", () => {
  const costs = computeOutsourcedLineCosts({
    soItems: [
      { so_item_id: 28, so_id: 3, outsourced_name: "Gearbox", outsourced_description: null, product_id: null },
      { so_item_id: 29, so_id: 3, outsourced_name: "Pump", outsourced_description: fromStockDescription(50, 30), product_id: null },
      { so_item_id: 30, so_id: 3, outsourced_name: "Belt", outsourced_description: null, product_id: null },
    ],
    poItems: [
      { po_item_id: 2, po_id: 1, quantity: 3, unit_price: 100, landed_cost: 330, source_so_item_id: 28 },
      { po_item_id: 3, po_id: 2, quantity: 1, unit_price: 200, landed_cost: null, source_so_item_id: 28 },
      { po_item_id: 4, po_id: 3, quantity: 1, unit_price: 999, landed_cost: null, source_so_item_id: 30 },
    ],
    pos: [
      { po_id: 1, status: "received", supplier_id: 1, cost_finalized: true },
      { po_id: 2, status: "received", supplier_id: 1, cost_finalized: false },
      { po_id: 3, status: "rejected", supplier_id: 1, cost_finalized: false },
    ],
    suppliers: [{ supplier_id: 1, supplier_name: "Supp A" }],
    reservedRows: [{ inventory_id: 50, unit_cost: 44, supplier_name: "Supp B" }],
  })
  assert.equal(costs.find((c) => c.soItemId === 28)!.unitCost, 132.5, "(3 x 110 landed + 1 x 200) / 4")
  assert.equal(costs.find((c) => c.soItemId === 28)!.supplierName, "Supp A")
  assert.equal(costs.find((c) => c.soItemId === 29)!.unitCost, 44, "taken from stock: its stock row's cost")
  assert.equal(costs.find((c) => c.soItemId === 30)!.unitCost, null, "a rejected PO does not count")
  const src = readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), "components/modules/inventory-module.tsx"), "utf8")
  assert.match(src, /fetch\("\/api\/inventory\/outsourced-costs"\)/)
  assert.doesNotMatch(src.slice(src.indexOf("const soldCostAndSupplier"), src.indexOf("const soldItems")), /costEstimate/)
})

test("Pending and Sold tabs on the screen: straight-to-customer rows, and Cost before Price, Supplier name before Customer", () => {
  const src = readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), "components/modules/inventory-module.tsx"), "utf8")
  assert.match(src, /fetch\("\/api\/inventory\/pending"\)/)
  assert.match(src, /dpStatus: RECEIVED_DIRECT,/)
  const sold = src.slice(src.indexOf('<TabsContent value="sold"'), src.indexOf('<TabsContent value="returns"'))
  const heads = [...sold.matchAll(/<(?:Num|Table)Head>\{t\("([^"]+)"\)/g)].map((m) => m[1])
  assert.ok(heads.indexOf("inventory.sold-cost") === heads.indexOf("field.unit-price") - 1, heads.join(","))
  assert.ok(heads.indexOf("inventory.sold-supplier") === heads.indexOf("field.customer") - 1, heads.join(","))
})
