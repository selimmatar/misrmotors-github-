// Consistency fixes: GRN -> PO status mapping, over-receipt guard, lib/enums.ts vs the live CHECK lists,
// and the single AR payment-status helper (lib/ar-status.ts). Run with lib/__tests__/run-tests.sh.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as grnRoute from "../../app/api/goods-receipts/route"
import { computeArStatus } from "../ar-status"
import { PO_STATUS_VALUES, SO_STATUS_VALUES, DP_STATUS, QUOTATION_STATUS, GRN_STATUS, computeInvoiceStatus } from "../enums"

// ---- goods receipts ------------------------------------------------------------------------------------
// PO 1 (approved): item 1 = stock product 7 (10 @ 100), item 2 = stock product 8 (4 @ 50)
function baseDb() {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "approved", total: 1200 }],
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock", item_name_snapshot: "Pump A" },
      { po_item_id: 2, po_id: 1, product_id: 8, quantity: 4, unit_price: 50, total: 200, item_type: "stock", item_name_snapshot: "Hose B" },
    ],
    goods_receipts: [],
    goods_receipt_lines: [],
    inventory: [],
    inventory_batches: [],
    sales_orders: [],
    sales_order_items: [],
    idempotency_log: [],
  })
  useDb(db)
  return db
}
let k = 0
const line = (poItemId: number, qty: number, extra: Row = {}) => ({ poItemId, quantityReceived: qty, warehouseId: 1, unitCost: 100, ...extra })
const rec = (lines: Row[]) => ({ poId: 1, receivedBy: 1, lines, idempotencyKey: `consistency-key-${++k}` })
const post = (body: any) => call(grnRoute.POST, "POST", body)
const poStatus = (db: FakeDb) => db.tables.purchase_orders.find((p) => p.po_id === 1)!.status

test("G1. everything received, no discrepancy: GRN complete -> PO received", async () => {
  const db = baseDb()
  assert.equal((await post(rec([line(1, 10), line(2, 4)]))).status, 200)
  assert.equal(db.tables.goods_receipts[0].status, "complete")
  assert.equal(poStatus(db), "received")
})

test("G2. everything received WITH a discrepancy: GRN discrepancy -> PO received_with_issues (was received)", async () => {
  const db = baseDb()
  const res = await post(rec([line(1, 10, { discrepancyType: "damaged" }), line(2, 4)]))
  assert.equal(res.status, 200)
  assert.equal(db.tables.goods_receipts[0].status, "discrepancy")
  assert.equal(res.body.poStatus, "received_with_issues")
  assert.equal(poStatus(db), "received_with_issues")
})

test("G3. partial receipt (with or without discrepancy) -> PO partially_received and stays receivable", async () => {
  const db = baseDb()
  assert.equal((await post(rec([line(1, 6, { discrepancyType: "damaged" })]))).status, 200)
  assert.equal(db.tables.goods_receipts[0].status, "discrepancy")
  assert.equal(poStatus(db), "partially_received")
  assert.equal((await post(rec([line(1, 4), line(2, 4)]))).status, 200)
  assert.equal(poStatus(db), "received")
})

test("G4. a received_with_issues PO cannot receive more", async () => {
  const db = baseDb()
  await post(rec([line(1, 10, { discrepancyType: "damaged" }), line(2, 4)]))
  const again = await post(rec([line(1, 1)]))
  assert.equal(again.status, 409)
  assert.equal(again.body.code, "PO_NOT_RECEIVABLE")
})

test("G5. over-receipt across several receipts is refused with the lines, nothing recorded or moved", async () => {
  const db = baseDb()
  assert.equal((await post(rec([line(1, 7)]))).status, 200)
  const grns = db.tables.goods_receipts.length
  const stock = db.tables.inventory.map((i) => ({ ...i }))
  const res = await post(rec([line(1, 4), line(2, 1)]))
  assert.equal(res.status, 409)
  assert.equal(res.body.code, "OVER_RECEIPT")
  assert.deepEqual(res.body.lines, [{ poItemId: 1, ordered: 10, alreadyReceived: 7, remaining: 3, requested: 4 }])
  assert.deepEqual(res.body.lines, res.body.items)
  assert.equal(db.tables.goods_receipts.length, grns)
  assert.deepEqual(db.tables.inventory, stock)
  assert.equal(poStatus(db), "partially_received")
})

test("G6. exactly the remaining quantity is accepted (boundary)", async () => {
  const db = baseDb()
  await post(rec([line(1, 7)]))
  assert.equal((await post(rec([line(1, 3), line(2, 4)]))).status, 200)
  assert.equal(poStatus(db), "received")
})

// ---- enums vs the live CHECK lists (verified with SELECT on pg_constraint) ---------------------------------
test("E1. PO statuses match purchase_orders_status_check", () => {
  assert.deepEqual([...PO_STATUS_VALUES].sort(), ["approved", "draft", "partially_received", "pending", "received", "received_with_issues", "rejected"])
})

test("E2. SO statuses match sales_orders_status_check", () => {
  assert.deepEqual([...SO_STATUS_VALUES].sort(), [
    "accountant_approved", "approved_quotation", "cancelled", "delivered", "draft", "draft_quotation", "expired_quotation",
    "pending", "pending_accountant", "pending_approval", "ready_for_delivery", "rejected_quotation", "shipped",
  ])
})

test("E3. DP, quotation and GRN statuses match their CHECKs", () => {
  assert.deepEqual(Object.values(DP_STATUS).sort(), ["APPROVED", "DRAFT", "OUT_FOR_DELIVERY", "PRINTED", "READY_FOR_PICKUP", "READY_FOR_SHIPMENT", "REJECTED", "SUBMITTED_SIGNED"])
  assert.deepEqual(Object.values(QUOTATION_STATUS).sort(), ["accepted", "draft", "expired", "rejected", "sent"])
  assert.deepEqual(Object.values(GRN_STATUS).sort(), ["complete", "discrepancy", "partial", "pending"])
})

// ---- AR payment status -------------------------------------------------------------------------------------
const today = new Date("2026-10-08T12:00:00")
const st = (amount: number, collectedAmount: number, dueDate?: string) => computeArStatus({ amount, collectedAmount, dueDate, today })

test("A1. paid / partially_paid / pending / overdue", () => {
  assert.equal(st(1000, 1000, "2026-01-01"), "paid")
  assert.equal(st(1000, 400, "2026-12-01"), "partially_paid")
  assert.equal(st(1000, 0, "2026-12-01"), "pending")
  assert.equal(st(1000, 0, "2026-10-01"), "overdue")
  assert.equal(st(1000, 0), "pending")
})

test("A2. over-collection (INV-2026-0005 style) is paid; rounding dust within 0.01 is paid", () => {
  assert.equal(st(1000, 1200, "2026-10-01"), "paid")
  assert.equal(st(1000, 999.995), "paid")
  assert.equal(st(1000, 999.5), "partially_paid")
})

test("A3. due today is not overdue; a past due date with part collected is overdue", () => {
  assert.equal(st(1000, 0, "2026-10-08"), "pending")
  assert.equal(st(1000, 300, "2026-10-07"), "overdue")
})

test("A4. never returns the schedule-only value 'partial'; strings and nulls are tolerated", () => {
  assert.equal(computeArStatus({ amount: "1000", collectedAmount: "250", today }), "partially_paid")
  assert.equal(computeArStatus({ amount: null, collectedAmount: null, today }), "paid")
  assert.equal(computeArStatus({ amount: 100, collectedAmount: 0, dueDate: "garbage", today }), "pending")
})

test("A5. enums.computeInvoiceStatus delegates to the same helper", () => {
  assert.equal(computeInvoiceStatus(500, 500), "paid")
  assert.equal(computeInvoiceStatus(100, 500), "partially_paid")
  assert.equal(computeInvoiceStatus(0, 500), "pending")
  assert.equal(computeInvoiceStatus(0, 500, "2000-01-01"), "overdue")
})

test("suppliers tab sums every AP invoice per order and measures paid status on money against the order total", () => {
  const fs = require("node:fs") as typeof import("node:fs")
  const src = fs.readFileSync(require("node:path").join(process.env.REPO_ROOT || "", "components/modules/supplier-module.tsx"), "utf8")
  assert.match(src, /\(invoiceMap\[inv\.poId\] \|\|= \[\]\)\.push\(inv\)/)
  // the ORDER total is the target: historical duplicate AP rows (each for the full total) must not double it
  assert.match(src, /const totalAmount = Number\(order\.total\) \|\| invoiced/)
  assert.doesNotMatch(src, /Math\.max\(Number\(order\.total\) \|\| 0, invoiced\)/)
  assert.match(src, /\} else if \(paidC < totalC\) \{\s*status = "partially_paid"/)
  assert.doesNotMatch(src, /monthsPaid > 0 && monthsPaid < totalMonths/)
})
