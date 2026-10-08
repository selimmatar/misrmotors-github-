// Batch 4B tests: POST /api/accounts-payable/payments, PUT/POST /api/accounts-payable and PO approval (the REAL route
// handlers + lib/ap-payments.ts; only the database client is replaced by the in-memory FakeDb).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as payRoute from "../../app/api/accounts-payable/payments/route"
import * as apRoute from "../../app/api/accounts-payable/route"
import * as poRoute from "../../app/api/purchase-orders/route"

const inv = (invoice_id: number, extra: Row = {}): Row => ({
  invoice_id,
  invoice_number: `APINV-T-${invoice_id}`,
  po_id: 10 + invoice_id,
  supplier_id: 1,
  amount: 1000,
  paid_amount: 0,
  months_paid: 0,
  status: "pending",
  ...extra,
})

function baseDb(extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    accounts_payable: [
      inv(1), // clean pending
      inv(2, { status: "paid", paid_amount: 0 }), // historical bad row: paid with paid_amount 0
      inv(3, { paid_amount: null, status: "pending" }), // NULL paid_amount
      inv(4, { status: "paid", paid_amount: 1000 }), // properly paid
    ],
    supplier_payments: [],
    balance_entries: [],
    idempotency_log: [],
    purchase_orders: [],
    ...extra,
  })
  useDb(db)
  return db
}

let k = 0
const newKey = () => `ap-test-key-${++k}-${Math.random().toString(36).slice(2, 8)}`
const pay = (invoiceId: number, amount: unknown, extra: Row = {}) =>
  call(payRoute.POST, "POST", {
    invoiceId,
    amount,
    paymentMethod: "bank_transfer",
    receiptUrl: "https://blob.test/receipt.pdf",
    idempotencyKey: newKey(),
    ...extra,
  })
const row = (db: FakeDb, id: number) => db.tables.accounts_payable.find((r) => r.invoice_id === id)!

test("P1. partial payment: invoice partially_paid, one payment row, one ledger row", async () => {
  const db = baseDb()
  const r = await pay(1, 400)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(row(db, 1).paid_amount, 400)
  assert.equal(row(db, 1).status, "partially_paid")
  assert.equal(row(db, 1).months_paid, 1)
  assert.equal(row(db, 1).payment_receipt_url, "https://blob.test/receipt.pdf")
  assert.equal(db.tables.supplier_payments.length, 1)
  assert.equal(db.tables.supplier_payments[0].amount, 400)
  assert.equal(db.tables.supplier_payments[0].payment_method, "bank_transfer")
  assert.equal(db.tables.supplier_payments[0].receipt_url, "https://blob.test/receipt.pdf")
  assert.equal(db.tables.balance_entries.length, 1)
  assert.equal(db.tables.balance_entries[0].amount, -400)
  assert.equal(db.tables.balance_entries[0].entry_type, "ap_payment")
  assert.equal(db.tables.balance_entries[0].reference_id, 11)
})

test("P2. exact payment closes the invoice; a second payment is refused", async () => {
  const db = baseDb()
  assert.equal((await pay(1, 400)).status, 200)
  const r = await pay(1, 600, { paymentMethod: "cash" })
  assert.equal(r.status, 200)
  assert.equal(row(db, 1).paid_amount, 1000)
  assert.equal(row(db, 1).status, "paid")
  const again = await pay(1, 1)
  assert.equal(again.status, 409)
  assert.equal(row(db, 1).paid_amount, 1000)
  assert.equal(db.tables.supplier_payments.length, 2)
})

test("P3. overpayment is refused without allowOverpayment and accepted with it", async () => {
  const db = baseDb()
  const r = await pay(1, 1500)
  assert.equal(r.status, 409)
  assert.equal(row(db, 1).paid_amount, 0)
  assert.equal(db.tables.supplier_payments.length, 0)
  const ok = await pay(1, 1500, { allowOverpayment: true, paymentMethod: "cheque" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(row(db, 1).paid_amount, 1500)
  assert.equal(row(db, 1).status, "paid")
})

test("P4. zero, negative and non-numeric amounts are rejected", async () => {
  const db = baseDb()
  for (const bad of [0, -5, "abc", "", null, undefined, NaN, "1e3", {}]) {
    const r = await pay(1, bad)
    assert.equal(r.status, 400, `amount ${String(bad)}`)
  }
  assert.equal(row(db, 1).paid_amount, 0)
  assert.equal(db.tables.supplier_payments.length, 0)
})

test("P5. invalid or missing method, missing receipt, bad key, bad invoice id are rejected", async () => {
  const db = baseDb()
  assert.equal((await pay(1, 10, { paymentMethod: "credit_card" })).status, 400)
  assert.equal((await pay(1, 10, { paymentMethod: undefined })).status, 400)
  assert.equal((await pay(1, 10, { receiptUrl: undefined })).status, 400)
  assert.equal((await pay(1, 10, { receiptUrl: "   " })).status, 400)
  assert.equal((await pay(1, 10, { idempotencyKey: undefined })).status, 400)
  assert.equal((await pay(1, 10, { idempotencyKey: "short" })).status, 400)
  assert.equal((await pay(1, 10, { idempotencyKey: "has spaces in it!!" })).status, 400)
  assert.equal((await pay(0, 10)).status, 400)
  assert.equal((await pay(999, 10)).status, 404)
  assert.equal(row(db, 1).paid_amount, 0)
  assert.equal(db.tables.supplier_payments.length, 0)
})

test("P6. replay with the same key returns the stored result and records nothing twice", async () => {
  const db = baseDb()
  const key = newKey()
  const a = await pay(1, 300, { idempotencyKey: key })
  const b = await pay(1, 300, { idempotencyKey: key })
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(b.body.isDuplicate, true)
  assert.equal(row(db, 1).paid_amount, 300)
  assert.equal(db.tables.supplier_payments.length, 1)
  assert.equal(db.tables.balance_entries.length, 1)
})

test("P7. concurrent payments with different keys cannot overspend the balance", async () => {
  for (let round = 0; round < 30; round++) {
    const db = baseDb()
    const results = await Promise.all([pay(1, 700), pay(1, 700), pay(1, 700)])
    const ok = results.filter((r) => r.status === 200).length
    assert.equal(ok, 1, JSON.stringify(results.map((r) => r.status)))
    assert.equal(row(db, 1).paid_amount, 700)
    assert.equal(db.tables.supplier_payments.length, 1)
    assert.equal(db.tables.balance_entries.length, 1)
  }
})

test("P8. concurrent payments that both fit are both applied exactly once", async () => {
  for (let round = 0; round < 30; round++) {
    const db = baseDb()
    const results = await Promise.all([pay(1, 100), pay(1, 200)])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200].sort(), JSON.stringify(results))
    assert.equal(row(db, 1).paid_amount, 300)
    assert.equal(db.tables.supplier_payments.length, 2)
  }
})

test("P9. supplier_payments insert failure: 500 partialFailure, retry with the same key gets 409, nothing repeated", async () => {
  const db = baseDb()
  db.failOn["supplier_payments:insert"] = "boom"
  const key = newKey()
  const a = await pay(1, 250, { idempotencyKey: key })
  assert.equal(a.status, 500)
  assert.equal(a.body.partialFailure, true)
  assert.equal(row(db, 1).paid_amount, 250)
  delete db.failOn["supplier_payments:insert"]
  const b = await pay(1, 250, { idempotencyKey: key })
  assert.equal(b.status, 409)
  assert.equal(b.body.partialFailure, true)
  assert.equal(row(db, 1).paid_amount, 250)
  assert.equal(db.tables.supplier_payments.length, 0)
  assert.equal(db.tables.idempotency_log[0].status, "partial_failure")
})

test("P10. balance_entries insert failure: 500 partialFailure, retry gets 409", async () => {
  const db = baseDb()
  db.failOn["balance_entries:insert"] = "boom"
  const key = newKey()
  const a = await pay(1, 250, { idempotencyKey: key })
  assert.equal(a.status, 500)
  assert.equal(a.body.partialFailure, true)
  assert.equal(db.tables.supplier_payments.length, 1)
  delete db.failOn["balance_entries:insert"]
  const b = await pay(1, 250, { idempotencyKey: key })
  assert.equal(b.status, 409)
  assert.equal(row(db, 1).paid_amount, 250)
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("P11. invoice update failure leaves everything untouched and the key retryable", async () => {
  const db = baseDb()
  db.failOn["accounts_payable:update"] = "boom"
  const key = newKey()
  const a = await pay(1, 250, { idempotencyKey: key })
  assert.equal(a.status, 500)
  assert.notEqual(a.body.partialFailure, true)
  assert.equal(row(db, 1).paid_amount, 0)
  delete db.failOn["accounts_payable:update"]
  const b = await pay(1, 250, { idempotencyKey: key })
  assert.equal(b.status, 200, JSON.stringify(b.body))
  assert.equal(row(db, 1).paid_amount, 250)
})

test("P12. historical paid rows and NULL paid_amount are refused and left unmodified", async () => {
  const db = baseDb()
  const before = JSON.stringify(db.tables.accounts_payable)
  assert.equal((await pay(2, 100)).status, 409) // paid with paid_amount 0
  assert.equal((await pay(3, 100)).status, 409) // NULL paid_amount
  assert.equal((await pay(4, 100)).status, 409) // properly paid
  assert.equal(JSON.stringify(db.tables.accounts_payable), before)
  assert.equal(db.tables.supplier_payments.length, 0)
  assert.equal(db.tables.balance_entries.length, 0)
})

test("A1. PUT /api/accounts-payable rejects client payment fields", async () => {
  const db = baseDb()
  for (const field of ["paidAmount", "status", "amount", "monthsPaid", "paymentReceiptUrl", "receiptUrl"]) {
    const r = await call(apRoute.PUT, "PUT", { id: "1", [field]: field === "status" ? "paid" : 5, dueDate: "2026-12-01" })
    assert.equal(r.status, 400, field)
  }
  assert.equal(row(db, 1).paid_amount, 0)
  assert.equal(row(db, 1).status, "pending")
  assert.equal(row(db, 1).due_date, undefined)
  assert.equal(db.tables.supplier_payments.length, 0)
  assert.equal(db.tables.balance_entries.length, 0)
})

test("A2. PUT with nothing to update is a 400; a harmless field still updates", async () => {
  const db = baseDb()
  assert.equal((await call(apRoute.PUT, "PUT", { id: "1" })).status, 400)
  const ok = await call(apRoute.PUT, "PUT", { id: "1", dueDate: "2026-12-01" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(row(db, 1).due_date, "2026-12-01")
  assert.equal(db.tables.supplier_payments.length, 0)
})

test("A3. POST /api/accounts-payable ignores client paid_amount and status", async () => {
  const db = baseDb({ accounts_payable: [] })
  const r = await call(apRoute.POST, "POST", {
    invoiceNumber: "APINV-NEW-1",
    supplierId: 1,
    poId: 55,
    amount: 800,
    paidAmount: 800,
    paid_amount: 800,
    status: "paid",
    monthsPaid: 3,
    paymentType: "cash",
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const created = db.tables.accounts_payable[0]
  assert.equal(created.paid_amount, 0)
  assert.equal(created.status, "pending")
  assert.equal(created.months_paid, 0)
})

const approvalDb = (paymentType: string) =>
  baseDb({
    accounts_payable: [],
    purchase_orders: [{ po_id: 77, po_number: "PO-T-77", supplier_id: 1, status: "pending", total: 500, payment_type: paymentType }],
  })

test("O1. PO approval creates a pending AP with paid_amount 0 and no ledger rows, for every payment type", async () => {
  for (const type of ["cash", "prepaid", "bank_transfer", "installment", "cheque", "hybrid"]) {
    const db = approvalDb(type)
    const r = await call(poRoute.PUT, "PUT", { id: 77, status: "approved" })
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.body)}`)
    assert.equal(db.tables.accounts_payable.length, 1, type)
    assert.equal(db.tables.accounts_payable[0].status, "pending", type)
    assert.equal(db.tables.accounts_payable[0].paid_amount, 0, type)
    assert.equal(db.tables.supplier_payments.length, 0, type)
    assert.equal(db.tables.balance_entries.length, 0, type)
  }
})

test("O2. AP insert failure at approval is surfaced as an error, not a 200", async () => {
  const db = approvalDb("cash")
  db.failOn["accounts_payable:insert"] = "boom"
  const r = await call(poRoute.PUT, "PUT", { id: 77, status: "approved" })
  assert.equal(r.status, 500)
  assert.equal(r.body.apInvoiceCreated, false)
  assert.equal(db.tables.supplier_payments.length, 0)
})

test("H1. paying a clean invoice never touches other historical rows", async () => {
  const db = baseDb()
  const others = JSON.stringify(db.tables.accounts_payable.filter((r) => r.invoice_id !== 1))
  assert.equal((await pay(1, 100)).status, 200)
  assert.equal(JSON.stringify(db.tables.accounts_payable.filter((r) => r.invoice_id !== 1)), others)
})

test("P13. concurrent payments on an already partially paid invoice cannot overspend (CAS on paid_amount)", async () => {
  for (let round = 0; round < 30; round++) {
    const db = baseDb({ accounts_payable: [inv(1, { paid_amount: 100, status: "partially_paid", months_paid: 1 })] })
    const results = await Promise.all([pay(1, 500), pay(1, 500)])
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)))
    assert.equal(row(db, 1).paid_amount, 600)
    assert.equal(db.tables.supplier_payments.length, 1)
  }
})

const sched = (schedule_id: number, extra: Row = {}): Row => ({
  schedule_id,
  invoice_id: 1,
  po_id: 11,
  schedule_type: "payable",
  installment_number: schedule_id,
  amount: 500,
  paid_amount: 0,
  status: "pending",
  ...extra,
})
const srow = (db: FakeDb, id: number) => db.tables.payment_schedules.find((r) => r.schedule_id === id)!

test("S1. paying with a scheduleId marks that payable schedule row paid (and partial for a part payment)", async () => {
  const db = baseDb({ payment_schedules: [sched(1), sched(2)] })
  const r = await pay(1, 500, { scheduleId: 1 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.scheduleUpdated, true)
  assert.equal(srow(db, 1).status, "paid")
  assert.equal(srow(db, 1).paid_amount, 500)
  assert.equal(srow(db, 1).receipt_url, "https://blob.test/receipt.pdf")
  assert.equal(srow(db, 2).status, "pending")
  const r2 = await pay(1, 200, { scheduleId: 2 })
  assert.equal(r2.status, 200)
  assert.equal(srow(db, 2).status, "partial")
  assert.equal(srow(db, 2).paid_amount, 200)
})

test("S2. a schedule of another invoice, a non-payable schedule, or a missing one is left untouched; payment still succeeds", async () => {
  const db = baseDb({
    payment_schedules: [sched(1, { invoice_id: 99, po_id: 999 }), sched(2, { schedule_type: "AR" })],
  })
  for (const id of [1, 2, 77]) {
    const r = await pay(1, 100, { scheduleId: id })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.scheduleUpdated, false)
  }
  assert.equal(srow(db, 1).paid_amount, 0)
  assert.equal(srow(db, 2).paid_amount, 0)
  assert.equal(row(db, 1).paid_amount, 300)
})

test("S3. a schedule update failure never fails or un-does a recorded payment", async () => {
  const db = baseDb({ payment_schedules: [sched(1)] })
  db.failOn["payment_schedules:update"] = "boom"
  const r = await pay(1, 500, { scheduleId: 1 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.scheduleUpdated, false)
  assert.equal(row(db, 1).paid_amount, 500)
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("S4. an invalid scheduleId is a 400 and records nothing", async () => {
  const db = baseDb({ payment_schedules: [sched(1)] })
  const r = await pay(1, 100, { scheduleId: "abc" })
  assert.equal(r.status, 400)
  assert.equal(row(db, 1).paid_amount, 0)
  assert.equal(db.tables.supplier_payments.length, 0)
})
