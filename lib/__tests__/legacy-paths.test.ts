// Batch 4F tests: retired legacy endpoints answer 410 without touching the database.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as supplierPayments from "../../app/api/supplier-payments/route"
import * as productReturns from "../../app/api/product-returns/route"

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
