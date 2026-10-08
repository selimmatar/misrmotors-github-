// Batch 4F tests: retired legacy endpoints answer 410 without touching the database, and the Accountant screen's
// supplier "Mark as paid" goes through the authoritative AP payment operation (recordApPayment) only.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as supplierPayments from "../../app/api/supplier-payments/route"
import * as productReturns from "../../app/api/product-returns/route"
import { buildMarkAsPaidRequest } from "../ap-mark-paid"
import { recordApPayment } from "../ap-payments"

const seed = () => ({
  accounts_payable: [
    { invoice_id: 1, invoice_number: "APINV-T-1", po_id: 11, supplier_id: 1, amount: 1200, paid_amount: 0, months_paid: 0, status: "pending" },
  ],
  supplier_payments: [{ payment_id: 1, invoice_id: 9, supplier_id: 1, amount: 50 }],
  balance_entries: [],
  idempotency_log: [],
  product_returns: [],
  return_items: [],
})
const writes = (db: FakeDb) =>
  Object.keys(db.calls).filter((k) => /:(insert|update|upsert|delete)$/.test(k) && db.calls[k] > 0)

test("L1. supplier-payments POST is retired: 410, nothing written", async () => {
  const db = new FakeDb(seed())
  useDb(db)
  const r = await call(supplierPayments.POST as any, "POST", { supplierInvoiceId: 1, supplierId: 1, amount: 100 })
  assert.equal(r.status, 410)
  assert.equal(r.body.code, "ENDPOINT_RETIRED")
  assert.equal(r.body.error, "Use POST /api/accounts-payable/payments")
  assert.deepEqual(writes(db), [])
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("L2. supplier-payments GET still lists payments", async () => {
  const db = new FakeDb(seed())
  useDb(db)
  const r = await call(supplierPayments.GET as any, "GET")
  assert.equal(r.status, 200)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].payment_id, 1)
})

test("L3. every product-returns handler answers 410 and uses no database", async () => {
  const db = new FakeDb(seed())
  useDb(db)
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
    const handler = (productReturns as any)[method]
    assert.equal(typeof handler, "function", method)
    const r = await call(handler, method, method === "GET" ? undefined : { soId: 1, items: [] })
    assert.equal(r.status, 410, method)
    assert.deepEqual(r.body, { code: "ENDPOINT_RETIRED", error: "Use /api/returns" })
  }
  assert.deepEqual(Object.keys(db.calls), [])
})

const invoice = { id: "1", amount: 1200, paidAmount: 0, monthsPaid: 0, status: "pending" }

test("L4. Mark as paid cannot build a request without method, receipt or key (button stays disabled)", () => {
  const noMethod = buildMarkAsPaidRequest({ invoice, installmentMonths: 6 })
  assert.equal(noMethod.ok, false)
  const noReceipt = buildMarkAsPaidRequest({ invoice, installmentMonths: 6, paymentMethod: "bank_transfer", idempotencyKey: "key-12345678" })
  assert.equal(noReceipt.ok, false)
  assert.match((noReceipt as any).reason, /receipt/i)
  const noPlan = buildMarkAsPaidRequest({ invoice, installmentMonths: 0, paymentMethod: "cash", receiptUrl: "u", idempotencyKey: "key-12345678" })
  assert.equal(noPlan.ok, false)
})

test("L5. Mark as paid amount is one instalment, capped at the remaining balance", () => {
  const base = { paymentMethod: "bank_transfer", receiptUrl: "https://blob.test/r.pdf", idempotencyKey: "key-12345678" }
  const first = buildMarkAsPaidRequest({ invoice, installmentMonths: 6, ...base })
  assert.ok(first.ok && first.amount === 200) // 1200 / 6
  const last = buildMarkAsPaidRequest({ invoice: { ...invoice, paidAmount: 1000, monthsPaid: 5 }, installmentMonths: 6, ...base })
  assert.ok(last.ok && last.amount === 200)
  const rounding = buildMarkAsPaidRequest({ invoice: { ...invoice, amount: 1000, paidAmount: 833.35, monthsPaid: 5 }, installmentMonths: 6, ...base })
  assert.ok(rounding.ok && rounding.amount === 166.65) // final instalment = exact remainder
  const capped = buildMarkAsPaidRequest({ invoice: { ...invoice, paidAmount: 1100, monthsPaid: 1 }, installmentMonths: 6, ...base })
  assert.ok(capped.ok && capped.amount === 100) // remaining 100 < instalment 200
  const paid = buildMarkAsPaidRequest({ invoice: { ...invoice, paidAmount: 1200, status: "paid" }, installmentMonths: 6, ...base })
  assert.equal(paid.ok, false)
})

test("L6. Mark as paid request is applied only by recordApPayment: invoice, supplier_payments and the ledger row come from the server", async () => {
  const db = new FakeDb(seed())
  useDb(db)
  const plan = buildMarkAsPaidRequest({
    invoice,
    installmentMonths: 6,
    paymentMethod: "bank_transfer",
    receiptUrl: "https://blob.test/r.pdf",
    idempotencyKey: "ui-key-12345678",
  })
  assert.ok(plan.ok)
  const result = await recordApPayment(db, (plan as any).body)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(db.tables.accounts_payable[0].paid_amount, 200)
  assert.equal(db.tables.accounts_payable[0].status, "partially_paid")
  assert.equal(db.tables.supplier_payments.length, 2)
  assert.equal(db.tables.balance_entries.length, 1)
  assert.equal(db.tables.balance_entries[0].amount, -200)

  // Same key replayed: no second increase.
  const again = await recordApPayment(db, (plan as any).body)
  assert.equal(again.status, 200)
  assert.equal(again.body.isDuplicate, true)
  assert.equal(db.tables.accounts_payable[0].paid_amount, 200)
  assert.equal(db.tables.balance_entries.length, 1)

  // The server's overpayment guard still applies to an over-large request.
  const over = await recordApPayment(db, { ...(plan as any).body, amount: 5000, idempotencyKey: "ui-key-87654321" })
  assert.equal(over.status, 409)
  assert.equal(db.tables.accounts_payable[0].paid_amount, 200)
})
