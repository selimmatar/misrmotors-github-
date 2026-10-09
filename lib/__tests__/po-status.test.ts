// Batch 4C tests: PUT /api/purchase-orders status workflow (the REAL route handler; only the database is the FakeDb).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as poRoute from "../../app/api/purchase-orders/route"

const po = (po_id: number, status: string, extra: Row = {}): Row => ({
  po_id,
  po_number: `PO-T-${po_id}`,
  supplier_id: 1,
  status,
  total: 500,
  payment_type: "cash",
  schedule_entries: '[{"d":1}]',
  approved_at: null,
  rejection_reason: null,
  ...extra,
})

function mk(rows: Row[], extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({ purchase_orders: rows, purchase_order_items: [], accounts_payable: [], ...extra })
  useDb(db)
  return db
}
const put = (body: Row) => call(poRoute.PUT, "PUT", body)
const get = (db: FakeDb, id: number) => db.tables.purchase_orders.find((r) => r.po_id === id)!

test("T1. pending -> approved: PO approved, approved_at set, one AP", async () => {
  const db = mk([po(1, "pending")])
  const r = await put({ id: "1", status: "approved" }) // the UI sends the id as a string
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(get(db, 1).status, "approved")
  assert.ok(get(db, 1).approved_at)
  assert.equal(db.tables.accounts_payable.length, 1)
  assert.equal(db.tables.accounts_payable[0].po_id, 1)
})

test("T2. re-approving an approved PO is a no-op: no second AP, approved_at kept", async () => {
  const db = mk([po(1, "pending")])
  await put({ id: 1, status: "approved" })
  const at = get(db, 1).approved_at
  const r = await put({ id: 1, status: "approved" })
  assert.equal(r.status, 200)
  assert.equal(db.tables.accounts_payable.length, 1)
  assert.equal(get(db, 1).approved_at, at)
})

test("T3. re-approving an approved PO that has no AP (older failure) repairs the AP", async () => {
  const db = mk([po(1, "approved")])
  const r = await put({ id: 1, status: "approved" })
  assert.equal(r.status, 200)
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("T4. forbidden transitions are rejected with 409 and change nothing", async () => {
  const cases: [string, string][] = [
    ["approved", "draft"],
    ["approved", "pending"],
    ["approved", "rejected"],
    ["received", "draft"],
    ["received", "approved"],
    ["partially_received", "approved"],
    ["rejected", "approved"],
    ["rejected", "pending"],
    ["pending", "received"],
    ["pending", "partially_received"],
    ["pending", "received_with_issues"],
    ["draft", "approved"],
    ["pending", "bogus"],
  ]
  for (const [from, to] of cases) {
    const db = mk([po(1, from)])
    const before = JSON.stringify(db.tables.purchase_orders)
    const r = await put({ id: 1, status: to })
    assert.equal(r.status, 409, `${from}->${to}: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.code, "INVALID_PO_TRANSITION", `${from}->${to}`)
    assert.equal(JSON.stringify(db.tables.purchase_orders), before, `${from}->${to}`)
    assert.equal(db.tables.accounts_payable.length, 0, `${from}->${to}`)
  }
})

test("T5. allowed transitions: draft->pending and pending->rejected (reason saved, no AP)", async () => {
  const db = mk([po(1, "draft"), po(2, "pending")])
  assert.equal((await put({ id: 1, status: "pending" })).status, 200)
  assert.equal(get(db, 1).status, "pending")
  const r = await put({ id: 2, status: "rejected", rejectionReason: "price too high" })
  assert.equal(r.status, 200)
  assert.equal(get(db, 2).status, "rejected")
  assert.equal(get(db, 2).rejection_reason, "price too high")
  assert.equal(db.tables.accounts_payable.length, 0)
})

test("T6. AP creation failure reverts the approval, answers truthfully, and a retry then succeeds", async () => {
  const db = mk([po(1, "pending")])
  db.failOn["accounts_payable:insert"] = "boom"
  const r = await put({ id: 1, status: "approved" })
  assert.equal(r.status, 500)
  assert.equal(r.body.poApproved, false)
  assert.equal(r.body.apInvoiceCreated, false)
  assert.equal(get(db, 1).status, "pending")
  assert.equal(get(db, 1).approved_at, null)
  delete db.failOn["accounts_payable:insert"]
  const retry = await put({ id: 1, status: "approved" })
  assert.equal(retry.status, 200)
  assert.equal(get(db, 1).status, "approved")
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("T7. AP lookup failure also reverts (no approved PO without an AP row)", async () => {
  const db = mk([po(1, "pending")])
  db.failOn["accounts_payable:select"] = "boom"
  const r = await put({ id: 1, status: "approved" })
  assert.equal(r.status, 500)
  assert.equal(get(db, 1).status, "pending")
  assert.equal(db.tables.accounts_payable.length, 0)
})

test("T8. an existing AP row is reused, never duplicated", async () => {
  const db = mk([po(1, "pending")], { accounts_payable: [{ invoice_id: 9, po_id: 1, amount: 500, paid_amount: 0, status: "pending" }] })
  assert.equal((await put({ id: 1, status: "approved" })).status, 200)
  assert.equal(db.tables.accounts_payable.length, 1)
  assert.equal(db.tables.accounts_payable[0].invoice_id, 9)
})

test("T9. concurrent approvals: exactly one wins, one AP", async () => {
  for (let round = 0; round < 30; round++) {
    const db = mk([po(1, "pending")])
    const rs = await Promise.all([put({ id: 1, status: "approved" }), put({ id: 1, status: "approved" })])
    // the loser either hits the compare-and-swap (409) or sees the PO already approved (idempotent 200)
    assert.ok(rs.every((r) => r.status === 200 || r.status === 409), JSON.stringify(rs.map((r) => r.status)))
    assert.ok(rs.some((r) => r.status === 200))
    assert.equal(db.tables.accounts_payable.length, 1)
  }
})

test("T10. concurrent approve vs reject: one winner, consistent end state", async () => {
  for (let round = 0; round < 30; round++) {
    const db = mk([po(1, "pending")])
    const rs = await Promise.all([put({ id: 1, status: "approved" }), put({ id: 1, status: "rejected", rejectionReason: "x" })])
    assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.status)))
    const st = get(db, 1).status
    assert.ok(st === "approved" || st === "rejected")
    assert.equal(db.tables.accounts_payable.length, st === "approved" ? 1 : 0)
  }
})

test("T11. schedule_entries is untouched unless the caller sends it", async () => {
  const db = mk([po(1, "pending"), po(2, "pending")])
  await put({ id: 1, status: "approved", total: 500, payment_type: "cash" })
  assert.equal(get(db, 1).schedule_entries, '[{"d":1}]')
  await put({ id: 2, status: "pending", schedule_entries: [{ d: 2 }] })
  assert.equal(get(db, 2).schedule_entries, '[{"d":2}]')
})

test("T12. items cannot be replaced on an approved or received PO; they can on a pending PO", async () => {
  const items = [{ product_id: 1, quantity: 2, unit_price: 10, total: 20 }]
  const db = mk([po(1, "approved"), po(2, "received"), po(3, "pending")], {
    purchase_order_items: [{ item_id: 1, po_id: 1, quantity: 5 }, { item_id: 2, po_id: 2, quantity: 5 }, { item_id: 3, po_id: 3, quantity: 5 }],
  })
  for (const id of [1, 2]) {
    const r = await put({ id, items })
    assert.equal(r.status, 409, String(id))
    assert.equal(r.body.code, "PO_ITEMS_LOCKED")
    assert.equal(db.tables.purchase_order_items.filter((i) => i.po_id === id).length, 1)
    assert.equal(db.tables.purchase_order_items.find((i) => i.po_id === id)!.quantity, 5)
  }
  const ok = await put({ id: 3, items })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  const rows = db.tables.purchase_order_items.filter((i) => i.po_id === 3)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].quantity, 2)
})

test("T13. unknown PO and invalid id", async () => {
  mk([po(1, "pending")])
  assert.equal((await put({ id: 99, status: "approved" })).status, 404)
  assert.equal((await put({ id: "abc", status: "approved" })).status, 400)
  assert.equal((await put({ status: "approved" })).status, 400)
})

test("T14. other POs, AP rows and GRNs are never touched by an approval", async () => {
  const db = mk([po(1, "pending"), po(2, "received")], {
    accounts_payable: [{ invoice_id: 5, po_id: 2, amount: 100, paid_amount: 100, status: "paid" }],
  })
  const others = JSON.stringify([db.tables.purchase_orders[1], db.tables.accounts_payable[0]])
  assert.equal((await put({ id: 1, status: "approved" })).status, 200)
  assert.equal(JSON.stringify([db.tables.purchase_orders[1], db.tables.accounts_payable[0]]), others)
})

test("T16. a PO with duplicate AP rows (historical) can still be approved/re-approved without error or a new AP", async () => {
  const db = mk([po(1, "pending")], {
    accounts_payable: [
      { invoice_id: 5, po_id: 1, amount: 500, paid_amount: 0, status: "pending" },
      { invoice_id: 6, po_id: 1, amount: 500, paid_amount: 0, status: "pending" },
    ],
  })
  assert.equal((await put({ id: 1, status: "approved" })).status, 200)
  assert.equal((await put({ id: 1, status: "approved" })).status, 200)
  assert.equal(db.tables.accounts_payable.length, 2)
})

test("T17. a request with nothing to write (items only) on a pending PO replaces the items and is not a conflict", async () => {
  const db = mk([po(1, "pending")], { purchase_order_items: [{ item_id: 1, po_id: 1, quantity: 5 }] })
  const r = await put({ id: 1, items: [{ product_id: 1, quantity: 3, unit_price: 1, total: 3 }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_order_items.length, 1)
  assert.equal(db.tables.purchase_order_items[0].quantity, 3)
  assert.equal(get(db, 1).status, "pending")
})

test("T18. if the revert after an AP failure also fails, the response says the PO is approved without an AP", async () => {
  const db = mk([po(1, "pending")])
  db.failOn["accounts_payable:insert"] = "boom"
  db.failOn["purchase_orders:update"] = "boom2"
  db.failAfter["purchase_orders:update"] = 1 // the approval write succeeds, the revert fails
  const r = await put({ id: 1, status: "approved" })
  assert.equal(r.status, 500)
  assert.equal(r.body.poApproved, true)
  assert.equal(r.body.apInvoiceCreated, false)
  assert.equal(get(db, 1).status, "approved")
})
