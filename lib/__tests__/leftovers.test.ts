// Leftover review fixes: PO PUT stale approve / revert / over-order, Customers tab chips, Create-DP planned count,
// payment-schedules error handling (real route handlers; only the database is the FakeDb).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as poRoute from "../../app/api/purchase-orders/route"
import * as scheduleRoute from "../../app/api/payment-schedules/route"
import { buildApprovalRevert } from "../po-status"
import { linesWithIncreasedQuantity } from "../po-over-order"
import { permitChip } from "../customer-dp-chip"
import { isPlannedPermit } from "../dp-planned"
import { isSOFullyDelivered } from "../delivery-status"

const po = (po_id: number, status: string, extra: Row = {}): Row => ({
  po_id, po_number: `PO-T-${po_id}`, supplier_id: 1, status, total: 500, payment_type: "cash",
  approved_at: null, approved_by: null, rejection_reason: null, ...extra,
})
const putPo = (body: Row) => call(poRoute.PUT, "PUT", body)
const getPo = (db: FakeDb, id: number) => db.tables.purchase_orders.find((r) => r.po_id === id)!

// ---- item 1 -------------------------------------------------------------------------------------------------
test("LO1. a same-status approve does not overwrite total or payment_type", async () => {
  const db = new FakeDb({ purchase_orders: [po(1, "pending")], purchase_order_items: [], accounts_payable: [] })
  useDb(db)
  assert.equal((await putPo({ id: 1, status: "approved" })).status, 200)
  const stamp = getPo(db, 1).approved_at
  const r = await putPo({ id: 1, status: "approved", total: 999, paymentType: "cheque", payment_terms: "installment" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(getPo(db, 1).total, 500)
  assert.equal(getPo(db, 1).payment_type, "cash")
  assert.equal(getPo(db, 1).approved_at, stamp)
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("LO2. the first approve (pending -> approved) still applies the sent total", async () => {
  const db = new FakeDb({ purchase_orders: [po(1, "pending")], purchase_order_items: [], accounts_payable: [] })
  useDb(db)
  const r = await putPo({ id: 1, status: "approved", total: 650 })
  assert.equal(r.status, 200)
  assert.equal(getPo(db, 1).total, 650)
  assert.equal(db.tables.accounts_payable[0].amount, 650)
})

test("LO3. a reverted approval restores approved_by, approved_at, rejection_reason and the changed columns", async () => {
  const db = new FakeDb({
    purchase_orders: [po(1, "pending", { rejection_reason: "earlier note", approved_by: null })],
    purchase_order_items: [],
    accounts_payable: [],
  })
  db.failOn["accounts_payable:insert"] = "boom"
  useDb(db)
  const r = await putPo({ id: 1, status: "approved", approvedBy: 7, total: 777, paymentType: "cheque", rejectionReason: "stale" })
  assert.equal(r.status, 500)
  assert.equal(r.body.poApproved, false)
  const row = getPo(db, 1)
  assert.equal(row.status, "pending")
  assert.equal(row.approved_at, null)
  assert.equal(row.approved_by, null)
  assert.equal(row.rejection_reason, "earlier note")
  assert.equal(row.total, 500)
  assert.equal(row.payment_type, "cash")
})

test("LO3b. buildApprovalRevert only restores columns the request touched plus the approval fields", () => {
  const revert = buildApprovalRevert(po(1, "pending"), { status: "approved", total: 1, nonexistent_col: 2 })
  assert.deepEqual(Object.keys(revert).sort(), ["approved_at", "approved_by", "rejection_reason", "status", "total"])
})

// ---- item 2 -------------------------------------------------------------------------------------------------
const soItems = (): Row[] => [
  { so_item_id: 10, so_id: 1, quantity: 10 },
  { so_item_id: 11, so_id: 1, quantity: 4 },
]
const poLine = (po_item_id: number, po_id: number, so: number, quantity: number): Row => ({
  po_item_id, po_id, source_so_id: 1, source_so_item_id: so, quantity, unit_price: 1, total: quantity,
})
const it = (qty: number, so: number): Row => ({ productId: 5, productName: "Part", quantity: qty, unitPrice: 1, total: qty, sourceSoId: "1", sourceSoItemId: so })
function legacyOverOrdered() {
  // PO 1 already orders 12 against an SO line that needs 10 (older data).
  const db = new FakeDb({
    sales_order_items: soItems(),
    purchase_orders: [po(1, "pending")],
    purchase_order_items: [poLine(1, 1, 10, 12)],
    accounts_payable: [],
  })
  useDb(db)
  return db
}

test("LO4. resending an unchanged legacy over-ordered line passes (unrelated edit)", async () => {
  const db = legacyOverOrdered()
  const r = await putPo({ id: 1, total: 520, items: [it(12, 10)] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_order_items.length, 1)
  assert.equal(getPo(db, 1).total, 520)
})

test("LO5. lowering the legacy over-ordered line passes; raising it is blocked", async () => {
  const db = legacyOverOrdered()
  assert.equal((await putPo({ id: 1, items: [it(11, 10)] })).status, 200)
  assert.equal(db.tables.purchase_order_items[0].quantity, 11)
  const up = await putPo({ id: 1, items: [it(12, 10)] }) // 11 -> 12 is an increase; 12 > 10 needed
  assert.equal(up.status, 409)
  assert.equal(up.body.code, "PO_OVER_ORDER")
  assert.equal(db.tables.purchase_order_items[0].quantity, 11)
})

test("LO6. a new over-ordering line is blocked even when another line is a legacy one", async () => {
  const db = legacyOverOrdered()
  const r = await putPo({ id: 1, items: [it(12, 10), it(5, 11)] }) // SO line 11 needs 4
  assert.equal(r.status, 409)
  assert.deepEqual(r.body.lines.map((l: any) => l.sourceSoItemId), [11])
  assert.equal(db.tables.purchase_order_items[0].quantity, 12)
})

test("LO6b. linesWithIncreasedQuantity compares per sales-order line against the stored total", () => {
  const stored = [{ source_so_item_id: 10, quantity: 6 }, { source_so_item_id: 10, quantity: 6 }]
  assert.equal(linesWithIncreasedQuantity([it(12, 10)], stored).length, 0)
  assert.equal(linesWithIncreasedQuantity([it(13, 10)], stored).length, 1)
  assert.equal(linesWithIncreasedQuantity([it(1, 11)], stored).length, 1) // new line
})

// ---- item 3 -------------------------------------------------------------------------------------------------
test("LO7. Customers tab chip: delivered statuses, pending otherwise, returns flagged", () => {
  assert.deepEqual(permitChip("APPROVED", 0), { label: "Delivered", tone: "green" })
  assert.deepEqual(permitChip("SUBMITTED_SIGNED", 0), { label: "Delivered", tone: "green" })
  assert.equal(permitChip("OUT_FOR_DELIVERY", 0).label, "Pending")
  assert.equal(permitChip("REJECTED", 3).label, "Pending")
  const returned = permitChip("APPROVED", 3)
  assert.equal(returned.tone, "orange")
  assert.match(returned.label, /3 returned/)
})

test("LO7b. Customers tab chip: only the permit that has returns is flagged (the other stays plainly Delivered)", () => {
  const permits = [
    { status: "APPROVED", returnedQuantity: 3 }, // DP with the return
    { status: "APPROVED", returnedQuantity: 0 }, // DP of the same order without returns
  ]
  const chips = permits.map((p) => permitChip(p.status, p.returnedQuantity))
  assert.equal(chips[0].label, "Delivered (3 returned)")
  assert.equal(chips[0].tone, "orange")
  assert.deepEqual(chips[1], { label: "Delivered", tone: "green" })
  assert.deepEqual(permitChip("APPROVED", undefined as any), { label: "Delivered", tone: "green" })
})

// ---- item 4 -------------------------------------------------------------------------------------------------
test("LO8. Create-DP: a rejected permit's quantity can be planned again, agreeing with isSOFullyDelivered", async () => {
  const permits = [
    { permit_id: 1, sales_order_id: 1, status: "APPROVED" },
    { permit_id: 2, sales_order_id: 1, status: "REJECTED" },
    { permit_id: 3, sales_order_id: 1, status: "DRAFT" },
  ]
  const dpItems = [
    { item_id: 1, permit_id: 1, product_id: 5, quantity: 6 },
    { item_id: 2, permit_id: 2, product_id: 5, quantity: 4 },
    { item_id: 3, permit_id: 3, product_id: 5, quantity: 1 },
  ]
  const planned = permits.filter(isPlannedPermit)
  assert.deepEqual(planned.map((p) => p.permit_id), [1, 3])
  const plannedQty = dpItems.filter((i) => planned.some((p) => p.permit_id === i.permit_id)).reduce((a, i) => a + i.quantity, 0)
  assert.equal(10 - plannedQty, 3) // before the fix: 10 - 11 -> 0 remaining

  const db = new FakeDb({
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 5, quantity: 10 }],
    delivery_permits: permits,
    delivery_permit_items: dpItems,
    product_returns: [],
    return_items: [],
  })
  assert.equal(await isSOFullyDelivered(db, 1), false) // the rejected 4 never count as delivered
  assert.equal(isPlannedPermit({ status: "rejected" }), false)
  assert.equal(isPlannedPermit({ status: "READY_FOR_SHIPMENT" }), true)
})

// ---- item 5 -------------------------------------------------------------------------------------------------
const scheduleDb = () =>
  new FakeDb({
    payment_schedules: [{ schedule_id: 1, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" }],
    accounts_receivable: [{ invoice_id: 5, amount: 300, collected_amount: 0, months_paid: 0, status: "pending" }],
    idempotency_log: [],
  })
const putSchedule = (body: Row) => call(scheduleRoute.PUT, "PUT", body)

test("LO9. schedule payment (idempotent path): AR update failure answers 500, not success", async () => {
  const db = scheduleDb()
  db.failOn["accounts_receivable:update"] = "ar down"
  useDb(db)
  const r = await putSchedule({ scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" })
  assert.equal(r.status, 500, JSON.stringify(r.body))
  assert.equal(r.body.schedulePaid, true)
  assert.equal(r.body.invoiceUpdated, false)
  assert.equal(r.body.message, undefined)
  assert.equal(db.tables.accounts_receivable[0].collected_amount, 0)
  assert.equal(db.tables.idempotency_log[0].status, "failed")
})

test("LO10. schedule payment (plain path): AR read failure answers 500, not success", async () => {
  const db = scheduleDb()
  db.failOn["accounts_receivable:select"] = "ar read down"
  useDb(db)
  const r = await putSchedule({ scheduleId: "1" })
  assert.equal(r.status, 500, JSON.stringify(r.body))
  assert.equal(r.body.invoiceUpdated, false)
  assert.equal(r.body.message, undefined)
})

test("LO11. schedule payment still succeeds and updates the invoice when nothing fails", async () => {
  for (const body of [{ scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" }, { scheduleId: "1" }]) {
    const db = scheduleDb()
    useDb(db)
    const r = await putSchedule(body)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.message, "Payment recorded successfully")
    assert.equal(db.tables.accounts_receivable[0].collected_amount, 100)
    assert.equal(db.tables.accounts_receivable[0].status, "partially_paid")
    assert.equal(db.tables.payment_schedules[0].status, "paid")
  }
})
