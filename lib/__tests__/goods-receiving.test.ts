// Batch 4A tests: POST /api/goods-receipts (the REAL route handler + lib/goods-receiving.ts; only the database
// client is replaced by the in-memory FakeDb). Run with lib/__tests__/run-tests.sh.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as grnRoute from "../../app/api/goods-receipts/route"
import { acquirePoLock, releasePoLock, LOCK_STALE_MS } from "../goods-receiving"

// Rounds for the randomised concurrency scenarios (GRN_STRESS=200 for a long soak)
const ROUNDS = Number(process.env.GRN_STRESS) || 30
const locks = (db: FakeDb) => db.tables.idempotency_log.filter((r) => String(r.idempotency_key).startsWith("po_receive_lock_"))

// PO 1 (approved): item 1 = stock product 7, 10 @ 100;  item 2 = outsourced, 5 @ 2,000, sourced for SO item 28.
// PO 2 (approved): item 3 = stock, 4  (used as the "foreign" item).  PO 3 draft, 4 rejected, 5 received,
// 6 partially_received, 7 pending, 8 received_with_issues.
function baseDb(extra: Record<string, Row[]> = {}) {
  const po = (po_id: number, status: string) => ({ po_id, po_number: `PO-T-${po_id}`, supplier_id: 1, status, total: 1000 })
  const db = new FakeDb({
    purchase_orders: [po(1, "approved"), po(2, "approved"), po(3, "draft"), po(4, "rejected"), po(5, "received"), po(6, "partially_received"), po(7, "pending"), po(8, "received_with_issues")],
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock", source_so_item_id: null, item_name_snapshot: "Pump A" },
      { po_item_id: 2, po_id: 1, product_id: null, quantity: 5, unit_price: 2000, total: 10000, item_type: "outsourced", outsourced_name: "Service X", source_so_id: 3, source_so_item_id: 28 },
      { po_item_id: 3, po_id: 2, product_id: 7, quantity: 4, unit_price: 100, total: 400, item_type: "stock" },
      { po_item_id: 6, po_id: 6, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock" },
    ],
    goods_receipts: [],
    goods_receipt_lines: [],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 5, unit_cost: 90, reorder_point: 0 }],
    inventory_batches: [],
    sales_orders: [{ so_id: 3, so_number: "SO-T-3", fulfillment_status: "PENDING" }],
    sales_order_items: [
      { so_item_id: 28, so_id: 3, quantity: 5, fulfilled_at: null },
      { so_item_id: 29, so_id: 3, quantity: 1, fulfilled_at: null },
    ],
    idempotency_log: [],
    ...extra,
  })
  useDb(db)
  return db
}

const post = (body: any) => call(grnRoute.POST, "POST", body)
let k = 0
const newKey = () => `grn-test-key-${++k}-${Math.random().toString(36).slice(2, 8)}`
const stock = (qty: unknown, extra: Row = {}) => ({ poItemId: 1, quantityReceived: qty, warehouseId: 1, unitCost: 100, ...extra })
const outs = (qty: unknown, extra: Row = {}) => ({ poItemId: 2, quantityReceived: qty, ...extra })
const rec = (poId: number, lines: Row[], extra: Row = {}) => ({ poId, receivedBy: 1, lines, ...extra })
const received = (db: FakeDb, poItemId: number) =>
  db.tables.goods_receipt_lines.filter((l) => l.po_item_id === poItemId).reduce((s, l) => s + l.quantity_received, 0)
const invQty = (db: FakeDb) => db.tables.inventory.find((i) => i.inventory_id === 100)!.quantity
const poStatus = (db: FakeDb, id: number) => db.tables.purchase_orders.find((p) => p.po_id === id)!.status
/** a historical receipt (e.g. one the previous system accepted) */
const seedReceipt = (db: FakeDb, receipt_id: number, po_id: number, lines: Row[]) => {
  db.tables.goods_receipts.push({ receipt_id, grn_number: `GRN-H-${receipt_id}`, po_id, status: "complete" })
  for (const l of lines) db.tables.goods_receipt_lines.push({ line_id: 900 + db.tables.goods_receipt_lines.length, receipt_id, ...l })
  db.seq.goods_receipts = Math.max(db.seq.goods_receipts || 0, receipt_id)
}

// ------------------------------------------------------------------------------------------------ validation
test("V1/V2. an approved PO and a partially_received PO can receive", async () => {
  const db = baseDb()
  const a = await post(rec(1, [stock(4)]))
  assert.equal(a.status, 200, JSON.stringify(a.body))
  assert.equal(a.body.success, true)
  assert.ok(a.body.receipt.grnNumber)
  const b = await post(rec(6, [{ poItemId: 6, quantityReceived: 3, warehouseId: 1 }]))
  assert.equal(b.status, 200, JSON.stringify(b.body))
  assert.equal(poStatus(db, 6), "partially_received")
})

for (const [id, status] of [[3, "draft"], [4, "rejected"], [5, "received"], [7, "pending"], [8, "received_with_issues"]] as const) {
  test(`V3-5. a ${status} PO is refused and nothing is written`, async () => {
    const db = baseDb()
    db.tables.purchase_order_items.push({ po_item_id: 50 + id, po_id: id, product_id: 7, quantity: 5, unit_price: 100, total: 500, item_type: "stock" })
    const before = db.snapshot()
    const res = await post(rec(id, [{ poItemId: 50 + id, quantityReceived: 1, warehouseId: 1 }], { idempotencyKey: newKey() }))
    assert.equal(res.status, 409)
    assert.match(res.body.error, new RegExp(status))
    assert.equal(db.tables.goods_receipts.length, 0)
    assert.equal(invQty(db), 5)
    assert.equal(poStatus(db, id), status)
    const nonEmpty = (snap: Record<string, any[]>) => Object.fromEntries(Object.entries(snap).filter(([name, rows]) => rows.length > 0 && name !== "idempotency_log"))
    assert.deepEqual(nonEmpty(db.snapshot()), nonEmpty(before))
  })
}

test("V6. a missing PO is 404", async () => {
  baseDb()
  const res = await post(rec(999, [stock(1)]))
  assert.equal(res.status, 404)
})

test("V6b. malformed requests are 400", async () => {
  baseDb()
  for (const body of [null, {}, { poId: "abc", lines: [stock(1)] }, { poId: 1 }, { poId: 1, lines: [] }, { poId: 1, lines: "x" }, { poId: -3, lines: [stock(1)] }]) {
    const res = await post(body)
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  const noItem = await post(rec(1, [{ quantityReceived: 1 }]))
  assert.equal(noItem.status, 400)
  const badKey = await post(rec(1, [stock(1)], { idempotencyKey: "x" }))
  assert.equal(badKey.status, 400)
  const badDisc = await post(rec(1, [stock(1, { discrepancyType: "bogus" })]))
  assert.equal(badDisc.status, 400)
})

test("V7. a PO item that belongs to another PO is refused", async () => {
  const db = baseDb()
  const res = await post(rec(1, [stock(1), { poItemId: 3, quantityReceived: 1, warehouseId: 1 }]))
  assert.equal(res.status, 400)
  assert.match(res.body.error, /does not belong/)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
})

test("V8-10. zero, negative and non-numeric quantities are refused (never clamped)", async () => {
  const db = baseDb()
  for (const q of [0, -1, -0.5, "0", "-2", "abc", "", null, undefined, NaN, Infinity, -Infinity, "1e3", "5.5", 2.5, "NaN", "Infinity", {}, [], true, 1_000_001]) {
    const res = await post(rec(1, [stock(q as any)]))
    assert.equal(res.status, 400, `quantity ${String(q)}`)
  }
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(db.tables.goods_receipt_lines.length, 0)
  assert.equal(invQty(db), 5)
  // numeric strings that are whole positive numbers are fine
  assert.equal((await post(rec(1, [stock("2")]))).status, 200)
})

test("V11. quantity above the remaining quantity is refused with the numbers, nothing recorded", async () => {
  const db = baseDb()
  const res = await post(rec(1, [stock(11)]))
  assert.equal(res.status, 409)
  assert.equal(res.body.code, "OVER_RECEIPT")
  assert.deepEqual(res.body.items[0], { poItemId: 1, ordered: 10, alreadyReceived: 0, remaining: 10, requested: 11 })
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(poStatus(db, 1), "approved")
})

test("V11b. one over-quantity line refuses the whole request (the valid line is not recorded either)", async () => {
  const db = baseDb()
  const res = await post(rec(1, [stock(3), outs(6)]))
  assert.equal(res.status, 409)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
})

test("V11c. the same item split over several warehouse lines is summed against the cap", async () => {
  const db = baseDb()
  const res = await post(rec(1, [stock(6), stock(5, { warehouseId: 2 })]))
  assert.equal(res.status, 409)
  assert.equal(db.tables.goods_receipts.length, 0)
  const ok = await post(rec(1, [stock(6), stock(4, { warehouseId: 2 })]))
  assert.equal(ok.status, 200)
  assert.equal(received(db, 1), 10)
})

// ------------------------------------------------------------------------------------------------ receiving
test("R12-17. partial -> partial -> final; PO status follows cumulative quantities; many GRNs", async () => {
  const db = baseDb()
  // the outsourced item is received completely first: the PO is still open because item 1 is not
  const first = await post(rec(1, [stock(4), outs(5)]))
  assert.equal(first.status, 200)
  assert.equal(first.body.poStatus, "partially_received")
  assert.equal(poStatus(db, 1), "partially_received")
  assert.equal(db.tables.goods_receipts[0].status, "partial")
  assert.equal(invQty(db), 9)
  const second = await post(rec(1, [stock(3)]))
  assert.equal(second.status, 200)
  assert.equal(poStatus(db, 1), "partially_received")
  // over the remaining 3
  const tooMuch = await post(rec(1, [stock(4)]))
  assert.equal(tooMuch.status, 409)
  assert.equal(tooMuch.body.items[0].remaining, 3)
  const last = await post(rec(1, [stock(3)]))
  assert.equal(last.status, 200)
  assert.equal(last.body.poStatus, "received")
  assert.equal(poStatus(db, 1), "received")
  assert.equal(db.tables.goods_receipts.length, 3)
  assert.equal(db.tables.goods_receipts[2].status, "complete")
  assert.equal(received(db, 1), 10)
  assert.equal(invQty(db), 15)
  // closed: no more receiving
  const closed = await post(rec(1, [stock(1)]))
  assert.equal(closed.status, 409)
})

test("R18. a discrepancy / short receipt never closes the PO; the rest stays receivable", async () => {
  const db = baseDb()
  const res = await post(rec(1, [stock(7, { discrepancyType: "quantity_mismatch", discrepancyNotes: "3 short" }), outs(5)]))
  assert.equal(res.status, 200)
  assert.equal(db.tables.goods_receipts[0].status, "discrepancy")
  assert.equal(res.body.poStatus, "partially_received")
  assert.equal(poStatus(db, 1), "partially_received")
  const rest = await post(rec(1, [stock(3)]))
  assert.equal(rest.status, 200)
  assert.equal(poStatus(db, 1), "received")
})

test("R18b. a discrepancy on the LAST quantity still ends 'received' by quantity, with GRN status discrepancy", async () => {
  const db = baseDb()
  assert.equal((await post(rec(1, [stock(10, { discrepancyType: "damaged" }), outs(5)]))).status, 200)
  assert.equal(db.tables.goods_receipts[0].status, "discrepancy")
  assert.equal(poStatus(db, 1), "received")
})

test("R19. the remaining quantity comes from database state (earlier GRN lines), not from the client", async () => {
  const db = baseDb()
  seedReceipt(db, 1, 1, [{ po_item_id: 1, item_type: "stock", quantity_received: 6, quantity_ordered: 10 }])
  const lying = await post(rec(1, [stock(5, { quantityOrdered: 99, remaining: 99, quantityRemaining: 99 })]))
  assert.equal(lying.status, 409)
  assert.equal(lying.body.items[0].alreadyReceived, 6)
  assert.equal(lying.body.items[0].remaining, 4)
  assert.equal((await post(rec(1, [stock(4)]))).status, 200)
})

test("R20. the server ignores client-supplied product / SO link / item type and uses the PO item", async () => {
  const db = baseDb()
  const res = await post(rec(1, [{ poItemId: 2, quantityReceived: 5, itemType: "stock", productId: 7, sourceSoItemId: 29, warehouseId: 1 }]))
  assert.equal(res.status, 200)
  const line = db.tables.goods_receipt_lines[0]
  assert.equal(line.item_type, "outsourced")
  assert.equal(line.product_id, null)
  assert.equal(line.source_so_item_id, 28)
  assert.equal(line.outsourced_name, "Service X")
  assert.equal(line.quantity_ordered, 5)
  assert.equal(invQty(db), 5, "an outsourced line never touches inventory")
  assert.equal(db.tables.inventory_batches.length, 0)
})

test("R21. stock receipt writes inventory + batch once; a missing inventory row is created", async () => {
  const db = baseDb()
  assert.equal((await post(rec(1, [stock(2, { warehouseId: 2 })]))).status, 200)
  const created = db.tables.inventory.find((i) => i.warehouse_id === 2)!
  assert.equal(created.quantity, 2)
  assert.equal(created.is_returned, false)
  assert.equal(db.tables.inventory_batches.length, 1)
  assert.equal(db.tables.inventory_batches[0].quantity_received, 2)
  assert.equal(db.tables.inventory_batches[0].po_number, "PO-T-1")
})

test("R22. a stock item typed in by hand (no product) gets a catalogue product, then inventory", async () => {
  const db = baseDb({ products: [] })
  db.tables.purchase_order_items.push({ po_item_id: 9, po_id: 1, product_id: null, quantity: 3, unit_price: 50, total: 150, item_type: "stock", item_name_snapshot: "Typed item" })
  const res = await post(rec(1, [{ poItemId: 9, quantityReceived: 3, warehouseId: 1 }]))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.products.length, 1)
  assert.equal(db.tables.products[0].product_name, "Typed item")
  assert.equal(db.tables.purchase_order_items.find((i) => i.po_item_id === 9)!.product_id, db.tables.products[0].product_id)
  assert.equal(db.tables.inventory.find((i) => i.product_id === db.tables.products[0].product_id)!.quantity, 3)
})

// ------------------------------------------------------------------------------------------------ idempotency
test("I20-21. the same request replayed (same key) returns the original GRN, no second GRN, no second stock", async () => {
  const db = baseDb()
  const key = newKey()
  const first = await post(rec(1, [stock(4)], { idempotencyKey: key }))
  assert.equal(first.status, 200)
  const again = await post(rec(1, [stock(4)], { idempotencyKey: key }))
  assert.equal(again.status, 200)
  assert.equal(again.body.replayed, true)
  assert.equal(again.body.receipt.id, first.body.receipt.id)
  assert.equal(again.body.receipt.grnNumber, first.body.receipt.grnNumber)
  assert.equal(db.tables.goods_receipts.length, 1)
  assert.equal(received(db, 1), 4)
  assert.equal(invQty(db), 9)
  assert.equal(db.tables.inventory_batches.length, 1)
})

test("I20b. two simultaneous submissions with the same key (double click) create one GRN", async () => {
  for (let round = 0; round < 15; round++) {
    const db = baseDb()
    const key = newKey()
    const results = await Promise.all([1, 2, 3].map(() => post(rec(1, [stock(4)], { idempotencyKey: key }))))
    assert.equal(db.tables.goods_receipts.length, 1, `round ${round}`)
    assert.equal(invQty(db), 9, `round ${round}`)
    assert.ok(results.some((r) => r.status === 200 && !r.body.replayed), "one request did the work")
    for (const r of results) assert.ok([200, 409].includes(r.status), `status ${r.status}`)
  }
})

test("I22. different keys (or no key) are different GRNs", async () => {
  const db = baseDb()
  assert.equal((await post(rec(1, [stock(2)], { idempotencyKey: newKey() }))).status, 200)
  assert.equal((await post(rec(1, [stock(2)], { idempotencyKey: newKey() }))).status, 200)
  assert.equal((await post(rec(1, [stock(2)]))).status, 200)
  assert.equal(db.tables.goods_receipts.length, 3)
  assert.equal(received(db, 1), 6)
})

test("I23. a refused request can be retried with the same key once it is valid; a failed one is not 'completed'", async () => {
  const db = baseDb()
  const key = newKey()
  assert.equal((await post(rec(1, [stock(11)], { idempotencyKey: key }))).status, 409)
  const ok = await post(rec(1, [stock(10)], { idempotencyKey: key }))
  assert.equal(ok.status, 200)
  assert.notEqual(ok.body.replayed, true)
  assert.equal(db.tables.goods_receipts.length, 1)
})

// ------------------------------------------------------------------------------------------------ concurrency
test("CASE A. 10 ordered, 6 received: two concurrent requests for 4 -> exactly one succeeds, one conflicts, received 10, ONE new GRN, stock +4 once, PO received", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    // PO item 2 (outsourced) is already fully received, so the PO's status depends only on item 1
    seedReceipt(db, 1, 1, [{ po_item_id: 1, item_type: "stock", quantity_received: 6, quantity_ordered: 10 }, { po_item_id: 2, item_type: "outsourced", quantity_received: 5, quantity_ordered: 5 }])
    db.tables.purchase_orders.find((p) => p.po_id === 1)!.status = "partially_received"
    const [a, b] = await Promise.all([post(rec(1, [stock(4)])), post(rec(1, [stock(4)]))])
    const ctx = `round ${round}: ${JSON.stringify([a.body, b.body])}`
    assert.deepEqual([a.status, b.status].sort(), [200, 409], ctx)
    const loser = a.status === 409 ? a : b
    // the loser either finds the PO already closed by the winner, or (if it read before the winner finished) is over the cap
    assert.ok(["PO_NOT_RECEIVABLE", "OVER_RECEIPT"].includes(loser.body.code), ctx)
    if (loser.body.code === "OVER_RECEIPT") assert.equal(loser.body.items[0].remaining, 0, ctx)
    assert.equal(received(db, 1), 10, ctx)
    assert.equal(db.tables.goods_receipts.length - 1, 1, `${ctx}: exactly one NEW GRN (1 historical + 1)`)
    assert.equal(db.tables.goods_receipt_lines.filter((l) => l.receipt_id !== 1 && l.po_item_id === 1).length, 1, ctx)
    assert.equal(invQty(db), 9, `${ctx}: inventory added exactly once (5 + 4)`)
    assert.equal(db.tables.inventory_batches.length, 1, ctx)
    assert.equal(poStatus(db, 1), "received", ctx)
    assert.equal(locks(db).length, 0, "lock released")
  }
})

test("CASE B. 10 ordered, 2 received: two concurrent requests for 4 -> both succeed (serialised), received 10, stock +8, PO received", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    seedReceipt(db, 1, 1, [{ po_item_id: 1, item_type: "stock", quantity_received: 2, quantity_ordered: 10 }, { po_item_id: 2, item_type: "outsourced", quantity_received: 5, quantity_ordered: 5 }])
    db.tables.purchase_orders.find((p) => p.po_id === 1)!.status = "partially_received"
    const [a, b] = await Promise.all([post(rec(1, [stock(4)])), post(rec(1, [stock(4)]))])
    const ctx = `round ${round}: ${JSON.stringify([a.body, b.body])}`
    assert.deepEqual([a.status, b.status], [200, 200], ctx)
    assert.equal(received(db, 1), 10, ctx)
    assert.equal(db.tables.goods_receipts.length - 1, 2, `${ctx}: two new GRNs`)
    assert.equal(invQty(db), 5 + 8, `${ctx}: inventory +8`)
    assert.equal(db.tables.inventory_batches.length, 2, ctx)
    assert.equal(poStatus(db, 1), "received", ctx)
    assert.equal(locks(db).length, 0, "lock released")
  }
})

test("C27. three concurrent requests that together exceed the remaining quantity never exceed the order", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    const results = await Promise.all([7, 7, 7, 3].map((q) => post(rec(1, [stock(q)]))))
    assert.ok(received(db, 1) <= 10, `round ${round}: received ${received(db, 1)}`)
    assert.equal(results.filter((r) => r.status === 200).length, db.tables.goods_receipts.length)
    assert.equal(invQty(db), 5 + received(db, 1))
  }
})

test("C29. concurrent receipts of the SAME product through two different POs never lose a stock increment", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    const [a, b] = await Promise.all([post(rec(1, [stock(4)])), post(rec(2, [{ poItemId: 3, quantityReceived: 3, warehouseId: 1 }]))])
    assert.deepEqual([a.status, b.status], [200, 200])
    assert.equal(invQty(db), 5 + 4 + 3, `round ${round}`)
  }
})

test("C30. a stale lock (crashed request) is taken over; a fresh lock is waited for", async () => {
  const stale = baseDb()
  stale.tables.idempotency_log.push({ id: 1, operation_type: "po_receive", idempotency_key: "po_receive_lock_1", entity_type: "purchase_orders", entity_id: 1, status: "processing", created_at: new Date(Date.now() - 5 * 60_000).toISOString() })
  stale.seq.idempotency_log = 1
  assert.equal((await post(rec(1, [stock(2)]))).status, 200)

  const fresh = baseDb()
  fresh.tables.idempotency_log.push({ id: 1, operation_type: "po_receive", idempotency_key: "po_receive_lock_1", entity_type: "purchase_orders", entity_id: 1, status: "processing", created_at: new Date().toISOString() })
  fresh.seq.idempotency_log = 1
  setTimeout(() => {
    fresh.tables.idempotency_log = fresh.tables.idempotency_log.filter((r) => r.id !== 1)
  }, 150)
  const started = Date.now()
  assert.equal((await post(rec(1, [stock(2)]))).status, 200)
  assert.ok(Date.now() - started >= 100, "waited for the lock holder")
})

// ------------------------------------------------------------------------------------------------ failure handling
test("F31. failing to insert the GRN header returns an error, nothing recorded", async () => {
  const db = baseDb()
  db.failOn["goods_receipts:insert"] = "boom"
  const res = await post(rec(1, [stock(2)], { idempotencyKey: newKey() }))
  assert.equal(res.status, 500)
  assert.notEqual(res.status, 200)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(db.tables.idempotency_log.length, 1)
  assert.equal(db.tables.idempotency_log[0].status, "failed")
})

test("F32. failing to insert the GRN lines undoes the header; no inventory change; not 200", async () => {
  const db = baseDb()
  db.failOn["goods_receipt_lines:insert"] = "boom"
  const res = await post(rec(1, [stock(2)]))
  assert.equal(res.status, 500)
  assert.equal(res.body.partialFailure, undefined)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(poStatus(db, 1), "approved")
})

test("F33. an inventory failure on the 2nd line undoes the 1st line's stock and the GRN", async () => {
  const db = baseDb()
  db.tables.purchase_order_items.push({ po_item_id: 9, po_id: 1, product_id: 8, quantity: 5, unit_price: 10, total: 50, item_type: "stock" })
  db.failOn["inventory:insert"] = "boom" // product 8 has no inventory row yet -> insert fails
  const res = await post(rec(1, [stock(3), { poItemId: 9, quantityReceived: 2, warehouseId: 1 }]))
  assert.equal(res.status, 500)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(db.tables.goods_receipt_lines.length, 0)
  assert.equal(invQty(db), 5, "the +3 on product 7 was taken back")
  assert.equal(db.tables.inventory_batches.length, 0)
  assert.equal(poStatus(db, 1), "approved")
})

test("F34. a batch insert failure is not swallowed: error, stock and GRN undone", async () => {
  const db = baseDb()
  db.failOn["inventory_batches:insert"] = "boom"
  const res = await post(rec(1, [stock(3)]))
  assert.equal(res.status, 500)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
})

test("F35. a sales-order update failure is not swallowed: error and everything undone", async () => {
  const db = baseDb()
  db.failOn["sales_order_items:update"] = "boom"
  const res = await post(rec(1, [stock(3), outs(5)]))
  assert.equal(res.status, 500)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(db.tables.sales_order_items.find((s) => s.so_item_id === 28)!.fulfilled_at, null)
})

test("F36. a PO status update failure undoes stock, SO marks and the GRN", async () => {
  const db = baseDb()
  db.failOn["purchase_orders:update"] = "boom"
  const res = await post(rec(1, [stock(3), outs(5)]))
  assert.equal(res.status, 500)
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(db.tables.sales_order_items.find((s) => s.so_item_id === 28)!.fulfilled_at, null)
  assert.equal(poStatus(db, 1), "approved")
})

test("F37. if the PO was closed/rejected while receiving, the receipt is refused and undone", async () => {
  const db = baseDb()
  const original = db.from.bind(db)
  // flip the PO to rejected after validation has passed (right before the guarded status update)
  ;(db as any).from = (table: string) => {
    const q = original(table)
    if (table === "purchase_orders") {
      const upd = q.update.bind(q)
      q.update = (payload: any) => {
        db.tables.purchase_orders.find((p) => p.po_id === 1)!.status = "rejected"
        return upd(payload)
      }
    }
    return q
  }
  const res = await post(rec(1, [stock(3)]))
  assert.equal(res.status, 409)
  assert.equal(res.body.code, "PO_CHANGED")
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(poStatus(db, 1), "rejected")
})

test("F38. if an undo also fails the response says so (partialFailure) and the key can never be replayed", async () => {
  const db = baseDb()
  db.failOn["goods_receipt_lines:insert"] = "boom"
  db.failOn["goods_receipts:delete"] = "cannot delete"
  const key = newKey()
  const res = await post(rec(1, [stock(2)], { idempotencyKey: key }))
  assert.equal(res.status, 500)
  assert.equal(res.body.partialFailure, true)
  assert.equal(db.tables.idempotency_log.find((r) => String(r.idempotency_key).endsWith(key))!.status, "partial_failure")
  const replay = await post(rec(1, [stock(2)], { idempotencyKey: key }))
  assert.equal(replay.status, 409)
  assert.equal(replay.body.partialFailure, true)
  assert.equal(db.tables.idempotency_log.filter((r) => String(r.idempotency_key).startsWith("po_receive_lock_")).length, 0, "lock released even after a failure")
})

test("F39. a failed request releases the PO lock so the next request works", async () => {
  const db = baseDb()
  db.failOn["inventory:update"] = "boom"
  assert.equal((await post(rec(1, [stock(2)]))).status, 500)
  delete db.failOn["inventory:update"]
  assert.equal((await post(rec(1, [stock(2)]))).status, 200)
  assert.equal(invQty(db), 7)
})

// ------------------------------------------------------------------------------------------------ SO linkage
test("S40. SO linkage: a fully received PO item marks its SO item fulfilled and the SO ready; partial does not", async () => {
  const db = baseDb()
  db.tables.sales_order_items = db.tables.sales_order_items.filter((s) => s.so_item_id === 28)
  const partial = await post(rec(1, [outs(3)]))
  assert.equal(partial.status, 200)
  assert.equal(db.tables.sales_order_items[0].fulfilled_at, null, "3 of 5 is not fulfilled")
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PENDING")
  assert.equal(db.tables.goods_receipt_lines[0].source_so_item_id, 28)
  const rest = await post(rec(1, [outs(2)]))
  assert.equal(rest.status, 200)
  assert.ok(db.tables.sales_order_items[0].fulfilled_at)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "READY_FOR_FULFILLMENT")
})

test("S41. an SO that has another unfulfilled line stays as it was; a delivered SO is never moved back", async () => {
  const db = baseDb()
  assert.equal((await post(rec(1, [outs(5)]))).status, 200)
  assert.ok(db.tables.sales_order_items.find((s) => s.so_item_id === 28)!.fulfilled_at)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PENDING", "SO item 29 is still unfulfilled")

  const delivered = baseDb()
  delivered.tables.sales_orders[0].fulfillment_status = "DELIVERED"
  delivered.tables.sales_order_items = delivered.tables.sales_order_items.filter((s) => s.so_item_id === 28)
  assert.equal((await post(rec(1, [outs(5)]))).status, 200)
  assert.equal(delivered.tables.sales_orders[0].fulfillment_status, "DELIVERED")
})

// ------------------------------------------------------------------------------------------------ historical data
test("H42. historical over-receipts are only read, never written: such a PO is closed and stays untouched", async () => {
  // PO 6-like history: ordered 5, received 10 across two GRNs, PO already `received`
  const db = baseDb()
  db.tables.purchase_orders.push({ po_id: 20, po_number: "PO-T-20", supplier_id: 1, status: "received", total: 10000 })
  db.tables.purchase_order_items.push({ po_item_id: 20, po_id: 20, product_id: null, quantity: 5, unit_price: 2000, total: 10000, item_type: "outsourced", source_so_item_id: 28 })
  seedReceipt(db, 4, 20, [{ po_item_id: 20, item_type: "outsourced", quantity_received: 5, quantity_ordered: 5, source_so_item_id: 28 }])
  seedReceipt(db, 5, 20, [{ po_item_id: 20, item_type: "outsourced", quantity_received: 5, quantity_ordered: 5, source_so_item_id: 28 }])
  const before = JSON.stringify(db.tables.goods_receipt_lines)
  const res = await post(rec(20, [{ poItemId: 20, quantityReceived: 1 }]))
  assert.equal(res.status, 409)
  assert.equal(JSON.stringify(db.tables.goods_receipt_lines), before)
  assert.equal(poStatus(db, 20), "received")
})

// ------------------------------------------------------------------------------------------------ PO lock
test("L1. the PO lock has exactly one owner at a time (10 contenders, every one eventually gets a turn)", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    let holders = 0
    let maxHolders = 0
    let turns = 0
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const id = await acquirePoLock(db, 1)
        assert.notEqual(id, null)
        holders++
        maxHolders = Math.max(maxHolders, holders)
        await new Promise((r) => setTimeout(r, 3))
        holders--
        turns++
        await releasePoLock(db, id as number)
      }),
    )
    assert.equal(maxHolders, 1, `round ${round}`)
    assert.equal(turns, 10)
    assert.equal(locks(db).length, 0)
  }
})

test("L2. locks are per PO: different POs never wait for each other", async () => {
  const db = baseDb()
  const a = await acquirePoLock(db, 1)
  const b = await acquirePoLock(db, 2)
  assert.ok(a && b && a !== b)
  assert.equal(locks(db).length, 2)
  await releasePoLock(db, a as number)
  await releasePoLock(db, b as number)
})

test("L3. a stale lock recovered by several contenders at once still yields one owner at a time, and never deletes the NEW owner's lock", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    db.tables.idempotency_log.push({ id: 1, operation_type: "po_receive", idempotency_key: "po_receive_lock_1", entity_type: "purchase_orders", entity_id: 1, status: "processing", created_at: new Date(Date.now() - LOCK_STALE_MS - 5000).toISOString() })
    db.seq.idempotency_log = 1
    let holders = 0
    let maxHolders = 0
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const id = await acquirePoLock(db, 1)
        assert.notEqual(id, null)
        assert.notEqual(id, 1, "the dead lock row itself is never 'owned'")
        holders++
        maxHolders = Math.max(maxHolders, holders)
        await new Promise((r) => setTimeout(r, 3))
        // the owner's own lock row must still be there while it holds the lock
        assert.ok(db.tables.idempotency_log.some((r) => r.id === id), "a contender deleted the current owner's lock")
        holders--
        await releasePoLock(db, id as number)
      }),
    )
    assert.equal(maxHolders, 1, `round ${round}`)
    assert.equal(locks(db).length, 0)
  }
})

test("L4. a fresh (still running) lock is never taken over: the contender only proceeds after it is released", async () => {
  const db = baseDb()
  const owner = await acquirePoLock(db, 1)
  let acquiredAt = 0
  const contender = acquirePoLock(db, 1).then(async (id) => {
    acquiredAt = Date.now()
    await releasePoLock(db, id as number)
  })
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(acquiredAt, 0, "contender must still be waiting")
  const releasedAt = Date.now()
  await releasePoLock(db, owner as number)
  await contender
  assert.ok(acquiredAt >= releasedAt)
})

test("L5. a request that dies leaves a lock that the next request recovers after the stale window", async () => {
  const db = baseDb()
  const dead = await acquirePoLock(db, 1) // owner never releases (crash)
  assert.ok(dead)
  db.tables.idempotency_log.find((r) => r.id === dead)!.created_at = new Date(Date.now() - LOCK_STALE_MS - 1000).toISOString()
  const res = await post(rec(1, [stock(2)]))
  assert.equal(res.status, 200)
  assert.equal(locks(db).length, 0)
})

test("L6. lock rows never interfere with replay keys, even for a hostile client key", async () => {
  const db = baseDb()
  for (const k of ["lock_1_abcdef", "lock_1", "po_receive_lock_1", "1_lock_xxxxxxxx", "lock", "x".repeat(8)]) {
    const res = await post(rec(1, [stock(1)], { idempotencyKey: k }))
    if (k.length < 8) assert.equal(res.status, 400, k)
    else assert.equal(res.status, 200, `${k}: ${JSON.stringify(res.body)}`)
  }
  assert.equal(locks(db).length, 0)
  const replayRows = db.tables.idempotency_log.filter((r) => /^po_receive_1_/.test(r.idempotency_key))
  assert.equal(replayRows.length, 4, "4 valid keys were claimed (the 2 too-short keys were refused with 400)")
  assert.ok(replayRows.every((r) => r.status === "completed"))
})

test("L7. two simultaneous requests are never inside the receiving critical section together", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    let inside = 0
    let maxInside = 0
    const original = db.from.bind(db)
    ;(db as any).from = (table: string) => {
      const q = original(table)
      // a receipt header is written once per request, inside the lock; the lock release (the only delete on idempotency_log
      // in a normal receipt) marks the end of the critical section
      if (table === "goods_receipts") {
        const ins = q.insert.bind(q)
        q.insert = (payload: any) => {
          inside++
          maxInside = Math.max(maxInside, inside)
          return ins(payload)
        }
      }
      if (table === "idempotency_log") {
        const del = q.delete.bind(q)
        q.delete = () => {
          inside--
          return del()
        }
      }
      return q
    }
    const results = await Promise.all([post(rec(1, [stock(3)])), post(rec(1, [stock(3)])), post(rec(1, [stock(3)]))])
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200])
    assert.equal(maxInside, 1, `round ${round}: two requests were inside the critical section together`)
  }
})

// ------------------------------------------------------------------------------------------------ SO fulfilment
test("S44. PO item 10: first GRN 4 -> PO partially_received and the SO item is NOT fulfilled; second GRN 6 -> PO received and the SO item IS fulfilled", async () => {
  const db = baseDb()
  db.tables.purchase_order_items.push({ po_item_id: 30, po_id: 1, product_id: null, quantity: 10, unit_price: 50, total: 500, item_type: "outsourced", outsourced_name: "Svc 10", source_so_id: 3, source_so_item_id: 30 })
  db.tables.sales_order_items = [{ so_item_id: 30, so_id: 3, quantity: 10, fulfilled_at: null }]
  // the rest of PO 1 is already complete so the PO status depends on item 30 only
  seedReceipt(db, 1, 1, [{ po_item_id: 1, item_type: "stock", quantity_received: 10, quantity_ordered: 10 }, { po_item_id: 2, item_type: "outsourced", quantity_received: 5, quantity_ordered: 5 }])
  const first = await post(rec(1, [{ poItemId: 30, quantityReceived: 4 }]))
  assert.equal(first.status, 200)
  assert.equal(poStatus(db, 1), "partially_received")
  assert.equal(db.tables.sales_order_items[0].fulfilled_at, null)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PENDING")
  const second = await post(rec(1, [{ poItemId: 30, quantityReceived: 6 }]))
  assert.equal(second.status, 200)
  assert.equal(poStatus(db, 1), "received")
  assert.ok(db.tables.sales_order_items[0].fulfilled_at)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "READY_FOR_FULFILLMENT")
})

test("S45. several POs against ONE SO item: fulfilled only when their combined received quantity reaches the SO quantity", async () => {
  const db = baseDb()
  // SO item 31 needs 10; PO 1 line orders 6, PO 2 line orders 4
  db.tables.purchase_order_items.push(
    { po_item_id: 31, po_id: 1, product_id: null, quantity: 6, unit_price: 10, total: 60, item_type: "outsourced", outsourced_name: "Svc", source_so_id: 3, source_so_item_id: 31 },
    { po_item_id: 32, po_id: 2, product_id: null, quantity: 4, unit_price: 10, total: 40, item_type: "outsourced", outsourced_name: "Svc", source_so_id: 3, source_so_item_id: 31 },
  )
  db.tables.sales_order_items = [{ so_item_id: 31, so_id: 3, quantity: 10, fulfilled_at: null }]
  assert.equal((await post(rec(1, [{ poItemId: 31, quantityReceived: 6 }]))).status, 200)
  assert.equal(db.tables.sales_order_items[0].fulfilled_at, null, "6 of the 10 needed has arrived: not fulfilled even though PO 1's line is complete")
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PENDING")
  assert.equal((await post(rec(2, [{ poItemId: 32, quantityReceived: 3 }]))).status, 200)
  assert.equal(db.tables.sales_order_items[0].fulfilled_at, null, "9 of 10")
  assert.equal((await post(rec(2, [{ poItemId: 32, quantityReceived: 1 }]))).status, 200)
  assert.ok(db.tables.sales_order_items[0].fulfilled_at, "10 of 10")
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "READY_FOR_FULFILLMENT")
})

test("S46. two POs that each cover the whole SO item (double cover): the first complete receipt fulfils it, the second changes nothing", async () => {
  const db = baseDb()
  db.tables.purchase_order_items.push(
    { po_item_id: 33, po_id: 1, product_id: null, quantity: 4, unit_price: 10, total: 40, item_type: "outsourced", outsourced_name: "Svc", source_so_item_id: 32 },
    { po_item_id: 34, po_id: 2, product_id: null, quantity: 4, unit_price: 10, total: 40, item_type: "outsourced", outsourced_name: "Svc", source_so_item_id: 32 },
  )
  db.tables.sales_order_items = [{ so_item_id: 32, so_id: 3, quantity: 4, fulfilled_at: null }]
  assert.equal((await post(rec(1, [{ poItemId: 33, quantityReceived: 4 }]))).status, 200)
  const stamp = db.tables.sales_order_items[0].fulfilled_at
  assert.ok(stamp)
  assert.equal((await post(rec(2, [{ poItemId: 34, quantityReceived: 4 }]))).status, 200)
  assert.equal(db.tables.sales_order_items[0].fulfilled_at, stamp, "the original fulfilled_at is kept")
})

test("S47. concurrent receipts of the two POs behind one SO item still fulfil it exactly once", async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const db = baseDb()
    db.tables.purchase_order_items.push(
      { po_item_id: 31, po_id: 1, product_id: null, quantity: 6, unit_price: 10, total: 60, item_type: "outsourced", outsourced_name: "Svc", source_so_item_id: 31 },
      { po_item_id: 32, po_id: 2, product_id: null, quantity: 4, unit_price: 10, total: 40, item_type: "outsourced", outsourced_name: "Svc", source_so_item_id: 31 },
    )
    db.tables.sales_order_items = [{ so_item_id: 31, so_id: 3, quantity: 10, fulfilled_at: null }]
    const [a, b] = await Promise.all([post(rec(1, [{ poItemId: 31, quantityReceived: 6 }])), post(rec(2, [{ poItemId: 32, quantityReceived: 4 }]))])
    assert.deepEqual([a.status, b.status], [200, 200])
    assert.ok(db.tables.sales_order_items[0].fulfilled_at, `round ${round}`)
  }
})

// ------------------------------------------------------------------------------------------------ compensation matrix
// For every stage that can fail: never 200, everything this request wrote is undone, the lock is released, and the
// idempotency row allows a clean retry. Then the same failure WITH a failing undo: partialFailure + key parked.
type Stage = { name: string; fail: Record<string, string>; undoBreaker: Record<string, string>; failAfter?: Record<string, number>; undoFailAfter?: Record<string, number> }
const STAGES: Stage[] = [
  { name: "GRN header", fail: { "goods_receipts:insert": "boom" }, undoBreaker: {} },
  { name: "GRN lines", fail: { "goods_receipt_lines:insert": "boom" }, undoBreaker: { "goods_receipts:delete": "cannot delete" } },
  { name: "inventory", fail: { "inventory:update": "boom" }, undoBreaker: { "goods_receipts:delete": "cannot delete" } },
  { name: "inventory batch", fail: { "inventory_batches:insert": "boom" }, undoBreaker: { "inventory:update": "cannot undo stock" }, undoFailAfter: { "inventory:update": 1 } },
  { name: "SO item update", fail: { "sales_order_items:update": "boom" }, undoBreaker: { "inventory:update": "cannot undo stock" }, undoFailAfter: { "inventory:update": 1 } },
  { name: "SO status update", fail: { "sales_orders:update": "boom" }, undoBreaker: { "sales_order_items:update": "cannot clear fulfilled_at" }, undoFailAfter: { "sales_order_items:update": 1 } },
  { name: "PO status update", fail: { "purchase_orders:update": "boom" }, undoBreaker: { "inventory:update": "cannot undo stock" }, undoFailAfter: { "inventory:update": 1 } },
]
// PO 1 fully received in one go (stock 10 + outsourced 5) so every stage is reached, SO 3 has only item 28
const compensationDb = () => {
  const db = baseDb()
  db.tables.sales_order_items = [{ so_item_id: 28, so_id: 3, quantity: 5, fulfilled_at: null }]
  return db
}
const fullReceipt = (extra: Row = {}) => rec(1, [stock(10), outs(5)], extra)
const untouched = (db: FakeDb) => {
  assert.equal(db.tables.goods_receipts.length, 0)
  assert.equal(db.tables.goods_receipt_lines.length, 0)
  assert.equal(invQty(db), 5)
  assert.equal(db.tables.inventory_batches.length, 0)
  assert.equal(db.tables.sales_order_items[0].fulfilled_at, null)
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PENDING")
  assert.equal(poStatus(db, 1), "approved")
}
for (const stage of STAGES) {
  test(`K. ${stage.name} fails: not 200, prior writes undone, lock released, key retryable`, async () => {
    const db = compensationDb()
    Object.assign(db.failOn, stage.fail)
    const key = newKey()
    const res = await post(fullReceipt({ idempotencyKey: key }))
    assert.ok(res.status >= 400, `status ${res.status}`)
    assert.notEqual(res.status, 200)
    assert.equal(res.body.partialFailure, undefined)
    untouched(db)
    assert.equal(locks(db).length, 0, "lock released")
    assert.equal(db.tables.idempotency_log.find((r) => String(r.idempotency_key).endsWith(key))!.status, "failed")
    // once the fault is gone the same key completes normally
    for (const f of Object.keys(stage.fail)) delete db.failOn[f]
    const retry = await post(fullReceipt({ idempotencyKey: key }))
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    assert.equal(poStatus(db, 1), "received")
    assert.equal(invQty(db), 15)
    assert.equal(db.tables.goods_receipts.length, 1)
  })

  test(`K. ${stage.name} fails AND the undo fails: partialFailure, key parked, lock released`, async () => {
    const db = compensationDb()
    Object.assign(db.failOn, stage.fail, stage.undoBreaker)
    Object.assign(db.failAfter, stage.undoFailAfter || {})
    const key = newKey()
    const res = await post(fullReceipt({ idempotencyKey: key }))
    if (stage.name === "GRN header") {
      // nothing had been written yet, so there is nothing to undo
      assert.equal(res.status, 500)
      assert.equal(res.body.partialFailure, undefined)
      return
    }
    assert.equal(res.status, 500)
    assert.equal(res.body.partialFailure, true, JSON.stringify(res.body))
    assert.ok(Array.isArray(res.body.notUndone) && res.body.notUndone.length > 0)
    assert.equal(locks(db).length, 0, "lock released")
    assert.equal(db.tables.idempotency_log.find((r) => String(r.idempotency_key).endsWith(key))!.status, "partial_failure")
    const replay = await post(fullReceipt({ idempotencyKey: key }))
    assert.equal(replay.status, 409)
    assert.equal(replay.body.partialFailure, true)
  })
}
