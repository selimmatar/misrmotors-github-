// Batch 1 (money and stock safety): supplier payment duplicates / overpayment credit / compensation, retired or
// restricted side-door endpoints, the guarded stock count and the delivery permit approve-vs-reject race.
// Real route handlers on the in-memory FakeDb; screen checks read the component source.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as apPayRoute from "../../app/api/accounts-payable/payments/route"
import * as creditsRoute from "../../app/api/supplier-credits/route"
import * as poRoute from "../../app/api/purchase-orders/route"
import * as arRoute from "../../app/api/accounts-receivable/route"
import * as arPayRoute from "../../app/api/accounts-receivable/payments/route"
import * as customerPaymentsRoute from "../../app/api/customer-payments/route"
import * as apRoute from "../../app/api/accounts-payable/route"
import * as balanceRoute from "../../app/api/balance/route"
import * as inventoryRoute from "../../app/api/inventory/route"
import * as scheduleRoute from "../../app/api/payment-schedules/route"
import * as auditRoute from "../../app/api/inventory/audit/route"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as applyCreditRoute from "../../app/api/accounts-receivable/apply-credit/route"
import * as customerCreditsRoute from "../../app/api/customer-credits/route"
import { reserveCredits, SUPPLIER_CREDIT_LEDGER } from "../credit-apply"

const ROOT = process.env.REPO_ROOT || join(__dirname, "../../../..")
const src = (file: string) => readFileSync(join(ROOT, file), "utf8")

// ---------------------------------------------------------------------------------------------------------
// 1. Supplier payments (BIZ-P-11)
// ---------------------------------------------------------------------------------------------------------
const apInv = (invoice_id: number, extra: Row = {}): Row => ({
  invoice_id, invoice_number: `APINV-B1-${invoice_id}`, po_id: 10 + invoice_id, supplier_id: 1, amount: 1000,
  paid_amount: 0, months_paid: 0, status: "pending", ...extra,
})
function apDb(extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    accounts_payable: [apInv(1), apInv(2)],
    supplier_payments: [], balance_entries: [], idempotency_log: [], supplier_credits: [], payment_schedules: [],
    purchase_orders: [], purchase_order_items: [], goods_receipts: [], sales_order_items: [],
    ...extra,
  })
  useDb(db)
  return db
}
let keySeq = 0
const apKey = () => `b1-key-${++keySeq}-${Math.random().toString(36).slice(2, 8)}`
const apPay = (invoiceId: number, amount: number, extra: Row = {}) =>
  call(apPayRoute.POST, "POST", {
    invoiceId, amount, paymentMethod: "bank_transfer", receiptUrl: `https://blob.test/r-${apKey()}.pdf`, idempotencyKey: apKey(), ...extra,
  })
const ap = (db: FakeDb, id: number) => db.tables.accounts_payable.find((r) => r.invoice_id === id)!

test("1a. a second payment with the same receipt on the same invoice is refused as DUPLICATE_PAYMENT", async () => {
  const db = apDb()
  const receiptUrl = "https://blob.test/same-receipt.pdf"
  const first = await apPay(1, 400, { receiptUrl, paymentDate: "2026-10-01" })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const key = apKey()
  const dup = await apPay(1, 400, { receiptUrl, idempotencyKey: key })
  assert.equal(dup.status, 409, JSON.stringify(dup.body))
  assert.equal(dup.body.code, "DUPLICATE_PAYMENT")
  assert.equal(dup.body.existingPayment.paymentDate, "2026-10-01")
  assert.equal(dup.body.existingPayment.amount, 400)
  assert.equal(ap(db, 1).paid_amount, 400, "the invoice is not touched")
  assert.equal(db.tables.supplier_payments.length, 1)
  assert.equal(db.tables.balance_entries.length, 1)
  // the same request, confirmed by the user, is saved (same idempotency key: the refusal left it retryable)
  const confirmed = await apPay(1, 400, { receiptUrl, idempotencyKey: key, confirmDuplicate: true })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
  assert.equal(ap(db, 1).paid_amount, 800)
  assert.equal(db.tables.supplier_payments.length, 2)
})

test("1a. a non-empty reference number already used on the invoice is a duplicate; empty or other invoices are not", async () => {
  const db = apDb()
  assert.equal((await apPay(1, 100, { referenceNumber: "CHQ-555" })).status, 200)
  const dup = await apPay(1, 100, { referenceNumber: " CHQ-555 " })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.code, "DUPLICATE_PAYMENT")
  assert.equal(db.tables.supplier_payments[0].reference_number, "CHQ-555")
  // an empty reference never matches, and the same reference on another invoice is not a duplicate
  assert.equal((await apPay(1, 100, { referenceNumber: "" })).status, 200)
  assert.equal((await apPay(1, 100, { referenceNumber: "" })).status, 200)
  assert.equal((await apPay(2, 100, { referenceNumber: "CHQ-555" })).status, 200)
  assert.equal(ap(db, 1).paid_amount, 300)
})

test("1a. an idempotent replay of a completed payment is still a duplicate replay, not DUPLICATE_PAYMENT", async () => {
  const db = apDb()
  const body = { receiptUrl: "https://blob.test/x.pdf", idempotencyKey: apKey() }
  assert.equal((await apPay(1, 100, body)).status, 200)
  const again = await apPay(1, 100, body)
  assert.equal(again.status, 200)
  assert.equal(again.body.isDuplicate, true)
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("1b. an overpayment needs confirmation; confirmed, the invoice is capped and the excess becomes supplier credit", async () => {
  const db = apDb()
  const refused = await apPay(1, 1500)
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, "OVERPAYMENT")
  assert.equal(refused.body.remaining, 1000)
  assert.equal(refused.body.excess, 500)
  assert.equal(db.tables.supplier_payments.length, 0)

  const r = await apPay(1, 1500, { allowOverpayment: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(ap(db, 1).paid_amount, 1000, "paid_amount never exceeds the invoice amount")
  assert.equal(ap(db, 1).status, "paid")
  assert.equal(r.body.invoice.balance, 0)
  assert.equal(db.tables.supplier_payments.length, 1)
  assert.equal(db.tables.supplier_payments[0].amount, 1500, "the payment row is the real cash")
  assert.equal(db.tables.balance_entries.length, 1)
  assert.equal(db.tables.balance_entries[0].amount, -1500, "the ledger is the real cash")
  assert.equal(db.tables.supplier_credits.length, 1)
  const c = db.tables.supplier_credits[0]
  assert.equal(c.supplier_id, 1)
  assert.equal(c.amount, 500)
  assert.equal(c.status, "active")
  assert.equal(c.credit_type, "overpayment")
  assert.equal(c.reference_type, "ap_payment")
  assert.equal(c.reference_id, db.tables.supplier_payments[0].payment_id)
  assert.equal(c.invoice_id, 1)
  assert.match(c.description, /Overpayment on APINV-B1-1/)
  assert.match(c.notes, /Overpayment on APINV-B1-1/)
  assert.equal(r.body.credit.amount, 500)
  assert.equal(r.body.credit.id, String(c.credit_id))
})

test("1b. an exact payment creates no credit", async () => {
  const db = apDb()
  assert.equal((await apPay(1, 1000, { allowOverpayment: true })).status, 200)
  assert.equal(db.tables.supplier_credits.length, 0)
  assert.equal(ap(db, 1).status, "paid")
})

test("1b. the overpayment credit is an open credit on the supplier card and can be deducted on a new PO", async () => {
  const db = apDb()
  assert.equal((await apPay(1, 1500, { allowOverpayment: true })).status, 200)
  const list = await call(creditsRoute.GET, "GET", undefined, "http://test.local/api/supplier-credits")
  assert.equal(list.status, 200)
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].unapplied, true)
  assert.equal(list.body[0].supplier_id, 1)
  assert.equal(list.body[0].amount, 500)
  assert.equal(list.body[0].invoice_number, "APINV-B1-1")
  let n = 0
  db.rpcHandlers.generate_po_number = () => `PO-B1-${++n}`
  const creditId = db.tables.supplier_credits[0].credit_id
  const po = await call(poRoute.POST, "POST", {
    supplier_id: 1, status: "pending", payment_terms: "cash", payment_type: "cash",
    items: [{ productId: 5, productName: "Part", quantity: 10, unitPrice: 100, total: 1000 }],
    credits: [{ creditId, amount: 500 }],
  })
  assert.equal(po.status, 200, JSON.stringify(po.body))
  assert.equal(db.tables.supplier_credits[0].status, "used")
})

test("1b. a failed credit insert is reported as a partial failure (payment kept, key parked)", async () => {
  const db = apDb()
  db.failOn["supplier_credits:insert"] = "credits down"
  const r = await apPay(1, 1200, { allowOverpayment: true })
  assert.equal(r.status, 500)
  assert.equal(r.body.partialFailure, true)
  assert.equal(r.body.failedStep, "supplier_credits")
  assert.equal(db.tables.supplier_payments.length, 1)
  assert.equal(db.tables.balance_entries.length, 1)
  assert.equal(db.tables.idempotency_log[0].status, "partial_failure")
})

test("1c. a failed supplier_payments insert puts the invoice back; nothing is left paid without a payment row", async () => {
  const db = apDb({ accounts_payable: [apInv(1, { paid_amount: 200, months_paid: 1, status: "partially_paid", payment_receipt_url: "old.pdf" })] })
  db.failOn["supplier_payments:insert"] = "payments down"
  const key = apKey()
  const r = await apPay(1, 800, { idempotencyKey: key })
  assert.equal(r.status, 500)
  assert.notEqual(r.body.partialFailure, true)
  assert.match(r.body.error, /Nothing was recorded/)
  assert.equal(ap(db, 1).paid_amount, 200)
  assert.equal(ap(db, 1).status, "partially_paid")
  assert.equal(ap(db, 1).months_paid, 1)
  assert.equal(ap(db, 1).payment_receipt_url, "old.pdf")
  assert.equal(db.tables.balance_entries.length, 0)
  assert.equal(db.tables.idempotency_log[0].status, "failed")
  delete db.failOn["supplier_payments:insert"]
  const retry = await apPay(1, 800, { idempotencyKey: key })
  assert.equal(retry.status, 200, JSON.stringify(retry.body))
  assert.equal(ap(db, 1).paid_amount, 1000)
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("1c. when the invoice cannot be put back the failure stays a partial failure", async () => {
  const db = apDb()
  db.failOn["supplier_payments:insert"] = "payments down"
  db.failOn["accounts_payable:update"] = "ap down"
  db.failAfter["accounts_payable:update"] = 1 // the payment update works, the compensation fails
  const r = await apPay(1, 300)
  assert.equal(r.status, 500)
  assert.equal(r.body.partialFailure, true)
  assert.equal(r.body.failedStep, "supplier_payments")
  assert.equal(db.tables.idempotency_log[0].status, "partial_failure")
})

test("1. screens: the AP dialog confirms duplicates and overpayments; the supplier card does not go negative", () => {
  const apModule = src("components/modules/accounts-payable-module.tsx")
  assert.match(apModule, /DUPLICATE_PAYMENT/)
  assert.match(apModule, /confirmDuplicate: true/)
  assert.match(apModule, /t\("ap\.duplicate-payment-confirm"\)/)
  assert.match(apModule, /t\("ap\.overpayment-credit-confirm"\)/)
  assert.doesNotMatch(apModule, /ap-allow-overpayment/, "the checkbox is replaced by the confirm")
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["ap.duplicate-payment-confirm", "ap.overpayment-credit-confirm"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in English and Arabic`)
  }
  const supplier = src("components/modules/supplier-module.tsx")
  assert.doesNotMatch(supplier, /totalSpent - totalPaid/, "balance due comes from the per-order amounts due (never negative)")
})

// ---------------------------------------------------------------------------------------------------------
// 2. Side doors
// ---------------------------------------------------------------------------------------------------------
test("2. retired creation endpoints answer 410 and write nothing (AR, customer payments, AP, balance)", async () => {
  const db = new FakeDb({ accounts_receivable: [], customer_payments: [], accounts_payable: [], balance_entries: [] })
  useDb(db)
  const cases: [any, Row][] = [
    [arRoute.POST, { invoiceNumber: "X-1", customerId: 1, soId: 1, amount: 100, collectedAmount: 100, status: "paid" }],
    [customerPaymentsRoute.POST, { invoiceId: 1, customerId: 1, amount: 100 }],
    [apRoute.POST, { invoiceNumber: "AP-X", supplierId: 1, poId: 1, amount: 800 }],
    [balanceRoute.POST, { type: "manual", amount: 5000, description: "cash" }],
  ]
  for (const [handler, body] of cases) {
    const r = await call(handler, "POST", body)
    assert.equal(r.status, 410, JSON.stringify(r.body))
    assert.ok(r.body.error)
  }
  for (const t of ["accounts_receivable", "customer_payments", "accounts_payable", "balance_entries"]) assert.equal(db.tables[t].length, 0, t)
})

const arRow = (extra: Row = {}): Row => ({
  invoice_id: 5, invoice_number: "INV-5", customer_id: 3, amount: 300, collected_amount: 0, months_paid: 0, status: "pending", ...extra,
})

test("2. AR PUT changes only the VAT invoice URL; the screen's { invoiceId, vatInvoiceUrl } body works", async () => {
  const db = new FakeDb({ accounts_receivable: [arRow()] })
  useDb(db)
  const ok = await call(arRoute.PUT, "PUT", { invoiceId: "5", vatInvoiceUrl: "https://blob.test/vat.pdf" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.accounts_receivable[0].vat_invoice_url, "https://blob.test/vat.pdf")
  assert.equal((await call(arRoute.PUT, "PUT", { id: 5, vatInvoiceUrl: "https://blob.test/v2.pdf" })).status, 200)
  assert.equal(db.tables.accounts_receivable[0].vat_invoice_url, "https://blob.test/v2.pdf")
  for (const field of ["collectedAmount", "collected_amount", "status", "monthsPaid", "months_paid", "amount"]) {
    const r = await call(arRoute.PUT, "PUT", { invoiceId: 5, vatInvoiceUrl: "x", [field]: field === "status" ? "paid" : 300 })
    assert.equal(r.status, 400, field)
  }
  assert.equal(db.tables.accounts_receivable[0].collected_amount, 0)
  assert.equal(db.tables.accounts_receivable[0].status, "pending")
  assert.equal((await call(arRoute.PUT, "PUT", { vatInvoiceUrl: "x" })).status, 400, "an id is required")
  assert.equal((await call(arRoute.PUT, "PUT", { invoiceId: 5 })).status, 400, "nothing to change")
  assert.equal((await call(arRoute.PUT, "PUT", { invoiceId: 99, vatInvoiceUrl: "x" })).status, 404)
})

test("2. AR DELETE refuses an invoice with collected money or payment rows", async () => {
  const del = (id: number) => call(arRoute.DELETE, "DELETE", undefined, `http://test.local/api/accounts-receivable?id=${id}`)
  const db = new FakeDb({
    accounts_receivable: [arRow({ invoice_id: 1, invoice_number: "A", collected_amount: 50 }), arRow({ invoice_id: 2, invoice_number: "B" }), arRow({ invoice_id: 3, invoice_number: "C" })],
    customer_payments: [{ payment_id: 1, invoice_id: 2, amount: 10 }],
  })
  useDb(db)
  assert.equal((await del(1)).status, 409)
  assert.equal((await del(2)).status, 409)
  assert.equal((await del(3)).status, 200)
  assert.deepEqual(db.tables.accounts_receivable.map((r) => r.invoice_id), [1, 2])
})

test("2. inventory PUT refuses quantity changes but still updates metadata; DELETE refuses a row with stock", async () => {
  const db = new FakeDb({
    inventory: [
      { inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 20, unit_cost: 10, reorder_point: 2, is_returned: false },
      { inventory_id: 2, product_id: 8, warehouse_id: 1, quantity: 0, unit_cost: 10, is_returned: false },
    ],
  })
  useDb(db)
  for (const extra of [{ quantity: 999 }, { quantity_increment: 5 }, { quantity: 0 }]) {
    const r = await call(inventoryRoute.PUT, "PUT", { productId: 7, warehouseId: 1, ...extra })
    assert.equal(r.status, 400, JSON.stringify(extra))
  }
  assert.equal(db.tables.inventory[0].quantity, 20)
  const meta = await call(inventoryRoute.PUT, "PUT", { productId: 7, warehouseId: 1, reorderPoint: 5, location: "A-3", unitCost: 12 })
  assert.equal(meta.status, 200, JSON.stringify(meta.body))
  assert.equal(db.tables.inventory[0].reorder_point, 5)
  assert.equal(db.tables.inventory[0].location, "A-3")
  assert.equal(db.tables.inventory[0].unit_cost, 12)
  assert.equal(db.tables.inventory[0].quantity, 20)
  // the sales order screen's call (updateInventoryQuantity: no quantity fields) still answers 200
  const so = await call(inventoryRoute.PUT, "PUT", { productId: 7, quantityChange: -2, updateType: "increment", warehouseId: 1 })
  assert.equal(so.status, 200, JSON.stringify(so.body))
  assert.equal(db.tables.inventory[0].quantity, 20)
  const del = (id: number) => call(inventoryRoute.DELETE, "DELETE", undefined, `http://test.local/api/inventory?id=${id}`)
  assert.equal((await del(1)).status, 409)
  assert.equal((await del(2)).status, 200)
  assert.deepEqual(db.tables.inventory.map((r) => r.inventory_id), [1])
})

test("2. payment rescheduling is removed: no endpoint, no request button, no CEO approval box", () => {
  const { existsSync } = require("node:fs") as typeof import("node:fs")
  assert.equal(existsSync(join(ROOT, "app/api/reschedule-requests/route.ts")), false)
  for (const f of ["components/modules/payment-schedule-module.tsx", "components/modules/accountant-module.tsx", "components/modules/financial-dashboard.tsx"]) {
    assert.doesNotMatch(src(f), /reschedule/i, f)
  }
  assert.doesNotMatch(src("lib/i18n-context.tsx"), /reschedule|إعادة الجدولة/)
})

const linkedScheduleDb = (schedules?: Row[], invoice: Row = {}) => {
  const db = new FakeDb({
    payment_schedules: schedules ?? [
      { schedule_id: 1, invoice_id: 5, installment_number: 1, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" },
    ],
    accounts_receivable: [arRow(invoice)],
    customer_payments: [], balance_entries: [], idempotency_log: [],
  })
  useDb(db)
  return db
}

test("2. a linked receivable schedule payment writes the customer payment and the ledger row (both PUT paths)", async () => {
  for (const body of [{ scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" }, { scheduleId: "1" }]) {
    const db = linkedScheduleDb()
    const r = await call(scheduleRoute.PUT, "PUT", body)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.message, "Payment recorded successfully")
    assert.equal(db.tables.accounts_receivable[0].collected_amount, 100)
    assert.equal(db.tables.payment_schedules[0].status, "paid")
    assert.equal(db.tables.payment_schedules[0].paid_amount, 100)
    assert.equal(db.tables.customer_payments.length, 1)
    assert.equal(db.tables.customer_payments[0].amount, 100)
    assert.equal(db.tables.customer_payments[0].invoice_id, 5)
    assert.equal(db.tables.balance_entries.length, 1)
    assert.equal(db.tables.balance_entries[0].entry_type, "ar_payment")
    assert.equal(db.tables.balance_entries[0].amount, 100)
    // a repeat is a duplicate and writes nothing
    const again = await call(scheduleRoute.PUT, "PUT", body)
    assert.equal(again.status, 200)
    assert.equal(again.body.isDuplicate, true)
    assert.equal(db.tables.customer_payments.length, 1)
    assert.equal(db.tables.balance_entries.length, 1)
  }
})

test("2. a schedule payment and the receivables screen payment write the same rows", async () => {
  const viaSchedule = linkedScheduleDb()
  await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 60, invoiceId: 5, paymentDate: "2026-10-08" })
  const viaAr = linkedScheduleDb()
  await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 60, idempotencyKey: "ar-screen-key-1", scheduleId: 1 })
  for (const db of [viaSchedule, viaAr]) {
    assert.equal(db.tables.accounts_receivable[0].collected_amount, 60)
    assert.equal(db.tables.accounts_receivable[0].status, "partially_paid")
    assert.equal(db.tables.payment_schedules[0].paid_amount, 60)
    assert.equal(db.tables.payment_schedules[0].status, "partial")
    assert.equal(db.tables.customer_payments.length, 1)
    assert.equal(db.tables.balance_entries.length, 1)
  }
})

test("2. a schedule payment above the invoice balance is refused; nothing is written", async () => {
  const db = linkedScheduleDb(undefined, { collected_amount: 250 })
  const r = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 100, invoiceId: 5 })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /exceeds/)
  assert.equal(db.tables.accounts_receivable[0].collected_amount, 250)
  assert.equal(db.tables.payment_schedules[0].paid_amount, 0)
  assert.equal(db.tables.customer_payments.length, 0)
})

test("2. AR payments route still answers as before after the extraction", async () => {
  const db = linkedScheduleDb()
  const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 300, idempotencyKey: "ar-screen-key-2" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.success, true)
  assert.equal(r.body.invoice.status, "paid")
  assert.equal((await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 300, idempotencyKey: "ar-screen-key-2" })).body.isDuplicate, true)
  assert.equal((await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 1, idempotencyKey: "ar-screen-key-3" })).status, 409)
  assert.equal(db.tables.customer_payments.length, 1)
})

// ---------------------------------------------------------------------------------------------------------
// 3. Stock count (BIZ-P-01)
// ---------------------------------------------------------------------------------------------------------
const stockRow = (inventory_id: number, product_id: number, warehouse_id: number, quantity: number): Row => ({
  inventory_id, product_id, warehouse_id, quantity, unit_cost: 10, reorder_point: 1, is_returned: false,
})
const countDb = () => {
  const db = new FakeDb({
    inventory: [stockRow(1, 7, 1, 20), stockRow(2, 7, 2, 30), stockRow(3, 8, 1, 5)],
    inventory_audits: [],
    products: [{ product_id: 7, product_name: "Brake pad" }, { product_id: 8, product_name: "Filter" }],
  })
  useDb(db)
  return db
}
const stock = (db: FakeDb, id: number) => db.tables.inventory.find((r) => r.inventory_id === id)!.quantity
const saveCount = (adjustments: Row[]) => call(auditRoute.POST, "POST", { adjustments, auditedBy: "u1" })

test("3. a count of stock that moved meanwhile is not saved; the other rows are (409 STOCK_CHANGED)", async () => {
  const db = countDb()
  // loaded at 20 / 30 / 5; a delivery took 4 from row 1 before the count was saved
  db.tables.inventory[0].quantity = 16
  const r = await saveCount([
    { inventoryId: 1, productId: 7, warehouseId: 1, systemQuantity: 20, physicalCount: 18 },
    { inventoryId: 2, productId: 7, warehouseId: 2, systemQuantity: 30, physicalCount: 28 },
    { inventoryId: 3, productId: 8, warehouseId: 1, systemQuantity: 5, physicalCount: 5 },
  ])
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.code, "STOCK_CHANGED")
  assert.deepEqual(r.body.changed, [
    { inventoryId: 1, productId: 7, productName: "Brake pad", warehouseId: 1, quantityLoaded: 20, quantityNow: 16 },
  ])
  assert.equal(stock(db, 1), 16, "the delivery is not overwritten")
  assert.equal(stock(db, 2), 28, "the unchanged row is saved")
  assert.equal(stock(db, 3), 5)
  assert.deepEqual(db.tables.inventory_audits.map((a) => a.product_id).sort(), [7, 8], "audits only for the saved rows")
  assert.equal(db.tables.inventory_audits.find((a) => a.product_id === 7)!.physical_count, 28)
})

test("3. a 'matches' count of stock that moved is reported too and leaves the stock alone", async () => {
  const db = countDb()
  db.tables.inventory[2].quantity = 9
  const r = await saveCount([{ inventoryId: 3, productId: 8, warehouseId: 1, systemQuantity: 5, physicalCount: 5 }])
  assert.equal(r.status, 409)
  assert.equal(r.body.changed[0].quantityNow, 9)
  assert.equal(stock(db, 3), 9)
  assert.equal(db.tables.inventory_audits.length, 0)
})

test("3. a count without the loaded system quantity is refused; nothing saved", async () => {
  const db = countDb()
  const r = await saveCount([{ inventoryId: 1, productId: 7, warehouseId: 1, physicalCount: 3 }])
  assert.equal(r.status, 400)
  assert.equal(stock(db, 1), 20)
  assert.equal(db.tables.inventory_audits.length, 0)
})

test("3. an unchanged count saves as before (200)", async () => {
  const db = countDb()
  const r = await saveCount([{ inventoryId: 1, productId: 7, warehouseId: 1, systemQuantity: 20, physicalCount: 17 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(stock(db, 1), 17)
  assert.equal(r.body.summary.adjustmentsMade, 1)
})

test("3. a count racing a stock movement never loses the movement", async () => {
  for (let round = 0; round < 20; round++) {
    const db = countDb()
    // a concurrent guarded movement of -4 (like a delivery deduction) on row 1
    const move = (async () => {
      await db.tick()
      const { data } = await db.from("inventory").update({ quantity: 16 }).eq("inventory_id", 1).eq("quantity", 20).select()
      return (data || []).length === 1
    })()
    const [r, moved] = await Promise.all([
      saveCount([{ inventoryId: 1, productId: 7, warehouseId: 1, systemQuantity: 20, physicalCount: 18 }]),
      move,
    ])
    if (moved) {
      assert.equal(r.status, 409, `round ${round}`)
      assert.equal(stock(db, 1), 16)
    } else {
      assert.equal(r.status, 200, `round ${round}`)
      assert.equal(stock(db, 1), 18)
    }
  }
})

test("3. an audit record failure puts the saved counts back", async () => {
  const db = countDb()
  db.failOn["inventory_audits:insert"] = "audits down"
  const r = await saveCount([{ inventoryId: 1, productId: 7, warehouseId: 1, systemQuantity: 20, physicalCount: 17 }])
  assert.equal(r.status, 500)
  assert.equal(stock(db, 1), 20)
})

test("3. screen: the stock count lists the changed rows and reloads their quantities", () => {
  const screen = src("components/modules/inventory-audit-module.tsx")
  assert.match(screen, /systemQuantity: item\.quantity/)
  assert.match(screen, /STOCK_CHANGED/)
  assert.match(screen, /t\("inventory-audit\.changed-title"\)/)
  assert.match(screen, /fetchInventory\(keep\)/)
  const i18n = src("lib/i18n-context.tsx")
  assert.ok(i18n.includes('"inventory-audit.changed-title": "These items changed during your count. Recheck them:"'))
  for (const key of ["inventory-audit.changed-title", "inventory-audit.changed-line"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in English and Arabic`)
  }
})

// ---------------------------------------------------------------------------------------------------------
// 4. Delivery permit approve vs reject (BIZ-S-001)
// ---------------------------------------------------------------------------------------------------------
function permitDb() {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-B1-1", customer_id: 5, status: "ready_for_delivery", fulfillment_status: "PENDING", total: 0 }],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, item_type: "stock", unit_price: 100, total: 1000 },
      { so_item_id: 2, so_id: 1, product_id: 8, quantity: 4, item_type: "stock", unit_price: 100, total: 400 },
    ],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-B1-1", sales_order_id: 1, customer_id: 5, status: "SUBMITTED_SIGNED" }],
    delivery_permit_items: [
      { item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "P7", quantity: 6, unit_price: 100, total: 600, warehouse_id: 1 },
      { item_id: 2, permit_id: 1, product_id: 8, item_name_snapshot: "P8", quantity: 4, unit_price: 100, total: 400, warehouse_id: 2 },
    ],
    inventory: [
      { inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 20, is_returned: false, unit_cost: 50 },
      { inventory_id: 2, product_id: 8, warehouse_id: 2, quantity: 4, is_returned: false, unit_cost: 50 },
    ],
    inventory_transactions: [], idempotency_log: [], product_returns: [], return_items: [], workflow_events: [], users: [],
  })
  useDb(db)
  return db
}
const dpApprove = () => call(dpRoute.PUT, "PUT", { permitId: "1", action: "APPROVE" })
const dpReject = () => call(dpRoute.PUT, "PUT", { permitId: "1", action: "REJECT", rejectionReason: "wrong address" })
const permitStatus = (db: FakeDb) => db.tables.delivery_permits[0].status
const onHand = (db: FakeDb) => db.tables.inventory.map((r) => r.quantity)

// Runs `change` on the permit row right before the request's own status write (between its read and its write).
function changeBeforeStatusWrite(db: FakeDb, change: () => void) {
  const from = db.from.bind(db)
  let done = false
  ;(db as any).from = (table: string) => {
    const q: any = from(table)
    if (table === "delivery_permits" && !done) {
      const update = q.update.bind(q)
      q.update = (payload: any) => {
        if (payload && payload.status !== undefined && !done) {
          done = true
          change()
        }
        return update(payload)
      }
    }
    return q
  }
}

test("4. an approval that loses to a reject puts the stock back and is refused (409); the key can be retried", async () => {
  const db = permitDb()
  changeBeforeStatusWrite(db, () => { db.tables.delivery_permits[0].status = "REJECTED" })
  const r = await dpApprove()
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.code, "DP_STATUS_CHANGED")
  assert.equal(r.body.error, "This permit was changed by someone else (now REJECTED). Reload.")
  assert.equal(permitStatus(db), "REJECTED")
  assert.deepEqual(onHand(db), [20, 4], "the deducted stock was put back")
  const key = db.tables.idempotency_log.find((l) => l.operation_type === "dp_approval")!
  assert.equal(key.status, "failed")
})

test("4. a reject that loses to an approval is refused (409) and the approval stands", async () => {
  const db = permitDb()
  changeBeforeStatusWrite(db, () => { db.tables.delivery_permits[0].status = "APPROVED" })
  const r = await dpReject()
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.error, "This permit was changed by someone else (now APPROVED). Reload.")
  assert.equal(permitStatus(db), "APPROVED")
})

test("4. approve and reject at the same time: exactly one wins and stock matches the outcome", async () => {
  for (let round = 0; round < 20; round++) {
    const db = permitDb()
    const [a, r] = await Promise.all([dpApprove(), dpReject()])
    assert.equal([a, r].filter((x) => x.status === 200).length, 1, `round ${round}: ${JSON.stringify([a.body, r.body])}`)
    const loser = a.status === 200 ? r : a
    assert.equal(loser.status, 409, JSON.stringify(loser.body))
    if (permitStatus(db) === "APPROVED") assert.deepEqual(onHand(db), [14, 0], `round ${round}`)
    else {
      assert.equal(permitStatus(db), "REJECTED")
      assert.deepEqual(onHand(db), [20, 4], `round ${round}`)
    }
  }
})

test("4. a plain approval still works and deducts once", async () => {
  const db = permitDb()
  const r = await dpApprove()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(permitStatus(db), "APPROVED")
  assert.deepEqual(onHand(db), [14, 0])
})

// ---------------------------------------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------------------------------------
// Runs `change` once, right before the first update of `table` (between the request's read and its write).
function beforeFirstUpdate(db: FakeDb, table: string, change: () => void) {
  const from = db.from.bind(db)
  let done = false
  ;(db as any).from = (name: string) => {
    const q: any = from(name)
    if (name === table && !done) {
      const update = q.update.bind(q)
      q.update = (payload: any) => {
        if (!done) {
          done = true
          change()
        }
        return update(payload)
      }
    }
    return q
  }
}

test("R I-2. the supplier card's total paid counts cash only, not supplier credit applied to an invoice", () => {
  const screen = src("components/modules/supplier-module.tsx")
  assert.match(screen, /payment\.payment_method === SUPPLIER_CREDIT_PAYMENT_METHOD\) return/)
})

test("R I-3. after STOCK_CHANGED the changed rows must be counted again; saved rows are confirmed", () => {
  const screen = src("components/modules/inventory-audit-module.tsx")
  assert.match(screen, /keep\.set\(item\.inventory_id, \{ physicalCount: null, notes: item\.notes \}\)/)
  assert.match(screen, /t\("inventory-audit\.saved-some"\)/)
  const i18n = src("lib/i18n-context.tsx")
  assert.equal(i18n.split('"inventory-audit.saved-some":').length - 1, 2, "English and Arabic")
})

test("R m2. an overpayment credit on an invoice without a supplier takes the supplier of its purchase order", async () => {
  const db = apDb({ accounts_payable: [apInv(1, { supplier_id: null })], purchase_orders: [{ po_id: 11, supplier_id: 7 }] })
  const r = await apPay(1, 1500, { allowOverpayment: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.supplier_credits[0].supplier_id, 7)
})

test("R m3. a payment insert that errors after writing the row is not undone (it stays a parked partial failure)", async () => {
  const db = apDb()
  db.failOn["supplier_payments:insert"] = "timeout after commit"
  const from = db.from.bind(db)
  ;(db as any).from = (name: string) => {
    const q: any = from(name)
    if (name === "supplier_payments") {
      const insert = q.insert.bind(q)
      q.insert = (payload: any) => {
        db.tables.supplier_payments.push({ ...payload, payment_id: 999 })
        return insert(payload)
      }
    }
    return q
  }
  const r = await apPay(1, 400)
  assert.equal(r.status, 500)
  assert.equal(r.body.partialFailure, true)
  assert.equal(ap(db, 1).paid_amount, 400, "the invoice matches the payment row that exists")
  assert.equal(db.tables.idempotency_log[0].status, "partial_failure")
})

test("R m6. the supplier card shows the credit type in the user's language", () => {
  const screen = src("components/modules/supplier-module.tsx")
  assert.match(screen, /supplier\.credit-type-overpayment/)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["supplier.credit-type-overpayment", "supplier.credit-type-return"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, key)
  }
})

test("R m8. an AR payment re-checks the balance when the invoice amount changed before its write", async () => {
  const db = linkedScheduleDb()
  beforeFirstUpdate(db, "accounts_receivable", () => { db.tables.accounts_receivable[0].amount = 100 })
  const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 200, idempotencyKey: "ar-amount-race-1" })
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(db.tables.accounts_receivable[0].collected_amount, 0)
  assert.equal(db.tables.customer_payments.length, 0)
})

test("R m9. pay in full on a schedule with nothing open is refused and collects nothing", async () => {
  for (const status of ["partial", "paid"]) {
    const db = linkedScheduleDb([
      { schedule_id: 1, invoice_id: 5, installment_number: 1, amount: 100, paid_amount: 100, status, schedule_type: "receivable" },
    ])
    const r = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1" })
    assert.equal(r.status, 400, `${status}: ${JSON.stringify(r.body)}`)
    assert.equal(db.tables.customer_payments.length, 0, status)
    assert.equal(db.tables.accounts_receivable[0].collected_amount, 0, status)
  }
})

test("R m10. a schedule of a purchase order is never paid as a customer receivable", async () => {
  const db = linkedScheduleDb([
    { schedule_id: 1, invoice_id: 5, po_id: 3, installment_number: 1, amount: 100, paid_amount: 0, status: "pending", schedule_type: null },
  ])
  await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 100, paymentDate: "2026-10-08" })
  assert.equal(db.tables.customer_payments.length, 0)
  assert.equal(db.tables.accounts_receivable[0].collected_amount, 0)
})

test("R m11. a stock count that cannot be put back after a failure says which rows kept the count", async () => {
  const db = countDb()
  db.failOn["inventory_audits:insert"] = "audits down"
  // stock moves after the count was written, so the guarded put-back misses
  const from = db.from.bind(db)
  ;(db as any).from = (name: string) => {
    if (name === "inventory_audits") db.tables.inventory[0].quantity = 99
    return from(name)
  }
  const r = await saveCount([{ inventoryId: 1, productId: 7, warehouseId: 1, systemQuantity: 20, physicalCount: 17 }])
  assert.equal(r.status, 500)
  assert.doesNotMatch(r.body.error, /Nothing was saved/)
  assert.match(r.body.error, /could not be put back/)
  assert.deepEqual(r.body.notRestored, [{ inventoryId: 1, productId: 7, warehouseId: 1 }])
})

// ---------------------------------------------------------------------------------------------------------
// Phase 2. Customer credits: AR overpayment, duplicate warning, using credit on an invoice, customer card
// ---------------------------------------------------------------------------------------------------------
const custCredit = (credit_id: number, amount: number, extra: Row = {}): Row => ({
  credit_id, customer_id: 3, amount, status: "active", credit_type: "overpayment", invoice_id: 9, reference_type: "ar_payment",
  reference_id: 1, notes: "Overpayment on INV-9", used_at: null, used_in_invoice_id: null, created_at: "2026-10-01T00:00:00Z", ...extra,
})
const creditDb = (credits: Row[] = [custCredit(1, 80)], invoice: Row = {}) => {
  const db = new FakeDb({
    accounts_receivable: [arRow(invoice), arRow({ invoice_id: 9, invoice_number: "INV-9", status: "paid", collected_amount: 300 })],
    customer_credits: credits, customer_payments: [], balance_entries: [], idempotency_log: [], payment_schedules: [],
  })
  useDb(db)
  return db
}
const applyCredit = (credits: Row[], key = apKey(), invoiceId = 5) =>
  call(applyCreditRoute.POST, "POST", { invoiceId, idempotencyKey: key, credits })
const ar5 = (db: FakeDb) => db.tables.accounts_receivable.find((r) => r.invoice_id === 5)!

test("P2 B. an AR payment above the balance is refused with OVERPAYMENT until it is confirmed; nothing is written", async () => {
  const db = creditDb([], { collected_amount: 250, status: "partially_paid" })
  const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 80, idempotencyKey: apKey() })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "OVERPAYMENT")
  assert.equal(r.body.remaining, 50)
  assert.equal(r.body.excess, 30)
  assert.match(r.body.error, /exceeds/)
  assert.equal(ar5(db).collected_amount, 250)
  for (const t of ["customer_payments", "balance_entries", "customer_credits"]) assert.equal(db.tables[t].length, 0, t)
})

test("P2 B. a confirmed AR overpayment caps the invoice, keeps the full cash and saves the excess as customer credit", async () => {
  const db = creditDb([], { collected_amount: 250, status: "partially_paid" })
  const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 80, idempotencyKey: apKey(), allowOverpayment: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(ar5(db).collected_amount, 300)
  assert.equal(ar5(db).status, "paid")
  assert.equal(db.tables.customer_payments[0].amount, 80)
  assert.equal(db.tables.balance_entries[0].amount, 80)
  assert.equal(db.tables.customer_credits.length, 1)
  const credit = db.tables.customer_credits[0]
  assert.equal(credit.customer_id, 3)
  assert.equal(credit.amount, 30)
  assert.equal(credit.status, "active")
  assert.equal(credit.credit_type, "overpayment")
  assert.equal(credit.reference_type, "ar_payment")
  assert.equal(credit.reference_id, db.tables.customer_payments[0].payment_id)
  assert.equal(credit.invoice_id, 5)
  assert.equal(credit.notes, "Overpayment on INV-5")
  assert.deepEqual(r.body.credit, { id: String(credit.credit_id), amount: 30 })
})

test("P2 B. a failed customer credit insert is a partial failure and the key is parked", async () => {
  const db = creditDb([], { collected_amount: 250, status: "partially_paid" })
  db.failOn["customer_credits:insert"] = "credits down"
  const key = apKey()
  const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 80, idempotencyKey: key, allowOverpayment: true })
  assert.equal(r.status, 500)
  assert.equal(r.body.partialFailure, true)
  assert.equal(r.body.failedStep, "customer_credits")
  const again = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 80, idempotencyKey: key, allowOverpayment: true })
  assert.equal(again.status, 409)
  assert.equal(db.tables.customer_payments.length, 1)
})

test("P2 B. a schedule payment that overpays behaves the same; the schedule gets only the invoice part", async () => {
  const db = linkedScheduleDb(undefined, { collected_amount: 250, status: "partially_paid" })
  db.tables.customer_credits = []
  const refused = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 100, invoiceId: 5 })
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, "OVERPAYMENT")
  const r = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 100, invoiceId: 5, allowOverpayment: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.accounts_receivable[0].collected_amount, 300)
  assert.equal(db.tables.payment_schedules[0].paid_amount, 50)
  assert.equal(db.tables.customer_payments[0].amount, 100)
  assert.equal(db.tables.customer_credits[0].amount, 50)
  assert.equal(r.body.credit.amount, 50)
})

test("P2 B. a payment with a receipt or reference already on the invoice needs confirmDuplicate", async () => {
  const db = creditDb([])
  db.tables.customer_payments.push({ payment_id: 41, invoice_id: 5, amount: 50, payment_date: "2026-10-01", receipt_url: "https://blob.test/r1.pdf", reference_number: "BANK-77" })
  for (const extra of [{ receiptUrl: "https://blob.test/r1.pdf" }, { referenceNumber: "BANK-77" }]) {
    const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 50, idempotencyKey: apKey(), ...extra })
    assert.equal(r.status, 409, JSON.stringify(extra))
    assert.equal(r.body.code, "DUPLICATE_PAYMENT")
    assert.deepEqual(r.body.existingPayment, { id: "41", paymentDate: "2026-10-01", amount: 50 })
  }
  assert.equal(db.tables.customer_payments.length, 1)
  const ok = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 50, idempotencyKey: apKey(), referenceNumber: "BANK-77", confirmDuplicate: true })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.customer_payments[1].reference_number, "BANK-77")
  // a payment with neither a receipt nor a reference is never treated as a duplicate
  assert.equal((await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 50, idempotencyKey: apKey() })).status, 200)
})

test("P2 C. using part of a credit splits it, raises the invoice, writes one customer_credit payment and no ledger row", async () => {
  const db = creditDb([custCredit(1, 80), custCredit(2, 20)])
  const r = await applyCredit([{ creditId: 1, amount: 50 }, { creditId: 2, amount: 20 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.applied, 70)
  assert.equal(ar5(db).collected_amount, 70)
  assert.equal(ar5(db).status, "partially_paid")
  assert.equal(ar5(db).months_paid, 0)
  const [c1, c2, rest] = db.tables.customer_credits
  assert.deepEqual([c1.status, c1.amount, c1.used_in_invoice_id], ["used", 50, 5])
  assert.ok(c1.used_at)
  assert.deepEqual([c2.status, c2.amount, c2.used_in_invoice_id], ["used", 20, 5])
  assert.deepEqual([rest.status, rest.amount, rest.customer_id, rest.used_in_invoice_id], ["active", 30, 3, null])
  assert.equal(rest.notes, "Remainder of credit #1 after 50.00 was applied to INV-5")
  assert.equal(db.tables.customer_payments.length, 1)
  assert.equal(db.tables.customer_payments[0].payment_method, "customer_credit")
  assert.equal(db.tables.customer_payments[0].amount, 70)
  assert.equal(db.tables.balance_entries.length, 0)
})

test("P2 C. credits above the remaining balance, of another customer or already used are refused; nothing changes", async () => {
  const cases: [Row[], Row[], string][] = [
    [[custCredit(1, 80)], [{ creditId: 1, amount: 60 }], "CREDIT_EXCEEDS_TOTAL"],
    [[custCredit(1, 80, { customer_id: 4 })], [{ creditId: 1, amount: 10 }], "CREDIT_NOT_AVAILABLE"],
    [[custCredit(1, 80, { status: "used" })], [{ creditId: 1, amount: 10 }], "CREDIT_NOT_AVAILABLE"],
    [[custCredit(1, 8)], [{ creditId: 1, amount: 10 }], "CREDIT_AMOUNT_INVALID"],
  ]
  for (const [credits, selection, code] of cases) {
    const db = creditDb(credits, { collected_amount: 250, status: "partially_paid" })
    const before = JSON.stringify(db.tables.customer_credits)
    const r = await applyCredit(selection)
    assert.equal(r.status, 409, code)
    assert.equal(r.body.code, code)
    assert.equal(JSON.stringify(db.tables.customer_credits), before, code)
    assert.equal(ar5(db).collected_amount, 250, code)
    assert.equal(db.tables.customer_payments.length, 0, code)
  }
  const db = creditDb()
  assert.equal((await applyCredit([])).status, 400)
  assert.equal(db.tables.customer_credits[0].status, "active")
})

test("P2 C. a credit used elsewhere between read and write is refused and the other credits are put back", async () => {
  const db = creditDb([custCredit(1, 40), custCredit(2, 40)])
  let n = 0
  const from = db.from.bind(db)
  ;(db as any).from = (name: string) => {
    if (name === "customer_credits" && ++n === 3) db.tables.customer_credits[1].amount = 39 // before the 2nd reserve
    return from(name)
  }
  const r = await applyCredit([{ creditId: 1, amount: 40 }, { creditId: 2, amount: 39 }])
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(db.tables.customer_credits[0].status, "active")
  assert.equal(db.tables.customer_credits[0].amount, 40)
  assert.equal(db.tables.customer_credits[0].used_in_invoice_id, null)
  assert.equal(ar5(db).collected_amount, 0)
})

test("P2 C. a failed invoice update or payment row puts the credits (and the invoice) back", async () => {
  for (const op of ["accounts_receivable:update", "customer_payments:insert"]) {
    const db = creditDb([custCredit(1, 80)])
    if (op === "accounts_receivable:update") db.failOn[op] = "down"
    else db.failOn[op] = "down"
    const key = apKey()
    const r = await applyCredit([{ creditId: 1, amount: 50 }], key)
    assert.equal(r.status, 500, op)
    assert.notEqual(r.body.partialFailure, true, op)
    assert.equal(db.tables.customer_credits.length, 1, op)
    assert.deepEqual([db.tables.customer_credits[0].status, db.tables.customer_credits[0].amount], ["active", 80], op)
    assert.equal(ar5(db).collected_amount, 0, op)
    assert.equal(ar5(db).status, "pending", op)
    assert.equal(db.tables.customer_payments.length, 0, op)
    // the key was rejected before anything stayed written, so it can be retried
    delete db.failOn[op]
    assert.equal((await applyCredit([{ creditId: 1, amount: 50 }], key)).status, 200, op)
  }
})

test("P2 C. applying the same credit request twice is idempotent", async () => {
  const db = creditDb([custCredit(1, 80)])
  const key = apKey()
  assert.equal((await applyCredit([{ creditId: 1, amount: 80 }], key)).status, 200)
  const again = await applyCredit([{ creditId: 1, amount: 80 }], key)
  assert.equal(again.status, 200)
  assert.equal(again.body.isDuplicate, true)
  assert.equal(ar5(db).collected_amount, 80)
  assert.equal(db.tables.customer_payments.length, 1)
  assert.equal(db.tables.customer_credits.length, 1)
})

test("P2 C. a credit cannot be used on a paid invoice", async () => {
  const db = creditDb([custCredit(1, 80)], { collected_amount: 300, status: "paid" })
  const r = await applyCredit([{ creditId: 1, amount: 10 }])
  assert.equal(r.status, 409)
  assert.equal(db.tables.customer_credits[0].status, "active")
})

test("P2 D. GET customer-credits lists a customer's open credits and, with include=used, the used ones with their invoice", async () => {
  const db = creditDb([
    custCredit(1, 80),
    custCredit(2, 20, { status: "used", used_in_invoice_id: 5, used_at: "2026-10-05T00:00:00Z" }),
    custCredit(3, 15, { customer_id: 4 }),
  ])
  void db
  const open = await call(customerCreditsRoute.GET, "GET", undefined, "http://test.local/api/customer-credits?customer_id=3")
  assert.equal(open.status, 200)
  assert.deepEqual(open.body.map((c: any) => c.credit_id), [1])
  assert.equal(open.body[0].invoice_number, "INV-9")
  assert.equal(open.body[0].unapplied, true)
  const all = await call(customerCreditsRoute.GET, "GET", undefined, "http://test.local/api/customer-credits?customer_id=3&include=used")
  assert.deepEqual(all.body.map((c: any) => c.credit_id), [1, 2])
  assert.equal(all.body[1].used_in_invoice_number, "INV-5")
  assert.equal(all.body[1].unapplied, false)
  const every = await call(customerCreditsRoute.GET, "GET", undefined, "http://test.local/api/customer-credits")
  assert.deepEqual(every.body.map((c: any) => c.credit_id).sort(), [1, 3])
  assert.equal((await call(customerCreditsRoute.GET, "GET", undefined, "http://test.local/api/customer-credits?customer_id=x")).status, 400)
})

test("P2 UI. the receivables screen confirms an overpayment and a duplicate, and offers the customer credit dialog", () => {
  const ar = src("components/modules/accounts-receivable-module.tsx")
  assert.match(ar, /ar\.overpayment-credit-confirm/)
  assert.match(ar, /code === "OVERPAYMENT"/)
  assert.match(ar, /code === "DUPLICATE_PAYMENT"/)
  assert.match(ar, /confirmDuplicate/)
  assert.match(ar, /referenceNumber/)
  assert.match(ar, /<CustomerCreditDialog/)
  const dialog = src("components/payment/customer-credit-dialog.tsx")
  assert.match(dialog, /\/api\/accounts-receivable\/apply-credit/)
  assert.match(dialog, /\/api\/customer-credits\?customer_id=/)
  assert.match(dialog, /idempotencyKey/)
  // the supplier PO form and the customer dialog share one credit list
  assert.match(src("components/supplier/supplier-credit-picker.tsx"), /CreditPickerList/)
  assert.match(dialog, /CreditPickerList/)
})

test("P2 UI. customer credit is never counted as cash paid; the customer card lists open and used credits", () => {
  for (const file of ["components/modules/accountant-module.tsx", "components/modules/customer-module.tsx"]) {
    assert.match(src(file), /=== CUSTOMER_CREDIT_PAYMENT_METHOD\) return/, file)
  }
  assert.match(src("components/modules/customer-module.tsx"), /<CustomerCreditsCard/)
  const card = src("components/accounting/customer-credits-card.tsx")
  assert.match(card, /include=used/)
  assert.match(card, /parseRemainderNote/)
  assert.match(card, /customer\.credit-used-on-invoice/)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["ar.overpayment-credit-confirm", "ar.credit.use", "ar.credit.apply", "customer.credits", "customer.credit-remainder-note", "customer.open-credit"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, key)
  }
})

// ---------------------------------------------------------------------------------------------------------
// Phase 2 review fixes: checked credit rollback, overpayment owner, payment row written despite an error,
// credit methods refused on cash payments
// ---------------------------------------------------------------------------------------------------------
const logStatus = (db: FakeDb, key: string) => db.tables.idempotency_log.find((r) => String(r.idempotency_key).endsWith(key))?.status

test("P2 I1. a credit that cannot be put back after a failed invoice update is a partial failure, not 'Nothing was saved'", async () => {
  const db = creditDb([custCredit(1, 80)])
  db.failOn["accounts_receivable:update"] = "down"
  db.failOn["customer_credits:update"] = "credits down"
  db.failAfter["customer_credits:update"] = 1 // the reserve succeeds, the restore fails
  const key = apKey()
  const r = await applyCredit([{ creditId: 1, amount: 80 }], key)
  assert.equal(r.status, 500)
  assert.equal(r.body.partialFailure, true)
  assert.doesNotMatch(r.body.error, /Nothing was saved/)
  assert.equal(logStatus(db, key), "partial_failure")
  assert.equal(db.tables.customer_credits[0].status, "used")
})

test("P2 I1. a split credit whose remainder was used meanwhile is put back only to the part this call used", async () => {
  const db = creditDb([custCredit(1, 80)])
  let arCalls = 0
  const from = db.from.bind(db)
  ;(db as any).from = (name: string) => {
    if (name === "accounts_receivable" && ++arCalls === 2) {
      // another tab uses the remainder, and a cash payment lands on the invoice before this call's update
      db.tables.customer_credits[1].status = "used"
      db.tables.customer_credits[1].used_in_invoice_id = 9
      ar5(db).collected_amount = 10
    }
    return from(name)
  }
  const key = apKey()
  const r = await applyCredit([{ creditId: 1, amount: 50 }], key)
  assert.equal(r.status, 500, JSON.stringify(r.body))
  assert.equal(r.body.partialFailure, true)
  assert.doesNotMatch(r.body.error, /Nothing was saved/)
  assert.equal(logStatus(db, key), "partial_failure")
  const [c1, rest] = db.tables.customer_credits
  // never more credit than the 80 the customer had: 50 open again, 30 spent by the other tab
  assert.deepEqual([c1.status, c1.amount, c1.used_in_invoice_id], ["active", 50, null])
  assert.deepEqual([rest.status, rest.amount], ["used", 30])
})

test("P2 I1. supplier credits: a reserve whose rollback fails reports a partial failure; a clean rollback keeps the old message", async () => {
  const supCredit = (credit_id: number, amount: number): Row => ({ credit_id, supplier_id: 1, amount, status: "active", notes: null })
  const run = async (failRestore: boolean) => {
    const db = new FakeDb({ supplier_credits: [supCredit(1, 40), supCredit(2, 40)] })
    const rows = new Map(db.tables.supplier_credits.map((r) => [r.credit_id, { ...r }]))
    db.tables.supplier_credits[1].amount = 39 // the second credit changed after it was read
    if (failRestore) {
      db.failOn["supplier_credits:update"] = "down"
      db.failAfter["supplier_credits:update"] = 1
    }
    const out = await reserveCredits(db, SUPPLIER_CREDIT_LEDGER, { targetId: 7, targetNumber: "PO-7", selections: [{ creditId: 1, amount: 40 }, { creditId: 2, amount: 40 }], rows })
    return { db, out }
  }
  const clean = await run(false)
  assert.equal(clean.out.error?.status, 409)
  assert.equal(clean.out.error?.body.code, "CREDIT_NOT_AVAILABLE")
  assert.equal(clean.out.error?.body.error, "Credit #2 was used or changed by someone else. Reload and try again.")
  assert.equal(clean.db.tables.supplier_credits[0].status, "active")
  const broken = await run(true)
  assert.equal(broken.out.error?.status, 500)
  assert.equal(broken.out.error?.body.partialFailure, true)
  assert.deepEqual(broken.out.error?.body.notRestored, [1])
  assert.doesNotMatch(String(broken.out.error?.body.error), /Nothing was saved/)
})

test("P2 I2. an overpayment on an invoice without a customer takes the sales order's customer, or is refused before any write", async () => {
  const db = creditDb([], { customer_id: null, so_id: 12, collected_amount: 250, status: "partially_paid" })
  db.tables.sales_orders = [{ so_id: 12, customer_id: 3 }]
  const ok = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 80, idempotencyKey: apKey(), allowOverpayment: true })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.customer_credits[0].customer_id, 3)
  assert.equal(db.tables.customer_credits[0].amount, 30)

  const none = creditDb([], { customer_id: null, so_id: null, collected_amount: 250, status: "partially_paid" })
  const key = apKey()
  const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 80, idempotencyKey: key, allowOverpayment: true })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "OVERPAYMENT_NO_CUSTOMER")
  assert.equal(ar5(none).collected_amount, 250)
  for (const t of ["customer_payments", "balance_entries", "customer_credits"]) assert.equal(none.tables[t].length, 0, t)
  assert.equal(logStatus(none, key), "failed")
  // a payment within the balance still works on such an invoice
  assert.equal((await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 50, idempotencyKey: apKey() })).status, 200)
})

test("P2 I3. a credit payment row written despite an error (timeout after commit) is parked, never undone", async () => {
  const db = creditDb([custCredit(1, 80)])
  const from = db.from.bind(db)
  ;(db as any).from = (name: string) => {
    const q: any = from(name)
    if (name === "customer_payments") {
      const run = q.run.bind(q)
      q.run = async () => {
        const out = await run()
        return q.op === "insert" ? { data: null, error: { message: "timeout", code: "57014" } } : out
      }
    }
    return q
  }
  const key = apKey()
  const r = await applyCredit([{ creditId: 1, amount: 50 }], key)
  assert.equal(r.status, 500)
  assert.equal(r.body.partialFailure, true)
  assert.equal(r.body.failedStep, "customer_payments")
  assert.equal(logStatus(db, key), "partial_failure")
  // the payment row is there, so the invoice and the credit stay applied
  assert.equal(db.tables.customer_payments.length, 1)
  assert.equal(ar5(db).collected_amount, 50)
  assert.deepEqual([db.tables.customer_credits[0].status, db.tables.customer_credits[0].amount], ["used", 50])
})

test("P2 M2. the credit payment methods are refused on cash payment routes", async () => {
  for (const paymentMethod of ["customer_credit", "supplier_credit"]) {
    const db = creditDb([])
    const r = await call(arPayRoute.POST, "POST", { invoiceId: 5, amount: 50, idempotencyKey: apKey(), paymentMethod })
    assert.equal(r.status, 400, paymentMethod)
    assert.equal(ar5(db).collected_amount, 0, paymentMethod)
    assert.equal(db.tables.customer_payments.length, 0, paymentMethod)
    assert.equal(db.tables.idempotency_log.length, 0, paymentMethod)
  }
  const sdb = linkedScheduleDb()
  const s = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentMethod: "customer_credit" })
  assert.equal(s.status, 400, JSON.stringify(s.body))
  assert.equal(sdb.tables.customer_payments.length, 0)
  assert.equal(sdb.tables.accounts_receivable[0].collected_amount, 0)
  const adb = apDb()
  const a = await apPay(1, 100, { paymentMethod: "supplier_credit" })
  assert.equal(a.status, 400)
  assert.equal(ap(adb, 1).paid_amount, 0)
})
