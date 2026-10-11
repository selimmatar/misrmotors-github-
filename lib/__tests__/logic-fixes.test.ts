// Logic fixes: inventory count per warehouse row, AP invoice delete guard, deterministic DP approval idempotency.
// Real handlers on the in-memory FakeDb.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as auditRoute from "../../app/api/inventory/audit/route"
import * as apRoute from "../../app/api/accounts-payable/route"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as finalizeRoute from "../../app/api/purchase-orders/finalize-cost/route"
import * as grnRoute from "../../app/api/goods-receipts/route"
import * as scheduleRoute from "../../app/api/payment-schedules/route"
import { generateDPApprovalIdempotencyKey, generatePOReceiveIdempotencyKey } from "../idempotency"

const ROOT = process.env.REPO_ROOT || join(__dirname, "../../../..")

// ---------------------------------------------------------------------------------------------------------
// 1. Inventory count (audit) adjusts only the counted warehouse row
// ---------------------------------------------------------------------------------------------------------
const invRow = (inventory_id: number, product_id: number, warehouse_id: number, quantity: number): Row => ({
  inventory_id, product_id, warehouse_id, quantity, unit_cost: 10, reorder_point: 1,
})
const auditDb = () => {
  const db = new FakeDb({ inventory: [invRow(1, 7, 1, 20), invRow(2, 7, 2, 30), invRow(3, 8, 1, 5)], inventory_audits: [] })
  useDb(db)
  return db
}
const qty = (db: FakeDb, id: number) => db.tables.inventory.find((r) => r.inventory_id === id)!.quantity
const audit = (adjustments: any[]) => call(auditRoute.POST, "POST", { adjustments })

test("audit: an adjustment with inventoryId changes only that inventory row", async () => {
  const db = auditDb()
  const r = await audit([{ inventoryId: 2, productId: 7, warehouseId: 2, systemQuantity: 30, physicalCount: 25 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 1), 20, "warehouse 1 row untouched")
  assert.equal(qty(db, 2), 25)
  assert.equal(db.tables.inventory_audits.length, 1)
})

test("audit: an inventoryId that does not belong to the product is refused and nothing is written", async () => {
  const db = auditDb()
  const r = await audit([{ inventoryId: 3, productId: 7, systemQuantity: 5, physicalCount: 1 }])
  assert.equal(r.status, 400)
  assert.equal(qty(db, 3), 5)
  assert.equal(db.tables.inventory_audits.length, 0)
})

test("audit: a product-only adjustment for a product stocked in several warehouses is refused (nothing written)", async () => {
  const db = auditDb()
  const r = await audit([
    { productId: 8, systemQuantity: 5, physicalCount: 4 },
    { productId: 7, systemQuantity: 20, physicalCount: 10 },
  ])
  assert.equal(r.status, 400)
  assert.ok(r.body.error)
  assert.deepEqual([qty(db, 1), qty(db, 2), qty(db, 3)], [20, 30, 5])
  assert.equal(db.tables.inventory_audits.length, 0)
})

test("audit: a product-only adjustment still works when the product has a single inventory row", async () => {
  const db = auditDb()
  const r = await audit([{ productId: 8, systemQuantity: 5, physicalCount: 4 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(qty(db, 3), 4)
})

test("audit: the warehouseId path is unchanged (updates that product in that warehouse only)", async () => {
  const db = auditDb()
  const r = await audit([{ productId: 7, warehouseId: 1, systemQuantity: 20, physicalCount: 18 }])
  assert.equal(r.status, 200)
  assert.deepEqual([qty(db, 1), qty(db, 2)], [18, 30])
})

test("audit screen: counts are keyed by inventory row and the save sends inventoryId + warehouseId", () => {
  const src = readFileSync(join(ROOT, "components/modules/inventory-audit-module.tsx"), "utf8")
  assert.match(src, /inventoryId:\s*item\.inventory_id/)
  assert.match(src, /warehouseId:\s*item\.warehouse_id/)
  assert.doesNotMatch(src, /item\.product_id === productId/, "edits must not spread to the same product in other warehouses")
  assert.match(src, /handlePhysicalCountChange\(item\.inventory_id/)
  assert.match(src, /handleNotesChange\(item\.inventory_id/)
})

// ---------------------------------------------------------------------------------------------------------
// 3. An AP invoice with payments cannot be deleted
// ---------------------------------------------------------------------------------------------------------
const apInvoice = (invoice_id: number, paid_amount = 0, months_paid = 0): Row => ({
  invoice_id, invoice_number: `AP-${invoice_id}`, po_id: 40 + invoice_id, amount: 1000, paid_amount, months_paid, status: "pending",
})
const del = (id: number) => call(apRoute.DELETE, "DELETE", undefined, `http://test.local/api/accounts-payable?id=${id}`)

test("AP delete: an unpaid invoice is still deleted", async () => {
  const db = new FakeDb({ accounts_payable: [apInvoice(1), apInvoice(2)], supplier_payments: [], payment_schedules: [] })
  useDb(db)
  const r = await del(2)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { success: true })
  assert.deepEqual(db.tables.accounts_payable.map((x) => x.invoice_id), [1])
})

test("AP delete: refused with 409 when the invoice has a paid amount", async () => {
  const db = new FakeDb({ accounts_payable: [apInvoice(2, 250, 1)], supplier_payments: [], payment_schedules: [] })
  useDb(db)
  const r = await del(2)
  assert.equal(r.status, 409)
  assert.ok(r.body.error)
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("AP delete: refused with 409 when supplier payments reference the invoice", async () => {
  const db = new FakeDb({
    accounts_payable: [apInvoice(2)], supplier_payments: [{ payment_id: 1, invoice_id: 2, amount: 100 }], payment_schedules: [],
  })
  useDb(db)
  const r = await del(2)
  assert.equal(r.status, 409)
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("AP delete: refused with 409 when a payable schedule of the invoice has been (partly) paid", async () => {
  const db = new FakeDb({
    accounts_payable: [apInvoice(2)], supplier_payments: [],
    payment_schedules: [{ schedule_id: 1, invoice_id: 2, schedule_type: "payable", amount: 500, paid_amount: 100, status: "partial" }],
  })
  useDb(db)
  const r = await del(2)
  assert.equal(r.status, 409)
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("AP delete: an unpaid schedule, or a paid RECEIVABLE schedule sharing the id, does not block", async () => {
  const db = new FakeDb({
    accounts_payable: [apInvoice(2)], supplier_payments: [],
    payment_schedules: [
      { schedule_id: 1, invoice_id: 2, schedule_type: "payable", amount: 500, paid_amount: 0, status: "pending" },
      { schedule_id: 2, invoice_id: 2, schedule_type: "receivable", amount: 500, paid_amount: 500, status: "paid" },
    ],
  })
  useDb(db)
  const r = await del(2)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.accounts_payable.length, 0)
})

// ---------------------------------------------------------------------------------------------------------
// 4. Deterministic idempotency keys; DP approval key only completes once the permit is really approved
// ---------------------------------------------------------------------------------------------------------
test("idempotency keys: DP approval and PO receive keys are stable across calls", async () => {
  const a = generateDPApprovalIdempotencyKey(5)
  await new Promise((r) => setTimeout(r, 3))
  assert.equal(generateDPApprovalIdempotencyKey(5), a)
  assert.equal(a, "dp_approve_5")
  assert.equal(generatePOReceiveIdempotencyKey(9), "po_receive_9")
})

const dpDb = () => {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-1", customer_id: 5, status: "ready_for_delivery", fulfillment_status: "PENDING", total: 0 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 6, item_type: "stock", unit_price: 100, total: 600 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-1", sales_order_id: 1, customer_id: 5, status: "SUBMITTED_SIGNED" }],
    delivery_permit_items: [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "P7", quantity: 6, unit_price: 100, total: 600, warehouse_id: 1 }],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 20, is_returned: false, unit_cost: 50, reorder_point: 5 }],
    inventory_transactions: [], idempotency_log: [], workflow_events: [],
  })
  useDb(db)
  return db
}
const approve = () => call(dpRoute.PUT, "PUT", { permitId: "1", action: "APPROVE" })
const approvalLog = (db: FakeDb) => db.tables.idempotency_log.filter((l) => l.operation_type === "dp_approval")

test("DP approve: a second APPROVE of the same permit is reported as a duplicate (one approval record)", async () => {
  const db = dpDb()
  const first = await approve()
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const again = await approve()
  assert.equal(again.status, 200)
  assert.equal(again.body.isDuplicate, true)
  assert.equal(approvalLog(db).length, 1)
  assert.equal(approvalLog(db)[0].status, "completed")
})

test("DP approve: if saving the permit fails, the approval is not marked done and a retry approves it", async () => {
  const db = dpDb()
  db.failOn["delivery_permits:update"] = "db down"
  const failed = await approve()
  assert.equal(failed.status, 500)
  assert.notEqual(approvalLog(db)[0]?.status, "completed")
  assert.equal(db.tables.inventory[0].quantity, 20, "stock put back")
  delete db.failOn["delivery_permits:update"]
  const retry = await approve()
  assert.equal(retry.status, 200, JSON.stringify(retry.body))
  assert.notEqual(retry.body.isDuplicate, true)
  assert.equal(db.tables.delivery_permits[0].status, "APPROVED")
  assert.equal(db.tables.inventory[0].quantity, 14)
})

// ---------------------------------------------------------------------------------------------------------
// Review follow-ups: landed cost only on this PO's units still on hand; payment keys
// ---------------------------------------------------------------------------------------------------------
test("finalize: overhead goes only on this PO's units still on hand, not on stock received later from another PO", async () => {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "approved", total: 1000, cost_finalized: false }],
    purchase_order_items: [{ po_item_id: 1, po_id: 1, product_id: 7, quantity: 10, unit_price: 100, total: 1000, item_type: "stock" }],
    goods_receipts: [], goods_receipt_lines: [], inventory: [], inventory_batches: [],
    sales_orders: [], sales_order_items: [], idempotency_log: [],
  })
  useDb(db)
  const got = await call(grnRoute.POST, "POST", {
    poId: 1, receivedBy: 1, idempotencyKey: "lf-fifo-1", lines: [{ poItemId: 1, quantityReceived: 10, warehouseId: 1, unitCost: 100 }],
  })
  assert.equal(got.status, 200, JSON.stringify(got.body))
  const row = db.tables.inventory.find((r) => r.product_id === 7 && r.warehouse_id === 1)!
  // 9 of this PO's units were delivered (permit deduction lowers inventory only, never the batch) ...
  row.quantity = 1
  // ... then 10 more arrived from another PO at the same cost
  db.tables.inventory_batches.push({ batch_id: 900, product_id: 7, po_id: 99, warehouse_id: 1, quantity_received: 10, quantity_available: 10, unit_cost: 100, landed_cost_per_unit: 100, batch_sequence: 99 })
  row.quantity = 11
  const r = await call(finalizeRoute.POST, "POST", { poId: 1, taxAmount: 140, otherCosts: 0 }) // 14 / unit
  assert.equal(r.status, 200, JSON.stringify(r.body))
  // one unit of PO-1 is left: (11*100 + 14*1) / 11 = 101.27 (not (1100 + 140) / 11 = 112.73)
  assert.equal(row.unit_cost, 101.27)
})

const schedDb = () => {
  const db = new FakeDb({
    payment_schedules: [{ schedule_id: 1, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" }],
    accounts_receivable: [{ invoice_id: 5, amount: 300, collected_amount: 0, months_paid: 0, status: "pending" }],
    idempotency_log: [],
  })
  useDb(db)
  return db
}

test("payment: without a paymentDate the key uses today's date (not one key for every day)", async () => {
  const db = schedDb()
  const r = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 40, invoiceId: 5 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const today = new Date().toISOString().split("T")[0]
  const key = db.tables.idempotency_log.find((l) => l.operation_type === "payment")!.idempotency_key
  assert.match(String(key), new RegExp(`_${new Date(today).getTime()}_`))
})

test("payment: a retry after 'schedule paid, invoice not updated' does not pay the schedule again", async () => {
  const db = schedDb()
  db.failOn["accounts_receivable:update"] = "db down"
  const first = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 40, invoiceId: 5, paymentDate: "2026-10-01" })
  assert.equal(first.status, 500)
  assert.equal(first.body.schedulePaid, true)
  delete db.failOn["accounts_receivable:update"]
  const retry = await call(scheduleRoute.PUT, "PUT", { scheduleId: "1", paidAmount: 40, invoiceId: 5, paymentDate: "2026-10-01" })
  assert.equal(retry.body.isDuplicate, true, JSON.stringify(retry.body))
  assert.equal(db.tables.payment_schedules[0].paid_amount, 40)
})
