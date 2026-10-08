// Batch 4E tests: weighted-average cost on goods receipt (POST /api/goods-receipts) and
// POST /api/purchase-orders/finalize-cost. REAL route handlers; only the database is the in-memory FakeDb.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as grnRoute from "../../app/api/goods-receipts/route"
import * as finalizeRoute from "../../app/api/purchase-orders/finalize-cost/route"
import { weightedAverageCost } from "../goods-receiving"

// ------------------------------------------------------------------------------------------ weighted average
function receiptDb(inventory: Row[]) {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "approved", total: 100000 }],
    purchase_order_items: [{ po_item_id: 1, po_id: 1, product_id: 7, quantity: 100, unit_price: 100, total: 10000, item_type: "stock" }],
    goods_receipts: [],
    goods_receipt_lines: [],
    inventory,
    inventory_batches: [],
    sales_orders: [],
    sales_order_items: [],
    idempotency_log: [],
  })
  useDb(db)
  return db
}
let k = 0
const receive = (qty: number, cost: number) =>
  call(grnRoute.POST, "POST", {
    poId: 1,
    receivedBy: 1,
    idempotencyKey: `cost-key-${++k}-${Math.random().toString(36).slice(2, 8)}`,
    lines: [{ poItemId: 1, quantityReceived: qty, warehouseId: 1, unitCost: cost }],
  })
const row = (db: FakeDb) => db.tables.inventory.filter((i) => i.product_id === 7 && i.is_returned === false)

test("costing: weightedAverageCost helper", () => {
  assert.equal(weightedAverageCost(10, 100, 10, 140), 120)
  assert.equal(weightedAverageCost(0, 90, 5, 100), 100) // no stock: the receipt cost
  assert.equal(weightedAverageCost(-3, 90, 5, 100), 100) // negative stock counts as none
  assert.equal(weightedAverageCost(null, null, 5, 100), 100)
  assert.equal(weightedAverageCost(5, null, 5, 100), 100) // unknown old cost: do not average against 0
  assert.equal(weightedAverageCost(3, 100, 4, 110), 105.71) // (3*100 + 4*110) / 7 = 105.714... -> 2 decimals
})

test("costing: first receipt (no inventory row) creates the row at the receipt cost", async () => {
  const db = receiveDb0()
  const r = await receive(10, 100)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(row(db).length, 1)
  assert.equal(row(db)[0].quantity, 10)
  assert.equal(row(db)[0].unit_cost, 100)
})
function receiveDb0() {
  return receiptDb([])
}

test("costing: 10 @100 then 10 @140 -> 20 units @120 (value 2400); batches stay as the audit record", async () => {
  const db = receiptDb([])
  await receive(10, 100)
  const r = await receive(10, 140)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(row(db)[0].quantity, 20)
  assert.equal(row(db)[0].unit_cost, 120)
  assert.equal(row(db)[0].quantity * row(db)[0].unit_cost, 2400)
  assert.deepEqual(db.tables.inventory_batches.map((b) => [b.quantity_received, b.unit_cost]), [[10, 100], [10, 140]])
})

test("costing: existing zero-stock row takes the receipt cost (not averaged with the stale cost)", async () => {
  const db = receiptDb([{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 0, unit_cost: 999, reorder_point: 0 }])
  await receive(5, 100)
  assert.equal(row(db)[0].quantity, 5)
  assert.equal(row(db)[0].unit_cost, 100)
})

test("costing: unequal costs and rounding to 2 decimals (5 @90 on hand + 3 @100 -> 8 @93.75; 3 @100 + 4 @110 -> 105.71)", async () => {
  const db = receiptDb([{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 5, unit_cost: 90, reorder_point: 0 }])
  await receive(3, 100)
  assert.equal(row(db)[0].quantity, 8)
  assert.equal(row(db)[0].unit_cost, 93.75)
  const db2 = receiptDb([{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 3, unit_cost: 100, reorder_point: 0 }])
  await receive(4, 110)
  assert.equal(row(db2)[0].unit_cost, 105.71)
})

test("costing: the returned-holding row is never averaged into", async () => {
  const db = receiptDb([
    { inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10, unit_cost: 100, reorder_point: 0 },
    { inventory_id: 101, product_id: 7, warehouse_id: 1, is_returned: true, quantity: 4, unit_cost: 5, reorder_point: 0 },
  ])
  await receive(10, 140)
  const ret = db.tables.inventory.find((i) => i.inventory_id === 101)!
  assert.deepEqual([ret.quantity, ret.unit_cost], [4, 5])
  assert.equal(db.tables.inventory.find((i) => i.inventory_id === 100)!.unit_cost, 120)
})

test("costing: concurrent receipts (10 @100 and 10 @140 on 10 @100) end at 30 units, cost independent of order", async () => {
  for (let i = 0; i < 15; i++) {
    const db = receiptDb([{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10, unit_cost: 100, reorder_point: 0 }])
    const [a, b] = await Promise.all([receive(10, 100), receive(10, 140)])
    assert.equal(a.status, 200, JSON.stringify(a.body))
    assert.equal(b.status, 200, JSON.stringify(b.body))
    assert.equal(row(db)[0].quantity, 30, `round ${i}`)
    // (10*100 + 10*100 + 10*140)/30 = 113.33 whichever applied first; rounding twice can differ by a cent
    assert.ok(Math.abs(row(db)[0].unit_cost - 113.33) <= 0.01, `round ${i}: ${row(db)[0].unit_cost}`)
  }
})

// ------------------------------------------------------------------------------------------ finalize-cost
function poDb(status: string, itemTotals: number[], po: Row = {}) {
  const sum = itemTotals.reduce((s, t) => s + t, 0)
  const db = new FakeDb({
    purchase_orders: [{ po_id: 6, po_number: "PO-T-6", status, total: Math.round(sum * 114) / 100, cost_finalized: false, ...po }],
    purchase_order_items: itemTotals.map((total, i) => ({ po_item_id: 10 + i, po_id: 6, product_id: 7 + i, quantity: 1, unit_price: total, total, allocated_tax: null, allocated_overhead: null, landed_cost: null })),
    idempotency_log: [],
  })
  useDb(db)
  return db
}
const finalize = (body: Row) => call(finalizeRoute.POST, "POST", { poId: 6, taxAmount: 0, otherCosts: 0, ...body })
const cents = (n: unknown) => Math.round(Number(n) * 100)
const items = (db: FakeDb) => db.tables.purchase_order_items
const sumOf = (db: FakeDb, col: string) => items(db).reduce((s, i) => s + cents(i[col]), 0)
const po = (db: FakeDb) => db.tables.purchase_orders[0]

test("costing: finalize allocates over item totals, not po.total (PO 6: items 10000, tax 1400, total 11400)", async () => {
  const db = poDb("received", [6000, 4000])
  assert.equal(po(db).total, 11400)
  const r = await finalize({ taxAmount: 1400 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(items(db).map((i) => i.allocated_tax), [840, 560]) // before: 6000/11400*1400 = 736.84 and 491.23 -> 1228.07 allocated
  assert.equal(sumOf(db, "allocated_tax"), 140000)
  assert.deepEqual(items(db).map((i) => i.landed_cost), [6840, 4560])
  assert.equal(po(db).cost_finalized, true)
  assert.equal(Number(po(db).tax_amount), 1400)
})

test("costing: allocated tax and overhead sum exactly to the inputs (remainder on the last item)", async () => {
  const db = poDb("received", [100, 100, 100])
  const r = await finalize({ taxAmount: 100, otherCosts: 50 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(items(db).map((i) => i.allocated_tax), [33.33, 33.33, 33.34])
  assert.equal(sumOf(db, "allocated_tax"), 10000)
  assert.equal(sumOf(db, "allocated_overhead"), 15000) // tax + other costs
  assert.equal(sumOf(db, "landed_cost"), 30000 + 15000)
  const db2 = poDb("partially_received", [1234.56, 789.01, 333.33, 10.1])
  await finalize({ taxAmount: 777.77, otherCosts: 12.34 })
  assert.equal(sumOf(db2, "allocated_tax"), 77777)
  assert.equal(sumOf(db2, "allocated_overhead"), 77777 + 1234)
})

test("costing: stable idempotency key po_finalize_cost_<poId>; a second submit is a no-op", async () => {
  const db = poDb("received", [6000, 4000])
  await finalize({ taxAmount: 1400 })
  assert.deepEqual(db.tables.idempotency_log.map((l) => [l.operation_type, l.idempotency_key, l.status]), [["po_finalize_cost", "po_finalize_cost_6", "completed"]])
  const again = await finalize({ taxAmount: 999 })
  assert.equal(again.status, 200)
  assert.equal(again.body.isDuplicate, true)
  assert.equal(db.calls["purchase_order_items:update"], 2) // only the first submit wrote the items
  assert.deepEqual(items(db).map((i) => i.allocated_tax), [840, 560])
})

test("costing: finalizing a PO that is already finalized (no idempotency record) is refused with 409", async () => {
  const db = poDb("received", [6000, 4000], { cost_finalized: true })
  const r = await finalize({ taxAmount: 1400 })
  assert.equal(r.status, 409)
  assert.equal(db.calls["purchase_order_items:update"] || 0, 0)
})

test("costing: concurrent double submit finalizes exactly once", async () => {
  for (let i = 0; i < 15; i++) {
    const db = poDb("received", [6000, 4000])
    const res = await Promise.all([finalize({ taxAmount: 1400 }), finalize({ taxAmount: 1400 }), finalize({ taxAmount: 1400 })])
    for (const r of res) assert.ok([200, 409].includes(r.status), JSON.stringify(r))
    assert.equal(res.filter((r) => r.status === 200 && r.body.success === true).length, 1, `round ${i}`)
    assert.equal(db.calls["purchase_order_items:update"], 2, `round ${i}: items written once`)
    assert.equal(po(db).cost_finalized, true)
    assert.equal(sumOf(db, "allocated_tax"), 140000)
  }
})

test("costing: a PO with a null cost_finalized flag can still be claimed", async () => {
  const db = poDb("received", [6000, 4000], { cost_finalized: null })
  const r = await finalize({ taxAmount: 1400 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(po(db).cost_finalized, true)
})

test("costing: refused (409) before anything was received; nothing written", async () => {
  for (const status of ["approved", "pending", "draft", "rejected"]) {
    const db = poDb(status, [6000, 4000])
    const before = JSON.stringify(db.tables.purchase_order_items)
    const r = await finalize({ taxAmount: 1400 })
    assert.equal(r.status, 409, status)
    assert.match(r.body.error, /received/i)
    assert.equal(JSON.stringify(db.tables.purchase_order_items), before)
    assert.equal(po(db).cost_finalized, false)
  }
  for (const status of ["received", "partially_received", "received_with_issues"]) {
    poDb(status, [6000, 4000])
    assert.equal((await finalize({ taxAmount: 1400 })).status, 200, status)
  }
})

test("costing: an item-update failure releases the claim, reports 500 truthfully, and the PO can be finalized afterwards", async () => {
  const db = poDb("received", [6000, 4000])
  db.failOn["purchase_order_items:update"] = "boom"
  db.failAfter["purchase_order_items:update"] = 0
  const r = await finalize({ taxAmount: 1400 })
  assert.equal(r.status, 500)
  assert.match(r.body.error, /boom/)
  assert.equal(po(db).cost_finalized, false)
  assert.equal(po(db).cost_finalized_at, null)
  assert.equal(db.tables.idempotency_log[0].status, "failed")
  delete db.failOn["purchase_order_items:update"]
  const retry = await finalize({ taxAmount: 1400 })
  assert.equal(retry.status, 200, JSON.stringify(retry.body))
  assert.equal(po(db).cost_finalized, true)
  assert.equal(sumOf(db, "allocated_tax"), 140000)
})

test("costing: failure after the first item was written releases the claim too", async () => {
  const db = poDb("received", [6000, 4000])
  db.failOn["purchase_order_items:update"] = "boom"
  db.failAfter["purchase_order_items:update"] = 1
  const r = await finalize({ taxAmount: 1400 })
  assert.equal(r.status, 500)
  assert.equal(po(db).cost_finalized, false)
})
