// Batch 4E tests: POST /api/warehouse-transfers/complete (the REAL route handler; only the database is the FakeDb).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as route from "../../app/api/warehouse-transfers/complete/route"

// Warehouse 1 -> 2. Product 7: 10 @100 at source. Product 8: 3 @50 at source. Destination has product 7 (4 @ 130) only.
function mk(extra: Record<string, Row[]> = {}, transferStatus = "pending") {
  const db = new FakeDb({
    warehouse_transfers: [{ transfer_id: 1, transfer_number: "WT-1", source_warehouse_id: 1, destination_warehouse_id: 2, status: transferStatus, completion_date: null }],
    warehouse_transfer_items: [{ item_id: 1, transfer_id: 1, product_id: 7, product_name: "Pump A", quantity_requested: 6, quantity_sent: null, is_outsourced: false, source_inventory_id: null }],
    inventory: [
      { inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10, unit_cost: 100, reorder_point: 0 },
      { inventory_id: 101, product_id: 8, warehouse_id: 1, is_returned: false, quantity: 3, unit_cost: 50, reorder_point: 0 },
      { inventory_id: 102, product_id: 7, warehouse_id: 2, is_returned: false, quantity: 4, unit_cost: 130, reorder_point: 0 },
      { inventory_id: 103, product_id: 7, warehouse_id: 1, is_returned: true, quantity: 99, unit_cost: 1, reorder_point: 0 },
    ],
    inventory_transactions: [],
    ...extra,
  })
  useDb(db)
  return db
}
const complete = (id: unknown = 1) => call(route.POST, "POST", { transferId: id })
const inv = (db: FakeDb, id: number) => db.tables.inventory.find((i) => i.inventory_id === id)!
const status = (db: FakeDb) => db.tables.warehouse_transfers[0].status
const addItem = (db: FakeDb, r: Row) => db.tables.warehouse_transfer_items.push({ item_id: db.tables.warehouse_transfer_items.length + 1, transfer_id: 1, is_outsourced: false, source_inventory_id: null, ...r })

test("transfers: happy path moves 6 of 10, adds to the existing destination row at the averaged cost, completes", async () => {
  const db = mk()
  const r = await complete()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(inv(db, 100).quantity, 4)
  assert.equal(inv(db, 102).quantity, 10)
  assert.equal(inv(db, 102).unit_cost, 112) // (4*130 + 6*100) / 10
  assert.equal(inv(db, 103).quantity, 99) // returned-holding row untouched
  assert.equal(status(db), "completed")
  assert.ok(db.tables.warehouse_transfers[0].completion_date)
})

test("transfers: destination row is created (at the source cost) when it does not exist", async () => {
  const db = mk()
  addItem(db, { product_id: 8, product_name: "Seal", quantity_requested: 2, quantity_sent: 2 })
  const r = await complete()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const created = db.tables.inventory.find((i) => i.product_id === 8 && i.warehouse_id === 2)!
  assert.ok(created)
  assert.deepEqual([created.quantity, created.unit_cost, created.is_returned], [2, 50, false])
  assert.equal(inv(db, 101).quantity, 1)
})

test("transfers: insufficient stock -> 409, nothing moved, transfer still pending", async () => {
  const db = mk()
  db.tables.warehouse_transfer_items[0].quantity_requested = 11
  const before = JSON.stringify(db.tables.inventory)
  const r = await complete()
  assert.equal(r.status, 409)
  assert.match(r.body.error, /Insufficient/)
  assert.equal(JSON.stringify(db.tables.inventory), before)
  assert.equal(status(db), "pending")
  assert.equal(db.tables.inventory_transactions.length, 0)
})

test("transfers: insufficiency on the 2nd item moves nothing (first item is not deducted)", async () => {
  const db = mk()
  addItem(db, { product_id: 8, product_name: "Seal", quantity_requested: 5, quantity_sent: 5 }) // only 3 on hand
  const before = JSON.stringify(db.tables.inventory)
  const r = await complete()
  assert.equal(r.status, 409)
  assert.equal(JSON.stringify(db.tables.inventory), before)
  assert.equal(status(db), "pending")
})

test("transfers: two items drawing on the same source row are checked together", async () => {
  const db = mk()
  addItem(db, { product_id: 7, product_name: "Pump A", quantity_requested: 6, quantity_sent: 6 }) // 6 + 6 > 10
  const before = JSON.stringify(db.tables.inventory)
  const r = await complete()
  assert.equal(r.status, 409)
  assert.equal(JSON.stringify(db.tables.inventory), before)
})

test("transfers: stock that vanishes between the check and the move -> 409 and everything already moved is put back", async () => {
  const db = mk()
  addItem(db, { product_id: 8, product_name: "Seal", quantity_requested: 3, quantity_sent: 3 })
  // the 2nd item's source is emptied by someone else right after the first item has been moved
  const real = db.from.bind(db)
  let moved = false
  ;(db as any).from = (table: string) => {
    const q = real(table)
    if (table === "inventory" && !moved && inv(db, 102).quantity === 10) {
      moved = true
      inv(db, 101).quantity = 0
    }
    return q
  }
  const r = await complete()
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(inv(db, 100).quantity, 10)
  assert.equal(inv(db, 102).quantity, 4)
  assert.equal(inv(db, 102).unit_cost, 130)
  assert.equal(status(db), "pending")
  assert.equal(db.tables.warehouse_transfers[0].completion_date, null)
})

test("transfers: a failure while moving reverts the status and undoes the items already moved", async () => {
  const db = mk()
  addItem(db, { product_id: 8, product_name: "Seal", quantity_requested: 2, quantity_sent: 2 })
  db.failOn["inventory:insert"] = "boom" // product 8 has no destination row, so creating it fails after item 1 was moved
  const r = await complete()
  assert.equal(r.status, 500)
  assert.match(r.body.error, /boom/)
  assert.equal(inv(db, 100).quantity, 10)
  assert.equal(inv(db, 101).quantity, 3)
  assert.equal(inv(db, 102).quantity, 4)
  assert.equal(inv(db, 102).unit_cost, 130)
  assert.equal(status(db), "pending")
})

test("transfers: concurrent double complete moves the stock once", async () => {
  for (let i = 0; i < 20; i++) {
    const db = mk()
    const res = await Promise.all([complete(), complete(), complete()])
    assert.equal(res.filter((r) => r.status === 200).length, 1, `round ${i}: ${JSON.stringify(res.map((r) => r.status))}`)
    for (const r of res) assert.ok([200, 409].includes(r.status))
    assert.equal(inv(db, 100).quantity, 4, `round ${i}`)
    assert.equal(inv(db, 102).quantity, 10, `round ${i}`)
    assert.equal(db.tables.inventory_transactions.length, 2)
  }
})

test("transfers: a completed transfer cannot be completed again", async () => {
  const db = mk()
  assert.equal((await complete()).status, 200)
  const r = await complete()
  assert.equal(r.status, 409)
  assert.equal(inv(db, 100).quantity, 4)
  assert.equal(inv(db, 102).quantity, 10)
  const cancelled = mk({}, "cancelled")
  assert.equal((await complete()).status, 409)
  assert.equal(inv(cancelled, 100).quantity, 10)
})

test("transfers: in_transit transfers can be completed; unknown transfer is 404", async () => {
  const db = mk({}, "in_transit")
  assert.equal((await complete()).status, 200)
  assert.equal(status(db), "completed")
  assert.equal((await complete(99)).status, 404)
})

test("transfers: audit rows are written as 'adjustment' (the only allowed type) with the transfer reference", async () => {
  const db = mk()
  await complete()
  const rows = db.tables.inventory_transactions
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((t) => [t.transaction_type, t.quantity_change, t.reference_type, t.reference_number, t.reference_id, t.product_id]), [
    ["adjustment", -6, "WAREHOUSE_TRANSFER", "WT-1", 1, 7],
    ["adjustment", 6, "WAREHOUSE_TRANSFER", "WT-1", 1, 7],
  ])
})

test("transfers: an audit-log failure is logged and does not undo the completed transfer", async () => {
  const db = mk()
  db.failOn["inventory_transactions:insert"] = "audit down"
  const logged: string[] = []
  const original = console.error
  console.error = (...a: any[]) => void logged.push(a.join(" "))
  try {
    const r = await complete()
    assert.equal(r.status, 200, JSON.stringify(r.body))
  } finally {
    console.error = original
  }
  assert.ok(logged.some((l) => l.includes("audit log insert failed") && l.includes("audit down")), logged.join("|"))
  assert.equal(status(db), "completed")
  assert.equal(inv(db, 100).quantity, 4)
  assert.equal(inv(db, 102).quantity, 10)
})

test("transfers: outsourced items move without an audit row", async () => {
  const db = mk({
    warehouse_transfer_items: [{ item_id: 1, transfer_id: 1, product_id: null, product_name: "Crane hire", outsourced_name: "Crane hire", quantity_requested: 2, quantity_sent: 2, is_outsourced: true, source_inventory_id: 200 }],
    inventory: [{ inventory_id: 200, product_id: null, warehouse_id: 1, is_returned: false, is_outsourced: true, outsourced_name: "Crane hire", quantity: 5, unit_cost: 10, reorder_point: 0 }],
  })
  const r = await complete()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(inv(db, 200).quantity, 3)
  const dest = db.tables.inventory.find((i) => i.warehouse_id === 2)!
  assert.deepEqual([dest.quantity, dest.is_outsourced, dest.outsourced_name], [2, true, "Crane hire"])
  assert.equal(db.tables.inventory_transactions.length, 0)
})
