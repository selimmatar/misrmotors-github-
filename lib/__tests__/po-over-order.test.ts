// Batch 4D tests: POST/PUT /api/purchase-orders must not order more than a sales-order line needs
// (the REAL route handlers; only the database is the FakeDb).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as poRoute from "../../app/api/purchase-orders/route"
import { describeOverOrderLines } from "../po-over-order"

// SO line 10 needs 10 units; SO line 11 needs 4 units.
const soItems = (): Row[] => [
  { so_item_id: 10, so_id: 1, quantity: 10 },
  { so_item_id: 11, so_id: 1, quantity: 4 },
]
const po = (po_id: number, status: string): Row => ({ po_id, po_number: `PO-T-${po_id}`, supplier_id: 1, status, total: 100, payment_type: "cash" })
const line = (po_item_id: number, po_id: number, source_so_item_id: number, quantity: number): Row => ({
  po_item_id, po_id, source_so_id: 1, source_so_item_id, quantity, unit_price: 1, total: quantity,
})

function mk(pos: Row[] = [], poItems: Row[] = []) {
  const db = new FakeDb({ sales_order_items: soItems(), purchase_orders: pos, purchase_order_items: poItems, accounts_payable: [] })
  let n = 0
  db.rpcHandlers.generate_po_number = () => `PO-GEN-${++n}`
  useDb(db)
  return db
}
const post = (items: Row[], extra: Row = {}) =>
  call(poRoute.POST, "POST", { supplier_id: 1, status: "pending", total: 100, payment_terms: "cash", items, ...extra })
const put = (body: Row) => call(poRoute.PUT, "PUT", body)
const item = (qty: number, soItemId: any, extra: Row = {}): Row => ({
  productId: 5, productName: "Part", quantity: qty, unitPrice: 1, total: qty, sourceSoId: "1", sourceSoItemId: soItemId, ...extra,
})

test("O1. ordering less than the SO quantity is allowed", async () => {
  const db = mk()
  const r = await post([item(6, "10")])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders.length, 1)
  assert.equal(db.tables.purchase_order_items[0].quantity, 6)
})

test("O2. ordering exactly the SO quantity is allowed", async () => {
  const db = mk()
  assert.equal((await post([item(10, "10")])).status, 200)
  assert.equal(db.tables.purchase_order_items.length, 1)
})

test("O3. over by 1 is blocked with details and nothing is written", async () => {
  const db = mk()
  const r = await post([item(11, "10")])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "PO_OVER_ORDER")
  assert.deepEqual(r.body.lines, [{ sourceSoItemId: 10, soQty: 10, alreadyOrdered: 0, requested: 11, allowed: 10 }])
  assert.ok(typeof r.body.error === "string" && r.body.error.length > 0)
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal(db.tables.purchase_order_items.length, 0)
})

test("O4. two POs on the same SO line: the second is blocked (6 + 6 > 10), 4 more is fine", async () => {
  const db = mk()
  assert.equal((await post([item(6, 10)])).status, 200)
  const r = await post([item(6, 10)])
  assert.equal(r.status, 409)
  assert.deepEqual(r.body.lines, [{ sourceSoItemId: 10, soQty: 10, alreadyOrdered: 6, requested: 6, allowed: 4 }])
  assert.equal(db.tables.purchase_orders.length, 1)
  assert.equal((await post([item(4, 10)])).status, 200)
})

test("O5. a rejected PO releases its quantity", async () => {
  const db = mk([po(1, "rejected"), po(2, "pending")], [line(1, 1, 10, 10), line(2, 2, 10, 3)])
  assert.equal((await post([item(7, 10)])).status, 200) // 3 (pending) + 7 = 10, the rejected 10 is ignored
  assert.equal((await post([item(1, 10)])).status, 409)
  assert.equal(db.tables.purchase_orders.length, 3)
})

test("O6. editing a PO's own lines does not double count them", async () => {
  const db = mk([po(1, "pending"), po(2, "pending")], [line(1, 1, 10, 6), line(2, 2, 10, 3)])
  // PO 1 may grow to 7 (3 on PO 2 + 7 = 10) ...
  const ok = await put({ id: "1", items: [item(7, "10")] })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.purchase_order_items.find((i) => i.po_id === 1)!.quantity, 7)
  // ... but not to 8, and the failed edit leaves the old lines in place
  const bad = await put({ id: 1, items: [item(8, 10)] })
  assert.equal(bad.status, 409)
  assert.equal(bad.body.code, "PO_OVER_ORDER")
  assert.deepEqual(bad.body.lines, [{ sourceSoItemId: 10, soQty: 10, alreadyOrdered: 3, requested: 8, allowed: 7 }])
  assert.equal(db.tables.purchase_order_items.find((i) => i.po_id === 1)!.quantity, 7)
})

test("O7. a status-only PUT that resends the unchanged items is not blocked", async () => {
  const db = mk([po(1, "pending")], [line(1, 1, 10, 10)])
  const r = await put({ id: 1, status: "approved", items: [item(10, 10)] })
  // the PO is still pending when the items are checked; its own 10 are not counted against itself
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].status, "approved")
})

test("O8. lines without source_so_item_id are skipped", async () => {
  const db = mk()
  const r = await post([{ productId: 5, productName: "Free", quantity: 999, unitPrice: 1, total: 999 }, item(2, 10)])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_order_items.length, 2)
})

test("O9. an unknown source_so_item_id is a 400 and writes nothing", async () => {
  const db = mk()
  const r = await post([item(1, 999)])
  assert.equal(r.status, 400)
  assert.equal(r.body.code, "PO_UNKNOWN_SO_ITEM")
  assert.equal(db.tables.purchase_orders.length, 0)
})

test("O10. PUT items keep source_so_* and outsourced fields", async () => {
  const db = mk([po(1, "pending")], [line(1, 1, 10, 2)])
  const r = await put({
    id: 1,
    items: [
      item(3, "10"),
      {
        itemType: "outsourced", productName: "Paint job", outsourcedName: "Paint job", outsourcedDescription: "Supplier: ACME",
        outsourcedUnit: "job", quantity: 2, unitPrice: 5, total: 10, sourceSoId: "1", sourceSoItemId: "11",
      },
    ],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const rows = db.tables.purchase_order_items.filter((i) => i.po_id === 1)
  assert.equal(rows.length, 2)
  const stock = rows.find((i) => i.item_type === "stock")!
  assert.equal(String(stock.source_so_item_id), "10")
  assert.equal(String(stock.source_so_id), "1")
  assert.equal(stock.product_id, 5)
  const out = rows.find((i) => i.item_type === "outsourced")!
  assert.equal(out.product_id, null)
  assert.equal(out.outsourced_name, "Paint job")
  assert.equal(out.outsourced_description, "Supplier: ACME")
  assert.equal(out.outsourced_unit, "job")
  assert.equal(String(out.source_so_item_id), "11")
  assert.equal(out.quantity, 2)
})

test("O11. string and integer ids are treated alike", async () => {
  mk([po(1, "pending")], [line(1, 1, 10, 5)])
  assert.equal((await post([item(5, "10")])).status, 200)
  assert.equal((await post([item(1, 10)])).status, 409)
  assert.equal((await post([item(1, "10")])).status, 409)
})

test("O12. several lines of one request on the same SO line are summed", async () => {
  const db = mk()
  const r = await post([item(6, 10), item(5, "10")])
  assert.equal(r.status, 409)
  assert.deepEqual(r.body.lines, [{ sourceSoItemId: 10, soQty: 10, alreadyOrdered: 0, requested: 11, allowed: 10 }])
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal((await post([item(6, 10), item(4, "10")])).status, 200)
})

test("O13. every offending line is reported; a fully valid other line does not hide them", async () => {
  mk()
  const r = await post([item(11, 10), item(5, 11), item(1, 11)])
  assert.equal(r.status, 409)
  assert.equal(r.body.lines.length, 2)
  assert.deepEqual(r.body.lines.map((l: any) => l.sourceSoItemId).sort(), [10, 11])
})

test("O14. allow_over_order: true lets an over-ordering PO through; without it the 409 stays", async () => {
  const db = mk([po(1, "pending")], [line(1, 1, 10, 10)])
  assert.equal((await post([item(27, "10")])).status, 409)
  const r = await post([item(27, "10")], { allow_over_order: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders.length, 2)
  assert.equal(db.tables.purchase_orders[1].allow_over_order, undefined, "the flag is not stored as a column")
  assert.equal(db.tables.purchase_order_items[1].quantity, 27)
})

test("O15. allow_over_order does not bypass the unknown-SO-line check", async () => {
  mk()
  const r = await post([item(1, "999")], { allow_over_order: true })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, "PO_UNKNOWN_SO_ITEM")
})

test("O16. PUT with allow_over_order: true accepts an increased over-ordering line", async () => {
  const db = mk([po(1, "pending")], [line(1, 1, 10, 5)])
  assert.equal((await put({ id: "1", items: [item(12, "10")] })).status, 409)
  const r = await put({ id: "1", items: [item(12, "10")], allow_over_order: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].allow_over_order, undefined)
})

test("O17. describeOverOrderLines names each line by product and fills the template", () => {
  const text = describeOverOrderLines(
    [{ sourceSoItemId: 199, soQty: 27, alreadyOrdered: 27, requested: 27, allowed: 0 }, { sourceSoItemId: 7, soQty: 2, alreadyOrdered: 0, requested: 3, allowed: 2 }],
    [{ sourceSoItemId: "199", productName: "Brake pad" }],
    "{product}: {needed} / {ordered} / {requested}",
  )
  assert.equal(text, "Brake pad: 27 / 27 / 27\n#7: 2 / 0 / 3")
})
