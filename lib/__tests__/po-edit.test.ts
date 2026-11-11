// Open purchase orders (owner request, 2026-11-08 edit; 2026-11-11 open POs): a PO is work in progress until it is
// closed. While open it can be edited (even after receiving), items can be exchanged on it, an item a customer
// returned can go back to the supplier by lowering it, and advances can be paid on it. Closing makes the supplier
// bill from the final PO (advances and reserved credits counted as paid); reopening removes it while nothing is paid.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as editRoute from "../../app/api/purchase-orders/edit/route"
import * as closeRoute from "../../app/api/purchase-orders/close/route"
import * as reopenRoute from "../../app/api/purchase-orders/reopen/route"
import * as advanceRoute from "../../app/api/purchase-orders/advance/route"
import * as exchangeRoute from "../../app/api/purchase-orders/exchange/route"
import { PO_CLOSABLE_STATUSES, PO_CLOSE_ROLES, PO_EDITABLE_STATUSES } from "../po-edit"
import { createReturn, previewReturnedItemCredit, processReturn, removeReturnedItem } from "../returns"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

const po = (extra: Row = {}): Row => ({
  po_id: 1, po_number: "PO-1", supplier_id: 1, status: "approved", total: 114, tax_amount: 14,
  payment_type: "cash", payment_terms: "prepaid", order_date: "2026-11-01", delivery_date: "2026-11-10", ...extra,
})
const bill = (extra: Row = {}): Row => ({
  invoice_id: 50, invoice_number: "APINV-PO-1", po_id: 1, supplier_id: 1, amount: 114, paid_amount: 0, status: "pending",
  payment_type: "cash", months_paid: 0, due_date: "2026-11-01", ...extra,
})
const line = (extra: Row = {}): Row => ({
  po_item_id: 7, po_id: 1, product_id: 5, item_name_snapshot: "Pump", quantity: 2, unit_price: 50, total: 100,
  item_type: "stock", source_so_id: null, source_so_item_id: null, ...extra,
})

function mk(tables: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    suppliers: [{ supplier_id: 1, supplier_name: "A" }, { supplier_id: 2, supplier_name: "B" }],
    products: [{ product_id: 5, product_name: "Pump" }, { product_id: 6, product_name: "Pump XL" }],
    purchase_orders: [po()],
    purchase_order_items: [line()],
    accounts_payable: [],
    supplier_payments: [],
    payment_schedules: [],
    supplier_credits: [],
    goods_receipts: [],
    goods_receipt_lines: [],
    sales_order_items: [],
    balance_entries: [],
    workflow_events: [],
    ...tables,
  })
  useDb(db)
  return db
}
const body = (extra: Row = {}) => ({
  id: "1",
  supplier_id: "1",
  order_date: "2026-11-01",
  delivery_date: "2026-11-20",
  payment_type: "cash",
  payment_terms: "prepaid",
  items: [{ id: "7", productId: "5", productName: "Pump", quantity: 3, unitPrice: 60 }],
  ...extra,
})
const edit = (b: Row) => call(editRoute.POST as any, "POST", b)
const close = (id = 1) => call(closeRoute.POST as any, "POST", { id: String(id) })
const reopen = (id = 1) => call(reopenRoute.POST as any, "POST", { id: String(id) })
const advance = (b: Row) => call(advanceRoute.POST as any, "POST", { id: "1", paymentMethod: "cash", ...b })
const exchange = (b: Row) => call(exchangeRoute.POST as any, "POST", { id: "1", ...b })
const history = async () => {
  const res = await (exchangeRoute.GET as any)(new Request("http://test.local/api/purchase-orders/exchange?poId=1"))
  return res.json()
}
const receive = (db: FakeDb, poItemId: number, qty: number) => {
  db.tables.goods_receipts.push({ receipt_id: 90 + db.tables.goods_receipts.length, po_id: 1, grn_number: "GRN-X" })
  db.tables.goods_receipt_lines.push({ line_id: 900 + db.tables.goods_receipt_lines.length, receipt_id: 90, po_item_id: poItemId, quantity_received: qty })
}

// ------------------------------------------------------------------------------------------------------- editing
test("E1. an open approved PO: items, total and dates saved in place (same line id); no supplier bill is made", async () => {
  const db = mk()
  const r = await edit(body())
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const order = db.tables.purchase_orders[0]
  assert.equal(order.status, "approved")
  assert.equal(order.total, 205.2) // 3 x 60 = 180 + 14% VAT (VAT stays on)
  assert.equal(order.tax_amount, 25.2)
  assert.equal(order.delivery_date, "2026-11-20")
  assert.deepEqual(db.tables.purchase_order_items.map((l) => [l.po_item_id, l.quantity, l.total]), [[7, 3, 180]])
  assert.equal(db.tables.accounts_payable.length, 0)
})

test("E2. editable after receiving: more ordered -> partially received; a received line removed is kept at 0", async () => {
  const db = mk({ purchase_orders: [po({ status: "received" })] })
  receive(db, 7, 2)
  const r = await edit(body({ items: [{ id: "7", productId: "5", productName: "Pump", quantity: 5, unitPrice: 50 }] }))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].status, "partially_received", "3 more can still be received")
  assert.equal(db.tables.purchase_order_items[0].po_item_id, 7, "receiving records stay linked")
  const swap = await edit(body({ items: [{ productId: "6", productName: "Pump XL", quantity: 2, unitPrice: 70 }] }))
  assert.equal(swap.status, 200, JSON.stringify(swap.body))
  const kept = db.tables.purchase_order_items.find((l) => l.po_item_id === 7)!
  assert.deepEqual([kept.quantity, kept.total], [0, 0], "received line kept at 0, not deleted")
  assert.equal(db.tables.purchase_order_items.filter((l) => l.quantity > 0).length, 1)
  assert.equal(db.tables.purchase_orders[0].status, "partially_received")
})

test("E3. a pending PO: lines added and removed (never received -> deleted); VAT turned off", async () => {
  const db = mk({ purchase_orders: [po({ status: "pending" })] })
  const r = await edit(body({ vat: false, items: [{ productId: "9", productName: "Valve", quantity: 4, unitPrice: 10 }, { productId: "5", productName: "Pump", quantity: 1, unitPrice: 50 }] }))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].total, 90)
  assert.equal(db.tables.purchase_orders[0].tax_amount, null)
  assert.deepEqual(db.tables.purchase_order_items.map((l) => l.quantity).sort(), [1, 4])
})

test("E4. an outsourced line keeps its sales-order link when edited", async () => {
  const db = mk({
    purchase_order_items: [line({ product_id: null, item_type: "outsourced", outsourced_name: "Gearbox", source_so_id: 3, source_so_item_id: 30 })],
    sales_order_items: [{ so_item_id: 30, so_id: 3, quantity: 5 }],
  })
  const r = await edit(body({ items: [{ id: "7", productName: "Gearbox", quantity: 5, unitPrice: 20 }] }))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const l = db.tables.purchase_order_items[0]
  assert.deepEqual([l.item_type, l.source_so_item_id, l.outsourced_name], ["outsourced", 30, "Gearbox"])
})

test("E5. locked: a closed PO (reopen first), rejected, cost finalized", async () => {
  const cases: [Record<string, Row[]>, string][] = [
    [{ accounts_payable: [bill()] }, "PO_CLOSED"],
    [{ purchase_orders: [po({ status: "rejected" })] }, "PO_NOT_EDITABLE"],
    [{ purchase_orders: [po({ status: "received", cost_finalized: true })] }, "PO_COST_FINALIZED"],
  ]
  for (const [tables, code] of cases) {
    const db = mk(tables)
    const before = JSON.stringify([db.tables.purchase_orders, db.tables.purchase_order_items])
    const r = await edit(body())
    assert.equal(r.status, 409, code)
    assert.equal(r.body.code, code)
    assert.equal(JSON.stringify([db.tables.purchase_orders, db.tables.purchase_order_items]), before, "nothing changed")
  }
})

test("E6. credits / advances on the PO: the supplier cannot change; the total cannot go below them", async () => {
  const reserved = () => ({ supplier_credits: [{ credit_id: 1, supplier_id: 1, amount: 50, status: "used", used_in_po_id: 1, credit_type: "advance" }] })
  mk(reserved())
  assert.equal((await edit(body({ supplier_id: "2" }))).body.code, "PO_CREDIT_SUPPLIER")
  mk(reserved())
  assert.equal((await edit(body({ vat: false, items: [{ id: "7", productId: "5", productName: "Pump", quantity: 1, unitPrice: 10 }] }))).body.code, "CREDIT_EXCEEDS_TOTAL")
})

test("E7. bad input is refused before anything is written", async () => {
  mk()
  for (const bad of [body({ id: "x" }), body({ items: [] }), body({ items: [{ productName: "P", quantity: 0, unitPrice: 1 }] }), body({ supplier_id: "99" }), body({ delivery_date: "next week" })]) {
    assert.equal((await edit(bad)).status, 400, JSON.stringify(bad))
  }
  assert.equal((await edit(body({ id: "99" }))).status, 404)
})

test("E8. ordering more than the sales order needs asks first, like on create", async () => {
  const db = mk({ purchase_order_items: [line({ source_so_id: 3, source_so_item_id: 30 })], sales_order_items: [{ so_item_id: 30, so_id: 3, quantity: 2 }] })
  const items = [{ id: "7", productId: "5", productName: "Pump", quantity: 5, unitPrice: 50, sourceSoId: "3", sourceSoItemId: "30" }]
  assert.equal((await edit(body({ items }))).body.code, "PO_OVER_ORDER")
  assert.equal(db.tables.purchase_order_items[0].quantity, 2)
  assert.equal((await edit(body({ items, allow_over_order: true }))).status, 200)
})

test("E9. if a line cannot be written, the PO is put back as it was", async () => {
  const db = mk()
  const before = { ...db.tables.purchase_orders[0] }
  db.failOn["purchase_order_items:update"] = "boom"
  const r = await edit(body())
  assert.equal(r.status, 500)
  assert.match(r.body.error, /Nothing was changed/)
  for (const [k, v] of Object.entries(before)) assert.equal(db.tables.purchase_orders[0][k], v, k)
})

// --------------------------------------------------------------------------------------------- close and reopen
test("C1. closing makes the bill from the final PO; advances and reserved credits are counted as paid (no new cash entry)", async () => {
  const db = mk({
    purchase_orders: [po({ total: 1000, tax_amount: null })],
    supplier_credits: [
      { credit_id: 1, supplier_id: 1, amount: 300, status: "used", used_in_po_id: 1, credit_type: "advance", notes: "method=bank_transfer; paid=2026-11-05" },
      { credit_id: 2, supplier_id: 1, amount: 100, status: "used", used_in_po_id: 1, credit_type: "return" },
    ],
  })
  const r = await close()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const ap = db.tables.accounts_payable
  assert.equal(ap.length, 1)
  assert.deepEqual([ap[0].amount, ap[0].paid_amount, ap[0].status], [1000, 400, "partially_paid"])
  const pays = db.tables.supplier_payments.map((p) => [p.amount, p.payment_method, p.reference_number])
  assert.deepEqual(pays, [[300, "bank_transfer", "APINV-PO-1-ADV-1"], [100, "supplier_credit", "APINV-PO-1-CREDIT"]])
  assert.equal(db.tables.balance_entries.length, 0)
  assert.ok(db.tables.workflow_events.some((e) => e.event_type === "PO_CLOSED"))
  assert.equal((await close()).body.code, "PO_ALREADY_CLOSED")
  assert.deepEqual([...PO_CLOSE_ROLES], ["accountant", "po-rep", "admin", "ceo"])
  assert.deepEqual([...PO_CLOSABLE_STATUSES], ["approved", "partially_received", "received", "received_with_issues"])
})

test("C2. reopening an unpaid PO removes its bill and the rows the close wrote; credits stay reserved; closing again remakes it", async () => {
  const db = mk({
    purchase_orders: [po({ total: 1000, tax_amount: null })],
    supplier_credits: [{ credit_id: 1, supplier_id: 1, amount: 300, status: "used", used_in_po_id: 1, credit_type: "advance", notes: "method=cash" }],
  })
  assert.equal((await close()).status, 200)
  db.tables.payment_schedules.push({ schedule_id: 1, invoice_id: db.tables.accounts_payable[0].invoice_id, paid_amount: 0, status: "pending" })
  const r = await reopen()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([db.tables.accounts_payable.length, db.tables.supplier_payments.length, db.tables.payment_schedules.length], [0, 0, 0])
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, 1)
  assert.equal((await edit(body({ items: [{ id: "7", productId: "5", productName: "Pump", quantity: 30, unitPrice: 50 }] }))).status, 200, "editable again")
  assert.equal((await close()).status, 200)
  assert.equal(db.tables.accounts_payable[0].paid_amount, 300)
  assert.equal((await reopen()).status, 200)
  assert.equal((await reopen()).body.code, "PO_ALREADY_OPEN")
})

test("C3. reopening is refused once money was paid on the bill (a payment, a hand-applied credit, a paid schedule, months paid)", async () => {
  const paidCases: Record<string, Row[]>[] = [
    { supplier_payments: [{ payment_id: 1, invoice_id: 50, amount: 10, payment_method: "cash", reference_number: "R1" }] },
    { supplier_payments: [{ payment_id: 1, invoice_id: 50, amount: 10, payment_method: "supplier_credit", reference_number: "APINV-PO-1-AP-APPLY" }] },
    { payment_schedules: [{ schedule_id: 1, invoice_id: 50, paid_amount: 10, status: "partial" }] },
    { accounts_payable: [bill({ months_paid: 1 })] },
  ]
  for (const tables of paidCases) {
    const db = mk({ accounts_payable: [bill()], ...tables })
    const r = await reopen()
    assert.equal(r.status, 409, JSON.stringify(tables))
    assert.equal(r.body.code, "PO_PAID")
    assert.equal(db.tables.accounts_payable.length, 1)
  }
})

// ------------------------------------------------------------------------------------------------------ advances
test("A1. an advance on an open PO: cash out now (ledger), kept reserved on the PO; refused when closed or above the total", async () => {
  const db = mk({ purchase_orders: [po({ total: 1000 })] })
  const r = await advance({ amount: 400, paymentMethod: "bank_transfer", referenceNumber: "TR-9", paymentDate: "2026-11-10" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const c = db.tables.supplier_credits[0]
  assert.deepEqual([c.amount, c.status, c.used_in_po_id, c.credit_type, c.supplier_id], [400, "used", 1, "advance", 1])
  assert.match(c.notes, /method=bank_transfer; paid=2026-11-10; ref=TR-9/)
  assert.deepEqual([db.tables.balance_entries[0].amount, db.tables.balance_entries[0].entry_type, db.tables.balance_entries[0].reference_id], [-400, "ap_payment", 1])
  assert.equal((await advance({ amount: 700 })).body.code, "ADVANCE_EXCEEDS_TOTAL")
  assert.equal((await advance({ amount: 10, paymentMethod: "bitcoin" })).status, 400)
  assert.equal((await advance({ amount: 0 })).status, 400)
  const h = await history()
  assert.deepEqual(h.advances.map((a: any) => [a.amount, a.method, a.ref, a.date]), [[400, "bank_transfer", "TR-9", "2026-11-10"]])
  db.tables.accounts_payable.push(bill())
  assert.equal((await advance({ amount: 10 })).body.code, "PO_CLOSED")
})

// ----------------------------------------------------------------------------------------------------- exchanges
test("X1. exchange X (400,000) for Y (410,000): X removed, Y added with X's sales-order link, total follows, history shows +10,000", async () => {
  const db = mk({
    purchase_orders: [po({ total: 456000, tax_amount: 56000 })],
    purchase_order_items: [line({ quantity: 10, unit_price: 40000, total: 400000, source_so_id: 3, source_so_item_id: 30 })],
  })
  const r = await exchange({ fromItemId: "7", quantity: 10, to: { name: "Pump X2 (new spec)", quantity: 10, unitPrice: 41000 }, notes: "supplier changed the model" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.exchange.difference, 10000)
  assert.equal(db.tables.purchase_order_items.length, 1)
  const y = db.tables.purchase_order_items[0]
  assert.deepEqual([y.outsourced_name, y.item_type, y.quantity, y.unit_price, y.total, y.source_so_item_id], ["Pump X2 (new spec)", "outsourced", 10, 41000, 410000, 30])
  assert.deepEqual([db.tables.purchase_orders[0].total, db.tables.purchase_orders[0].tax_amount], [467400, 57400])
  const h = await history()
  assert.equal(h.exchanges.length, 1)
  assert.deepEqual([h.exchanges[0].from.name, h.exchanges[0].from.total, h.exchanges[0].to.name, h.exchanges[0].to.total, h.exchanges[0].difference, h.exchanges[0].notes], ["Pump", 400000, "Pump X2 (new spec)", 410000, 10000, "supplier changed the model"])
})

test("X2. part of a received line exchanged for a catalogue product: X lowered and kept, Y to receive -> partially received", async () => {
  const db = mk({ purchase_orders: [po({ status: "received", total: 1000, tax_amount: null })], purchase_order_items: [line({ quantity: 10, unit_price: 100, total: 1000 })] })
  receive(db, 7, 10)
  const r = await exchange({ fromItemId: "7", quantity: 4, to: { productId: "6", quantity: 4, unitPrice: 120 } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const x = db.tables.purchase_order_items.find((l) => l.po_item_id === 7)!
  const y = db.tables.purchase_order_items.find((l) => l.po_item_id !== 7)!
  assert.deepEqual([x.quantity, x.total], [6, 600])
  assert.deepEqual([y.product_id, y.item_name_snapshot, y.item_type, y.quantity], [6, "Pump XL", "stock", 4])
  assert.equal(db.tables.purchase_orders[0].total, 1080)
  assert.equal(db.tables.purchase_orders[0].status, "partially_received")
  assert.equal(r.body.exchange.difference, 80)
})

test("X3. exchange refused: closed PO, more than the line holds, missing new item; nothing changes", async () => {
  let db = mk({ accounts_payable: [bill()] })
  assert.equal((await exchange({ fromItemId: "7", quantity: 1, to: { name: "Y", quantity: 1, unitPrice: 1 } })).body.code, "PO_CLOSED")
  db = mk()
  const before = JSON.stringify(db.tables.purchase_order_items)
  assert.equal((await exchange({ fromItemId: "7", quantity: 5, to: { name: "Y", quantity: 1, unitPrice: 1 } })).body.code, "EXCHANGE_TOO_MANY")
  assert.equal((await exchange({ fromItemId: "7", quantity: 1, to: { quantity: 1, unitPrice: 1 } })).status, 400)
  assert.equal(JSON.stringify(db.tables.purchase_order_items), before)
  assert.equal(db.tables.workflow_events.length, 0)
})

// ------------------------------------------------------------------------- a returned item goes back on an open PO
// SO 1: 2 x Pump sold; bought on PO 3 (open, received) line 9: 2 x 30,000 + VAT. The customer returns 1.
function returnDb(openPo: boolean) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-C-1", customer_id: 5, status: "delivered", subtotal: 100000, discount_amount: 0, total: 114000, net_total: 114000 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 2, unit_price: 50000, total: 100000 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    suppliers: [{ supplier_id: 2, supplier_name: "Supplier" }],
    warehouses: [{ warehouse_id: 1 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-C-1", sales_order_id: 1, customer_id: 5, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump", sku_snapshot: "P", quantity: 2, unit_price: 50000, total: 100000, supplier_id: null, outsourced_name: null }],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10 }],
    goods_receipt_lines: [{ line_id: 1, receipt_id: 4, po_item_id: 9, product_id: 7, item_type: "stock", quantity_received: 2, unit_cost: 30000, source_so_item_id: 1 }],
    goods_receipts: [{ receipt_id: 4, grn_number: "GRN-4", po_id: 3 }],
    purchase_orders: [{ po_id: 3, po_number: "PO-3", supplier_id: 2, status: "received", total: 68400, tax_amount: 8400 }],
    purchase_order_items: [{ po_item_id: 9, po_id: 3, product_id: 7, quantity: 2, unit_price: 30000, total: 60000, item_type: "stock" }],
    accounts_payable: openPo ? [] : [{ invoice_id: 1, invoice_number: "APINV-PO-3", po_id: 3, supplier_id: 2, amount: 68400, paid_amount: 0, status: "pending" }],
    accounts_receivable: [], invoice_delivery_permits: [], supplier_credits: [], workflow_events: [],
    product_returns: [], return_items: [], inventory_batches: [], idempotency_log: [], customer_credits: [],
  })
}
async function returnOneToHolding(db: FakeDb) {
  const created = await createReturn(db, { permitId: 1, idempotencyKey: `po-open-${Math.random().toString(36).slice(2)}`, createdBy: "t", items: [{ productId: 7, productName: "Pump", quantityReturned: 1, reason: "wrong_item", condition: "good" }] })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const items = db.tables.return_items.filter((i: Row) => i.return_id === created.body.returnId)
  const res = await processReturn(db, { returnId: created.body.returnId, status: "completed", processedBy: "wh", warehouseAssignments: items.map((i: Row) => ({ returnItemId: i.return_item_id, warehouseId: 1 })) })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return db.tables.inventory.find((r: Row) => r.is_returned)!
}

test("R1. open PO: sending a returned item back lowers the PO line and total instead of making a supplier credit", async () => {
  const db = returnDb(true)
  const holding = await returnOneToHolding(db)
  const preview = await previewReturnedItemCredit(db, { inventoryId: holding.inventory_id })
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.deepEqual([preview.body.lowersPo, preview.body.lowerBy, preview.body.amount, preview.body.poNumber], [true, 1, 30000, "PO-3"])
  const res = await removeReturnedItem(db, { inventoryId: holding.inventory_id })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.supplier_credits.length, 0)
  assert.deepEqual([db.tables.purchase_order_items[0].quantity, db.tables.purchase_order_items[0].total], [1, 30000])
  assert.deepEqual([db.tables.purchase_orders[0].total, db.tables.purchase_orders[0].tax_amount], [34200, 4200])
  assert.deepEqual(res.body.loweredPo, { poId: 3, poNumber: "PO-3", quantity: 1, amount: 30000, newTotal: 34200 })
  assert.ok(db.tables.workflow_events.some((e: Row) => e.event_type === "PO_ITEM_SENT_BACK" && e.entity_id === 3))
  assert.equal(db.tables.inventory.filter((r: Row) => r.is_returned).length, 0, "the holding row is gone")
})

test("R2. closed PO: sending a returned item back still makes a supplier credit (as before)", async () => {
  const db = returnDb(false)
  const holding = await returnOneToHolding(db)
  const res = await removeReturnedItem(db, { inventoryId: holding.inventory_id })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.supplier_credits.length, 1)
  assert.equal(db.tables.supplier_credits[0].amount, 30000)
  assert.equal(db.tables.purchase_order_items[0].quantity, 2, "a closed PO is not changed")
})

// ------------------------------------------------------------------------------------------------------- screens
test("S1. PO screen: Open / Closed badge, the More menu (exchange, advance, close, reopen), history in the details", () => {
  assert.deepEqual([...PO_EDITABLE_STATUSES], ["draft", "pending", "approved", "partially_received", "received", "received_with_issues"])
  const screen = src("components/modules/purchase-order-module.tsx")
  assert.match(screen, /const isClosedPO = \(order: PurchaseOrder\)/)
  assert.match(screen, /PO_EDITABLE_STATUSES\.includes\(order\.status\) && !isClosedPO\(order\)/)
  assert.match(screen, /<PoOpenMenu/)
  assert.match(screen, /<PoOpenBadge closed=\{isClosedPO\(order\)\} \/>/)
  assert.match(screen, /<PoHistory poId=\{viewDetailsOrder\.id\} \/>/)
  const menu = src("components/purchase-order/po-open-actions.tsx")
  for (const url of ["/api/purchase-orders/close", "/api/purchase-orders/reopen", "/api/purchase-orders/advance", "/api/purchase-orders/exchange"]) assert.ok(menu.includes(url), url)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["po.open", "po.closed", "po.exchange-item", "po.record-advance", "po.close-send-ap", "po.reopen", "po.exchanges", "po.exchange-difference", "po.edit-open-note", "inv.lowers-open-po", "inv.removed-lowered-po"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, key)
  }
  assert.match(src("lib/app-context.tsx"), /fetch\("\/api\/purchase-orders\/edit"/)
})
