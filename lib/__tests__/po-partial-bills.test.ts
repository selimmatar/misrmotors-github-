// Several supplier bills per PO (owner request, 2026-11-17): "Bill received items" on an open PO, the closing bill with
// "not coming" quantities, advances / return credits taken off the FIRST bills, reopen removes only the LAST bill.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as billRoute from "../../app/api/purchase-orders/bill/route"
import * as closeRoute from "../../app/api/purchase-orders/close/route"
import * as reopenRoute from "../../app/api/purchase-orders/reopen/route"
import * as editRoute from "../../app/api/purchase-orders/edit/route"
import * as advanceRoute from "../../app/api/purchase-orders/advance/route"
import { PO_CLOSE_ROLES } from "../po-edit"
import { decide } from "../auth/decide"
import { closingBillOf, isPartialBill } from "../po-bill-number"
import * as apRoute from "../../app/api/accounts-payable/route"
import { apDueSchedule, summarizeDue } from "../due-schedule"
import { billSchedules } from "../po-bill-schedule"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

// PO-1: pumps 10 x 100 and valves 5 x 40 = 1,200 + 14% VAT = 1,368
const po = (extra: Row = {}): Row => ({
  po_id: 1, po_number: "PO-1", supplier_id: 1, status: "partially_received", total: 1368, tax_amount: 168,
  payment_type: "cash", payment_terms: "prepaid", order_date: "2026-11-01", ...extra,
})
const items = (): Row[] => [
  { po_item_id: 7, po_id: 1, product_id: 5, item_name_snapshot: "Pump", quantity: 10, unit_price: 100, total: 1000, item_type: "stock" },
  { po_item_id: 8, po_id: 1, product_id: 6, item_name_snapshot: "Valve", quantity: 5, unit_price: 40, total: 200, item_type: "stock" },
]
function mk(tables: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    suppliers: [{ supplier_id: 1, supplier_name: "A" }],
    products: [{ product_id: 5, product_name: "Pump" }, { product_id: 6, product_name: "Valve" }],
    purchase_orders: [po()],
    purchase_order_items: items(),
    accounts_payable: [], ap_invoice_lines: [], supplier_payments: [], payment_schedules: [], supplier_credits: [],
    goods_receipts: [], goods_receipt_lines: [], sales_order_items: [], balance_entries: [], workflow_events: [], users: [],
    ...tables,
  })
  useDb(db)
  return db
}
let grl = 900
const receive = (db: FakeDb, poItemId: number, qty: number) => {
  db.tables.goods_receipt_lines.push({ line_id: ++grl, receipt_id: 90, po_item_id: poItemId, quantity_received: qty })
}
const bill = (lines: { poItemId: number; quantity: number }[], extra: Row = {}) => call(billRoute.POST as any, "POST", { id: "1", lines, ...extra })
const close = (extra: Row = {}) => call(closeRoute.POST as any, "POST", { id: "1", ...extra })
const reopen = () => call(reopenRoute.POST as any, "POST", { id: "1" })
const info = async () => (await (billRoute.GET as any)(new Request("http://test.local/api/purchase-orders/bill?poId=1"))).json()
const bills = (db: FakeDb) => [...db.tables.accounts_payable].sort((a, b) => a.invoice_id - b.invoice_id)

test("PB1. a bill for part of what was received: quantities x PO prices, VAT pro-rated; lines kept; PO stays open", async () => {
  const db = mk()
  receive(db, 7, 6)
  receive(db, 8, 5)
  const r = await bill([{ poItemId: 7, quantity: 4 }, { poItemId: 8, quantity: 5 }], { supplierInvoiceNumber: "S-77", invoiceDate: "2026-11-15" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const [b] = bills(db)
  assert.deepEqual([b.invoice_number, b.amount, b.invoice_date, b.supplier_invoice_number, b.status], ["APINV-PO-1-B1", 684, "2026-11-15", "S-77", "pending"]) // (400 + 200) x 1.14
  assert.deepEqual(db.tables.ap_invoice_lines.map((l) => [l.ap_invoice_id, l.po_item_id, l.quantity, l.unit_price, l.total]), [[b.invoice_id, 7, 4, 100, 400], [b.invoice_id, 8, 5, 40, 200]])
  assert.equal(closingBillOf(bills(db), "PO-1"), null, "the PO is still open")
  const i = await info()
  assert.deepEqual(i.lines.map((l: any) => [l.poItemId, l.ordered, l.received, l.billed, l.open]), [[7, 10, 6, 4, 2], [8, 5, 5, 5, 0]])
  assert.equal(i.billedPercent, 50)
  assert.ok(db.tables.workflow_events.some((e) => e.event_type === "PO_BILLED"))
})

test("PB2. the second bill takes only the rest; never more than received - billed", async () => {
  const db = mk()
  receive(db, 7, 6)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }])).status, 200)
  const tooMany = await bill([{ poItemId: 7, quantity: 3 }])
  assert.equal(tooMany.status, 409)
  assert.equal(tooMany.body.code, "BILL_TOO_MANY")
  assert.equal((await bill([{ poItemId: 8, quantity: 1 }])).body.code, "BILL_TOO_MANY", "nothing of the valves received")
  assert.equal((await bill([{ poItemId: 7, quantity: 0 }])).body.code, "NOTHING_TO_BILL")
  const second = await bill([{ poItemId: 7, quantity: 2 }])
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.deepEqual(bills(db).map((b) => [b.invoice_number, b.amount]), [["APINV-PO-1-B1", 456], ["APINV-PO-1-B2", 228]])
  assert.equal(bills(db).length, 2)
})

test("PB3. an advance comes off the first bill as far as it goes; the remainder carries to the next bill", async () => {
  const db = mk({ supplier_credits: [{ credit_id: 3, supplier_id: 1, amount: 600, status: "used", used_in_po_id: 1, credit_type: "advance", notes: "method=bank_transfer" }] })
  receive(db, 7, 10)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }])).status, 200) // 456
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }])).status, 200) // 456
  const [b1, b2] = bills(db)
  assert.deepEqual([b1.paid_amount, b1.status], [456, "paid"])
  assert.deepEqual([b2.paid_amount, b2.status], [144, "partially_paid"])
  assert.deepEqual(db.tables.supplier_payments.map((p) => [p.invoice_id, p.amount, p.payment_method, p.reference_number]), [
    [b1.invoice_id, 456, "bank_transfer", "APINV-PO-1-B1-ADV-3"],
    [b2.invoice_id, 144, "bank_transfer", "APINV-PO-1-B2-ADV-3"],
  ])
  assert.equal(db.tables.balance_entries.length, 0, "no new cash entry")
  // the advance is used up: the closing bill gets nothing off
  assert.equal((await close()).status, 200)
  const last = bills(db)[2]
  assert.deepEqual([last.invoice_number, last.paid_amount], ["APINV-PO-1", 0])
  // still open POs accept advances; a closed one does not
  assert.equal((await call(advanceRoute.POST as any, "POST", { id: "1", amount: 1, paymentMethod: "cash" })).body.code, "PO_CLOSED")
})

test("PB4. close bills everything received-but-unbilled; 'not coming' is recorded on the line and left out", async () => {
  const db = mk()
  receive(db, 7, 6)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }])).status, 200)
  assert.equal((await close({ notComing: [{ poItemId: 7, quantity: 5 }] })).body.code, "NOT_COMING_TOO_MANY", "only 4 were not received")
  const r = await close({ notComing: [{ poItemId: 7, quantity: 4 }, { poItemId: 8, quantity: 5 }], supplierInvoiceNumber: "S-90" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const [, final] = bills(db)
  assert.deepEqual([final.invoice_number, final.amount, final.supplier_invoice_number], ["APINV-PO-1", 228, "S-90"]) // the 2 received pumps
  assert.deepEqual(db.tables.purchase_order_items.map((l) => [l.po_item_id, l.quantity_not_coming]), [[7, 4], [8, 5]])
  assert.deepEqual(db.tables.ap_invoice_lines.filter((l) => l.ap_invoice_id === final.invoice_id).map((l) => [l.po_item_id, l.quantity]), [[7, 2]])
  assert.equal((await bill([{ poItemId: 7, quantity: 1 }])).body.code, "PO_CLOSED")
  assert.equal((await close()).body.code, "PO_ALREADY_CLOSED")
  assert.equal((await info()).billedPercent, 100)
})

test("PB5. close with nothing billed before and nothing left out: one bill of the PO total, as before", async () => {
  const db = mk({ purchase_orders: [po({ status: "approved" })] })
  const r = await close()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(bills(db).map((b) => [b.invoice_number, b.amount]), [["APINV-PO-1", 1368]])
})

test("PB6. reopen removes only the LAST bill, only while unpaid; earlier bills stay", async () => {
  const db = mk({ supplier_credits: [{ credit_id: 3, supplier_id: 1, amount: 100, status: "used", used_in_po_id: 1, credit_type: "advance", notes: "method=cash" }] })
  receive(db, 7, 10)
  await bill([{ poItemId: 7, quantity: 4 }])
  assert.equal((await close()).status, 200)
  assert.equal(bills(db).length, 2)
  const r = await reopen()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.reopened, true)
  assert.deepEqual(bills(db).map((b) => b.invoice_number), ["APINV-PO-1-B1"], "the first bill stays; the PO is open again")
  assert.equal(db.tables.ap_invoice_lines.every((l) => l.ap_invoice_id === bills(db)[0].invoice_id), true, "the removed bill's lines are gone")
  assert.equal(db.tables.supplier_payments.length, 1, "the first bill keeps the advance it took")
  // a payment on the last bill blocks removing it
  db.tables.supplier_payments.push({ payment_id: 99, invoice_id: bills(db)[0].invoice_id, amount: 10, payment_method: "cash", reference_number: "R1" })
  assert.equal((await reopen()).body.code, "PO_PAID")
  assert.equal(bills(db).length, 1)
  db.tables.supplier_payments.pop()
  const removed = await reopen()
  assert.equal(removed.status, 200)
  assert.equal(removed.body.reopened, false, "a bill for received items only goes; the PO was open already")
  assert.equal(bills(db).length, 0)
  assert.equal((await reopen()).body.code, "PO_ALREADY_OPEN")
})

test("PB7. an old PO with one bill and no lines: closed, the whole PO counts as billed, reopen works as before", async () => {
  const db = mk({ accounts_payable: [{ invoice_id: 50, invoice_number: "APINV-PO-1", po_id: 1, supplier_id: 1, amount: 1368, paid_amount: 0, status: "pending", months_paid: 0 }] })
  receive(db, 7, 10)
  const i = await info()
  assert.equal(i.closed, true)
  assert.deepEqual(i.lines.map((l: any) => l.billed), [10, 5])
  assert.equal((await bill([{ poItemId: 7, quantity: 1 }])).body.code, "PO_CLOSED")
  assert.equal((await reopen()).status, 200)
  assert.equal(bills(db).length, 0)
})

test("PB8. before the migration: bill-lines table missing -> partial bills refused, a whole-PO close still works", async () => {
  const db = mk()
  db.failOn["ap_invoice_lines:select"] = 'relation "public.ap_invoice_lines" does not exist'
  receive(db, 7, 6)
  assert.equal((await bill([{ poItemId: 7, quantity: 1 }])).body.code, "MIGRATION_PENDING")
  assert.equal((await close({ notComing: [{ poItemId: 8, quantity: 5 }] })).body.code, "MIGRATION_PENDING")
  assert.equal(bills(db).length, 0)
  const r = await close()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(bills(db).map((b) => [b.invoice_number, b.amount, b.supplier_invoice_number]), [["APINV-PO-1", 1368, undefined]])
  assert.equal(db.tables.ap_invoice_lines.length, 0)
  assert.equal((await reopen()).status, 200)
})

test("PB9. an open PO with bills stays editable, but a billed line cannot go below what was billed", async () => {
  const db = mk()
  receive(db, 7, 6)
  await bill([{ poItemId: 7, quantity: 4 }])
  const body = (q: number) => ({ id: "1", supplier_id: "1", order_date: "2026-11-01", payment_type: "cash", items: [{ id: "7", productId: "5", productName: "Pump", quantity: q, unitPrice: 100 }, { id: "8", productId: "6", productName: "Valve", quantity: 5, unitPrice: 40 }] })
  const low = await call(editRoute.POST as any, "POST", body(3))
  assert.equal(low.status, 409)
  assert.equal(low.body.code, "PO_LINE_BILLED")
  assert.equal((await call(editRoute.POST as any, "POST", body(8))).status, 200, "lowering the unbilled part is fine")
})

test("PB10. who may: the same people as closing (PO_CLOSE_ROLES); bill numbers; screens and strings", () => {
  const person = (roles: string[]) => ({ userId: 1, name: "x", roles: roles as any, active: true })
  for (const role of ["accountant", "po-rep", "admin", "ceo", "sales-rep", "warehouse-rep"]) {
    const kind = decide({ mode: "on", path: "/api/purchase-orders/bill", method: "POST", identity: person([role]), idle: false }).kind
    const close = decide({ mode: "on", path: "/api/purchase-orders/close", method: "POST", identity: person([role]), idle: false }).kind
    assert.equal(kind, close, role)
    assert.equal(kind === "allow", PO_CLOSE_ROLES.includes(role), role)
  }
  assert.equal(isPartialBill({ invoice_number: "APINV-PO-1-B2" }, "PO-1"), true)
  assert.equal(isPartialBill({ invoice_number: "APINV-PO-1" }, "PO-1"), false)
  assert.equal(isPartialBill({ invoice_number: "APINV-PO-12" }, "PO-1"), false)
  const menu = src("components/purchase-order/po-open-actions.tsx")
  assert.match(menu, /PO_CLOSE_ROLES\.includes\(role\)/)
  assert.match(menu, /<BillReceivedDialog/)
  assert.match(src("components/purchase-order/po-bill-dialog.tsx"), /"\/api\/purchase-orders\/bill"/)
  assert.match(src("components/modules/accounts-payable-module.tsx"), /t\("ap\.po-bill-of"\)/)
  assert.match(src("components/modules/purchase-order-module.tsx"), /<PoBilledNote/)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["po.bill-received", "po.bill-now", "po.bill-not-coming", "po.billed-summary", "po.remove-last-bill", "ap.po-bill-of"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, key)
  }
})

test("PB11. the migration is additive and safe to run twice; RLS on, no policies", () => {
  const sql = src("scripts/sql/2026-11-17-ap-invoice-lines.sql")
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  assert.doesNotMatch(code, /(^|;)\s*(drop|delete|truncate|update|insert|alter table \S+ (drop|alter))\b/im)
  assert.doesNotMatch(code, /create policy/i)
  assert.match(code, /create table if not exists public\.ap_invoice_lines/)
  assert.match(code, /references public\.accounts_payable\(invoice_id\) on delete cascade/)
  assert.match(code, /references public\.purchase_order_items\(po_item_id\)/)
  assert.match(code, /alter table public\.ap_invoice_lines enable row level security/)
  for (const stmt of code.match(/(create table|create index|add column)[^;]*/gi) || []) assert.match(stmt, /if not exists/i, stmt)
})

// ---------------------------------------------------------------------------------------------------------------
// Accounts Payable: each bill's payment schedule is its own share of the PO plan (2026-11-17)
// ---------------------------------------------------------------------------------------------------------------

// 30% down on the order date, the rest in 3 monthly payments from a month later
const hybrid = (extra: Row = {}) => po({
  payment_type: "hybrid", payment_terms: "hybrid", installments: 3, down_payment_amount: 410.4, down_payment_percent: 30,
  down_payment_due_date: "2026-11-01", remaining_amount: 957.6, remaining_installment_months: 3, monthly_amount: 319.2,
  payment_start_date: "2026-12-01", ...extra,
})
const apList = async (): Promise<any[]> =>
  (await (await (apRoute.GET as any)(new Request("http://test.local/api/accounts-payable"))).json()).sort((a: any, b: any) => Number(a.id) - Number(b.id))
const due = (inv: any) => apDueSchedule(inv, null).map((e) => [e.dueDate, e.amount, e.paid, e.isDownPayment])

test("PB12. a part bill gets the PO plan scaled to its amount, its days counted from the bill date", async () => {
  const db = mk({ purchase_orders: [hybrid()] })
  receive(db, 7, 4)
  receive(db, 8, 5)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }, { poItemId: 8, quantity: 5 }], { invoiceDate: "2026-11-15" })).status, 200) // 684 = half
  const [b1] = await apList()
  assert.deepEqual(b1.billSchedule, [
    { dueDate: "2026-11-15", amount: 205.2, isDownPayment: true },
    { dueDate: "2026-12-15", amount: 159.6, isDownPayment: false },
    { dueDate: "2027-01-15", amount: 159.6, isDownPayment: false },
    { dueDate: "2027-02-15", amount: 159.6, isDownPayment: false },
  ])
  assert.deepEqual(
    [b1.downPaymentAmount, b1.downPaymentDueDate, b1.remainingAmount, b1.remainingInstallmentMonths, b1.monthlyAmount, b1.paymentStartDate],
    [205.2, "2026-11-15", 478.8, 3, 159.6, "2026-12-15"],
    "not the whole PO's 410.40 down payment",
  )
  assert.equal(summarizeDue(apDueSchedule(b1, hybrid() as any), "2026-11-20").overdue, 205.2, "the PO passed in is not used")
})

test("PB13. the closing bill takes what is left of each payment, so the bills add up to the PO plan", () => {
  const p = po({ total: 100, payment_type: "installments", installments: 3, remaining_installment_months: 3, payment_start_date: "2026-11-01", order_date: "2026-11-01" })
  const list = [
    { invoice_id: 1, invoice_number: "APINV-PO-1-B1", amount: 33.33, invoice_date: "2026-11-01" },
    { invoice_id: 2, invoice_number: "APINV-PO-1", amount: 66.67, invoice_date: "2026-11-11" },
  ]
  const s = billSchedules(p, list, new Set([1, 2]))
  assert.deepEqual(s.get(1)!.map((e) => [e.dueDate, e.amount]), [["2026-11-01", 11.11], ["2026-12-01", 11.11], ["2027-01-01", 11.11]])
  assert.deepEqual(s.get(2)!.map((e) => [e.dueDate, e.amount]), [["2026-11-11", 22.22], ["2026-12-11", 22.22], ["2027-01-11", 22.23]])
  const odd = billSchedules(p, [{ ...list[0], amount: 10 }], new Set([1]))
  assert.deepEqual(odd.get(1)!.map((e) => e.amount), [3.33, 3.33, 3.34], "a bill's own last payment takes its rounding")
  // a bill dated before the PO: its days are not counted backwards
  assert.equal(billSchedules(p, [{ ...list[0], invoice_date: "2026-10-01" }], new Set([1])).get(1)![0].dueDate, "2026-11-01")
})

test("PB14. the advance on the first bills (option A) fills their first payments; a paid or 0 bill has nothing due", async () => {
  const db = mk({
    purchase_orders: [hybrid()],
    supplier_credits: [{ credit_id: 3, supplier_id: 1, amount: 600, status: "used", used_in_po_id: 1, credit_type: "advance", notes: "method=cash" }],
  })
  receive(db, 7, 10)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }], { invoiceDate: "2026-11-01" })).status, 200) // 456, all from the advance
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }], { invoiceDate: "2026-11-01" })).status, 200) // 456, 144 from the advance
  const [b1, b2] = await apList()
  assert.equal(summarizeDue(apDueSchedule(b1, null), "2027-06-01").balance, 0, "fully paid by the advance: nothing due")
  assert.deepEqual(due(b2), [
    ["2026-11-01", 136.8, 136.8, true],
    ["2026-12-01", 106.4, 7.2, false],
    ["2027-01-01", 106.4, 0, false],
    ["2027-02-01", 106.4, 0, false],
  ])
  assert.equal(summarizeDue(apDueSchedule(b2, null), "2026-12-05").overdue, 99.2)
  const zero = billSchedules(hybrid(), [{ invoice_id: 9, invoice_number: "APINV-PO-1-B1", amount: 0, invoice_date: "2026-11-01" }], new Set([9]))
  assert.deepEqual(zero.get(9), [])
  assert.deepEqual(apDueSchedule({ amount: 0, paidAmount: 0, billSchedule: [] }, hybrid() as any), [])
})

test("PB15. bills without lines, and the one bill of a whole PO, keep the PO plan exactly as before", async () => {
  mk({
    purchase_orders: [hybrid()],
    accounts_payable: [{ invoice_id: 50, invoice_number: "APINV-PO-1", po_id: 1, supplier_id: 1, amount: 1368, paid_amount: 0, status: "pending", months_paid: 0, invoice_date: "2026-11-05", down_payment_amount: 410.4, payment_type: "hybrid" }],
  })
  const [old] = await apList()
  assert.equal(old.billSchedule, null)
  assert.equal(old.downPaymentAmount, 410.4)
  // closed in one go with the lines table in place: a single bill that carries the PO's own plan
  mk({ purchase_orders: [hybrid({ status: "approved" })] })
  assert.equal((await close()).status, 200)
  const [whole] = await apList()
  assert.equal(whole.billSchedule, null)
  assert.equal(whole.downPaymentAmount, 410.4)
  // the lines table not made yet: the list still loads, as before
  const pending = mk({ purchase_orders: [hybrid()], accounts_payable: [{ invoice_id: 51, invoice_number: "APINV-PO-1-B1", po_id: 1, supplier_id: 1, amount: 684, paid_amount: 0, status: "pending" }] })
  pending.failOn["ap_invoice_lines:select"] = 'relation "public.ap_invoice_lines" does not exist'
  const rows = await apList()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].billSchedule, null)
  const ui = src("components/modules/accounts-payable-module.tsx")
  assert.match(ui, /if \(Array\.isArray\(invoice\.billSchedule\)\)/)
  assert.match(ui, /if \(poId && !ownSchedule\)/)
})
