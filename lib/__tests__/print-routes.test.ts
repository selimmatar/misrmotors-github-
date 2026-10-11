// Batch 3: the REAL route handlers GET /api/sales-orders/print and GET /api/sales-orders/missing-items-pdf against the
// in-memory FakeDb. Both are read-only: every test also checks the database was not touched.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { useDb } from "./route-harness"
import * as printRoute from "../../app/api/sales-orders/print/route"
import * as missingRoute from "../../app/api/sales-orders/missing-items-pdf/route"

const get = async (handler: (req: any) => Promise<Response>, query: string) => {
  const res = await handler(new Request(`http://test.local/api/x${query}`))
  return { status: res.status, html: await res.text(), type: res.headers.get("content-type") || "" }
}

// FakeDb creates an empty table object the first time a query touches an unseeded table; that is not a write.
const data = (snapshot: Record<string, Row[]>) => Object.fromEntries(Object.entries(snapshot).filter(([, rows]) => rows.length > 0))

function world(opts: { status?: string; so?: Row; items?: Row[]; extra?: Record<string, Row[]> } = {}) {
  const items = opts.items ?? [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, unit_price: 10000, total: 100000, item_type: "stock", outsourced_name: null }]
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: opts.status ?? "delivered", order_date: "2026-10-01", total: 114000, net_total: 114000, subtotal: 100000, discount_amount: 0, discount_type: "none", discount_value: 0, payment_type: "bank_transfer", payment_terms: "prepaid", notes: null, ...opts.so }],
    customers: [{ customer_id: 5, customer_name: "Test Customer", phone: "0100", email: "t@example.com" }],
    sales_order_items: items,
    products: [{ product_id: 7, product_name: "Pump A", sku: "A", last_landed_cost: 4000 }],
    inventory: [],
    delivery_permits: [{ permit_id: 1, sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: [{ permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", quantity: 10 }],
    ...opts.extra,
  })
  useDb(db)
  return db
}

test("P1. Print SO works for draft, approved and delivered orders - and uses the SO layout, not the quotation layout", async () => {
  for (const status of ["draft", "pending_accountant", "accountant_approved", "ready_for_delivery", "shipped", "delivered"]) {
    const db = world({ status })
    const before = db.snapshot()
    const res = await get(printRoute.GET, "?soId=1")
    assert.equal(res.status, 200, status)
    assert.match(res.type, /text\/html/)
    assert.match(res.html, /<html dir="rtl" lang="ar">/)
    assert.match(res.html, /<div class="doc-title">أمر بيع<\/div>/, status)
    assert.doesNotMatch(res.html, /عرض سعر/, status) // no quotation wording
    assert.match(res.html, /SO-T-1/)
    assert.match(res.html, /Pump A/)
    assert.deepEqual(data(db.snapshot()), data(before), "read-only")
  }
})

test("P2. soId validation and error codes; failures never print partial documents", async () => {
  world()
  for (const q of ["", "?soId=", "?soId=abc", "?soId=0", "?soId=-3", "?soId=12abc", "?soId=1.5", "?soId=99999999999"]) assert.equal((await get(printRoute.GET, q)).status, 400, q)
  assert.equal((await get(printRoute.GET, "?soId=999")).status, 404)
  const db = world()
  db.failOn["sales_order_items:select"] = "boom"
  const failed = await get(printRoute.GET, "?soId=1")
  assert.equal(failed.status, 500)
  assert.doesNotMatch(failed.html, /SO-T-1/)
})

test("P3. every dynamic value is escaped (customer, item names, notes, address, SO number)", async () => {
  const evil = `<script>alert("x")</script>`
  const db = world({
    so: { notes: evil, delivery_address: evil, delivery_contact_name: evil, so_number: `SO<${"b"}>1` },
    items: [{ so_item_id: 1, so_id: 1, product_id: null, quantity: 1, unit_price: 100, total: 100, item_type: "outsourced", outsourced_name: evil }],
  })
  db.tables.customers[0].customer_name = evil
  const res = await get(printRoute.GET, "?soId=1")
  assert.equal(res.status, 200)
  assert.doesNotMatch(res.html, /<script>alert/)
  assert.match(res.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/)
  assert.doesNotMatch(res.html, /SO<b>1/)
})

test("P4. returns: original total, returns adjustment and current net total (agree with the stored Batch 2 net_total)", async () => {
  const db = world({
    so: { total: 114000, net_total: 91200 },
    extra: {
      product_returns: [{ return_id: 1, permit_id: "1", status: "pending_warehouse", created_at: "2026-10-02T00:00:00Z" }],
      return_items: [{ return_item_id: 1, return_id: 1, product_id: 7, product_name: "Pump A", returned_quantity: 2 }],
    },
  })
  const res = await get(printRoute.GET, "?soId=1")
  assert.match(res.html, /الإجمالي الأصلي/)
  assert.match(res.html, /مرتجعات \/ تسويات/)
  assert.match(res.html, /صافي الإجمالي الحالي/)
  assert.match(res.html, /114,000/)
  assert.match(res.html, /-22,800/)
  assert.match(res.html, />91,200</)
  assert.match(res.html, /مرتجع: 2/)
  assert.equal(db.tables.sales_orders[0].total, 114000) // nothing rewritten
  // an order without returns shows one plain total and no adjustment lines
  world()
  const plain = await get(printRoute.GET, "?soId=1")
  assert.doesNotMatch(plain.html, /مرتجعات/)
  assert.doesNotMatch(plain.html, /صافي الإجمالي الحالي/)
})

test("P5. prints the CURRENT saved state, not an earlier one", async () => {
  const db = world()
  assert.match((await get(printRoute.GET, "?soId=1")).html, /Pump A/)
  db.tables.sales_order_items[0].quantity = 3
  db.tables.sales_order_items[0].total = 30000
  const second = await get(printRoute.GET, "?soId=1")
  assert.match(second.html, /<td class="center">3<\/td>/)
})

test("P6. SO with a discount: breakdown shown and equals the stored total (SO-2026-0004 style)", async () => {
  world({
    so: { total: 1038725.19, net_total: 1038725.19, discount_amount: 18595.15, discount_type: "percentage", discount_value: 2 },
    items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 1, unit_price: 929757.6, total: 929757.6, item_type: "stock", outsourced_name: null }],
  })
  const html = (await get(printRoute.GET, "?soId=1")).html
  assert.match(html, />911,162\.45<\/td>/) // net subtotal, one money column (no piastre column)
  assert.match(html, /127,562/) // VAT 127,562.74
  assert.match(html, /1,038,725/)
})

test("P7. long SO: ONE totals block, after the item table, no <tfoot>, kept in one piece", async () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ so_item_id: i + 1, so_id: 1, product_id: null, quantity: 1, unit_price: 100, total: 100, item_type: "outsourced", outsourced_name: `Item ${i + 1}` }))
  world({ items, so: { total: 13680, net_total: 13680 } })
  const html = (await get(printRoute.GET, "?soId=1")).html
  assert.doesNotMatch(html, /<tfoot/i)
  assert.equal((html.match(/class="totals-block"/g) || []).length, 1)
  assert.equal((html.match(/الإجمالي</g) || []).length, 1)
  const lastItemRow = html.lastIndexOf("Item 120")
  const closeItems = html.indexOf("</table>", lastItemRow)
  assert.ok(html.indexOf('class="totals-block"') > closeItems, "totals come after the whole items table")
  assert.match(html, /\.totals-block \{[^}]*break-inside: avoid; page-break-inside: avoid/)
  assert.match(html, /\.items-table thead \{ display: table-header-group; \}/)
})

// ---------------------------------------------------------------------------------------------------------------
// Missing Items route
// ---------------------------------------------------------------------------------------------------------------
test("R1. Missing Items: Unit Cost visible by default; hideCost=1 / true hides the column AND the cost total; other values do not", async () => {
  const db = world() // product cost 4000 -> total cost of 10 missing = 40,000
  db.tables.delivery_permits = [] // nothing delivered yet
  const shown = await get(missingRoute.GET, "?soId=1")
  assert.equal(shown.status, 200)
  assert.match(shown.html, /<th>Unit Cost<\/th>/)
  assert.match(shown.html, /EGP 4,000\.00/)
  assert.match(shown.html, /Total cost of missing items/)
  assert.doesNotMatch(shown.html, /EGP 10,000/) // the selling price is never printed as a cost
  for (const q of ["&hideCost=1", "&hideCost=true", "&hideCost=TRUE"]) {
    const hidden = await get(missingRoute.GET, `?soId=1${q}`)
    assert.doesNotMatch(hidden.html, /Unit Cost/, q)
    assert.doesNotMatch(hidden.html, /Total cost of missing items/, q)
    assert.doesNotMatch(hidden.html, /EGP/, q)
    assert.match(hidden.html, /Missing/, q)
  }
  for (const q of ["&hideCost=0", "&hideCost=yes", "&hideCost=", "&hideCost=1;drop"]) assert.match((await get(missingRoute.GET, `?soId=1${q}`)).html, /<th>Unit Cost<\/th>/, q)
})

test("R2. Missing Items: a delivered item with no cost shows n/a, no invented total", async () => {
  const db = world({ items: [{ so_item_id: 1, so_id: 1, product_id: null, quantity: 4, unit_price: 99999, total: 399996, item_type: "outsourced", outsourced_name: "Borescope", outsourced_description: "Supplier: SMG" }] })
  db.tables.delivery_permits = []
  db.tables.delivery_permit_items = []
  const res = await get(missingRoute.GET, "?soId=1")
  assert.match(res.html, /n\/a/)
  assert.doesNotMatch(res.html, /99,999/)
  assert.match(res.html, /EGP 0\.00/)
  assert.match(res.html, /1 item with unit cost n\/a not included/)
})

test("R3. Missing Items: validation, 404, 500; escapes names; read-only", async () => {
  const db = world({ items: [{ so_item_id: 1, so_id: 1, product_id: null, quantity: 2, unit_price: 1, total: 2, item_type: "outsourced", outsourced_name: `<img src=x onerror=alert(1)>`, outsourced_description: "Supplier: <b>x</b>" }] })
  db.tables.delivery_permits = []
  const before = db.snapshot()
  for (const q of ["", "?soId=abc", "?soId=0", "?soId=3x"]) assert.equal((await get(missingRoute.GET, q)).status, 400, q)
  assert.equal((await get(missingRoute.GET, "?soId=404")).status, 404)
  const res = await get(missingRoute.GET, "?soId=1")
  assert.doesNotMatch(res.html, /<img src=x/)
  assert.doesNotMatch(res.html, /<b>x<\/b>/)
  assert.match(res.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.deepEqual(data(db.snapshot()), data(before))
  db.failOn["delivery_permits:select"] = "boom"
  assert.equal((await get(missingRoute.GET, "?soId=1")).status, 500)
})

test("R4. Missing Items: a fully delivered order says so; returns bring the quantity back", async () => {
  world()
  assert.match((await get(missingRoute.GET, "?soId=1")).html, /Missing Items Report/)
  const db = world()
  db.tables.product_returns = []
  assert.equal(db.tables.delivery_permits.length, 1)
  const done = await get(missingRoute.GET, "?soId=1")
  assert.match(done.html, /No missing items/)
  world({ extra: { product_returns: [{ return_id: 1, permit_id: "1", status: "pending_warehouse", created_at: "2026-10-02T00:00:00Z" }], return_items: [{ return_item_id: 1, return_id: 1, product_id: 7, product_name: "Pump A", returned_quantity: 3 }] } })
  const back = await get(missingRoute.GET, "?soId=1")
  assert.doesNotMatch(back.html, /No missing items/)
  assert.match(back.html, /<td class="n missing">3<\/td>/)
})

test("R5. Missing Items report has the separate Out for Delivery column with the right figures", async () => {
  const db = world({ items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, unit_price: 10000, total: 100000, item_type: "stock", outsourced_name: null }] })
  db.tables.delivery_permits = [{ permit_id: 1, sales_order_id: 1, status: "OUT_FOR_DELIVERY" }, { permit_id: 2, sales_order_id: 1, status: "APPROVED" }, { permit_id: 3, sales_order_id: 1, status: "DRAFT" }]
  db.tables.delivery_permit_items = [{ permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", quantity: 3 }, { permit_id: 2, product_id: 7, item_name_snapshot: "Pump A", quantity: 4 }, { permit_id: 3, product_id: 7, item_name_snapshot: "Pump A", quantity: 2 }]
  db.tables.product_returns = [{ return_id: 1, permit_id: "2", status: "pending_warehouse", created_at: "2026-10-02T00:00:00Z" }]
  db.tables.return_items = [{ return_item_id: 1, return_id: 1, product_id: 7, product_name: "Pump A", returned_quantity: 1 }]
  const html = (await get(missingRoute.GET, "?soId=1")).html
  assert.match(html, /<th class="n">Out for Delivery<\/th>/)
  const headers = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])
  assert.deepEqual(headers.slice(headers.indexOf("Ordered"), headers.indexOf("Received") + 1), ["Ordered", "Out for Delivery", "Delivered", "Returned", "Net Delivered", "Missing", "PO Ordered", "Received"])
  // Ordered 10 | Out for Delivery 3 | Delivered 4 | Returned 1 | Net 3 | Missing 4
  const cells = [...html.matchAll(/<td class="n( missing)?">(\d+)<\/td>/g)].map((m) => m[2]).slice(0, 8)
  assert.deepEqual(cells, ["10", "3", "4", "1", "3", "4", "0", "0"])
})

test("R6. report labels a PO-price valuation and notes it under the cost total", async () => {
  const db = world({ items: [{ so_item_id: 1, so_id: 1, product_id: null, quantity: 4, unit_price: 99999, total: 1, item_type: "outsourced", outsourced_name: "Borescope", outsourced_description: "Supplier: SMG" }] })
  db.tables.delivery_permits = []
  db.tables.purchase_orders = [{ po_id: 1, po_number: "PO-1", status: "approved" }]
  db.tables.purchase_order_items = [{ po_item_id: 1, po_id: 1, source_so_item_id: 1, quantity: 4, landed_cost: 0, unit_price: 750 }]
  const html = (await get(missingRoute.GET, "?soId=1")).html
  assert.match(html, /EGP 750\.00<div class="sku">PO Price<\/div>/)
  assert.match(html, /EGP 3,000\.00/) // 4 missing x 750
  assert.match(html, /1 item valued at PO Price/)
  assert.doesNotMatch(html, /99,999/)
  assert.doesNotMatch((await get(missingRoute.GET, "?soId=1&hideCost=1")).html, /PO Price|EGP/)
})
