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
