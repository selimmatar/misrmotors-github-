// Tests for the returns workflow (Batch 2): creation, validation, idempotency, concurrency, processing,
// holding inventory, restock / write-off, returned batches and the returned-quantity helpers. In-memory stand-in
// for Supabase (no network, no real database). Run (from the repo root):
//   npx tsc lib/payment-type.ts lib/return-lines.ts lib/returns.ts lib/invoicing.ts lib/__tests__/fake-db.ts \
//     lib/__tests__/returns.test.ts lib/__tests__/invoicing-returns.test.ts --outDir /tmp/ret-test \
//     --module commonjs --target es2020 --skipLibCheck --esModuleInterop && \
//   node --test /tmp/ret-test/__tests__/returns.test.js /tmp/ret-test/__tests__/invoicing-returns.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { createReturn, processReturn, rejectReturn, removeReturnedItem, restockReturnedItem } from "../returns"
import { loadReturnLines, netLineQuantities, returnedByKey, returnedTotalsByPermit, subtractReturns, toMs } from "../return-lines"

// ---------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------
// DP 1: APPROVED, SO 1: 100 x Pump (product 7) + 5 x Silicon Gun (outsourced, supplier 3)
// DP 2: OUT_FOR_DELIVERY, DP 3: SUBMITTED_SIGNED (20 Pump), DP 4: DRAFT, DP 5: APPROVED on SO 2 (30 Pump)
const dp = (permit_id: number, so: number, status: string) => ({ permit_id, permit_no: `DP-T-${permit_id}`, sales_order_id: so, customer_id: 5, status })
const dpi = (item_id: number, permit_id: number, product_id: number | null, name: string, quantity: any, extra: Row = {}) => ({
  item_id, permit_id, product_id, item_name_snapshot: name, sku_snapshot: product_id ? "SKU-7" : null, quantity, unit_price: 10000, supplier_id: null, outsourced_name: null, ...extra,
})
const HISTORICAL = {
  product_returns: [1, 2, 3, 4].map((id) => ({
    return_id: id, permit_id: `RET-17900000000${id}`, so_id: null, customer_id: 2, status: id === 4 ? "pending_warehouse" : "received",
    so_number: `SO-OLD-${id}`, customer_name: "Old Customer", total_items_returned: 1, created_at: "2026-09-06T16:07:47.2+00:00",
  })),
  return_items: [1, 2, 3, 4].map((id) => ({
    return_item_id: id, return_id: id, product_id: 7, product_name: "Pump", original_quantity: 40, returned_quantity: 2,
    return_reason: "wrong_item", item_condition: "good", restocked: id !== 4, unit_cost: 21600, is_outsourced: false,
  })),
  inventory_batches: [
    { batch_id: 5, product_id: 7, po_number: null, quantity_received: 2, quantity_available: 2, unit_cost: 21600, received_date: "2020-01-01", batch_sequence: 2, warehouse_id: 1, is_returned: true },
    { batch_id: 8, product_id: 7, po_number: null, quantity_received: 1, quantity_available: 1, unit_cost: 26000, received_date: "2020-01-02", batch_sequence: 3, warehouse_id: 1, is_returned: true },
  ],
  supplier_credits: [{ credit_id: 1, supplier_id: 3, amount: 4000, credit_type: "return", reference_type: "inventory", status: "active" }],
}

function seed(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-T-1", customer_id: 5 },
      { so_id: 2, so_number: "SO-T-2", customer_id: 5 },
    ],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    suppliers: [{ supplier_id: 3, supplier_name: "Mostafa Co" }],
    warehouses: [{ warehouse_id: 1 }, { warehouse_id: 2 }],
    delivery_permits: [dp(1, 1, "APPROVED"), dp(2, 1, "OUT_FOR_DELIVERY"), dp(3, 1, "SUBMITTED_SIGNED"), dp(4, 1, "DRAFT"), dp(5, 2, "APPROVED")],
    delivery_permit_items: [
      dpi(11, 1, 7, "Pump", "100"),
      dpi(12, 1, null, "Silicon Gun", 5, { supplier_id: 3, outsourced_name: "Mostafa Co", unit_price: 9600 }),
      dpi(21, 2, 7, "Pump", 10),
      dpi(31, 3, 7, "Pump", 20),
      dpi(41, 4, 7, "Pump", 10),
      dpi(51, 5, 7, "Pump", 30),
    ],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10, unit_cost: 5000, reorder_point: 10 }],
    product_returns: HISTORICAL.product_returns,
    return_items: HISTORICAL.return_items,
    inventory_batches: HISTORICAL.inventory_batches,
    supplier_credits: HISTORICAL.supplier_credits,
    ...extra,
  })
}

let keyCounter = 0
const newKey = () => `test-key-${++keyCounter}-${Math.random().toString(36).slice(2, 8)}`
const pump = (qty: any, extra: Row = {}) => ({ productId: 7, productName: "Pump", quantityReturned: qty, reason: "wrong_item", condition: "good", ...extra })
const gun = (qty: any, extra: Row = {}) => ({ productName: "Silicon Gun", quantityReturned: qty, reason: "damaged", condition: "good", ...extra })

async function create(db: FakeDb, items: any[], opts: { permitId?: any; key?: string; extra?: Row } = {}) {
  return createReturn(db, { permitId: opts.permitId ?? 1, idempotencyKey: opts.key ?? newKey(), items, createdBy: "tester", ...opts.extra })
}
const newReturns = (db: FakeDb) => db.tables.product_returns.filter((r) => r.return_id > 4)
const returnedTotal = (db: FakeDb, permit = 1) =>
  newReturns(db).filter((r) => r.permit_id === String(permit) && r.status !== "rejected").flatMap((r) => db.tables.return_items.filter((i) => i.return_id === r.return_id)).reduce((s, i) => s + i.returned_quantity, 0)
const assignAll = (db: FakeDb, returnId: number, warehouseId = 1) =>
  db.tables.return_items.filter((i) => i.return_id === returnId).map((i) => ({ returnItemId: i.return_item_id, warehouseId }))
const holdingRows = (db: FakeDb) => db.tables.inventory.filter((r) => r.is_returned)
const sellable = (db: FakeDb, product = 7, wh = 1) => db.tables.inventory.find((r) => r.product_id === product && r.warehouse_id === wh && !r.is_returned)

// ---------------------------------------------------------------------------------------------------------
// 1-8. Creation + validation
// ---------------------------------------------------------------------------------------------------------
test("1 + linkage. valid return is stored against the real DP and SO, with server-derived details", async () => {
  const db = seed()
  const res = await create(db, [pump(30), gun(2, { condition: "damaged" })], { extra: { soId: 1, customerId: "5", customerName: "IGNORED", notes: "n" } })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const ret = newReturns(db)[0]
  assert.equal(ret.return_id, res.body.returnId)
  assert.equal(ret.permit_id, "1") // the real DP id, never RET-<timestamp>
  assert.equal(ret.so_id, 1)
  assert.equal(ret.so_number, "SO-T-1")
  assert.equal(ret.customer_id, 5)
  assert.equal(ret.customer_name, "Test Customer") // from the DB, not the browser
  assert.equal(ret.status, "pending_warehouse")
  assert.equal(ret.total_items_returned, 2)
  const items = db.tables.return_items.filter((i) => i.return_id === ret.return_id)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => [i.product_id, i.product_name, i.returned_quantity, i.original_quantity, i.item_condition, i.is_outsourced]), [
    [7, "Pump", 30, 100, "good", false],
    [null, "Silicon Gun", 2, 5, "damaged", true],
  ])
  assert.equal(items[1].supplier_name, "Mostafa Co")
})

test("2. unknown DP -> 404, malformed DP id -> 400; nothing created", async () => {
  const db = seed()
  assert.equal((await create(db, [pump(1)], { permitId: 999 })).status, 404)
  assert.equal((await create(db, [pump(1)], { permitId: "RET-1790257022809" })).status, 400)
  assert.equal((await createReturn(db, { idempotencyKey: newKey(), items: [pump(1)] })).status, 400) // no permit at all
  assert.equal(newReturns(db).length, 0)
})

test("3. returns are accepted from OUT_FOR_DELIVERY (customer refuses at the door) and from delivered permits", async () => {
  for (const [permit, status] of [[2, "OUT_FOR_DELIVERY"], [3, "SUBMITTED_SIGNED"], [1, "APPROVED"]] as const) {
    const db = seed()
    assert.equal(db.tables.delivery_permits.find((p) => p.permit_id === permit)!.status, status)
    const res = await create(db, [pump(1)], { permitId: permit })
    assert.equal(res.status, 200, `${status}: ${JSON.stringify(res.body)}`)
    const ret = newReturns(db)[0]
    assert.equal(ret.permit_id, String(permit)) // always linked to the actual DP ...
    assert.equal(ret.so_id, 1) // ... and its sales order
  }
})

test("3. returns are refused for every other permit status", async () => {
  for (const status of ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED", "READY_FOR_PICKUP", "REJECTED", "CANCELLED", "SOMETHING_ELSE"]) {
    const db = seed()
    db.tables.delivery_permits.find((p) => p.permit_id === 1)!.status = status
    const res = await create(db, [pump(1)], { permitId: 1 })
    assert.equal(res.status, 409, status)
    assert.match(res.body.error, /only allowed for permits that are out for delivery or delivered/)
    assert.equal(newReturns(db).length, 0, status)
  }
})

test("3. a return from an OUT_FOR_DELIVERY permit can be processed into the holding row like any other", async () => {
  const db = seed()
  const id = (await create(db, [pump(4)], { permitId: 2 })).body.returnId
  assert.equal((await proc(db, id)).status, 200)
  assert.equal(holdingRows(db)[0].quantity, 4)
  assert.equal(db.tables.product_returns.find((r) => r.return_id === id)!.permit_id, "2")
})

test("4. a product that is not on the DP is rejected (by id, by name, by foreign line id)", async () => {
  const db = seed()
  assert.equal((await create(db, [pump(1, { productId: 99 })])).status, 400)
  assert.equal((await create(db, [gun(1, { productName: "Unknown Thing" })])).status, 400)
  assert.equal((await create(db, [pump(1, { permitItemId: 51 })])).status, 400) // line of another DP
  assert.equal((await create(db, [pump(1, { permitItemId: 11, productId: 8 })])).status, 400) // id/line mismatch
  assert.equal((await create(db, [pump(1, { permitItemId: 11 })], { permitId: 1 })).status, 200)
  assert.equal(newReturns(db).length, 1)
})

test("customer / SO supplied by the browser must match the DP", async () => {
  const db = seed()
  assert.equal((await create(db, [pump(1)], { extra: { customerId: 6 } })).status, 400)
  assert.equal((await create(db, [pump(1)], { extra: { soId: 2 } })).status, 400)
  assert.equal(newReturns(db).length, 0)
})

test("5-6. zero, negative, fractional and non-numeric quantities are rejected", async () => {
  const db = seed()
  for (const bad of [0, -3, "0", "-1", 1.5, "abc", null, undefined, NaN, Infinity, ""]) {
    const res = await create(db, [pump(bad)])
    assert.equal(res.status, 400, `quantity ${String(bad)}`)
  }
  assert.equal((await create(db, [])).status, 400)
  assert.equal((await create(db, [pump(2, { condition: "weird" })])).status, 400)
  assert.equal(newReturns(db).length, 0)
  assert.equal((await create(db, [pump("3")])).status, 200) // numeric string is fine
})

test("7. cannot return more than was delivered on the DP", async () => {
  const db = seed()
  const res = await create(db, [pump(101)])
  assert.equal(res.status, 409)
  assert.match(res.body.error, /only 100 of 100 delivered/)
  const dup = await create(db, [pump(60), pump(60)]) // same product twice in one request counts together
  assert.equal(dup.status, 409)
  assert.equal(newReturns(db).length, 0)
})

test("8, 10. cumulative returns: 40 ok, 50 ok, 20 rejected (only 10 left), 10 ok, then nothing", async () => {
  const db = seed()
  assert.equal((await create(db, [pump(40)])).status, 200)
  assert.equal((await create(db, [pump(50)])).status, 200)
  const over = await create(db, [pump(20)])
  assert.equal(over.status, 409)
  assert.match(over.body.error, /only 10 of 100/)
  assert.equal((await create(db, [pump(10)])).status, 200)
  assert.equal((await create(db, [pump(1)])).status, 409)
  assert.equal(returnedTotal(db), 100)
})

test("returns on other DPs and the historical returns do not count against this DP", async () => {
  const db = seed()
  assert.equal((await create(db, [pump(30)], { permitId: 5 })).status, 200) // DP 5 (other SO)
  assert.equal((await create(db, [pump(20)], { permitId: 3 })).status, 200) // DP 3 (same SO, other DP)
  assert.equal((await create(db, [pump(100)], { permitId: 1 })).status, 200) // DP 1 untouched by either
})

test("9. a rejected return does not consume returnable quantity", async () => {
  const db = seed()
  const first = await create(db, [pump(100)])
  assert.equal(first.status, 200)
  assert.equal((await create(db, [pump(1)])).status, 409) // fully returned
  db.tables.product_returns.find((r) => r.return_id === first.body.returnId)!.status = "rejected"
  assert.equal((await create(db, [pump(100)])).status, 200) // quantity is available again
})

// ---------------------------------------------------------------------------------------------------------
// 11. Idempotency
// ---------------------------------------------------------------------------------------------------------
test("11. same idempotency key replays safely; different payload/permit keys do not collide", async () => {
  const db = seed()
  const key = newKey()
  const first = await create(db, [pump(10)], { key })
  const second = await create(db, [pump(10)], { key })
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(second.body.isDuplicate, true)
  assert.equal(second.body.returnId, first.body.returnId)
  assert.equal(newReturns(db).length, 1)
  assert.equal(returnedTotal(db), 10)
  assert.equal((await create(db, [pump(10)], { key: "missing" })).status, 400) // key must be well formed
  assert.equal((await createReturn(db, { permitId: 1, items: [pump(1)] })).status, 400) // key is required
})

test("11. a key that is still processing is rejected; a failed key can be retried", async () => {
  const db = seed()
  const key = newKey()
  // a request that is "in flight"
  db.tables.idempotency_log = [{ id: 1, operation_type: "return_create", idempotency_key: `ret_1_${key}`, entity_type: "delivery_permit", entity_id: 1, status: "processing" }]
  const blocked = await create(db, [pump(1)], { key })
  assert.equal(blocked.status, 409)
  assert.equal(newReturns(db).length, 0)

  // a failed attempt (validation) must not block the legitimate retry with the same key
  const retryKey = newKey()
  assert.equal((await create(db, [pump(500)], { key: retryKey })).status, 409)
  const retry = await create(db, [pump(5)], { key: retryKey })
  assert.equal(retry.status, 200)
  assert.equal(newReturns(db).length, 1)
})

test("11. concurrent double-submit with ONE key creates exactly one return", async () => {
  for (let run = 0; run < 15; run++) {
    const db = seed()
    const key = newKey()
    const results = await Promise.all(Array.from({ length: 4 }, () => create(db, [pump(30)], { key })))
    assert.equal(newReturns(db).length, 1, `run ${run}`)
    assert.equal(results.filter((r) => r.status === 200 && !r.body.isDuplicate).length, 1)
    assert.ok(results.every((r) => r.status === 200 || r.status === 409))
  }
})

// ---------------------------------------------------------------------------------------------------------
// 12. Concurrent creation (+ negative control)
// ---------------------------------------------------------------------------------------------------------
test("12. concurrent returns never exceed the delivered quantity (lowest return id wins)", async () => {
  for (let run = 0; run < 40; run++) {
    const db = seed()
    const results = await Promise.all(Array.from({ length: 5 }, () => create(db, [pump(30)])))
    const total = returnedTotal(db)
    assert.ok(total <= 100, `run ${run}: returned ${total} of 100`)
    assert.ok(total >= 30, `run ${run}: at least the first request must succeed`)
    const ok = results.filter((r) => r.status === 200).length
    assert.equal(ok, total / 30, `run ${run}: every success is a stored return and vice versa`)
    assert.ok(results.every((r) => r.status === 200 || r.status === 409), `run ${run}: ${JSON.stringify(results.map((r) => r.status))}`)
    assert.equal(newReturns(db).length, ok) // losers left nothing behind
    assert.equal(db.tables.return_items.filter((i) => i.return_id > 4).length, ok)
  }
})

test("12 (negative control). WITHOUT the re-check the same race over-returns, so the test above can detect it", async () => {
  // check -> insert only: what a "SELECT remaining; INSERT" implementation does
  async function naiveCreate(db: FakeDb) {
    const lines = await loadReturnLines(db, [1])
    if (returnedByKey(lines, { permitId: 1 }).get("p:7")! + 30 > 100) return 409
    const { data } = await db.from("product_returns").insert({ permit_id: "1", status: "pending_warehouse" }).select().single()
    await db.from("return_items").insert({ return_id: data.return_id, product_id: 7, product_name: "Pump", returned_quantity: 30 })
    return 200
  }
  // pre-existing 80 returned so only ONE more request of 30 can be right... but 5 racers all pass the pre-check
  let violations = 0
  for (let run = 0; run < 40; run++) {
    const db = seed()
    await Promise.all(Array.from({ length: 5 }, () => naiveCreate(db)))
    if (returnedTotal(db) > 100) violations++
  }
  assert.ok(violations > 0, "the naive implementation should over-return in at least one run")
})

test("D. a failed items insert removes the half-created return and reports failure", async () => {
  const db = seed()
  db.failOn["return_items:insert"] = "disk full"
  const key = newKey()
  const res = await create(db, [pump(10)], { key })
  assert.equal(res.status, 500)
  assert.equal(newReturns(db).length, 0)
  assert.equal(db.tables.return_items.filter((i) => i.return_id > 4).length, 0)
  delete db.failOn["return_items:insert"]
  const retry = await create(db, [pump(10)], { key }) // the key was released, so the retry works
  assert.equal(retry.status, 200)
  assert.equal(newReturns(db).length, 1)
})

test("D. if the half-created return cannot be removed the failure is flagged for manual review", async () => {
  const db = seed()
  db.failOn["return_items:insert"] = "disk full"
  db.failOn["product_returns:delete"] = "cannot delete"
  const key = newKey()
  const res = await create(db, [pump(10)], { key })
  assert.equal(res.status, 500)
  assert.equal(res.body.partialFailure, true)
  const retry = await create(db, [pump(10)], { key })
  assert.equal(retry.status, 409) // parked: never replayed blindly
  assert.equal(retry.body.partialFailure, true)
})

// ---------------------------------------------------------------------------------------------------------
// 13-15, 22, 23. Processing
// ---------------------------------------------------------------------------------------------------------
async function pendingReturn(db: FakeDb, items: any[] = [pump(40)]) {
  const res = await create(db, items)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body.returnId as number
}
const proc = (db: FakeDb, returnId: number, assignments?: any[]) =>
  processReturn(db, { returnId, status: "completed", processedBy: "wh", warehouseAssignments: assignments ?? assignAll(db, returnId) })

test("23. processing puts GOOD items into the holding row (is_returned) and tags a returned batch; sellable stock is untouched", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(40), gun(2)])
  const res = await proc(db, id)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.heldItems, 2)
  const holding = holdingRows(db)
  assert.equal(holding.length, 2)
  const pumpHold = holding.find((r) => r.product_id === 7)!
  assert.deepEqual([pumpHold.quantity, pumpHold.warehouse_id, pumpHold.is_returned, pumpHold.so_number], [40, 1, true, "SO-T-1"])
  const gunHold = holding.find((r) => !r.product_id)!
  assert.deepEqual([gunHold.quantity, gunHold.is_outsourced, gunHold.outsourced_name], [2, true, "Silicon Gun"])
  assert.equal(sellable(db)!.quantity, 10) // sellable stock unchanged
  const batch = db.tables.inventory_batches.find((b) => b.po_number === `RET-${id}`)!
  assert.deepEqual([batch.quantity_available, batch.is_returned, batch.product_id], [40, true, 7])
  const ret = db.tables.product_returns.find((r) => r.return_id === id)!
  assert.equal(ret.status, "received")
  assert.ok(db.tables.return_items.filter((i) => i.return_id === id).every((i) => i.restocked === true))
  // a second return for the same product/warehouse merges into the same holding row
  const id2 = await pendingReturn(db, [pump(10)])
  assert.equal((await proc(db, id2)).status, 200)
  assert.equal(holdingRows(db).find((r) => r.product_id === 7)!.quantity, 50)
})

test("22. damaged / defective / unsellable items never enter stock but stay tracked on the return", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(3, { condition: "damaged" }), pump(2, { condition: "good" }), gun(1, { condition: "defective" })])
  const before = db.tables.inventory.length
  const res = await proc(db, id)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.heldItems, 1)
  assert.equal(res.body.notRestockable, 2)
  assert.equal(holdingRows(db).length, 1)
  assert.equal(holdingRows(db)[0].quantity, 2) // only the good pumps
  assert.equal(db.tables.inventory.length, before + 1)
  assert.equal(sellable(db)!.quantity, 10)
  const items = db.tables.return_items.filter((i) => i.return_id === id)
  assert.equal(items.length, 3) // still tracked
  assert.deepEqual(items.map((i) => i.restocked), [false, true, false])

  // all-bad return: completes without touching inventory at all
  const bad = await pendingReturn(db, [pump(4, { condition: "unsellable" })])
  const snapshot = JSON.stringify(db.tables.inventory)
  assert.equal((await proc(db, bad, [])).status, 200)
  assert.equal(JSON.stringify(db.tables.inventory), snapshot)
  assert.equal(db.tables.inventory_batches.filter((b) => b.po_number === `RET-${bad}`).length, 0)
})

test("processing uses the STORED quantity/condition, not what the browser sends; missing / unknown warehouse is rejected up front", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(7)])
  const itemId = db.tables.return_items.find((i) => i.return_id === id)!.return_item_id
  assert.equal((await proc(db, id, [])).status, 400) // no warehouse for a good item
  assert.equal((await proc(db, id, [{ returnItemId: itemId, warehouseId: 99 }])).status, 400)
  assert.equal(db.tables.product_returns.find((r) => r.return_id === id)!.status, "pending_warehouse")
  const res = await proc(db, id, [{ returnItemId: itemId, warehouseId: 2, quantityReturned: 9999, condition: "damaged" }])
  assert.equal(res.status, 200)
  assert.deepEqual(holdingRows(db).map((r) => [r.warehouse_id, r.quantity]), [[2, 7]])
})

test("13. processing the same return twice adds stock once (received -> received is refused)", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(40)])
  assert.equal((await proc(db, id)).status, 200)
  const again = await proc(db, id)
  assert.equal(again.status, 409)
  assert.equal(again.body.currentStatus, "received")
  assert.equal(holdingRows(db)[0].quantity, 40)
  assert.equal(db.tables.inventory_batches.filter((b) => b.po_number === `RET-${id}`).length, 1)
})

test("other status changes cannot bypass the workflow", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(5)])
  for (const status of ["restocked", "rejected", "pending_warehouse", "assigned_warehouse", "bogus", undefined]) {
    const res = await processReturn(db, { returnId: id, status, warehouseAssignments: assignAll(db, id) })
    assert.equal(res.status, 400, String(status))
  }
  assert.equal((await processReturn(db, { returnId: 99999, status: "completed" })).status, 404)
  assert.equal((await processReturn(db, { returnId: "x", status: "completed" })).status, 400)
  assert.equal(db.tables.product_returns.find((r) => r.return_id === id)!.status, "pending_warehouse")
  assert.equal(holdingRows(db).length, 0)
})

test("14. concurrent processing: exactly one request wins and stock is added once", async () => {
  for (let run = 0; run < 30; run++) {
    const db = seed()
    const id = await pendingReturn(db, [pump(40), gun(2)])
    const results = await Promise.all(Array.from({ length: 5 }, () => proc(db, id)))
    assert.equal(results.filter((r) => r.status === 200).length, 1, `run ${run}: ${JSON.stringify(results.map((r) => r.status))}`)
    assert.ok(results.every((r) => r.status === 200 || r.status === 409))
    assert.equal(holdingRows(db).find((r) => r.product_id === 7)!.quantity, 40, `run ${run}`)
    assert.equal(holdingRows(db).filter((r) => !r.product_id).length, 1)
    assert.equal(db.tables.inventory_batches.filter((b) => b.po_number === `RET-${id}`).length, 1)
  }
})

test("14 (negative control). a check-then-act processor double-adds under the same race", async () => {
  async function naiveProcess(db: FakeDb, returnId: number) {
    const { data: ret } = await db.from("product_returns").select("*").eq("return_id", returnId).maybeSingle()
    if (ret.status !== "pending_warehouse") return 409
    const { data: existing } = await db.from("inventory").select("*").eq("product_id", 7).eq("warehouse_id", 1).eq("is_returned", true).maybeSingle()
    if (existing) await db.from("inventory").update({ quantity: existing.quantity + 40 }).eq("inventory_id", existing.inventory_id)
    else await db.from("inventory").insert({ product_id: 7, warehouse_id: 1, is_returned: true, quantity: 40 })
    await db.from("product_returns").update({ status: "received" }).eq("return_id", returnId)
    return 200
  }
  let violations = 0
  for (let run = 0; run < 30; run++) {
    const db = seed()
    const id = await pendingReturn(db, [pump(40)])
    const results = await Promise.all(Array.from({ length: 5 }, () => naiveProcess(db, id)))
    if (results.filter((r) => r === 200).length > 1) violations++ // several requests "processed" the same return
  }
  assert.ok(violations > 0, "the naive processor should process the same return more than once in at least one run")
})

test("15. an inventory write failure fails the request, undoes partial work and leaves the return retryable", async () => {
  const db = seed()
  const id = await pendingReturn(db, [gun(2), pump(40)]) // outsourced row is written first, then the product row
  const stockBefore = JSON.stringify(db.tables.inventory)

  for (const failing of ["inventory_batches:insert", "inventory:insert", "return_items:update"]) {
    db.failOn[failing] = "boom"
    const res = await proc(db, id)
    assert.equal(res.status, 500, failing)
    assert.notEqual(res.body.success, true)
    assert.equal(JSON.stringify(db.tables.inventory), stockBefore, `${failing}: stock restored`)
    assert.equal(db.tables.inventory_batches.filter((b) => b.po_number === `RET-${id}`).length, 0, failing)
    assert.equal(db.tables.product_returns.find((r) => r.return_id === id)!.status, "pending_warehouse", failing)
    assert.ok(db.tables.return_items.filter((i) => i.return_id === id).every((i) => !i.restocked), failing)
    delete db.failOn[failing]
  }
  const ok = await proc(db, id) // the same return can now be processed normally, exactly once
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(holdingRows(db).length, 2)
})

test("15. failure while ADDING to an existing holding row is undone too", async () => {
  const db = seed()
  const first = await pendingReturn(db, [pump(10)])
  assert.equal((await proc(db, first)).status, 200)
  const second = await pendingReturn(db, [pump(5)])
  db.failOn["inventory_batches:insert"] = "boom"
  assert.equal((await proc(db, second)).status, 500)
  assert.equal(holdingRows(db)[0].quantity, 10) // the 5 added to the holding row was taken off again
  assert.equal(db.tables.product_returns.find((r) => r.return_id === second)!.status, "pending_warehouse")
})

test("15. if the undo itself fails the request reports a partial failure and the return is NOT retryable", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(40)])
  db.failOn["inventory_batches:insert"] = "boom"
  db.failOn["inventory:delete"] = "undo blocked"
  const res = await proc(db, id)
  assert.equal(res.status, 500)
  assert.equal(res.body.partialFailure, true)
  assert.equal(db.tables.product_returns.find((r) => r.return_id === id)!.status, "assigned_warehouse")
  delete db.failOn["inventory_batches:insert"]
  delete db.failOn["inventory:delete"]
  assert.equal((await proc(db, id)).status, 409) // never silently re-run on top of unknown state
})

// ---------------------------------------------------------------------------------------------------------
// 16-18, K. Restock / write-off
// ---------------------------------------------------------------------------------------------------------
async function withHolding(db: FakeDb, qty = 40) {
  const id = await pendingReturn(db, [pump(qty)])
  assert.equal((await proc(db, id)).status, 200)
  return { returnId: id, holding: holdingRows(db).find((r) => r.product_id === 7)! }
}

test("16. restock moves the holding quantity into sellable stock exactly once; the second call adds nothing", async () => {
  const db = seed()
  const { returnId, holding } = await withHolding(db, 40)
  const res = await restockReturnedItem(db, { inventoryId: holding.inventory_id })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(sellable(db)!.quantity, 50)
  assert.equal(holdingRows(db).length, 0)
  const again = await restockReturnedItem(db, { inventoryId: holding.inventory_id })
  assert.ok([404, 409].includes(again.status), String(again.status))
  assert.equal(sellable(db)!.quantity, 50)
  // K: its returned batch became an ordinary batch; the historical stale returned batches are untouched
  const batch = db.tables.inventory_batches.find((b) => b.po_number === `RET-${returnId}`)!
  assert.deepEqual([batch.is_returned, batch.quantity_available], [false, 40])
  assert.deepEqual(db.tables.inventory_batches.filter((b) => b.batch_id <= 8).map((b) => [b.is_returned, b.quantity_available]), [[true, 2], [true, 1]])
})

test("16. restock creates the sellable row when none exists; refuses a row that is not a pending return", async () => {
  const db = seed()
  const { holding } = await withHolding(db, 6)
  db.tables.inventory = db.tables.inventory.filter((r) => r.is_returned) // no sellable row
  assert.equal((await restockReturnedItem(db, { inventoryId: holding.inventory_id })).status, 200)
  assert.equal(sellable(db)!.quantity, 6)
  assert.equal((await restockReturnedItem(db, { inventoryId: sellable(db)!.inventory_id })).status, 400) // sellable row
  assert.equal(sellable(db)!.quantity, 6)
  assert.equal((await restockReturnedItem(db, {})).status, 400)
  assert.equal((await restockReturnedItem(db, { inventoryId: 99999 })).status, 404)
})

test("16. restocking an outsourced return clears the flag once", async () => {
  const db = seed()
  const id = await pendingReturn(db, [gun(2)])
  assert.equal((await proc(db, id)).status, 200)
  const row = holdingRows(db)[0]
  assert.equal((await restockReturnedItem(db, { inventoryId: row.inventory_id })).status, 200)
  assert.equal(db.tables.inventory.find((r) => r.inventory_id === row.inventory_id)!.is_returned, false)
  assert.equal((await restockReturnedItem(db, { inventoryId: row.inventory_id })).status, 400)
})

test("17. concurrent restock: one request wins, quantity is added once", async () => {
  for (let run = 0; run < 30; run++) {
    const db = seed()
    const { holding } = await withHolding(db, 40)
    const results = await Promise.all(Array.from({ length: 5 }, () => restockReturnedItem(db, { inventoryId: holding.inventory_id })))
    assert.equal(results.filter((r) => r.status === 200).length, 1, `run ${run}: ${JSON.stringify(results.map((r) => r.status))}`)
    assert.ok(results.every((r) => [200, 404, 409].includes(r.status)))
    assert.equal(sellable(db)!.quantity, 50, `run ${run}`)
    assert.equal(holdingRows(db).length, 0)
  }
})

test("17 (negative control). the old read-add-delete restock reports success for every racer", async () => {
  async function oldRestock(db: FakeDb, inventoryId: number) {
    const { data: held } = await db.from("inventory").select("*").eq("inventory_id", inventoryId).maybeSingle()
    if (!held || !held.is_returned) return 404
    const { data: main } = await db.from("inventory").select("*").eq("product_id", 7).eq("warehouse_id", 1).eq("is_returned", false).maybeSingle()
    await db.from("inventory").update({ quantity: main.quantity + held.quantity }).eq("inventory_id", main.inventory_id)
    await db.from("inventory").delete().eq("inventory_id", inventoryId)
    return 200
  }
  let violations = 0
  for (let run = 0; run < 20; run++) {
    const db = seed()
    const { holding } = await withHolding(db, 40)
    const results = await Promise.all(Array.from({ length: 5 }, () => oldRestock(db, holding.inventory_id)))
    if (results.filter((r) => r === 200).length > 1) violations++
  }
  assert.ok(violations > 0, "the old implementation lets several requests 'restock' the same row")
})

test("16/J. restock failure puts the holding row back and changes nothing else", async () => {
  const db = seed()
  const { holding } = await withHolding(db, 40)
  db.failOn["inventory:update"] = "boom"
  const res = await restockReturnedItem(db, { inventoryId: holding.inventory_id })
  assert.equal(res.status, 500)
  const back = db.tables.inventory.find((r) => r.inventory_id === holding.inventory_id)!
  assert.deepEqual([back.is_returned, back.quantity], [true, 40])
  assert.equal(sellable(db)!.quantity, 10)
  delete db.failOn["inventory:update"]
  assert.equal((await restockReturnedItem(db, { inventoryId: holding.inventory_id })).status, 200) // and it can be retried
  assert.equal(sellable(db)!.quantity, 50)
})

test("18. write-off happens once: one supplier credit, no second removal; a sellable row is never deleted", async () => {
  const db = seed()
  const { returnId, holding } = await withHolding(db, 4)
  const input = { inventoryId: holding.inventory_id, supplierNameId: 3, productName: "Pump", quantity: 9999, unitCost: 1 }
  const res = await removeReturnedItem(db, input)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(holdingRows(db).length, 0)
  const credits = db.tables.supplier_credits.filter((c) => c.credit_id > 1)
  assert.equal(credits.length, 1)
  assert.equal(credits[0].amount, 4 * 10000) // the HELD quantity at the real cost, not the browser's 9999 x 1
  assert.equal(credits[0].reference_id, holding.inventory_id)
  const again = await removeReturnedItem(db, input)
  assert.ok([404, 409].includes(again.status))
  assert.equal(db.tables.supplier_credits.filter((c) => c.credit_id > 1).length, 1)
  // K: the returned batch no longer shows available quantity; historical batches untouched
  const batch = db.tables.inventory_batches.find((b) => b.po_number === `RET-${returnId}`)!
  assert.deepEqual([batch.quantity_available, batch.quantity_received], [0, 4])
  assert.deepEqual(db.tables.inventory_batches.filter((b) => b.batch_id <= 8).map((b) => b.quantity_available), [2, 1])
  // safety: an ordinary sellable row can no longer be deleted through this endpoint
  const sell = await removeReturnedItem(db, { inventoryId: sellable(db)!.inventory_id, supplierNameId: 3 })
  assert.equal(sell.status, 400)
  assert.equal(sellable(db)!.quantity, 10)
})

test("18. concurrent write-off: exactly one credit, one removal", async () => {
  for (let run = 0; run < 30; run++) {
    const db = seed()
    const { holding } = await withHolding(db, 4)
    const results = await Promise.all(Array.from({ length: 5 }, () => removeReturnedItem(db, { inventoryId: holding.inventory_id, supplierNameId: 3, productName: "Pump" })))
    assert.equal(results.filter((r) => r.status === 200).length, 1, `run ${run}`)
    assert.equal(db.tables.supplier_credits.filter((c) => c.credit_id > 1).length, 1, `run ${run}`)
  }
})

test("18. restock then write-off (and the reverse) cannot both happen to the same holding row", async () => {
  const db = seed()
  const { holding } = await withHolding(db, 4)
  const [a, b] = await Promise.all([restockReturnedItem(db, { inventoryId: holding.inventory_id }), removeReturnedItem(db, { inventoryId: holding.inventory_id, supplierNameId: 3, productName: "Pump" })])
  assert.equal([a, b].filter((r) => r.status === 200).length, 1)
  const restocked = a.status === 200
  assert.equal(sellable(db)!.quantity, restocked ? 14 : 10)
  assert.equal(db.tables.supplier_credits.filter((c) => c.credit_id > 1).length, restocked ? 0 : 1)
})

test("18. a failed supplier credit restores the holding row so the write-off can be retried", async () => {
  const db = seed()
  const { holding } = await withHolding(db, 4)
  db.failOn["supplier_credits:insert"] = "boom"
  const res = await removeReturnedItem(db, { inventoryId: holding.inventory_id, supplierNameId: 3, productName: "Pump" })
  assert.equal(res.status, 500)
  const back = db.tables.inventory.find((r) => r.inventory_id === holding.inventory_id)!
  assert.deepEqual([back.is_returned, back.quantity], [true, 4])
  assert.equal(db.tables.supplier_credits.filter((c) => c.credit_id > 1).length, 0)
  delete db.failOn["supplier_credits:insert"]
  assert.equal((await removeReturnedItem(db, { inventoryId: holding.inventory_id, supplierNameId: 3, productName: "Pump" })).status, 200)
  assert.equal(db.tables.supplier_credits.filter((c) => c.credit_id > 1).length, 1)
})

// ---------------------------------------------------------------------------------------------------------
// 19-20. Returned quantity in DP / delivered / Missing Items calculations
// ---------------------------------------------------------------------------------------------------------
test("19-20. valid returns reduce delivered / added quantities; rejected, other-DP and historical returns do not", async () => {
  const db = seed()
  await create(db, [pump(10), gun(2)]) // DP 1, pending
  const rejected = await create(db, [pump(50)]) // DP 1, will be rejected
  db.tables.product_returns.find((r) => r.return_id === rejected.body.returnId)!.status = "rejected"
  await create(db, [pump(7)], { permitId: 5 }) // DP 5 (another order)

  const lines = await loadReturnLines(db, [1, 3])
  assert.deepEqual([...returnedTotalsByPermit(lines)], [[1, 12]]) // 10 pump + 2 gun on DP 1 only
  assert.equal(returnedByKey(lines, { permitId: 1 }).get("p:7"), 10)
  assert.equal(returnedByKey(lines, { permitId: 1 }).get("n:Silicon Gun"), 2)

  // DP display: per-line returned quantity
  const dp1Lines = [{ key: "p:7", quantity: 100 }, { key: "n:Silicon Gun", quantity: 5 }]
  assert.deepEqual(netLineQuantities(dp1Lines, returnedByKey(lines, { permitId: 1 })), [90, 3])
  // same product listed twice on a DP: returns are applied in order
  assert.deepEqual(netLineQuantities([{ key: "p:7", quantity: 6 }, { key: "p:7", quantity: 6 }], new Map([["p:7", 8]])), [0, 4])

  // delivered / Missing Items style maps (SO 1 ordered 100 Pump + 5 Gun; DP 1 delivered all of it)
  const delivered = new Map<number, number>([[7, 100]])
  const deliveredByName = new Map<string, number>([["Silicon Gun", 5]])
  subtractReturns(delivered, deliveredByName, lines)
  assert.equal(delivered.get(7), 90) // no longer "fully delivered": 90 < 100 ordered
  assert.equal(deliveredByName.get("Silicon Gun"), 3)
  // Missing Items: ordered - added = 100 - 90 = 10 missing again; 5 - 3 = 2
  assert.equal(Math.max(0, 100 - delivered.get(7)!), 10)
  assert.equal(Math.max(0, 5 - deliveredByName.get("Silicon Gun")!), 2)

  // no returns on DP 3 -> nothing subtracted
  const d3 = new Map<number, number>([[7, 20]])
  subtractReturns(d3, new Map(), await loadReturnLines(db, [3]))
  assert.equal(d3.get(7), 20)
})

test("timestamps from both tables compare correctly", () => {
  assert.equal(toMs("2026-10-08T10:00:01.000Z"), toMs("2026-10-08T10:00:01"))
  assert.equal(toMs("2026-10-08T10:00:01.5+00:00"), toMs("2026-10-08T10:00:01.5"))
  assert.equal(toMs("2026-09-06 16:07:47.201885+00"), Date.parse("2026-09-06T16:07:47.201Z"))
  assert.ok(Number.isNaN(toMs(null)))
})

// ---------------------------------------------------------------------------------------------------------
// Reject transition: pending_warehouse -> rejected
// ---------------------------------------------------------------------------------------------------------
test("reject: a pending return can be rejected with a reason; no inventory is created and the quantity is free again", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(100)])
  assert.equal((await create(db, [pump(1)])).status, 409) // fully returned
  const inventoryBefore = JSON.stringify(db.tables.inventory)
  const res = await rejectReturn(db, { returnId: id, reason: "Goods were refused by mistake", rejectedBy: "wh-1" })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const row = db.tables.product_returns.find((r) => r.return_id === id)!
  assert.equal(row.status, "rejected")
  assert.match(row.warehouse_notes, /wh-1: Goods were refused by mistake/)
  assert.equal(JSON.stringify(db.tables.inventory), inventoryBefore) // no inventory
  assert.equal(db.tables.inventory_batches.filter((b) => b.batch_id > 8).length, 0)
  assert.equal(db.tables.return_items.filter((i) => i.return_id === id).length, 1) // history kept
  assert.equal((await create(db, [pump(100)])).status, 200) // quantity available again
})

test("reject: a reason is required", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(5)])
  for (const reason of [undefined, "", "  ", "ab", null, 5]) {
    assert.equal((await rejectReturn(db, { returnId: id, reason })).status, 400, String(reason))
  }
  assert.equal(db.tables.product_returns.find((r) => r.return_id === id)!.status, "pending_warehouse")
})

test("reject: only pending returns can be rejected; processed / rejected / in-progress / unknown ones cannot", async () => {
  const db = seed()
  const processed = await pendingReturn(db, [pump(5)])
  assert.equal((await proc(db, processed)).status, 200)
  const stockAfter = JSON.stringify(db.tables.inventory)
  const res = await rejectReturn(db, { returnId: processed, reason: "too late to reject" })
  assert.equal(res.status, 409)
  assert.equal(res.body.currentStatus, "received")
  assert.equal(JSON.stringify(db.tables.inventory), stockAfter)

  const rejectedOnce = await pendingReturn(db, [pump(5)])
  assert.equal((await rejectReturn(db, { returnId: rejectedOnce, reason: "first rejection" })).status, 200)
  assert.equal((await rejectReturn(db, { returnId: rejectedOnce, reason: "second rejection" })).status, 409)

  const inProgress = await pendingReturn(db, [pump(5)])
  db.tables.product_returns.find((r) => r.return_id === inProgress)!.status = "assigned_warehouse"
  assert.equal((await rejectReturn(db, { returnId: inProgress, reason: "being processed" })).status, 409)

  assert.equal((await rejectReturn(db, { returnId: 99999, reason: "does not exist" })).status, 404)
  assert.equal((await rejectReturn(db, { returnId: "x", reason: "bad id" })).status, 400)
  // historical returns are never rejected through this path by accident: #4 is the only pending one and is left alone here
  assert.equal(db.tables.product_returns.find((r) => r.return_id === 4)!.status, "pending_warehouse")
})

test("reject: a rejected return cannot be processed afterwards, and concurrent reject + process has a single winner", async () => {
  const db = seed()
  const id = await pendingReturn(db, [pump(5)])
  assert.equal((await rejectReturn(db, { returnId: id, reason: "rejected first" })).status, 200)
  assert.equal((await proc(db, id)).status, 409)
  assert.equal(holdingRows(db).length, 0)

  for (let run = 0; run < 25; run++) {
    const d = seed()
    const rid = await pendingReturn(d, [pump(5)])
    const [r, p] = await Promise.all([rejectReturn(d, { returnId: rid, reason: "race reject" }), proc(d, rid)])
    assert.equal([r, p].filter((x) => x.status === 200).length, 1, `run ${run}: ${r.status}/${p.status}`)
    const status = d.tables.product_returns.find((x) => x.return_id === rid)!.status
    assert.equal(status, r.status === 200 ? "rejected" : "received")
    assert.equal(holdingRows(d).length, r.status === 200 ? 0 : 1)
  }
})

// ---------------------------------------------------------------------------------------------------------
// 24. Historical data
// ---------------------------------------------------------------------------------------------------------
test("24. the four historical returns and their related rows are never touched by the new workflow", async () => {
  const db = seed()
  const historicalIds = [1, 2, 3, 4]
  const pick = () => JSON.stringify({
    returns: db.tables.product_returns.filter((r) => historicalIds.includes(r.return_id)),
    items: db.tables.return_items.filter((i) => historicalIds.includes(i.return_item_id)),
    batches: db.tables.inventory_batches.filter((b) => [5, 8].includes(b.batch_id)),
    credits: db.tables.supplier_credits.filter((c) => c.credit_id === 1),
  })
  const before = pick()
  const a = await pendingReturn(db, [pump(20)])
  await proc(db, a)
  const holding = holdingRows(db)[0]
  await restockReturnedItem(db, { inventoryId: holding.inventory_id })
  const b = await pendingReturn(db, [pump(5)])
  await proc(db, b)
  await removeReturnedItem(db, { inventoryId: holdingRows(db)[0].inventory_id, supplierNameId: 3, productName: "Pump" })
  await create(db, [pump(999)]) // rejected request
  assert.equal(pick(), before)
  // and they never count against any DP
  assert.deepEqual([...returnedTotalsByPermit(await loadReturnLines(db, [1, 2, 3, 4, 5]))].map(([p]) => p), [1])
})
