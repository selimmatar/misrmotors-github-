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

// ---- review fix: rejecting a signed permit takes a "delivered" SO back ----
test("REJECT of the SUBMITTED_SIGNED permit that made the SO delivered: SO is no longer delivered", async () => {
  const db = dpDb(
    [permit(1, "SUBMITTED_SIGNED")],
    [{ item_id: 1, permit_id: 1, product_id: 7, quantity: 10 }],
  )
  db.tables.sales_orders[0].status = "delivered"
  db.tables.sales_orders[0].fulfillment_status = "DELIVERED"
  const r = await put(1, "REJECT", { rejectionReason: "wrong goods" })
  assert.equal(r.status, 200)
  assert.equal(st(db), "REJECTED")
  assert.equal(db.tables.sales_orders[0].status, "ready_for_delivery")
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "READY_FOR_PICKUP")
})

test("REJECT of one of two delivered permits: SO falls back to PARTIALLY_DELIVERED", async () => {
  const db = dpDb(
    [permit(1, "SUBMITTED_SIGNED"), permit(2, "APPROVED")],
    [{ item_id: 1, permit_id: 1, product_id: 7, quantity: 5 }, { item_id: 2, permit_id: 2, product_id: 7, quantity: 5 }],
  )
  db.tables.sales_orders[0].status = "delivered"
  db.tables.sales_orders[0].fulfillment_status = "DELIVERED"
  await put(1, "REJECT", { rejectionReason: "x" })
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "PARTIALLY_DELIVERED")
})

// Customers tab: an order invoiced per delivery permit is only paid when the collected sum covers the ORDER total,
// and an order with some (not all) lines delivered shows "partially delivered".
test("customer order payment sums every invoice and measures against the order total", async () => {
  const { orderPayment } = await import("../customer-order-status")
  const p = orderPayment({ total: 2418232.83 }, [{ amount: 1524944.28, collectedAmount: 1524944.28 }])
  assert.equal(p.status, "partially_paid"); assert.equal(p.amountDue, 893288.55); assert.equal(p.totalAmount, 2418232.83)
  const two = orderPayment({ total: 300 }, [{ amount: 100, collectedAmount: 100 }, { amount: 200, collectedAmount: 200 }])
  assert.equal(two.status, "paid"); assert.equal(two.amountDue, 0)
  assert.equal(orderPayment({ total: 300 }, [{ amount: 100, collectedAmount: 0 }]).status, "unpaid")
  assert.equal(orderPayment({ total: 300 }, []).status, "no_invoice")
  assert.equal(orderPayment({ total: 0.3 }, [{ amount: 0.3, collectedAmount: 0.1 }, { amount: 0, collectedAmount: 0.2 }]).status, "paid")
})

test("customer order shows partially delivered when only some lines are delivered", async () => {
  const { orderDisplayStatus } = await import("../customer-order-status")
  const items = (...s: (string | null)[]) => s.map((deliveryState) => ({ deliveryState }))
  assert.equal(orderDisplayStatus({ status: "ready_for_delivery", items: items("delivered", "not_delivered") }), "partially_delivered")
  assert.equal(orderDisplayStatus({ status: "ready_for_delivery", items: items("partial") }), "partially_delivered")
  assert.equal(orderDisplayStatus({ status: "ready_for_delivery", items: items("not_delivered", null) }), "ready_for_delivery")
  assert.equal(orderDisplayStatus({ status: "delivered", items: items("delivered") }), "delivered")
  assert.equal(orderDisplayStatus({ status: "approved", items: [] }), "approved")
})

test("sales order screen: a draft or pending DP is not a delivery", async () => {
  const { soDeliveryLabel } = await import("../customer-order-status")
  const items = (...s: (string | null)[]) => s.map((deliveryState) => ({ deliveryState }))
  const dp = [{ permitId: 1 }]
  // A DP exists but nothing on it has been approved/delivered yet (owner, 2026-11-04: SO-2026-742962).
  assert.equal(soDeliveryLabel({ status: "accountant_approved", items: items("not_delivered", "not_delivered"), deliveryPermits: dp }), "not_delivered")
  assert.equal(soDeliveryLabel({ status: "accountant_approved", items: items("not_delivered") }), "not_delivered")
  assert.equal(soDeliveryLabel({ status: "ready_for_delivery", items: items("delivered", "not_delivered"), deliveryPermits: dp }), "partially_delivered")
  assert.equal(soDeliveryLabel({ status: "ready_for_delivery", items: items("partial"), deliveryPermits: dp }), "partially_delivered")
  assert.equal(soDeliveryLabel({ status: "delivered", items: items("delivered"), deliveryPermits: dp }), "delivered")
})

test("sales order screen shows the delivery label from delivered lines, not from DP count", () => {
  const fs = require("node:fs") as typeof import("node:fs")
  const src = fs.readFileSync(require("node:path").join(process.env.REPO_ROOT || process.cwd(), "components/modules/sales-order-module.tsx"), "utf8")
  assert.match(src, /soDeliveryLabel\(/)
  assert.doesNotMatch(src, /if \(deliveryPermits\.length === 0\) return "not_delivered"/)
})

test("customers tab uses every invoice per order and the derived order status", () => {
  const fs = require("node:fs") as typeof import("node:fs")
  const src = fs.readFileSync(require("node:path").join(process.env.REPO_ROOT || "", "components/modules/customer-module.tsx"), "utf8")
  assert.match(src, /orderPayment\(order, orderInvoices\[order\.id\] \|\| \[\]\)/)
  assert.match(src, /\(invoiceMap\[inv\.soId\] \|\|= \[\]\)\.push\(inv\)/)
  assert.match(src, /orderDisplayStatus\(order\)/)
})

test("POST: a returned / refused quantity can go out again on a new permit (10 ordered, 10 sent, 4 returned -> 4 more ok, 5 not)", async () => {
  const db = dpDb([permit(1, "APPROVED")], [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "P7", quantity: 10 }])
  db.tables.product_returns = [{ return_id: 1, permit_id: "1", status: "received", created_at: "2026-11-10T00:00:00Z" }]
  db.tables.return_items = [{ return_item_id: 1, return_id: 1, product_id: 7, product_name: "P7", returned_quantity: 4 }]
  const over = await post([{ productId: "7", productName: "P7", quantity: 5, unitPrice: 1, total: 5 }])
  assert.equal(over.status, 409)
  assert.deepEqual(over.body.lines, [{ productId: 7, ordered: 10, alreadyOnPermits: 6, requested: 5, remaining: 4 }])
  const ok = await post([{ productId: "7", productName: "P7", quantity: 4, unitPrice: 1, total: 4 }])
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
})

// ---- stock leaves when the customer SIGNS (owner rule, 2026-11-12) ----
const signedItem = (qty: number) => [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "P7", quantity: qty, warehouse_id: 1 }]
test("SIGN: stock leaves when the permit is signed; approving later does not take it again", async () => {
  const db = dpDb([permit(1, "OUT_FOR_DELIVERY")], signedItem(5))
  const signed = await put(1, "MARK_SUBMITTED_SIGNED")
  assert.equal(signed.status, 200, JSON.stringify(signed.body))
  assert.equal(st(db), "SUBMITTED_SIGNED")
  assert.equal(db.tables.inventory[0].quantity, 45)
  assert.ok(db.tables.inventory_transactions.some((t: Row) => t.transaction_type === "sale" && t.quantity_change === -5))
  const approved = await put(1, "APPROVE")
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  assert.equal(st(db), "APPROVED")
  assert.equal(db.tables.inventory[0].quantity, 45, "not taken twice")
})

test("SIGN then REJECT: the stock taken at signing goes back to the same row, logged as a return", async () => {
  const db = dpDb([permit(1, "OUT_FOR_DELIVERY")], signedItem(5))
  assert.equal((await put(1, "MARK_SUBMITTED_SIGNED")).status, 200)
  const r = await put(1, "REJECT", { rejectionReason: "customer refused everything" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.stockPutBack, true)
  assert.equal(st(db), "REJECTED")
  assert.equal(db.tables.inventory[0].quantity, 50)
  assert.ok(db.tables.inventory_transactions.some((t: Row) => t.transaction_type === "return" && t.quantity_change === 5))
  // rejecting a permit that was never signed moves no stock
  const db2 = dpDb([permit(1, "OUT_FOR_DELIVERY")], signedItem(5))
  assert.equal((await put(1, "REJECT", { rejectionReason: "x" })).status, 200)
  assert.equal(db2.tables.inventory[0].quantity, 50)
})

test("SIGN: not enough stock refuses the signature and changes nothing", async () => {
  const db = dpDb([permit(1, "OUT_FOR_DELIVERY")], signedItem(60))
  const r = await put(1, "MARK_SUBMITTED_SIGNED")
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "INSUFFICIENT_STOCK")
  assert.equal(st(db), "OUT_FOR_DELIVERY")
  assert.equal(db.tables.inventory[0].quantity, 50)
})

test("SIGN: a permit signed BEFORE this change (no stock taken yet) still has its stock taken when approved", async () => {
  const db = dpDb([permit(1, "SUBMITTED_SIGNED")], signedItem(5))
  assert.equal((await put(1, "APPROVE")).status, 200)
  assert.equal(db.tables.inventory[0].quantity, 45)
})

test("DP review window: Approve / Reject for the accountant, admin and CEO; both windows show what was returned; errors show the reason", () => {
  const fs = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  const read = (f: string) => fs.readFileSync(path.join(process.env.REPO_ROOT || process.cwd(), f), "utf8")
  const mod = read("components/modules/delivery-permits-module.tsx")
  assert.match(mod, /permitToReview && canApprove && permitToReview\.status === "SUBMITTED_SIGNED" && \(\s*<ApproveRejectControls/)
  assert.match(mod, /onApprove=\{\(\) => reviewAction\("APPROVE"\)\}/)
  assert.match(mod, /alert\(body\.error \|\| t\("message\.error"\)\)/)
  const card = read("components/delivery-permit/delivery-permit-card.tsx")
  assert.match(card, /\(item as any\)\.returnedQuantity\) > 0/)
  assert.match(card, /alert\(errorData\.error \|\| t\("message\.error"\)\)/)
})

test("approval lock: a numeric user id (\"6\") is not written to the uuid column (it made approving fail)", async () => {
  const { asUuid } = await import("../idempotency")
  assert.equal(asUuid("6"), null)
  assert.equal(asUuid(6), null)
  assert.equal(asUuid(undefined), null)
  assert.equal(asUuid("1b4e28ba-2fa1-11d2-883f-0016d3cca427"), "1b4e28ba-2fa1-11d2-883f-0016d3cca427")
  // approving a signed permit with a numeric user id works end to end
  const db = dpDb([permit(1, "SUBMITTED_SIGNED")], signedItem(5))
  const r = await put(1, "APPROVE", { userId: "6" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(st(db), "APPROVED")
  assert.ok(db.tables.idempotency_log.every((row: Row) => row.user_id == null), "no numeric id in the uuid column")
})

test("approve: the approver is written to approved_by (a known user) and never as a number into the uuid column", async () => {
  let db = dpDb([permit(1, "SUBMITTED_SIGNED")], signedItem(5))
  db.tables.users.push({ user_id: 6 })
  let r = await put(1, "APPROVE", { userId: "6" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.tables.delivery_permits[0]
  assert.deepEqual([row.status, row.approved_by, row.approved_by_user_id ?? null], ["APPROVED", 6, null])
  // an unknown user id is left empty instead of failing the save
  db = dpDb([permit(1, "OUT_FOR_DELIVERY")], signedItem(5))
  r = await put(1, "MARK_SUBMITTED_SIGNED", { userId: "99" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.delivery_permits[0].submitted_signed_by ?? null, null)
  assert.doesNotMatch(require("node:fs").readFileSync(require("node:path").join(process.env.REPO_ROOT || process.cwd(), "app/api/delivery-permits/route.ts"), "utf8"), /approved_by_user_id = userId \? Number\.parseInt/)
})
