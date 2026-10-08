// Workflow fixes: delivery-permit REJECT columns, DP transition guard, server-side DP quantity cap,
// sales-order reject status mapping, dead calls removed from sales-orders POST/PUT.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as soRoute from "../../app/api/sales-orders/route"
import { DP_ACTION_FROM, isAllowedDpTransition } from "../dp-transitions"

const ALL = ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "SUBMITTED_SIGNED", "APPROVED", "REJECTED"]
const permit = (permit_id: number, status: string, extra: Row = {}): Row => ({
  permit_id, permit_no: `DP-T-${permit_id}`, sales_order_id: 1, customer_id: 5, status, ...extra,
})
function dpDb(permits: Row[], items: Row[] = [], soLines: Row[] = [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, item_type: "stock" }]) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "accountant_approved", fulfillment_status: "PENDING", total: 0 }],
    sales_order_items: soLines,
    delivery_permits: permits,
    delivery_permit_items: items,
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 50, is_returned: false, unit_cost: 5 }],
    inventory_transactions: [], idempotency_log: [], workflow_events: [], users: [{ user_id: 3 }],
  })
  useDb(db)
  return db
}
const put = (permitId: number, action: string, extra: Row = {}) => call(dpRoute.PUT, "PUT", { permitId: String(permitId), action, ...extra })
const post = (items: Row[]) => call(dpRoute.POST, "POST", { salesOrderId: "1", customerId: "5", recipientName: "R", items })
const st = (db: FakeDb, id = 1) => db.tables.delivery_permits.find((p) => p.permit_id === id)!.status

// ---- 2. transition table (pure) ----
test("transition table: every action UI offers is allowed from the status the UI offers it in", () => {
  const ui: [string, string][] = [
    ["DRAFT", "MARK_READY_FOR_PICKUP"], ["DRAFT", "MARK_PRINTED"], ["DRAFT", "ALLOCATE_WAREHOUSES"],
    ["READY_FOR_SHIPMENT", "MARK_READY_FOR_PICKUP"], ["PRINTED", "MARK_OUT_FOR_DELIVERY"],
    ["READY_FOR_PICKUP", "MARK_OUT_FOR_DELIVERY"], ["OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED"],
    ["SUBMITTED_SIGNED", "APPROVE"], ["SUBMITTED_SIGNED", "REJECT"],
  ]
  for (const [from, action] of ui) assert.ok(isAllowedDpTransition(from, action), `${from} -> ${action}`)
})

test("transition table: skipping steps and leaving final states is refused", () => {
  assert.equal(isAllowedDpTransition("DRAFT", "APPROVE"), false)
  assert.equal(isAllowedDpTransition("DRAFT", "MARK_SUBMITTED_SIGNED"), false)
  assert.equal(isAllowedDpTransition("READY_FOR_PICKUP", "APPROVE"), false)
  assert.equal(isAllowedDpTransition("REJECTED", "APPROVE"), false)
  for (const s of ["REJECTED", "APPROVED"]) assert.equal(isAllowedDpTransition(s, "REJECT"), false)
  assert.equal(isAllowedDpTransition("DRAFT", "UPDATE_DETAILS"), true) // not guarded
  assert.deepEqual(Object.keys(DP_ACTION_FROM).sort(), ["ALLOCATE_WAREHOUSES", "APPROVE", "MARK_OUT_FOR_DELIVERY", "MARK_PRINTED", "MARK_READY_FOR_PICKUP", "MARK_SUBMITTED_SIGNED", "REJECT"])
})

test("PUT: a disallowed action returns 409 DP_INVALID_TRANSITION and changes nothing", async () => {
  const db = dpDb([permit(1, "DRAFT")])
  const r = await put(1, "APPROVE")
  assert.equal(r.status, 409)
  assert.deepEqual([r.body.code, r.body.from, r.body.action], ["DP_INVALID_TRANSITION", "DRAFT", "APPROVE"])
  assert.equal(st(db), "DRAFT")
  assert.equal(db.tables.workflow_events.length, 0)
  assert.equal(db.tables.inventory[0].quantity, 50)
})

test("PUT: the full happy path DRAFT -> ... -> APPROVED still works", async () => {
  const db = dpDb([permit(1, "DRAFT")], [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "P7", quantity: 4, warehouse_id: 1 }])
  for (const a of ["ALLOCATE_WAREHOUSES", "MARK_READY_FOR_PICKUP", "MARK_OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED", "APPROVE"]) {
    const r = await put(1, a, { userId: "3", allocations: [] })
    assert.equal(r.status, 200, `${a}: ${JSON.stringify(r.body)}`)
  }
  assert.equal(st(db), "APPROVED")
})

test("PUT: DP_ALREADY_APPROVED guard still wins on an APPROVED permit", async () => {
  dpDb([permit(1, "APPROVED")])
  const r = await put(1, "REJECT", { rejectionReason: "x" })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "DP_ALREADY_APPROVED")
})

// ---- 1. REJECT writes only real columns ----
test("REJECT from SUBMITTED_SIGNED: status REJECTED, rejected_at/reason/rejected_by set, no rejected_by_user_id", async () => {
  const db = dpDb([permit(1, "SUBMITTED_SIGNED")])
  const r = await put(1, "REJECT", { rejectionReason: "wrong goods", userId: "3" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.tables.delivery_permits[0]
  assert.equal(row.status, "REJECTED")
  assert.equal(row.rejection_reason, "wrong goods")
  assert.ok(row.rejected_at)
  assert.equal(row.rejected_by, 3)
  assert.ok(!("rejected_by_user_id" in row))
  assert.equal(db.tables.workflow_events.length, 1)
})

test("REJECT with an unknown user id does not write rejected_by (FK to users) but still rejects", async () => {
  const db = dpDb([permit(1, "OUT_FOR_DELIVERY")])
  const r = await put(1, "REJECT", { rejectionReason: "r", userId: "999" })
  assert.equal(r.status, 200)
  assert.equal(db.tables.delivery_permits[0].status, "REJECTED")
  assert.ok(!("rejected_by" in db.tables.delivery_permits[0]) || db.tables.delivery_permits[0].rejected_by == null)
})

test("REJECT is refused on an already REJECTED permit", async () => {
  dpDb([permit(1, "REJECTED")])
  const r = await put(1, "REJECT", { rejectionReason: "again" })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "DP_INVALID_TRANSITION")
})

test("all statuses covered by the table are real DB statuses", () => {
  for (const list of Object.values(DP_ACTION_FROM)) for (const s of list) assert.ok(ALL.includes(s), s)
})

// ---- 3. DP quantity cap ----
test("POST: second DP is capped by what earlier non-rejected permits already took (10 ordered, 6 used, 5 asked -> 409)", async () => {
  const db = dpDb([permit(1, "DRAFT")], [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "P7", quantity: 6 }])
  const r = await post([{ productId: "7", productName: "P7", quantity: 5, unitPrice: 1, total: 5 }])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "DP_OVER_QUANTITY")
  assert.deepEqual(r.body.lines, [{ productId: 7, ordered: 10, alreadyOnPermits: 6, requested: 5, remaining: 4 }])
  assert.equal(db.tables.delivery_permits.length, 1, "no permit created")
})

test("POST: exactly the remaining quantity is accepted; rejected permits free their quantity", async () => {
  const db = dpDb([permit(1, "DRAFT"), permit(2, "REJECTED")], [
    { item_id: 1, permit_id: 1, product_id: 7, quantity: 6 },
    { item_id: 2, permit_id: 2, product_id: 7, quantity: 4 },
  ])
  const r = await post([{ productId: "7", productName: "P7", quantity: 4, unitPrice: 1, total: 4 }])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.delivery_permits.length, 3)
})

test("POST: the same product twice in one request is summed against the cap", async () => {
  dpDb([])
  const r = await post([
    { productId: "7", productName: "P7", quantity: 6, unitPrice: 1, total: 6 },
    { productId: "7", productName: "P7", quantity: 6, unitPrice: 1, total: 6 },
  ])
  assert.equal(r.status, 409)
  assert.equal(r.body.lines[0].requested, 12)
})

test("POST: outsourced lines (no product id) are not capped", async () => {
  const db = dpDb([], [], [{ so_item_id: 2, so_id: 1, product_id: null, quantity: 1, outsourced_name: "Crane", item_type: "outsourced" }])
  const r = await post([{ productName: "Crane", supplierName: "S", quantity: 5, unitPrice: 1, total: 5 }])
  assert.equal(r.status, 200)
  assert.equal(db.tables.delivery_permits.length, 1)
})

// ---- 4. SO reject ----
function soDb(entity_type: string) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "pending_accountant", entity_type, total: 0 }],
    sales_order_items: [], delivery_permits: [], customers: [{ customer_id: 5, customer_name: "C" }],
  })
  useDb(db)
  return db
}
test("SO reject: a normal order is written as cancelled, never 'rejected'", async () => {
  const db = soDb("sales_order")
  const r = await call(soRoute.PUT, "PUT", { id: 1, status: "rejected", notes: "[Accountant Rejected] no" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.sales_orders[0].status, "cancelled")
})
test("SO reject: a quotation-type order becomes rejected_quotation", async () => {
  const db = soDb("quotation")
  const r = await call(soRoute.PUT, "PUT", { id: 1, status: "rejected" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.sales_orders[0].status, "rejected_quotation")
})
test("SO approve is unchanged (accountant_approved)", async () => {
  const db = soDb("sales_order")
  const r = await call(soRoute.PUT, "PUT", { id: 1, status: "accountant_approved" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.sales_orders[0].status, "accountant_approved")
})

// ---- 5. dead calls removed ----
test("SO PUT with quotationRequests no longer touches quotation_requests (table does not exist) and still succeeds", async () => {
  const db = soDb("sales_order")
  const r = await call(soRoute.PUT, "PUT", { id: 1, status: "pending_accountant", quotationRequests: [{ quotation_request_id: "Q1" }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.quotation_requests, undefined)
})
