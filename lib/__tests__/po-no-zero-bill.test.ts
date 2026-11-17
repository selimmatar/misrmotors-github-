// No 0 EGP closing bill (owner request, 2026-11-18): closing a PO whose bills for received items already took everything
// makes NO bill; the PO is marked closed in its history (lib/po-closed-marker.ts) and counts as closed everywhere.
// Reopen clears the marker only. Also: the sales order list's status filter.
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
import * as poListRoute from "../../app/api/purchase-orders/route"
import { PO_CLOSED_NO_BILL, closedWithoutBillIds } from "../po-closed-marker"
import { isPoClosed } from "../po-bill"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

// PO-1: pumps 10 x 100 and valves 5 x 40 = 1,200 + 14% VAT = 1,368
const po = (extra: Row = {}): Row => ({
  po_id: 1, po_number: "PO-1", supplier_id: 1, status: "received", total: 1368, tax_amount: 168,
  payment_type: "cash", payment_terms: "prepaid", order_date: "2026-11-01", created_at: "2026-11-01", ...extra,
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
    po_requests: [],
    ...tables,
  })
  useDb(db)
  return db
}
let grl = 900
const receive = (db: FakeDb, poItemId: number, qty: number) => {
  db.tables.goods_receipt_lines.push({ line_id: ++grl, receipt_id: 90, po_item_id: poItemId, quantity_received: qty })
}
const bill = (lines: { poItemId: number; quantity: number }[]) => call(billRoute.POST as any, "POST", { id: "1", lines })
const close = (extra: Row = {}) => call(closeRoute.POST as any, "POST", { id: "1", ...extra })
const reopen = () => call(reopenRoute.POST as any, "POST", { id: "1" })
const info = async () => (await (billRoute.GET as any)(new Request("http://test.local/api/purchase-orders/bill?poId=1"))).json()
const bills = (db: FakeDb) => [...db.tables.accounts_payable].sort((a, b) => a.invoice_id - b.invoice_id)
const editBody = (q: number) => ({ id: "1", supplier_id: "1", order_date: "2026-11-01", payment_type: "cash", items: [{ id: "7", productId: "5", productName: "Pump", quantity: q, unitPrice: 100 }, { id: "8", productId: "6", productName: "Valve", quantity: 5, unitPrice: 40 }] })

/** Everything received and billed in two bills for received items: nothing is left for a closing bill. */
async function fullyBilled() {
  const db = mk()
  receive(db, 7, 10)
  receive(db, 8, 5)
  assert.equal((await bill([{ poItemId: 7, quantity: 6 }])).status, 200)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }, { poItemId: 8, quantity: 5 }])).status, 200)
  assert.equal(bills(db).reduce((s, b) => s + b.amount, 0), 1368)
  return db
}

test("NZ1. closing a fully billed PO makes no 0 bill; the PO counts as closed everywhere", async () => {
  const db = await fullyBilled()
  const r = await close()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([r.body.noBill, r.body.invoiceNumber, r.body.amount], [true, null, 0])
  assert.deepEqual(bills(db).map((b) => b.invoice_number), ["APINV-PO-1-B1", "APINV-PO-1-B2"], "no APINV-PO-1 bill")
  assert.equal(db.tables.accounts_payable.some((b) => Number(b.amount) === 0), false, "no 0-amount bill")
  const marker = db.tables.workflow_events.filter((e) => e.event_type === "PO_CLOSED")
  assert.deepEqual(marker.map((e) => [e.entity_type, e.entity_id, e.new_value]), [["PURCHASE_ORDER", 1, PO_CLOSED_NO_BILL]])
  // closed: the bill screen, billing more, closing again, advances, editing
  assert.equal((await info()).closed, true)
  assert.equal(await isPoClosed(db, { po_id: 1, po_number: "PO-1" }), true)
  assert.equal((await bill([{ poItemId: 7, quantity: 1 }])).body.code, "PO_CLOSED")
  assert.equal((await close()).body.code, "PO_ALREADY_CLOSED")
  assert.equal((await call(advanceRoute.POST as any, "POST", { id: "1", amount: 1, paymentMethod: "cash" })).body.code, "PO_CLOSED")
  assert.equal((await call(editRoute.POST as any, "POST", editBody(12))).body.code, "PO_CLOSED")
  // the PO list shows it closed
  const list = await call(poListRoute.GET as any, "GET")
  assert.equal(list.status, 200, JSON.stringify(list.body))
  const row = (Array.isArray(list.body) ? list.body : list.body.data || list.body.purchaseOrders || []).find((o: any) => o.id === "1")
  assert.equal(row?.closedWithoutBill, true)
})

test("NZ2. reopen clears only the marker (no bill removed); 'Remove last bill' and a later close work as before", async () => {
  const db = await fullyBilled()
  assert.equal((await close()).status, 200)
  const r = await reopen()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([r.body.reopened, r.body.removed], [true, null])
  assert.equal(bills(db).length, 2, "both bills stay")
  assert.equal((await info()).closed, false)
  assert.equal((await closedWithoutBillIds(db)).size, 0)
  assert.equal((await call(editRoute.POST as any, "POST", editBody(12))).status, 200, "open again: editable (2 more pumps)")
  // now 2 pumps are not billed: closing makes a real closing bill
  const c = await close({ notComing: [{ poItemId: 7, quantity: 2 }] })
  assert.equal(c.status, 200, JSON.stringify(c.body))
  assert.equal(c.body.noBill, true, "the 2 extra pumps are not coming: still nothing to bill")
  assert.equal((await reopen()).body.reopened, true)
  const c2 = await close()
  assert.equal(c2.status, 200, JSON.stringify(c2.body))
  assert.equal(c2.body.invoiceNumber, "APINV-PO-1")
  assert.equal(c2.body.amount, 228) // 2 x 100 x 1.14
  assert.equal((await reopen()).body.removed, "APINV-PO-1")
  const removed = await reopen()
  assert.deepEqual([removed.body.reopened, removed.body.removed], [false, "APINV-PO-1-B2"], "Remove last bill unchanged")
})

test("NZ3. what is left all 'not coming': closed without a bill, the not-coming quantities recorded", async () => {
  const db = mk({ purchase_orders: [po({ status: "partially_received" })] })
  receive(db, 7, 4)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }])).status, 200)
  const r = await close({ notComing: [{ poItemId: 7, quantity: 6 }, { poItemId: 8, quantity: 5 }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.noBill, true)
  assert.equal(bills(db).length, 1)
  assert.deepEqual(db.tables.purchase_order_items.map((l) => [l.po_item_id, l.quantity_not_coming]), [[7, 6], [8, 5]])
})

test("NZ4. the marker cannot be written: nothing changes, the PO stays open", async () => {
  const db = mk({ purchase_orders: [po({ status: "partially_received" })] })
  receive(db, 7, 4)
  assert.equal((await bill([{ poItemId: 7, quantity: 4 }])).status, 200)
  db.failOn["workflow_events:insert"] = "boom"
  const r = await close({ notComing: [{ poItemId: 7, quantity: 6 }, { poItemId: 8, quantity: 5 }] })
  assert.equal(r.status, 500)
  assert.equal(bills(db).length, 1)
  assert.deepEqual(db.tables.purchase_order_items.map((l) => Number(l.quantity_not_coming) || 0), [0, 0], "not-coming put back")
  delete db.failOn["workflow_events:insert"]
  assert.equal((await info()).closed, false)
})

test("NZ5. closed = the latest PO_CLOSED / PO_REOPENED event; a normal close and an untouched PO are unaffected", async () => {
  const db = mk({
    workflow_events: [
      { event_id: 1, entity_type: "PURCHASE_ORDER", entity_id: 1, event_type: "PO_CLOSED", new_value: PO_CLOSED_NO_BILL },
      { event_id: 2, entity_type: "PURCHASE_ORDER", entity_id: 1, event_type: "PO_REOPENED", new_value: "{}" },
      { event_id: 3, entity_type: "PURCHASE_ORDER", entity_id: 1, event_type: "PO_CLOSED", new_value: PO_CLOSED_NO_BILL },
      { event_id: 4, entity_type: "PURCHASE_ORDER", entity_id: 2, event_type: "PO_CLOSED", new_value: PO_CLOSED_NO_BILL },
      { event_id: 5, entity_type: "PURCHASE_ORDER", entity_id: 2, event_type: "PO_REOPENED", new_value: "{}" },
      { event_id: 6, entity_type: "PURCHASE_ORDER", entity_id: 3, event_type: "PO_CLOSED", new_value: "APINV-PO-3" },
      { event_id: 7, entity_type: "SALES_ORDER", entity_id: 4, event_type: "PO_CLOSED", new_value: PO_CLOSED_NO_BILL },
    ],
  })
  assert.deepEqual([...(await closedWithoutBillIds(db))], [1])
  assert.deepEqual([...(await closedWithoutBillIds(db, [2, 3]))], [])
  assert.deepEqual([...(await closedWithoutBillIds(db, []))], [])
  // a PO with nothing billed before still gets its one bill of the PO total
  const fresh = mk({ purchase_orders: [po({ status: "approved" })] })
  const r = await close()
  assert.equal(r.status, 200)
  assert.deepEqual(bills(fresh).map((b) => [b.invoice_number, b.amount]), [["APINV-PO-1", 1368]])
})

test("NZ6. screens: the PO list and the close dialog know a no-bill close; strings in both languages", () => {
  const module = src("components/modules/purchase-order-module.tsx")
  assert.match(module, /isClosedPO = \(order: PurchaseOrder\) => !!closingBillOf\(poBills\(order\), order\.poNumber\) \|\| !!order\.closedWithoutBill/)
  const dialog = src("components/purchase-order/po-bill-dialog.tsx")
  assert.match(dialog, /res\?\.noBill \? t\("po\.closed-done-no-bill"\)/)
  assert.match(dialog, /po\.close-no-bill-note/)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["po.closed-done-no-bill", "po.close-no-bill-note", "so.filter-status", "so.all-statuses"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in English and Arabic`)
  }
})

test("NZ7. sales orders list: status filter (All + each status present) combined with the search", () => {
  const so = src("components/modules/sales-order-module.tsx")
  assert.match(so, /const \[listStatusFilter, setListStatusFilter\] = useState<string>\("ALL"\)/)
  assert.match(so, /const listStatuses = \[\.\.\.new Set\(salesOrders\.map\(\(order\) => String\(getSODeliveryStatus\(order\)\)\)\)\]/)
  // the search AND the status filter
  assert.match(so, /getCustomerName\(order\.customerId\)\.toLowerCase\(\)\.includes\(searchTerm\.toLowerCase\(\)\)\) &&\s*\(listStatusFilter === "ALL" \|\| String\(getSODeliveryStatus\(order\)\) === listStatusFilter\)/)
  assert.match(so, /<SelectItem value="ALL">\{t\("so\.all-statuses"\)\}<\/SelectItem>/)
  assert.match(so, /\{t\(`so\.status\.\$\{status\}`\)\}/, "the same labels as the status badges")
  assert.match(so, /aria-label=\{t\("so\.filter-status"\)\}/)
})
