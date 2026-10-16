// FEAT-01: a supplier credit (raised by returned items) can be deducted when a new purchase order is created.
// The credit is reserved on the PO at creation (partial use splits the credit row; the remainder stays open),
// released when the PO is rejected or deleted, and applied to the supplier invoice (AP) on approval:
// AP amount stays the gross PO total, paid_amount = the credit, one supplier_payments row with method
// "supplier_credit", and NO balance_entries row (no cash moved).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as poRoute from "../../app/api/purchase-orders/route"
import * as creditsRoute from "../../app/api/supplier-credits/route"
import * as apPdf from "../../app/api/invoices/ap/[id]/pdf/route"

const credit = (credit_id: number, supplier_id: number, amount: number, extra: Row = {}): Row => ({
  credit_id, supplier_id, amount, credit_type: "return", invoice_id: 50, reference_id: 900 + credit_id, reference_type: "product_return",
  description: `Return credit ${credit_id}`, status: "active", created_at: "2026-10-01T10:00:00", created_by: null, used_at: null,
  used_in_po_id: null, notes: null, ...extra,
})

function mk(credits: Row[] = [], pos: Row[] = [], extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    supplier_credits: credits, purchase_orders: pos, purchase_order_items: [], accounts_payable: [], supplier_payments: [],
    balance_entries: [], goods_receipts: [], sales_order_items: [], ...extra,
  })
  let n = 0
  db.rpcHandlers.generate_po_number = () => `PO-GEN-${++n}`
  useDb(db)
  return db
}
// 10 x 100 = 1000, no VAT
const items = (unitPrice = 100, qty = 10) => [{ productId: 5, productName: "Part", quantity: qty, unitPrice, total: qty * unitPrice }]
const post = (credits: unknown, extra: Row = {}) =>
  call(poRoute.POST, "POST", { supplier_id: 1, status: "pending", payment_terms: "cash", payment_type: "cash", items: items(), credits, ...extra })
const put = (body: Row) => call(poRoute.PUT, "PUT", body)
const del = (id: number) => call(poRoute.DELETE, "DELETE", undefined, `http://test.local/api/purchase-orders?id=${id}`)

test("C1. a full credit is reserved on the new PO", async () => {
  const db = mk([credit(1, 1, 300)])
  const r = await post([{ creditId: 1, amount: 300 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const po = db.tables.purchase_orders[0]
  assert.equal(po.total, 1000, "the PO keeps its gross total")
  const c = db.tables.supplier_credits
  assert.equal(c.length, 1)
  assert.equal(c[0].status, "used")
  assert.equal(c[0].used_in_po_id, po.po_id)
  assert.ok(c[0].used_at)
  assert.equal(c[0].amount, 300)
  assert.equal(r.body.appliedCredit, 300)
})

test("C2. a partial use splits the credit: the used part is linked to the PO, the remainder stays active", async () => {
  const db = mk([credit(1, 1, 300)])
  const r = await post([{ creditId: 1, amount: 120.5 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const po = db.tables.purchase_orders[0]
  const used = db.tables.supplier_credits.find((c) => c.credit_id === 1)!
  assert.equal(used.status, "used")
  assert.equal(used.amount, 120.5)
  assert.equal(used.used_in_po_id, po.po_id)
  const rest = db.tables.supplier_credits.filter((c) => c.credit_id !== 1)
  assert.equal(rest.length, 1)
  assert.equal(rest[0].status, "active")
  assert.equal(rest[0].amount, 179.5)
  assert.equal(rest[0].supplier_id, 1)
  assert.equal(rest[0].invoice_id, 50, "the remainder keeps the source invoice")
  assert.equal(rest[0].reference_id, 901)
  assert.equal(rest[0].used_in_po_id, null)
  assert.match(String(rest[0].notes), /#1/)
  const sum = db.tables.supplier_credits.reduce((s, c) => s + Number(c.amount), 0)
  assert.equal(sum, 300, "no credit is created or lost by the split")
})

test("C3. several credits can be combined", async () => {
  const db = mk([credit(1, 1, 300), credit(2, 1, 200)])
  const r = await post([{ creditId: 1, amount: 300 }, { creditId: 2, amount: 50 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.appliedCredit, 350)
  assert.equal(db.tables.supplier_credits.filter((c) => c.status === "used").length, 2)
  assert.equal(db.tables.supplier_credits.filter((c) => c.status === "active").reduce((s, c) => s + c.amount, 0), 150)
})

test("C4. refused, nothing written: credit of another supplier", async () => {
  const db = mk([credit(1, 2, 300)])
  const r = await post([{ creditId: 1, amount: 100 }])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "CREDIT_NOT_AVAILABLE")
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal(db.tables.supplier_credits[0].status, "active")
})

test("C5. refused, nothing written: credit already used", async () => {
  const db = mk([credit(1, 1, 300, { status: "used" })])
  const r = await post([{ creditId: 1, amount: 100 }])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "CREDIT_NOT_AVAILABLE")
  assert.equal(db.tables.purchase_orders.length, 0)
})

test("C6. refused: more than the credit, zero/negative, or unknown credit", async () => {
  const db = mk([credit(1, 1, 300)])
  assert.equal((await post([{ creditId: 1, amount: 300.01 }])).body.code, "CREDIT_AMOUNT_INVALID")
  assert.equal((await post([{ creditId: 1, amount: 0 }])).status, 400)
  assert.equal((await post([{ creditId: 1, amount: -5 }])).status, 400)
  assert.equal((await post([{ creditId: 1, amount: "abc" }])).status, 400)
  assert.equal((await post([{ creditId: 1, amount: 10 }, { creditId: 1, amount: 10 }])).status, 400, "a credit listed twice")
  assert.equal((await post([{ creditId: 77, amount: 10 }])).body.code, "CREDIT_NOT_AVAILABLE")
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.deepEqual(db.tables.supplier_credits.map((c) => [c.status, c.amount]), [["active", 300]])
})

test("C7. refused: credits larger than the PO total", async () => {
  const db = mk([credit(1, 1, 5000)])
  const r = await post([{ creditId: 1, amount: 1000.01 }])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "CREDIT_EXCEEDS_TOTAL")
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal((await post([{ creditId: 1, amount: 1000 }])).status, 200, "exactly the total is allowed")
})

test("C8. two POs racing for the same credit: only one gets it", async () => {
  const db = mk([credit(1, 1, 300)])
  const [a, b] = await Promise.all([post([{ creditId: 1, amount: 300 }]), post([{ creditId: 1, amount: 300 }])])
  const ok = [a, b].filter((r) => r.status === 200)
  const refused = [a, b].filter((r) => r.status === 409)
  assert.equal(ok.length, 1, JSON.stringify([a.body, b.body]))
  assert.equal(refused.length, 1)
  assert.equal(db.tables.purchase_orders.length, 1, "the losing PO was removed")
  assert.equal(db.tables.supplier_credits.length, 1)
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, db.tables.purchase_orders[0].po_id)
})

test("C9. a failed remainder insert undoes the reservation and the PO", async () => {
  const db = mk([credit(1, 1, 300)])
  db.failOn["supplier_credits:insert"] = "boom"
  const r = await post([{ creditId: 1, amount: 100 }])
  assert.equal(r.status, 500)
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal(db.tables.purchase_order_items.length, 0)
  assert.deepEqual(db.tables.supplier_credits.map((c) => [c.status, c.amount, c.used_in_po_id]), [["active", 300, null]])
})

test("C10. a PO without credits is unchanged (no credits key or an empty list)", async () => {
  const db = mk([credit(1, 1, 300)])
  assert.equal((await post(undefined)).status, 200)
  assert.equal((await post([])).status, 200)
  assert.equal(db.tables.supplier_credits[0].status, "active")
  assert.equal((await post("nope")).status, 400)
})

async function createWithCredit(db: FakeDb, amount: number, creditId = 1) {
  const r = await post([{ creditId, amount }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return Number(r.body.id)
}

test("C11. approval applies the credit to the supplier invoice, without a cash ledger row", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  const r = await put({ id: poId, status: "approved" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const ap = db.tables.accounts_payable
  assert.equal(ap.length, 1)
  assert.equal(ap[0].amount, 1000, "gross")
  assert.equal(ap[0].paid_amount, 300)
  assert.equal(ap[0].status, "partially_paid")
  const pays = db.tables.supplier_payments
  assert.equal(pays.length, 1)
  assert.equal(pays[0].amount, 300)
  assert.equal(pays[0].payment_method, "supplier_credit")
  assert.equal(pays[0].invoice_id, ap[0].invoice_id)
  assert.equal(pays[0].supplier_id, 1)
  assert.equal(db.tables.balance_entries.length, 0, "a credit offset is not a cash movement")
})

test("C12. a credit covering the whole PO marks the invoice paid", async () => {
  const db = mk([credit(1, 1, 1000)])
  const poId = await createWithCredit(db, 1000)
  assert.equal((await put({ id: poId, status: "approved" })).status, 200)
  assert.equal(db.tables.accounts_payable[0].status, "paid")
  assert.equal(db.tables.accounts_payable[0].paid_amount, 1000)
})

test("C13. approval without credits is unchanged (pending, paid 0, no payment row)", async () => {
  const db = mk([credit(1, 1, 300)])
  const r = await post(undefined)
  assert.equal((await put({ id: Number(r.body.id), status: "approved" })).status, 200)
  assert.equal(db.tables.accounts_payable[0].paid_amount, 0)
  assert.equal(db.tables.accounts_payable[0].status, "pending")
  assert.equal(db.tables.supplier_payments.length, 0)
})

test("C14. a repeated approval does not apply the credit twice", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  assert.equal((await put({ id: poId, status: "approved" })).status, 200)
  db.tables.purchase_orders[0].approved_at = "2026-01-01T00:00:00Z" // outside the in-flight window
  assert.equal((await put({ id: poId, status: "approved" })).status, 200)
  assert.equal(db.tables.accounts_payable.length, 1)
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("C15. if the credit payment row fails, the invoice is removed and the approval is reverted", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  db.failOn["supplier_payments:insert"] = "boom"
  const r = await put({ id: poId, status: "approved" })
  assert.equal(r.status, 500)
  assert.equal(r.body.poApproved, false)
  assert.equal(db.tables.accounts_payable.length, 0)
  assert.equal(db.tables.purchase_orders[0].status, "pending")
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, poId, "the credit stays reserved for the retry")
})

test("C16. rejecting the PO releases its credits", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 120)
  const r = await put({ id: poId, status: "rejected", rejection_reason: "x" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  for (const c of db.tables.supplier_credits) {
    assert.equal(c.status, "active")
    assert.equal(c.used_in_po_id, null)
    assert.equal(c.used_at, null)
  }
  assert.equal(db.tables.supplier_credits.reduce((s, c) => s + c.amount, 0), 300)
})

test("C17. deleting the PO releases its credits", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  assert.equal((await del(poId)).status, 200)
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal(db.tables.supplier_credits[0].status, "active")
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, null)
})

test("C18. an item edit may not bring the total below the reserved credit", async () => {
  const db = mk([credit(1, 1, 900)])
  const poId = await createWithCredit(db, 900)
  const bad = await put({ id: poId, items: items(50) }) // 500 < 900
  assert.equal(bad.status, 409)
  assert.equal(bad.body.code, "CREDIT_EXCEEDS_TOTAL")
  assert.equal(db.tables.purchase_orders[0].total, 1000)
  assert.equal(db.tables.purchase_order_items[0].unit_price, 100)
  assert.equal((await put({ id: poId, items: items(95) })).status, 200) // 950 >= 900
})

test("C19. credits marked credited manually (no PO) are never counted on a PO", async () => {
  const db = mk([credit(1, 1, 300), credit(2, 1, 400, { status: "used", used_at: "2026-10-02T00:00:00" })])
  const poId = await createWithCredit(db, 300)
  assert.equal((await put({ id: poId, status: "approved" })).status, 200)
  assert.equal(db.tables.accounts_payable[0].paid_amount, 300)
})

test("C20. GET supplier credits: default lists only active; ?include=used adds the used ones with their PO number", async () => {
  const db = mk([credit(1, 1, 300), credit(2, 1, 100)])
  const poId = await createWithCredit(db, 300)
  const def = await call(creditsRoute.GET, "GET", undefined, "http://test.local/api/supplier-credits")
  assert.deepEqual(def.body.map((c: any) => c.credit_id), [2])
  const all = await call(creditsRoute.GET, "GET", undefined, "http://test.local/api/supplier-credits?include=used")
  const used = all.body.find((c: any) => c.credit_id === 1)
  assert.ok(used)
  assert.equal(used.status, "used")
  assert.equal(used.used_in_po_id, poId)
  assert.equal(used.used_in_po_number, db.tables.purchase_orders[0].po_number)
  assert.equal(all.body.length, 2)
})

test("C21. the supplier invoice print shows the credit deduction and the net amount", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  assert.equal((await put({ id: poId, status: "approved" })).status, 200)
  const invoiceId = db.tables.accounts_payable[0].invoice_id
  const res = await apPdf.GET(new Request(`http://test.local/api/invoices/ap/${invoiceId}/pdf`) as any, { params: Promise.resolve({ id: String(invoiceId) }) })
  const html = await res.text()
  assert.equal(res.status, 200)
  assert.match(html, /خصم رصيد المورد[\s\S]*?300\.00/)
  assert.match(html, /الصافي المستحق[\s\S]*?700\.00/)
  assert.match(html, /المتبقي[\s\S]*?700\.00/)
})

test("C22. the supplier invoice print without credit has no credit line", async () => {
  const db = mk([])
  const r = await post(undefined)
  assert.equal((await put({ id: Number(r.body.id), status: "approved" })).status, 200)
  const invoiceId = db.tables.accounts_payable[0].invoice_id
  const res = await apPdf.GET(new Request(`http://test.local/x`) as any, { params: Promise.resolve({ id: String(invoiceId) }) })
  const html = await res.text()
  assert.doesNotMatch(html, /خصم رصيد المورد/)
})

test("C23. credits are refused on a non-EGP purchase order (credits are in EGP), nothing written", async () => {
  const db = mk([credit(1, 1, 300)])
  const r = await post([{ creditId: 1, amount: 300 }], { currency: "USD" })
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.code, "CREDIT_CURRENCY")
  assert.equal(db.tables.purchase_orders.length, 0)
  assert.equal(db.tables.supplier_credits[0].status, "active")
  assert.equal((await post([], { currency: "USD" })).status, 200, "a non-EGP PO without credits is still allowed")
})

test("C24. rejecting a PO that already has a supplier invoice does not release its credits", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  db.tables.purchase_orders[0].status = "pending"
  db.tables.accounts_payable.push({ invoice_id: 77, po_id: poId, supplier_id: 1, amount: 1000, paid_amount: 300, status: "partially_paid" })
  const r = await put({ id: poId, status: "rejected", rejection_reason: "x" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.supplier_credits[0].status, "used", "the credit stays applied to the invoice")
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, poId)
  assert.equal(r.body.creditsReleased, false)
})

test("C25. an approval that wins while the PO is being deleted keeps its credits applied", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  // Simulate the approval landing between the delete's dependency check and its credit release.
  const realFrom = db.from.bind(db)
  let injected = false
  ;(db as any).from = (t: string) => {
    if (t === "supplier_credits" && !injected) {
      injected = true
      db.tables.accounts_payable.push({ invoice_id: 78, po_id: poId, supplier_id: 1, amount: 1000, paid_amount: 300, status: "partially_paid" })
      db.tables.supplier_payments.push({ payment_id: 5, invoice_id: 78, supplier_id: 1, amount: 300, payment_method: "supplier_credit" })
    }
    return realFrom(t)
  }
  const r = await del(poId)
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders.length, 1, "the PO is kept")
  assert.equal(db.tables.supplier_credits[0].status, "used", "the credit stays applied to the invoice")
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, poId)
})

test("C26 remainder note round-trips so the supplier card can show it in Arabic", async () => {
  const { remainderNote, parseRemainderNote } = await import("../supplier-credit-note")
  const note = remainderNote(12, 500, "PO-2026-0101")
  assert.equal(note, "Remainder of credit #12 after 500.00 was applied to PO-2026-0101")
  assert.deepEqual(parseRemainderNote(note), { creditId: "12", amount: "500.00", poNumber: "PO-2026-0101" })
  assert.equal(parseRemainderNote("Returned 2 pumps"), null)
  assert.equal(parseRemainderNote(null), null)
})

test("C27. rejecting a PO joins a split credit back into one row", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 120)
  assert.equal(db.tables.supplier_credits.length, 2)
  assert.equal((await put({ id: poId, status: "rejected", rejection_reason: "x" })).status, 200)
  assert.equal(db.tables.supplier_credits.length, 1, "the remainder row is folded back")
  const c = db.tables.supplier_credits[0]
  assert.equal(c.credit_id, 1)
  assert.equal(c.amount, 300)
  assert.equal(c.status, "active")
  assert.equal(c.used_in_po_id, null)
})

test("C28. deleting a PO joins a split credit back into one row", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 50)
  assert.equal((await del(poId)).status, 200)
  assert.deepEqual(db.tables.supplier_credits.map((c) => [c.credit_id, c.amount, c.status]), [[1, 300, "active"]])
})

test("C29. no join when the remainder was already used on another PO", async () => {
  const db = mk([credit(1, 1, 300)])
  const poA = await createWithCredit(db, 100)
  const remainderId = db.tables.supplier_credits.find((c) => c.credit_id !== 1)!.credit_id
  const poB = await createWithCredit(db, 200, remainderId)
  assert.notEqual(poA, poB)
  assert.equal((await put({ id: poA, status: "rejected", rejection_reason: "x" })).status, 200)
  const byId = new Map(db.tables.supplier_credits.map((c) => [c.credit_id, c]))
  assert.equal(byId.get(1)!.amount, 100)
  assert.equal(byId.get(1)!.status, "active")
  assert.equal(byId.get(remainderId)!.status, "used")
  assert.equal(byId.get(remainderId)!.used_in_po_id, poB)
  assert.equal(db.tables.supplier_credits.reduce((s, c) => s + c.amount, 0), 300)
})

test("C30. ?include=used tells a credit reserved on a pending PO apart from one applied on approval", async () => {
  const db = mk([credit(1, 1, 300), credit(2, 1, 100)])
  const poA = await createWithCredit(db, 300, 1)
  await createWithCredit(db, 100, 2)
  assert.equal((await put({ id: poA, status: "approved" })).status, 200)
  const all = await call(creditsRoute.GET, "GET", undefined, "http://test.local/api/supplier-credits?include=used")
  const byId = new Map(all.body.map((c: any) => [c.credit_id, c]))
  assert.equal((byId.get(1) as any).used_in_po_status, "approved")
  assert.equal((byId.get(2) as any).used_in_po_status, "pending")
})

test("C31. an approval during the delete that did NOT apply the credits leaves them free (not lost)", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 300)
  const realFrom = db.from.bind(db)
  let calls = 0
  ;(db as any).from = (t: string) => {
    // The approval reads the credits after the delete released them: AP at gross, no credit payment.
    if (t === "accounts_payable" && ++calls === 2) {
      db.tables.accounts_payable.push({ invoice_id: 79, po_id: poId, supplier_id: 1, amount: 1000, paid_amount: 0, status: "pending" })
    }
    return realFrom(t)
  }
  const r = await del(poId)
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(db.tables.supplier_credits[0].status, "active", "the credit was not applied anywhere, so it stays open")
  assert.equal(db.tables.supplier_credits[0].used_in_po_id, null)
})

test("C32. a failed PO delete puts the released credits back on the PO", async () => {
  const db = mk([credit(1, 1, 300)])
  const poId = await createWithCredit(db, 120)
  db.failOn["purchase_orders:delete"] = "boom"
  const r = await del(poId)
  assert.equal(r.status, 500)
  assert.equal(db.tables.purchase_orders.length, 1)
  const used = db.tables.supplier_credits.find((c) => c.credit_id === 1)!
  assert.equal(used.status, "used")
  assert.equal(used.used_in_po_id, poId)
  assert.equal(used.amount, 120)
  assert.equal(db.tables.supplier_credits.reduce((s, c) => s + c.amount, 0), 300)
})

test("C33. ?include=used: open credits are listed in full, used ones only when they went to a PO", async () => {
  const db = mk([credit(1, 1, 300), credit(2, 1, 50, { status: "used", used_in_po_id: null }), credit(3, 1, 70)])
  await createWithCredit(db, 70, 3)
  const all = await call(creditsRoute.GET, "GET", undefined, "http://test.local/api/supplier-credits?include=used")
  assert.equal(all.status, 200)
  assert.deepEqual(all.body.map((c: any) => c.credit_id).sort(), [1, 3])
  assert.equal(all.body.filter((c: any) => c.status === "active").reduce((s: number, c: any) => s + c.amount, 0), 300)
})
