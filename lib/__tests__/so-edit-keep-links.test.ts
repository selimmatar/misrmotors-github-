// Editing a sales order keeps its line ids (owner report, 2026-11-18): an edit used to re-create the order's lines, so
// purchase-order lines (source_so_item_id) lost their link and the order overview said an item bought and received
// "is not on any purchase order". A line still on the order is changed in place (same so_item_id), only new lines are
// inserted and only removed lines deleted; the PO line of a removed line is left as it is.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as soRoute from "../../app/api/sales-orders/route"
import { buildSoOverview } from "../so-overview"
import { matchSoEditLines, saveSoEditLines, withSoLineIds } from "../so-edit"
import { sortSoLines } from "../line-order"

// SO 1 (not delivered yet): line 1 = 2 x Forklift 3 ton bought on PO 1 and received, line 2 = 4 x Jack on PO 2 (not
// received), line 3 = 10 x Socket set on no PO.
function seed() {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-K-1", customer_id: 5, status: "accountant_approved", total: 3000, subtotal: 3000, discount_amount: 0, notes: null, created_at: "2026-11-02T10:00:00" }],
    customers: [{ customer_id: 5, customer_name: "Al Nour" }],
    products: [],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: null, outsourced_name: "Forklift 3 ton", quantity: 2, unit_price: 1000, total: 2000, item_type: "outsourced", line_order: 1 },
      { so_item_id: 2, so_id: 1, product_id: null, outsourced_name: "Jack", quantity: 4, unit_price: 100, total: 400, item_type: "outsourced", line_order: 2 },
      { so_item_id: 3, so_id: 1, product_id: null, outsourced_name: "Socket set", quantity: 10, unit_price: 60, total: 600, item_type: "outsourced", line_order: 3 },
    ],
    delivery_permits: [],
    delivery_permit_items: [],
    product_returns: [],
    return_items: [],
    purchase_orders: [
      { po_id: 1, po_number: "PO-1", supplier_id: 9, status: "received", total: 1400, created_at: "2026-11-03T08:00:00" },
      { po_id: 2, po_number: "PO-2", supplier_id: 9, status: "approved", total: 280, created_at: "2026-11-03T09:00:00" },
    ],
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, source_so_id: 1, source_so_item_id: 1, quantity: 2, unit_price: 700 },
      { po_item_id: 2, po_id: 2, source_so_id: 1, source_so_item_id: 2, quantity: 4, unit_price: 70 },
    ],
    goods_receipt_lines: [{ line_id: 1, po_item_id: 1, quantity_received: 2 }],
    suppliers: [{ supplier_id: 9, supplier_name: "Mostafa" }],
    accounts_payable: [],
    supplier_credits: [],
    accounts_receivable: [],
    invoice_delivery_permits: [],
    customer_payments: [],
    workflow_events: [],
    inventory: [],
    po_requests: [],
    po_request_items: [],
  })
  useDb(db)
  return db
}

// what the edit dialog sends for a saved line
const sent = (r: Row, extra: Row = {}) => ({
  id: String(r.so_item_id),
  so_item_id: String(r.so_item_id),
  productId: "",
  productName: r.outsourced_name,
  quantity: r.quantity,
  unitPrice: r.unit_price,
  total: Number(r.quantity) * Number(r.unit_price),
  itemType: "outsourced",
  ...extra,
})
const put = (items: any[]) => call(soRoute.PUT as any, "PUT", { so_id: 1, customerId: "5", items })
const saved = (db: FakeDb) => sortSoLines(db.tables.sales_order_items.filter((r) => r.so_id === 1))
const row = (db: FakeDb, id: number) => db.tables.sales_order_items.find((r) => r.so_item_id === id)!

test("K1. changing a line's quantity and price keeps its so_item_id; the PO link still resolves in the overview", async () => {
  const db = seed()
  const before = await buildSoOverview(db, 1)
  assert.equal(before!.lines.find((l: any) => l.name === "Forklift 3 ton")!.state !== "no_po", true)

  const [a, b, c] = saved(db)
  const res = await put([sent(a, { quantity: 3, unitPrice: 1100, total: 3300 }), sent(b), sent(c)])
  assert.equal(res.status, 200, JSON.stringify(res.body))

  assert.deepEqual(saved(db).map((r) => r.so_item_id), [1, 2, 3], "every line keeps its id")
  assert.equal(row(db, 1).quantity, 3)
  assert.equal(row(db, 1).unit_price, 1100)
  assert.deepEqual(db.tables.purchase_order_items.map((p) => p.source_so_item_id), [1, 2], "PO lines untouched")

  const ov = (await buildSoOverview(db, 1))!
  const fork = ov.lines.find((l: any) => l.name === "Forklift 3 ton") as any
  assert.notEqual(fork.state, "no_po", "the forklift is still on its purchase order")
  assert.deepEqual([fork.poNumbers, fork.onPo, fork.received], [["PO-1"], 2, 2], JSON.stringify(fork))
  const jack = ov.lines.find((l: any) => l.name === "Jack") as any
  assert.notEqual(jack.state, "no_po")
  assert.deepEqual(jack.poNumbers, ["PO-2"])
})

test("K2. add and remove lines in one edit: kept lines keep their ids, only the new line is inserted, only the removed one deleted", async () => {
  const db = seed()
  const [a, b, c] = saved(db)
  const res = await put([
    sent(a),
    { productId: "", productName: "Hydraulic hose", quantity: 5, unitPrice: 20, total: 100, itemType: "outsourced" },
    sent(c, { quantity: 8, total: 480 }),
  ])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  void b

  const lines = saved(db)
  assert.deepEqual(lines.map((r) => r.outsourced_name), ["Forklift 3 ton", "Hydraulic hose", "Socket set"])
  assert.equal(lines[0].so_item_id, 1)
  assert.equal(lines[2].so_item_id, 3)
  assert.ok(lines[1].so_item_id > 3, "the new line gets a new id")
  assert.deepEqual(lines.map((r) => r.line_order), [1, 2, 3])
  assert.equal(row(db, 3).quantity, 8)
  assert.equal(db.tables.sales_order_items.some((r) => r.so_item_id === 2), false, "the removed Jack line is gone")
  // the PO line of the removed line is left as it is
  assert.deepEqual(db.tables.purchase_order_items.find((p) => p.po_item_id === 2), { po_item_id: 2, po_id: 2, source_so_id: 1, source_so_item_id: 2, quantity: 4, unit_price: 70 })

  const ov = (await buildSoOverview(db, 1))!
  assert.notEqual((ov.lines.find((l: any) => l.name === "Forklift 3 ton") as any).state, "no_po")
})

test("K3. reorder only: same ids, new line_order in the chosen order", async () => {
  const db = seed()
  const [a, b, c] = saved(db)
  const res = await put([sent(c), sent(a), sent(b)])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const lines = saved(db)
  assert.deepEqual(lines.map((r) => r.so_item_id), [3, 1, 2])
  assert.deepEqual(lines.map((r) => r.line_order), [1, 2, 3])
  assert.equal(db.tables.sales_order_items.length, 3)
  const ov = (await buildSoOverview(db, 1))!
  assert.notEqual((ov.lines.find((l: any) => l.name === "Forklift 3 ton") as any).state, "no_po")
})

test("K4. an older client that sends no ids: lines are matched by item (product, or trimmed outsourced name)", async () => {
  const db = seed()
  const res = await put([
    { productId: "", productName: "  Socket set ", quantity: 10, unitPrice: 60, total: 600, itemType: "outsourced" },
    { productId: "", productName: "Forklift 3 ton", quantity: 2, unitPrice: 1050, total: 2100, itemType: "outsourced" },
    { productId: "", productName: "Jack", quantity: 4, unitPrice: 100, total: 400, itemType: "outsourced" },
  ])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(saved(db).map((r) => r.so_item_id), [3, 1, 2])
  assert.equal(row(db, 1).unit_price, 1050)
})

test("K5. matching: id first, then item for lines without one; foreign / repeated ids and new stored picks are new lines", () => {
  const stored = [
    { so_item_id: 10, product_id: 7, outsourced_name: null, line_order: 2 },
    { so_item_id: 11, product_id: 7, outsourced_name: null, line_order: 1 },
    { so_item_id: 12, product_id: null, outsourced_name: "Jack", line_order: 3 },
  ]
  assert.deepEqual(
    matchSoEditLines(stored, [
      { id: "10", productId: "7" },
      { productId: "7" }, // no id: the other product-7 line
      { productId: "7" }, // no saved line left: new
      { id: "10", productId: "7" }, // sent twice: the copy is new
      { id: "999", productName: "Jack" }, // not a line of this order: new (no fallback)
      { productName: "Jack", fromInventoryId: "4" }, // a new pick from stored stock
    ]),
    [10, 11, null, null, null, null],
  )
  // without ids, product-7 lines are taken in the saved order (line_order)
  assert.deepEqual(matchSoEditLines(stored, [{ productId: "7" }, { productId: "7" }, { productName: " Jack " }]), [11, 10, 12])
  const out = withSoLineIds(stored, [{ so_item_id: 12, productName: "Jack" }, { id: "999", soItemId: "999", productName: "X" }])
  assert.deepEqual(out, [{ productName: "Jack", id: "12" }, { productName: "X" }])
})

test("K6. a failed line write puts back what was written and the route reports it, the order unchanged", async () => {
  const db = seed()
  const from = db.from.bind(db)
  ;(db as any).from = (table: string) => {
    const q: any = from(table)
    if (table !== "sales_order_items") return q
    const insert = q.insert.bind(q)
    q.insert = (payload: any) => {
      const rows = Array.isArray(payload) ? payload : [payload]
      if (rows.some((r: any) => r?.outsourced_name === "Broken")) {
        const failed: any = { select: () => failed, then: (ok: any, bad: any) => Promise.resolve({ data: null, error: { message: "boom" } }).then(ok, bad) }
        return failed
      }
      return insert(payload)
    }
    return q
  }
  const before = JSON.parse(JSON.stringify(db.tables.sales_order_items))
  const headerBefore = { ...db.tables.sales_orders[0] }
  const [a, b, c] = saved(db)
  const res = await call(soRoute.PUT as any, "PUT", {
    so_id: 1, customerId: "5", notes: "edited", total: 9999,
    items: [sent(a, { quantity: 9, total: 9000 }), sent(b), { productId: "", productName: "Broken", quantity: 1, unitPrice: 1, total: 1, itemType: "outsourced" }],
  })
  void c
  assert.equal(res.status, 500, JSON.stringify(res.body))
  assert.equal(res.body.code, "ORDER_LINES_NOT_SAVED")
  assert.deepEqual(sortSoLines(db.tables.sales_order_items).map((r) => [r.so_item_id, r.quantity]), sortSoLines(before).map((r: Row) => [r.so_item_id, r.quantity]))
  assert.equal(db.tables.sales_orders[0].total, headerBefore.total)
  assert.equal(db.tables.sales_orders[0].notes ?? null, headerBefore.notes ?? null)

  // saveSoEditLines on its own: nothing deleted when an insert fails
  const direct = await saveSoEditLines(db, 1, [{ id: 1, row: { quantity: 5 } }, { id: null, row: { so_id: 1, outsourced_name: "Broken" } }])
  assert.equal(direct.ok, false)
  assert.equal(direct.ok === false && direct.undone, true)
  assert.equal(row(db, 1).quantity, 2)
  assert.equal(db.tables.sales_order_items.length, 3)
})
