// Typed document numbers (owner, 2026-11-04): every create form may take a number the person types instead of the
// automatic one. These tests call the real route handlers with the in-memory FakeDb (route-harness.ts), whose UNIQUE
// map mirrors the database's UNIQUE constraint on each number column.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import { cleanManualNumber, highestSerial, insertWithNumber } from "../doc-number"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as soRoute from "../../app/api/sales-orders/route"
import * as quotationRoute from "../../app/api/sales-quotations/route"
import * as approveRoute from "../../app/api/sales-quotations/approve/route"
import * as poRoute from "../../app/api/purchase-orders/route"
import * as prRoute from "../../app/api/po-requests/route"
import * as fromDps from "../../app/api/accounts-receivable/create-from-dps/route"
import * as grnRoute from "../../app/api/goods-receipts/route"
import * as apRoute from "../../app/api/accounts-payable/route"

const YEAR = new Date().getFullYear()

// ------------------------------------------------------------------------------------------- the shared helper
test("cleanManualNumber: empty means automatic; text is trimmed and kept as typed", () => {
  for (const raw of [undefined, null, "", "   "]) assert.deepEqual(cleanManualNumber(raw), { ok: true, value: null })
  assert.deepEqual(cleanManualNumber("  OLD  55 "), { ok: true, value: "OLD 55" })
  assert.deepEqual(cleanManualNumber("Book 3 / 120"), { ok: true, value: "Book 3 / 120" })
  assert.deepEqual(cleanManualNumber(150), { ok: true, value: "150" })
  assert.deepEqual(cleanManualNumber(`DP-${YEAR}-0150`), { ok: true, value: `DP-${YEAR}-0150` })
})

test("cleanManualNumber: refuses what cannot be saved or would confuse a counter", () => {
  assert.equal(cleanManualNumber({}).ok, false)
  assert.equal(cleanManualNumber("x".repeat(51)).ok, false)
  assert.equal(cleanManualNumber("x".repeat(50)).ok, true)
  assert.equal(cleanManualNumber("A\u0007B").ok, false)
  for (const bad of [`DP-${YEAR}-12A`, `INV-${YEAR}-`, `POR-${YEAR}-1234567890`]) {
    const r = cleanManualNumber(bad)
    assert.equal(r.ok, false, bad)
    if (!r.ok) assert.match(r.error, /must end in digits only/)
  }
  assert.equal(cleanManualNumber(`SO-${YEAR}-ABC`).ok, true) // SO numbers come from a database counter, not "highest + 1"
})

test("highestSerial only reads numbers in its own shape", () => {
  assert.equal(highestSerial([`DP-${YEAR}-0009`, `DP-${YEAR}-0150`, "OLD-999", `DP-${YEAR - 1}-5000`, null], "DP", YEAR), 150)
  assert.equal(highestSerial(["Book 3"], "DP", YEAR), 0)
})

test("insertWithNumber: a taken typed number is reported, an automatic clash moves to the next number", async () => {
  const used = new Set(["A-1", "A-2"])
  const insert = async (n: string) => (used.has(n) ? { data: null, error: { code: "23505" } } : (used.add(n), { data: { n }, error: null }))
  assert.deepEqual(await insertWithNumber("A-1", async () => "never", insert), { ok: false, reason: "taken", number: "A-1" })
  let next = 0
  const auto = await insertWithNumber(null, async () => `A-${++next}`, insert)
  assert.deepEqual(auto, { ok: true, data: { n: "A-3" }, number: "A-3" })
  assert.deepEqual(await insertWithNumber(null, async () => null, insert), { ok: false, reason: "no_number" })
  const other = await insertWithNumber("B-1", async () => "x", async () => ({ data: null, error: { code: "XX000", message: "down" } }))
  assert.equal(other.ok, false)
  assert.equal((other as any).reason, "error")
})

// ------------------------------------------------------------------------------------------- delivery permits
function dpDb(permits: Row[] = []) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "accountant_approved", fulfillment_status: "PENDING", total: 1140 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    warehouses: [{ warehouse_id: 1 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock" }],
    delivery_permits: permits,
    delivery_permit_items: [],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 50, unit_cost: 50, reorder_point: 0 }],
  })
  useDb(db)
  return db
}
const postDp = (extra: Row = {}) =>
  call(dpRoute.POST, "POST", {
    salesOrderId: "1", customerId: "5", recipientName: "Contact", recipientPhone: "0100", deliveryAddress: "Cairo", createdBy: "tester",
    items: [{ productId: "7", productName: "Pump A", sku: "A", quantity: 1, unitPrice: 100, total: 100 }],
    ...extra,
  })

test("DP: a typed number is used exactly as typed", async () => {
  const db = dpDb()
  const r = await postDp({ manualNumber: " Old book 77 " })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.delivery_permits[0].permit_no, "Old book 77")
})

test("DP: a taken number is refused with a plain message and nothing is saved", async () => {
  const db = dpDb([{ permit_id: 1, permit_no: "DP-X", sales_order_id: 1, customer_id: 5, status: "DRAFT" }])
  const r = await postDp({ manualNumber: "DP-X" })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, "DP-X is already used. Pick another number.")
  assert.equal(db.tables.delivery_permits.length, 1)
  assert.equal(db.tables.delivery_permit_items.length, 0)
})

test("DP: a number shaped like the automatic one must end in digits", async () => {
  const db = dpDb()
  const r = await postDp({ manualNumber: `DP-${YEAR}-12A` })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, "BAD_NUMBER")
  assert.equal(db.tables.delivery_permits.length, 0)
})

test("DP: the automatic number continues after a high typed one and ignores free text", async () => {
  const db = dpDb([
    { permit_id: 1, permit_no: `DP-${YEAR}-0150`, sales_order_id: 1, customer_id: 5, status: "DRAFT" },
    { permit_id: 2, permit_no: `DP-${YEAR}-OLD`, sales_order_id: 1, customer_id: 5, status: "DRAFT" },
    { permit_id: 3, permit_no: `DP-${YEAR}-0009`, sales_order_id: 1, customer_id: 5, status: "DRAFT" },
  ])
  const r = await postDp()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.delivery_permits.at(-1)!.permit_no, `DP-${YEAR}-0151`)
})

// ------------------------------------------------------------------------------------------- customer invoice from DPs
function invoiceDb(invoices: Row[] = []) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "delivered", fulfillment_status: "DELIVERED", total: 1140, net_total: 1140, subtotal: 1000, discount_amount: 0, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 1 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-T-1", sales_order_id: 1, customer_id: 5, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", sku_snapshot: "A", quantity: 10, unit_price: 100, total: 1000, supplier_id: null, outsourced_name: null }],
    invoice_delivery_permits: [],
    accounts_receivable: invoices,
  })
  useDb(db)
  return db
}

test("customer invoice: a typed number is used; a taken one is refused", async () => {
  let db = invoiceDb()
  const ok = await call(fromDps.POST, "POST", { permit_ids: [1], manualNumber: "INV-OLD-12" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.accounts_receivable[0].invoice_number, "INV-OLD-12")

  db = invoiceDb([{ invoice_id: 9, invoice_number: "INV-OLD-12", customer_id: 5, amount: 1, status: "pending" }])
  const taken = await call(fromDps.POST, "POST", { permit_ids: [1], manualNumber: "INV-OLD-12" })
  assert.equal(taken.status, 409)
  assert.equal(taken.body.error, "INV-OLD-12 is already used. Pick another number.")
  assert.equal(db.tables.accounts_receivable.length, 1)
  assert.equal(db.tables.invoice_delivery_permits.length, 0)
})

// ------------------------------------------------------------------------------------------- sales orders
function soDb(orders: Row[] = []) {
  const db = new FakeDb({
    sales_orders: orders, sales_order_items: [], delivery_permits: [], delivery_permit_items: [], idempotency_log: [],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 100, unit_cost: 50, is_returned: false, reorder_point: 0 }],
    inventory_transactions: [], product_returns: [], return_items: [], workflow_events: [],
  })
  let n = 0
  db.rpcHandlers.generate_so_number = () => `SO-AUTO-${++n}`
  useDb(db)
  return db
}
const postSo = (extra: Row = {}) =>
  call(soRoute.POST, "POST", {
    customerId: "5", total: 100, subtotal: 100, paymentType: "bank_transfer", status: "draft",
    items: [{ productId: "7", productName: "Product 7", quantity: 1, unitPrice: 100, total: 100, itemType: "stock" }],
    ...extra,
  })

test("sales order: typed number used; taken refused; the number the screen sends on its own is ignored", async () => {
  const db = soDb([{ so_id: 1, so_number: "SO-AUTO-1", customer_id: 5, status: "draft", total: 0 }])
  const typed = await postSo({ manualNumber: "SO-LEGACY-4" })
  assert.equal(typed.status, 200, JSON.stringify(typed.body))
  assert.equal(db.tables.sales_orders.at(-1)!.so_number, "SO-LEGACY-4")

  const taken = await postSo({ manualNumber: "SO-LEGACY-4" })
  assert.equal(taken.status, 409)
  assert.equal(taken.body.error, "SO-LEGACY-4 is already used. Pick another number.")
  assert.equal(db.tables.sales_orders.length, 2)

  // The automatic number "SO-AUTO-1" is already taken (by a typed one), so the next automatic number is used.
  const auto = await postSo({ soNumber: "SO-FROM-SCREEN" })
  assert.equal(auto.status, 200, JSON.stringify(auto.body))
  assert.equal(db.tables.sales_orders.at(-1)!.so_number, "SO-AUTO-2")
})

test("quotation -> sales order: the typed number is used for the new order", async () => {
  const db = new FakeDb({
    sales_quotations: [{ id: 1, quotation_number: "Q-1", status: "sent", customer_id: 5, subtotal: 200, total: 228, net_total: 228, payment_type: "cash", payment_details: {}, order_date: new Date().toISOString().slice(0, 10), validity_days: 30 }],
    sales_quotation_items: [{ id: 1, quotation_id: 1, line_no: 1, product_id: 7, product_name: "Product 7", quantity: 2, unit_price: 100, item_type: "inventory" }],
    sales_orders: [{ so_id: 9, so_number: "SO-TAKEN", customer_id: 5, status: "draft", total: 0 }],
    sales_order_items: [], delivery_permits: [], delivery_permit_items: [], suppliers: [], accounts_receivable: [], po_requests: [], po_request_items: [],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 10, unit_cost: 50, is_returned: false }],
  })
  for (const q of db.tables.sales_quotations) q.items = db.tables.sales_quotation_items.filter((l) => l.quotation_id === q.id)
  db.rpcHandlers.generate_so_number = () => "SO-AUTO-1"
  useDb(db)
  const taken = await call(approveRoute.POST as any, "POST", { quotation_id: 1, manualNumber: "SO-TAKEN" })
  assert.equal(taken.status, 409, JSON.stringify(taken.body))
  assert.equal(db.tables.sales_orders.length, 1)
  const ok = await call(approveRoute.POST as any, "POST", { quotation_id: 1, manualNumber: "SO-FROM-Q" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.sales_orders.at(-1)!.so_number, "SO-FROM-Q")
})

// ------------------------------------------------------------------------------------------- quotations
test("quotation: typed number used; taken refused", async () => {
  const db = new FakeDb({ sales_quotations: [{ id: 1, quotation_number: "Q-OLD-1", status: "sent" }], sales_quotation_items: [] })
  db.rpcHandlers.generate_quotation_number = () => "Q-AUTO-1"
  useDb(db)
  const body = (manualNumber?: string) => ({ customer_name: "Test Customer", items: [{ product_name: "Pump", quantity: 1, unit_price: 100 }], manualNumber })
  const ok = await call(quotationRoute.POST as any, "POST", body("Q-OLD-2"))
  assert.ok(ok.status < 300, JSON.stringify(ok.body))
  assert.equal(db.tables.sales_quotations.at(-1)!.quotation_number, "Q-OLD-2")
  const taken = await call(quotationRoute.POST as any, "POST", body("Q-OLD-1"))
  assert.equal(taken.status, 409)
  assert.equal(taken.body.error, "Q-OLD-1 is already used. Pick another number.")
  assert.equal(db.tables.sales_quotations.length, 2)
  const auto = await call(quotationRoute.POST as any, "POST", body())
  assert.ok(auto.status < 300, JSON.stringify(auto.body))
  assert.equal(db.tables.sales_quotations.at(-1)!.quotation_number, "Q-AUTO-1")
})

// ------------------------------------------------------------------------------------------- purchase orders
test("purchase order: typed number used; taken refused; the number the screen sends on its own is ignored", async () => {
  const db = new FakeDb({ purchase_orders: [{ po_id: 1, po_number: "PO-OLD-1", supplier_id: 1, status: "pending", total: 1 }], purchase_order_items: [], sales_order_items: [], accounts_payable: [] })
  let n = 0
  db.rpcHandlers.generate_po_number = () => `PO-AUTO-${++n}`
  useDb(db)
  const item = { productId: 5, productName: "Part", quantity: 1, unitPrice: 10, total: 10 }
  const post = (extra: Row) => call(poRoute.POST, "POST", { supplier_id: 1, status: "pending", total: 10, payment_terms: "cash", items: [item], ...extra })
  const ok = await post({ manualNumber: "PO-OLD-2" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.purchase_orders.at(-1)!.po_number, "PO-OLD-2")
  const taken = await post({ manualNumber: "PO-OLD-1" })
  assert.equal(taken.status, 409)
  assert.equal(taken.body.error, "PO-OLD-1 is already used. Pick another number.")
  assert.equal(db.tables.purchase_orders.length, 2)
  assert.equal(db.tables.purchase_order_items.length, 1)
  const auto = await post({ poNumber: "PO-FROM-SCREEN" })
  assert.equal(auto.status, 200, JSON.stringify(auto.body))
  assert.equal(db.tables.purchase_orders.at(-1)!.po_number, "PO-AUTO-1")
})

// ------------------------------------------------------------------------------------------- price requests
test("PO request: typed number used; taken refused; bad POR shape refused", async () => {
  const db = new FakeDb({ po_requests: [{ request_id: 1, request_number: "POR-OLD", supplier_id: 3, status: "pending" }], po_request_items: [], sales_quotations: [], sales_orders: [] })
  db.rpcHandlers.generate_po_request_number = () => `POR-${YEAR}-0001`
  useDb(db)
  const post = (manualNumber?: string) => call(prRoute.POST as any, "POST", { supplier_id: 3, items: [{ product_id: null, product_name: "Pump", quantity: 2, unit: "unit" }], manualNumber })
  const ok = await post(`POR-${YEAR}-0500`)
  assert.equal(ok.status, 201, JSON.stringify(ok.body))
  assert.equal(db.tables.po_requests.at(-1)!.request_number, `POR-${YEAR}-0500`)
  const taken = await post("POR-OLD")
  assert.equal(taken.status, 409)
  assert.equal(taken.body.error, "POR-OLD is already used. Pick another number.")
  const bad = await post(`POR-${YEAR}-1234567890`)
  assert.equal(bad.status, 400)
  assert.equal(db.tables.po_requests.length, 2)
})

// ------------------------------------------------------------------------------------------- goods receipts
function grnDb(receipts: Row[] = []) {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "approved", total: 1000 }],
    purchase_order_items: [{ po_item_id: 1, po_id: 1, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock", source_so_item_id: null, item_name_snapshot: "Pump A" }],
    goods_receipts: receipts, goods_receipt_lines: [],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 5, unit_cost: 90, reorder_point: 0 }],
    inventory_batches: [], sales_orders: [], sales_order_items: [], idempotency_log: [],
  })
  useDb(db)
  return db
}
let k = 0
const postGrn = (manualNumber?: string) =>
  call(grnRoute.POST, "POST", {
    poId: 1, receivedBy: 1, idempotencyKey: `doc-number-grn-${++k}-${Math.random().toString(36).slice(2, 8)}`,
    lines: [{ poItemId: 1, quantityReceived: 2, warehouseId: 1, unitCost: 100 }], manualNumber,
  })

test("goods receipt: typed number used; taken refused before any stock moves", async () => {
  let db = grnDb()
  const ok = await postGrn("GRN-BOOK-7")
  assert.ok(ok.status < 300, JSON.stringify(ok.body))
  assert.equal(db.tables.goods_receipts[0].grn_number, "GRN-BOOK-7")

  db = grnDb([{ receipt_id: 1, grn_number: "GRN-BOOK-7", po_id: 1 }])
  const taken = await postGrn("GRN-BOOK-7")
  assert.equal(taken.status, 409, JSON.stringify(taken.body))
  assert.match(JSON.stringify(taken.body), /GRN-BOOK-7 is already used\. Pick another number\./)
  assert.equal(db.tables.goods_receipts.length, 1)
  assert.equal(db.tables.inventory[0].quantity, 5)
})

test("goods receipt: after a taken number, the same submission can be sent again with another number", async () => {
  const db = grnDb([{ receipt_id: 1, grn_number: "GRN-BOOK-7", po_id: 1 }])
  const body = (manualNumber: string) => ({
    poId: 1, receivedBy: 1, idempotencyKey: "doc-number-grn-same-key", manualNumber,
    lines: [{ poItemId: 1, quantityReceived: 2, warehouseId: 1, unitCost: 100 }],
  })
  assert.equal((await call(grnRoute.POST, "POST", body("GRN-BOOK-7"))).status, 409)
  const retry = await call(grnRoute.POST, "POST", body("GRN-BOOK-8"))
  assert.ok(retry.status < 300, JSON.stringify(retry.body))
  assert.equal(db.tables.goods_receipts.at(-1)!.grn_number, "GRN-BOOK-8")
  assert.equal(db.tables.inventory[0].quantity, 7)
})

test("goods receipt: an automatic number that clashes with a typed one moves on", async () => {
  const db = grnDb([{ receipt_id: 1, grn_number: `GRN-${YEAR}-0001`, po_id: 1 }])
  const ok = await postGrn()
  assert.ok(ok.status < 300, JSON.stringify(ok.body))
  assert.equal(db.tables.goods_receipts.at(-1)!.grn_number, `GRN-${YEAR}-0002`)
})

// ------------------------------------------------------------------------------------------- supplier invoices
test("supplier invoice: the number can be changed; a taken or empty one is refused", async () => {
  const db = new FakeDb({
    accounts_payable: [
      { invoice_id: 1, invoice_number: "APINV-PO-1", supplier_id: 1, amount: 100, status: "pending" },
      { invoice_id: 2, invoice_number: "SUP-555", supplier_id: 1, amount: 100, status: "pending" },
    ],
  })
  useDb(db)
  const ok = await call(apRoute.PUT as any, "PUT", { id: 1, invoiceNumber: " SUP-777 " })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.accounts_payable[0].invoice_number, "SUP-777")
  const taken = await call(apRoute.PUT as any, "PUT", { id: 1, invoiceNumber: "SUP-555" })
  assert.equal(taken.status, 409)
  assert.equal(taken.body.error, "SUP-555 is already used. Pick another number.")
  const empty = await call(apRoute.PUT as any, "PUT", { id: 1, invoiceNumber: "" })
  assert.equal(empty.status, 400)
  assert.equal(db.tables.accounts_payable[0].invoice_number, "SUP-777")
})
