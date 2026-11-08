// Edit a purchase order after it was made (owner request, 2026-11-08): POST /api/purchase-orders/edit.
// Editable until goods are received; an approved PO stays approved and its supplier bill follows; locked once paid.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as editRoute from "../../app/api/purchase-orders/edit/route"
import { PO_EDITABLE_STATUSES } from "../po-edit"

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
    purchase_orders: [po()],
    purchase_order_items: [line()],
    accounts_payable: [bill()],
    supplier_payments: [],
    payment_schedules: [],
    supplier_credits: [],
    goods_receipts: [],
    sales_order_items: [],
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

test("E1. an approved PO: new items, total and dates are saved; it stays approved and its bill follows", async () => {
  const db = mk()
  const r = await edit(body())
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const order = db.tables.purchase_orders[0]
  assert.equal(order.status, "approved")
  assert.equal(order.total, 205.2) // 3 x 60 = 180 + 14% VAT (VAT stays on)
  assert.equal(order.tax_amount, 25.2)
  assert.equal(order.delivery_date, "2026-11-20")
  assert.equal(db.tables.purchase_order_items.length, 1)
  assert.equal(db.tables.purchase_order_items[0].quantity, 3)
  assert.equal(db.tables.purchase_order_items[0].total, 180)
  const ap = db.tables.accounts_payable[0]
  assert.equal(ap.amount, 205.2)
  assert.equal(ap.status, "pending")
  assert.equal(ap.invoice_number, "APINV-PO-1", "same bill, not a new one")
  assert.equal(r.body.billUpdated, true)
})

test("E2. supplier and payment terms change on the PO and on its bill; the old unpaid schedule is removed", async () => {
  const db = mk({ payment_schedules: [{ schedule_id: 1, invoice_id: 50, schedule_type: "payable", amount: 114, paid_amount: 0, status: "pending" }] })
  const r = await edit(
    body({ supplier_id: "2", payment_type: "installments", payment_terms: "installment", installments: 3, monthly_amount: 68.4, payment_start_date: "2026-12-01" }),
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].supplier_id, 2)
  assert.equal(db.tables.purchase_orders[0].payment_type, "installments")
  const ap = db.tables.accounts_payable[0]
  assert.equal(ap.supplier_id, 2)
  assert.equal(ap.payment_type, "installments")
  assert.equal(ap.installment_months, 3)
  assert.equal(ap.due_date, "2026-12-01")
  assert.equal(db.tables.payment_schedules.length, 0, "made again from the new bill")
})

test("E3. a pending PO (no bill yet) is edited; lines can be added and removed; VAT can be turned off", async () => {
  const db = mk({ purchase_orders: [po({ status: "pending" })], accounts_payable: [] })
  const r = await edit(body({ vat: false, items: [{ productId: "9", productName: "Valve", quantity: 4, unitPrice: 10 }, { productId: "5", productName: "Pump", quantity: 1, unitPrice: 50 }] }))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].status, "pending")
  assert.equal(db.tables.purchase_orders[0].total, 90)
  assert.equal(db.tables.purchase_orders[0].tax_amount, null)
  assert.deepEqual(db.tables.purchase_order_items.map((l) => l.quantity), [4, 1])
  assert.equal(r.body.billUpdated, false)
  assert.equal(db.tables.accounts_payable.length, 0, "no bill is made by an edit")
})

test("E4. an outsourced line keeps its sales-order link when edited", async () => {
  const db = mk({
    purchase_order_items: [line({ product_id: null, item_type: "outsourced", outsourced_name: "Gearbox", source_so_id: 3, source_so_item_id: 30 })],
    sales_order_items: [{ so_item_id: 30, so_id: 3, quantity: 5 }],
  })
  const r = await edit(body({ items: [{ id: "7", productName: "Gearbox", quantity: 5, unitPrice: 20 }] }))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const l = db.tables.purchase_order_items[0]
  assert.equal(l.item_type, "outsourced")
  assert.equal(l.source_so_item_id, 30)
  assert.equal(l.outsourced_name, "Gearbox")
})

test("E5. locked: goods received, received status, rejected, a real payment on the bill, a paid schedule", async () => {
  const cases: [Record<string, Row[]>, string][] = [
    [{ goods_receipts: [{ receipt_id: 1, po_id: 1 }] }, "PO_RECEIVED"],
    [{ purchase_orders: [po({ status: "received" })] }, "PO_NOT_EDITABLE"],
    [{ purchase_orders: [po({ status: "partially_received" })] }, "PO_NOT_EDITABLE"],
    [{ purchase_orders: [po({ status: "rejected" })] }, "PO_NOT_EDITABLE"],
    [{ supplier_payments: [{ payment_id: 1, invoice_id: 50, amount: 10, payment_method: "cash" }] }, "PO_PAID"],
    [{ payment_schedules: [{ schedule_id: 1, invoice_id: 50, paid_amount: 10, status: "partial" }] }, "PO_PAID"],
    [{ accounts_payable: [bill({ months_paid: 1 })] }, "PO_PAID"],
  ]
  for (const [tables, code] of cases) {
    const db = mk(tables)
    const before = JSON.stringify(db.tables.purchase_orders)
    const r = await edit(body())
    assert.equal(r.status, 409, code)
    assert.equal(r.body.code, code)
    assert.match(r.body.error, /./)
    assert.equal(JSON.stringify(db.tables.purchase_orders), before, "nothing changed")
  }
})

test("E6. supplier credits: a credit offset is not a payment; the supplier cannot change while credits are applied; total not below the credit", async () => {
  const withCredit = () => ({
    supplier_credits: [{ credit_id: 1, supplier_id: 1, amount: 50, status: "used", used_in_po_id: 1 }],
    accounts_payable: [bill({ paid_amount: 50, status: "partially_paid" })],
    supplier_payments: [{ payment_id: 1, invoice_id: 50, amount: 50, payment_method: "supplier_credit" }],
  })
  let db = mk(withCredit())
  let r = await edit(body())
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.accounts_payable[0].paid_amount, 50)
  assert.equal(db.tables.accounts_payable[0].status, "partially_paid")
  db = mk(withCredit())
  r = await edit(body({ supplier_id: "2" }))
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "PO_CREDIT_SUPPLIER")
  db = mk(withCredit())
  r = await edit(body({ vat: false, items: [{ id: "7", productId: "5", productName: "Pump", quantity: 1, unitPrice: 10 }] }))
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "CREDIT_EXCEEDS_TOTAL")
})

test("E7. bad input is refused before anything is written", async () => {
  mk()
  for (const bad of [
    body({ id: "x" }),
    body({ items: [] }),
    body({ items: [{ productName: "P", quantity: 0, unitPrice: 1 }] }),
    body({ items: [{ productName: "P", quantity: 1, unitPrice: -1 }] }),
    body({ supplier_id: "" }),
    body({ supplier_id: "99" }),
    body({ delivery_date: "next week" }),
  ]) {
    assert.equal((await edit(bad)).status, 400, JSON.stringify(bad))
  }
  assert.equal((await edit(body({ id: "99" }))).status, 404)
})

test("E8. ordering more than the sales order needs asks first, like on create", async () => {
  const db = mk({
    purchase_order_items: [line({ source_so_id: 3, source_so_item_id: 30 })],
    sales_order_items: [{ so_item_id: 30, so_id: 3, quantity: 2 }],
  })
  const items = [{ id: "7", productId: "5", productName: "Pump", quantity: 5, unitPrice: 50, sourceSoId: "3", sourceSoItemId: "30" }]
  const r = await edit(body({ items }))
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "PO_OVER_ORDER")
  assert.equal(db.tables.purchase_order_items[0].quantity, 2)
  assert.equal((await edit(body({ items, allow_over_order: true }))).status, 200)
})

test("E9. if the bill cannot be updated, the PO and its lines are put back as they were", async () => {
  const db = mk()
  const poBefore = { ...db.tables.purchase_orders[0] }
  const linesBefore = JSON.stringify(db.tables.purchase_order_items)
  db.failOn["accounts_payable:update"] = "boom"
  const r = await edit(body({ supplier_id: "2" }))
  assert.equal(r.status, 500)
  assert.match(r.body.error, /Nothing was changed/)
  for (const [key, value] of Object.entries(poBefore)) assert.equal(db.tables.purchase_orders[0][key], value, key)
  assert.equal(db.tables.purchase_orders[0].payment_start_date ?? null, null)
  assert.equal(JSON.stringify(db.tables.purchase_order_items), linesBefore)
})

test("E10. PO screen: Edit on draft, pending and approved POs opens the form filled in and saves through the edit route", () => {
  assert.deepEqual([...PO_EDITABLE_STATUSES], ["draft", "pending", "approved"])
  const screen = src("components/modules/purchase-order-module.tsx")
  assert.match(screen, /PO_EDITABLE_STATUSES\.includes\(/)
  assert.match(screen, /const startEdit = \(order: PurchaseOrder\)/)
  assert.match(screen, /editingPoId \? t\("po\.edit-title"\)/)
  assert.match(src("lib/app-context.tsx"), /fetch\("\/api\/purchase-orders\/edit"/)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["po.edit", "po.edit-title", "po.edit-save", "po.edit-saved"]) assert.equal(i18n.split(`"${key}":`).length - 1, 2, key)
})
