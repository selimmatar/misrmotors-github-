// Tests for Batch 2's change to invoicing: valid (non-rejected) returned quantity reduces what can still be
// invoiced.   ordered - already invoiced - returned = remaining invoiceable (never below zero).
// Run together with returns.test.ts (see the command at the top of that file).
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { createDpInvoices, createSoInvoice, round2 } from "../invoicing"

const PRICE = 10000
const so = (ordered: number) => ({
  so_id: 1, so_number: "SO-T-1", customer_id: 5, total: round2(ordered * PRICE * 1.14), subtotal: ordered * PRICE, discount_amount: 0,
  payment_type: "bank_transfer", payment_terms: "prepaid", installments: 6,
})
const dp = (permit_id: number, status = "APPROVED", sales_order_id = 1) => ({ permit_id, permit_no: `DP-T-${permit_id}`, sales_order_id, status })
const dpItem = (permit_id: number, quantity: number) => ({ permit_id, product_id: 7, item_name_snapshot: "Pump", quantity, unit_price: PRICE, total: quantity * PRICE })
const ret = (return_id: number, permit: number | string, quantity: number, status = "pending_warehouse", created_at = "2026-10-01T00:00:00Z") => ({
  header: { return_id, permit_id: String(permit), status, created_at },
  item: { return_item_id: return_id, return_id, product_id: 7, product_name: "Pump", returned_quantity: quantity },
})

function setup(ordered: number, dps: [number, number][], returns: ReturnType<typeof ret>[] = [], extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [so(ordered)],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    sales_order_items: [{ so_id: 1, product_id: 7, outsourced_name: null, quantity: ordered, unit_price: PRICE, total: ordered * PRICE }],
    delivery_permits: dps.map(([id]) => dp(id)),
    delivery_permit_items: dps.map(([id, qty]) => dpItem(id, qty)),
    invoice_delivery_permits: [],
    accounts_receivable: [],
    product_returns: returns.map((r) => r.header),
    return_items: returns.map((r) => r.item),
    ...extra,
  })
}
const invoices = (db: FakeDb) => db.tables.accounts_receivable

test("21. SO 100 / DP 100 / returned 30: the DP invoice covers only the 70 kept", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 1, 30)])
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.invoices[0].amount, round2(70 * PRICE * 1.14)) // 798,000 - not 1,140,000
  assert.equal(invoices(db).length, 1)
})

test("21. the returned units are not invoiceable again until they are delivered again; never below zero", async () => {
  // ordered 100, DP1 delivered 100 (30 returned). A replacement delivery DP2 of 30 would be billable, DP3 beyond that is not.
  const db = setup(100, [[1, 100], [2, 30], [3, 5]], [ret(1, 1, 30)])
  assert.equal((await createDpInvoices(db, [1])).status, 200) // 70 kept
  const replacement = await createDpInvoices(db, [2]) // delivered 130 gross, 30 returned -> pool 100
  assert.equal(replacement.status, 200, JSON.stringify(replacement.body))
  const over = await createDpInvoices(db, [3])
  assert.equal(over.status, 409)
  assert.match(over.body.error, /only 0 of 100 ordered remain to be invoiced \(30 returned\)/)
  assert.equal(invoices(db).length, 2)
})

test("21. the spec example: ordered 100, 20 invoiced, a DP of 80 with 30 returned -> exactly 50 remain", async () => {
  const db = setup(100, [[1, 20], [2, 80]], [ret(1, 2, 30)])
  assert.equal((await createDpInvoices(db, [1])).status, 200) // 20 invoiced
  const second = await createDpInvoices(db, [2])
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.invoices[0].amount, round2(50 * PRICE * 1.14)) // 20 + 50 = 70 = 100 - 30
  assert.equal((await createDpInvoices(db, [2])).status, 400) // the same DP can never be invoiced twice
})

test("21. a fully returned DP has nothing left to invoice", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 1, 100)])
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 409)
  assert.match(res.body.error, /Nothing to invoice/)
  assert.equal(invoices(db).length, 0)
})

test("21/9. a rejected return does not reduce the invoiceable quantity", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 1, 30, "rejected")])
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200)
  assert.equal(res.body.invoices[0].amount, 1140000)
})

test("21. returns on a DP of ANOTHER order and historical RET-… returns are ignored", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 9, 5), ret(2, "RET-1790257022809", 40)])
  db.tables.sales_orders.push({ ...so(100), so_id: 2, so_number: "SO-T-2" })
  db.tables.delivery_permits.push(dp(9, "APPROVED", 2))
  db.tables.delivery_permit_items.push(dpItem(9, 10))
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.invoices[0].amount, 1140000)
})

test("21. an invoice created BEFORE a return is not changed, and the return still blocks re-billing those units", async () => {
  const db = setup(130, [[1, 100], [2, 30]])
  const first = await createDpInvoices(db, [1])
  assert.equal(first.status, 200)
  assert.equal(first.body.invoices[0].amount, 1140000) // billed in full: no return existed yet
  await db.from("product_returns").insert({ permit_id: "1", status: "pending_warehouse" }) // filed AFTER the invoice
  await db.from("return_items").insert({ return_id: db.tables.product_returns[0].return_id, product_id: 7, product_name: "Pump", returned_quantity: 30 })
  assert.equal(invoices(db)[0].amount, 1140000) // never retroactively changed
  const second = await createDpInvoices(db, [2])
  assert.equal(second.status, 409) // no credit note yet: the 30 billed-and-returned units are not billed again
  assert.match(second.body.error, /only 0 of 130/)
})

test("21. an invoice created AFTER a return is priced net, and the same return is not counted twice later", async () => {
  const db = setup(130, [[1, 100], [2, 30]], [ret(1, 1, 30)])
  const first = await createDpInvoices(db, [1])
  assert.equal(first.status, 200)
  assert.equal(first.body.invoices[0].amount, round2(70 * PRICE * 1.14))
  const second = await createDpInvoices(db, [2]) // 70 billed + 30 new = 100 = 130 - 30 returned
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.invoices[0].amount, round2(30 * PRICE * 1.14))
})

test("21. concurrent invoices: return-aware re-check lets both through when they fit and exactly one when they do not", async () => {
  for (let run = 0; run < 30; run++) {
    // ordered 100; DP1 60 + DP2 60 (20 returned -> 40 kept): 60 + 40 = 100 fits, so both invoices are valid.
    // (Batch 1B behaviour: a request that overlaps another one's insert-then-link window can be refused with a
    // transient 409 and must simply be retried - it must never produce an over-invoice.)
    const fits = setup(100, [[1, 60], [2, 60]], [ret(1, 2, 20)])
    const both = await Promise.all([createDpInvoices(fits, [1]), createDpInvoices(fits, [2])])
    assert.ok(both.every((r) => r.status === 200 || r.status === 409), `run ${run}`)
    for (const [index, result] of both.entries()) {
      if (result.status === 409) assert.equal((await createDpInvoices(fits, [index + 1])).status, 200, `run ${run}: retry of DP${index + 1}`)
    }
    assert.equal(invoices(fits).length, 2, `run ${run}`)
    assert.equal(round2(invoices(fits).reduce((sum, i) => sum + i.amount, 0)), 1140000) // 60 + 40 units, exactly
    // only 10 returned -> 60 + 50 = 110 > 100: exactly one survives
    const clash = setup(100, [[1, 60], [2, 60]], [ret(1, 2, 10)])
    const [a, b] = await Promise.all([createDpInvoices(clash, [1]), createDpInvoices(clash, [2])])
    assert.equal([a, b].filter((r) => r.status === 200).length, 1, `run ${run}: ${a.status}/${b.status}`)
    assert.equal(invoices(clash).length, 1)
  }
})

// ---------------------------------------------------------------------------------------------------------
// Whole-order (sales order) invoices are return-aware too
// ---------------------------------------------------------------------------------------------------------
test("W1. whole-order invoice does not charge for returned quantity", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 1, 30)])
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.amount, round2(70 * PRICE * 1.14)) // 798,000 instead of the 1,140,000 SO total
  assert.equal(invoices(db).length, 1)
  assert.equal(db.tables.sales_orders[0].total, 1140000) // the order itself is untouched
})

test("W2. no returns, rejected returns, other-order and historical returns: the whole-order invoice is the SO total", async () => {
  const none = setup(100, [[1, 100]])
  assert.equal((await createSoInvoice(none, 1)).body.amount, 1140000)
  const rejected = setup(100, [[1, 100]], [ret(1, 1, 30, "rejected")])
  assert.equal((await createSoInvoice(rejected, 1)).body.amount, 1140000)
  const historical = setup(100, [[1, 100]], [ret(1, "RET-1790257022809", 40), ret(2, 9, 5)])
  assert.equal((await createSoInvoice(historical, 1)).body.amount, 1140000)
  const undelivered = setup(100, []) // not even a delivery permit yet
  assert.equal((await createSoInvoice(undelivered, 1)).body.amount, 1140000)
})

test("W3. a fully returned order has nothing to invoice", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 1, 100)])
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 409)
  assert.match(res.body.error, /Nothing to invoice/)
  assert.equal(invoices(db).length, 0)
})

test("W4. an order edited down to what the customer kept is not reduced twice", async () => {
  // 100 delivered, 30 returned, the order was edited from 100 to 70 (the edit absorbed the return)
  const db = setup(70, [[1, 100]], [ret(1, 1, 30)])
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 200)
  assert.equal(res.body.amount, round2(70 * PRICE * 1.14)) // the SO total of 70 units
})

test("W5. a whole-order invoice is never changed by a later return", async () => {
  const db = setup(100, [[1, 100]])
  const res = await createSoInvoice(db, 1)
  assert.equal(res.body.amount, 1140000)
  await db.from("product_returns").insert({ permit_id: "1", status: "pending_warehouse" })
  await db.from("return_items").insert({ return_id: db.tables.product_returns[0].return_id, product_id: 7, product_name: "Pump", returned_quantity: 30 })
  assert.equal(invoices(db)[0].amount, 1140000) // existing invoices never change retroactively
  assert.equal((await createSoInvoice(db, 1)).status, 409) // and the order is still invoiced only once
})

test("W6. discount: the returned share is taken off the discounted, VAT-inclusive total", async () => {
  const db = setup(100, [[1, 100]], [ret(1, 1, 25)])
  // 10% discount on the order: total = 100 x 10,000 x 0.9 x 1.14
  Object.assign(db.tables.sales_orders[0], { discount_amount: 100000, total: 1026000 })
  const res = await createSoInvoice(db, 1)
  assert.equal(res.body.amount, round2(1026000 * 0.75))
})
