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
import * as rescheduleRoute from "../../app/api/reschedule-requests/route"
import * as scheduleRoute from "../../app/api/payment-schedules/route"

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

const rescheduleDb = (request: Row = {}, invoice: Row = {}) => {
  const db = new FakeDb({
    reschedule_requests: [{
      id: 1, invoice_id: 5, status: "pending", current_amount: 300, requested_amount: 300, requested_months: 6,
      current_due_date: "2026-09-01", requested_due_date: "2026-12-01", ...request,
    }],
    accounts_receivable: [arRow({ due_date: "2026-09-01", installment_months: 3, status: "overdue", collected_amount: 100, ...invoice })],
  })
  useDb(db)
  return db
}
const review = (status: string, extra: Row = {}) => call(rescheduleRoute.PUT, "PUT", { id: 1, status, reviewedBy: "CEO", ...extra })

test("2. reschedule approval applies the terms once and recomputes the invoice status", async () => {
  const db = rescheduleDb({ requested_amount: 250 })
  const r = await review("approved")
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const inv = db.tables.accounts_receivable[0]
  assert.equal(inv.amount, 250)
  assert.equal(inv.installment_months, 6)
  assert.equal(inv.due_date, "2026-12-01")
  assert.equal(inv.status, "partially_paid", "recomputed from the new amount (lib/ar-status)")
  assert.equal(db.tables.reschedule_requests[0].status, "approved")
  // a second review (approve or reject) of the same request is refused
  assert.equal((await review("approved")).status, 409)
  assert.equal((await review("rejected", { rejectionReason: "late" })).status, 409)
  assert.equal(db.tables.reschedule_requests[0].status, "approved")
})

test("2. reschedule approval never sets the amount below what was collected", async () => {
  const db = rescheduleDb({ requested_amount: 80 })
  const r = await review("approved")
  assert.equal(r.status, 409)
  assert.match(r.body.error, /already paid/)
  assert.equal(db.tables.accounts_receivable[0].amount, 300)
  assert.equal(db.tables.reschedule_requests[0].status, "pending")
})

test("2. reschedule: an invoice update failure is a failure and the request goes back to pending", async () => {
  const db = rescheduleDb()
  db.failOn["accounts_receivable:update"] = "ar down"
  const r = await review("approved")
  assert.equal(r.status, 500)
  assert.equal(db.tables.reschedule_requests[0].status, "pending")
  delete db.failOn["accounts_receivable:update"]
  assert.equal((await review("approved")).status, 200)
  assert.equal(db.tables.accounts_receivable[0].installment_months, 6)
})

test("2. reschedule: approve and reject at the same time end with exactly one review", async () => {
  for (let round = 0; round < 15; round++) {
    const db = rescheduleDb()
    const rs = await Promise.all([review("approved"), review("rejected", { rejectionReason: "no" })])
    assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.body)))
    const final = db.tables.reschedule_requests[0].status
    assert.equal(db.tables.accounts_receivable[0].installment_months, final === "approved" ? 6 : 3, `round ${round}`)
  }
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
