// Tests that call the REAL route handlers (no mirrored logic): PUT /api/sales-orders, /api/returns,
// /api/delivery-permits, /api/accounts-receivable/create-from-dps and create-from-so, /api/inventory/restock-returned
// and remove-returned. Only the database client is replaced (in-memory FakeDb, see route-harness.ts).
// Run with lib/__tests__/run-tests.sh.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as soRoute from "../../app/api/sales-orders/route"
import * as returnsRoute from "../../app/api/returns/route"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as fromDps from "../../app/api/accounts-receivable/create-from-dps/route"
import * as fromSo from "../../app/api/accounts-receivable/create-from-so/route"
import * as restockRoute from "../../app/api/inventory/restock-returned/route"
import * as removeRoute from "../../app/api/inventory/remove-returned/route"

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

// SO 1: 10 x Pump A (product 7 @ 10,000) = 100,000 (+14% VAT = 114,000), delivered on DP 1 (APPROVED).
function baseDb(extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "delivered", fulfillment_status: "DELIVERED", total: 114000, net_total: 114000, subtotal: 100000, discount_amount: 0, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 1, notes: "original notes" },
    ],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }, { customer_id: 6, customer_name: "Other Customer" }],
    warehouses: [{ warehouse_id: 1 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 10, unit_price: 10000, total: 100000, item_type: "stock" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-T-1", sales_order_id: 1, customer_id: 5, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", sku_snapshot: "A", quantity: 10, unit_price: 10000, total: 100000, supplier_id: null, outsourced_name: null }],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 5, unit_cost: 5000, reorder_point: 10 }],
    invoice_delivery_permits: [],
    accounts_receivable: [],
    ...extra,
  })
  useDb(db)
  return db
}

let k = 0
const key = () => `route-test-key-${++k}-${Math.random().toString(36).slice(2, 8)}`
const returnBody = (qty: number, extra: Row = {}) => ({
  permitId: 1,
  idempotencyKey: key(),
  createdBy: "tester",
  items: [{ productId: 7, productName: "Pump A", quantityReturned: qty, reason: "wrong_item", condition: "good" }],
  ...extra,
})
const postReturn = (body: any) => call(returnsRoute.POST, "POST", body)
const lineA = (quantity: number, extra: Row = {}) => ({ id: "1", productId: "7", productName: "Pump A", quantity, unitPrice: 10000, total: quantity * 10000, itemType: "stock", ...extra })
const lineB = (quantity: number) => ({ productId: "8", productName: "Pump B", quantity, unitPrice: 12000, total: quantity * 12000, itemType: "stock" })

// The payload app-context's updateSalesOrder sends for the "Edit order" dialog.
function editPayload(items: any[], extra: Row = {}) {
  const subtotal = items.reduce((s, i) => s + i.total, 0)
  return {
    so_id: 1,
    status: "delivered",
    notes: "original notes",
    payment_type: "bank_transfer",
    total: round2(subtotal * 1.14),
    customerId: "5",
    deliveryAddress: "Cairo",
    deliveryContactName: "Contact",
    deliveryContactPhone: "0100",
    items,
    subtotal,
    discountType: "none",
    discountValue: 0,
    discountAmount: 0,
    paymentTerms: "prepaid",
    installments: 1,
    paymentDetails: { paymentType: "bank_transfer" },
    ...extra,
  }
}
const putSo = (payload: any) => call(soRoute.PUT, "PUT", payload)
const dpIds = (db: FakeDb) => db.tables.delivery_permits.map((p) => p.permit_id)
const order = (db: FakeDb) => db.tables.sales_orders[0]
const snapshotHistory = (db: FakeDb) =>
  JSON.stringify({
    returns: db.tables.product_returns,
    returnItems: db.tables.return_items,
    // invoicing adds the back-compat delivery_permits.invoice_id link; that is not part of the delivery history
    dp1: db.tables.delivery_permits.filter((p) => p.permit_id === 1).map(({ invoice_id: _link, ...rest }) => rest),
    dp1Items: db.tables.delivery_permit_items.filter((i) => i.permit_id === 1),
    lineA: db.tables.sales_order_items.find((r) => r.so_item_id === 1)!.product_id,
  })

// A delivery permit for the replacement item B, created through the real endpoint and walked to APPROVED.
async function replacementDp(db: FakeDb, upTo: "DRAFT" | "SUBMITTED_SIGNED" | "APPROVED" = "APPROVED") {
  const created = await call(dpRoute.POST, "POST", {
    salesOrderId: "1",
    customerId: "5",
    recipientName: "Contact",
    recipientPhone: "0100",
    deliveryAddress: "Cairo",
    createdBy: "tester",
    items: [{ productId: "8", productName: "Pump B", sku: "B", quantity: 2, unitPrice: 12000, total: 24000 }],
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const permitId = Number(created.body.id)
  const steps = upTo === "DRAFT" ? [] : upTo === "SUBMITTED_SIGNED" ? ["MARK_READY_FOR_PICKUP", "MARK_OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED"] : ["MARK_READY_FOR_PICKUP", "MARK_OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED", "APPROVE"]
  for (const action of steps) {
    const res = await call(dpRoute.PUT, "PUT", { permitId: String(permitId), action, userId: "1", driverName: "Driver" })
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(res.body)}`)
  }
  return permitId
}

// ---------------------------------------------------------------------------------------------------------
// 1. Exchange on the SAME order, end to end through the real endpoints
// ---------------------------------------------------------------------------------------------------------
test("ROUTE. return 2 of 10, then edit the SAME order (10 -> 8 + 2 replacement), new DP, invoices - all through the real endpoints", async () => {
  const db = baseDb()

  // 1) the return, through POST /api/returns: linked to the real DP and SO; the order's current total follows it
  const ret = await postReturn(returnBody(2))
  assert.equal(ret.status, 200, JSON.stringify(ret.body))
  assert.equal(order(db).net_total, round2(80000 * 1.14)) // current SO = 8 x 10,000 (+VAT), not the gross 100,000
  assert.equal(order(db).total, 114000) // the ordered value of the lines is unchanged
  const afterReturn = snapshotHistory(db)

  // 2) PUT /api/sales-orders: lower A to the 8 kept, add 2 x B (EGP 12,000)
  const edit = await putSo(editPayload([lineA(8), lineB(2)]))
  assert.equal(edit.status, 200, JSON.stringify(edit.body))
  assert.equal(edit.body.success, true)
  assert.equal(db.tables.sales_orders.length, 1) // no new sales order
  assert.equal(order(db).so_id, 1) // same SO id
  const items = db.tables.sales_order_items
  assert.equal(items.length, 2)
  assert.deepEqual([items[0].so_item_id, items[0].product_id, items[0].quantity], [1, 7, 8]) // original line kept, lowered
  assert.deepEqual([items[1].product_id, items[1].quantity, items[1].unit_price], [8, 2, 12000]) // replacement
  assert.equal(order(db).total, round2(104000 * 1.14)) // 8 x 10,000 + 2 x 12,000 (+VAT)
  assert.equal(order(db).net_total, round2(104000 * 1.14)) // current SO = 104,000 (+VAT)
  assert.deepEqual([order(db).status, order(db).fulfillment_status], ["ready_for_delivery", "PARTIALLY_DELIVERED"]) // B still to ship
  // the original return, DP 1, its items and the Pump A line identity are exactly as they were
  assert.equal(snapshotHistory(db), afterReturn)
  const returnRow = db.tables.product_returns[0]
  assert.deepEqual([returnRow.so_id, returnRow.permit_id, returnRow.status], [1, "1", "pending_warehouse"])
  const returnItem = db.tables.return_items[0]
  assert.deepEqual([returnItem.product_id, returnItem.product_name, returnItem.returned_quantity, returnItem.unit_cost], [7, "Pump A", 2, 10000]) // item, quantity, value

  // 3) the replacement flows into a NEW delivery permit of the same order (real POST + status actions)
  const dp2 = await replacementDp(db)
  assert.deepEqual(dpIds(db), [1, dp2])
  assert.equal(db.tables.delivery_permits.find((p) => p.permit_id === dp2)!.sales_order_id, 1)
  assert.equal(db.tables.delivery_permits.find((p) => p.permit_id === 1)!.status, "APPROVED") // original DP untouched
  assert.deepEqual([order(db).status, order(db).fulfillment_status], ["delivered", "DELIVERED"]) // fully delivered again

  // 4) invoices: the kept A and the replacement B, never the returned pumps
  const invA = await call(fromDps.POST, "POST", { permit_ids: [1] })
  assert.equal(invA.status, 200, JSON.stringify(invA.body))
  assert.equal(invA.body.invoices[0].amount, round2(8 * 10000 * 1.14))
  const invB = await call(fromDps.POST, "POST", { permit_ids: [dp2] })
  assert.equal(invB.status, 200, JSON.stringify(invB.body))
  assert.equal(invB.body.invoices[0].amount, round2(2 * 12000 * 1.14))
  assert.equal(round2(db.tables.accounts_receivable.reduce((s, i) => s + i.amount, 0)), order(db).net_total) // invoices add up to the current SO total
  assert.equal(snapshotHistory(db), afterReturn) // and still nothing in the history moved
})

test("ROUTE. keeping Pump A at 10 and adding B gives the same current total and the same whole-order invoice", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(2))).status, 200)
  const edit = await putSo(editPayload([lineA(10), lineB(2)]))
  assert.equal(edit.status, 200, JSON.stringify(edit.body))
  assert.equal(order(db).total, round2(124000 * 1.14)) // lines, gross
  assert.equal(order(db).net_total, round2(104000 * 1.14)) // current SO: the 2 returned pumps are not counted
  const invoice = await call(fromSo.POST, "POST", { so_id: 1 })
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body))
  assert.equal(invoice.body.amount, round2(104000 * 1.14))
})

test("ROUTE. whole-order invoice after a return on the real endpoint: the returned quantity is not charged", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(2))).status, 200)
  const invoice = await call(fromSo.POST, "POST", { so_id: 1 })
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body))
  assert.equal(invoice.body.amount, round2(80000 * 1.14)) // 91,200 instead of 114,000
  assert.equal(order(db).total, 114000) // the order's lines are untouched
  // a second whole-order invoice is still refused
  assert.equal((await call(fromSo.POST, "POST", { so_id: 1 })).status, 409)
})

// ---------------------------------------------------------------------------------------------------------
// 2. Invalid edits are refused by the server and change nothing
// ---------------------------------------------------------------------------------------------------------
test("ROUTE. PUT refuses invalid edits server-side and writes nothing", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(2))).status, 200)
  const before = JSON.stringify({ order: db.tables.sales_orders, items: db.tables.sales_order_items, permits: db.tables.delivery_permits })

  const cases: [string, any, RegExp][] = [
    ["quantity below what the customer keeps", editPayload([lineA(7), lineB(2)], { notes: "should not be saved" }), /8 are kept by the customer \(delivered 10, returned 2\)/],
    ["quantity of the kept item set to 0", editPayload([lineA(0), lineB(2)]), /8 are kept/],
    ["a delivered line removed", editPayload([lineB(2)]), /cannot be removed/],
    ["a delivered line overwritten by another item", editPayload([lineA(10, { productId: "8", productName: "Pump B", unitPrice: 12000, total: 120000 })]), /cannot be turned into a different item/],
    ["customer changed after permits exist", editPayload([lineA(8), lineB(2)], { customerId: "6" }), /customer .* cannot be changed/],
  ]
  for (const [label, payload, pattern] of cases) {
    const res = await putSo(payload)
    assert.equal(res.status, 409, label)
    assert.match(res.body.error, pattern, label)
    assert.equal(JSON.stringify({ order: db.tables.sales_orders, items: db.tables.sales_order_items, permits: db.tables.delivery_permits }), before, `${label}: nothing may change`)
  }
  // and a valid edit afterwards still works
  assert.equal((await putSo(editPayload([lineA(8), lineB(2)]))).status, 200)
})

test("ROUTE. a PUT with no delivery permits keeps the ordinary free editing; an unknown order is 404", async () => {
  const db = baseDb({ delivery_permits: [], delivery_permit_items: [] })
  const res = await putSo(editPayload([lineB(3)], { customerId: "6" }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(Number(order(db).customer_id), 6)
  assert.equal((await putSo(editPayload([lineA(1)], { so_id: 99 }))).status, 404)
})

test("ROUTE. an edit of the order's other fields (address, notes) after a return is allowed and does not touch the history", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(2))).status, 200)
  const before = snapshotHistory(db)
  const res = await putSo(editPayload([lineA(10)], { notes: "customer called", deliveryAddress: "New address" }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(order(db).notes, "customer called")
  assert.equal(snapshotHistory(db), before)
})

// ---------------------------------------------------------------------------------------------------------
// 3. Billing rules around the exchange
// ---------------------------------------------------------------------------------------------------------
test("ROUTE. invoice-BEFORE-return: the existing invoice never changes and the replacement is NOT billed (no override)", async () => {
  const db = baseDb()
  const original = await call(fromDps.POST, "POST", { permit_ids: [1] })
  assert.equal(original.status, 200)
  assert.equal(original.body.invoices[0].amount, 114000) // billed in full before the return
  assert.equal((await postReturn(returnBody(2))).status, 200)
  assert.equal(order(db).net_total, round2(80000 * 1.14)) // the order's current total follows the return ...
  assert.equal(db.tables.accounts_receivable[0].amount, 114000) // ... the invoice does not
  assert.equal((await putSo(editPayload([lineA(8), lineB(2)]))).status, 200)
  const dp2 = await replacementDp(db)
  for (const body of [{ permit_ids: [dp2] }, { permit_ids: [dp2], force: true, override: true, allowReplacement: true }]) {
    const res = await call(fromDps.POST, "POST", body)
    assert.equal(res.status, 409, JSON.stringify(body))
    assert.match(res.body.error, /would exceed sales order/)
  }
  assert.equal(db.tables.accounts_receivable.length, 1)
  assert.equal(db.tables.accounts_receivable[0].amount, 114000)
  assert.equal(db.tables.invoice_delivery_permits.some((l) => l.permit_id === dp2), false)
})

test("ROUTE. invoice-AFTER-return: the invoice is priced net and the replacement is billable", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(2))).status, 200)
  const first = await call(fromDps.POST, "POST", { permit_ids: [1] })
  assert.equal(first.body.invoices[0].amount, round2(8 * 10000 * 1.14))
  assert.equal((await putSo(editPayload([lineA(8), lineB(2)]))).status, 200)
  const dp2 = await replacementDp(db)
  const second = await call(fromDps.POST, "POST", { permit_ids: [dp2] })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.invoices[0].amount, round2(2 * 12000 * 1.14))
})

// ---------------------------------------------------------------------------------------------------------
// 4. Returns from OUT_FOR_DELIVERY and DELIVERED permits (real endpoint)
// ---------------------------------------------------------------------------------------------------------
test("ROUTE. returns are accepted from OUT_FOR_DELIVERY and delivered permits, refused from every other status", async () => {
  for (const [status, ok] of [["OUT_FOR_DELIVERY", true], ["SUBMITTED_SIGNED", true], ["APPROVED", true], ["DRAFT", false], ["READY_FOR_SHIPMENT", false], ["READY_FOR_PICKUP", false], ["PRINTED", false], ["REJECTED", false]] as const) {
    const db = baseDb()
    db.tables.delivery_permits[0].status = status
    const res = await postReturn(returnBody(1))
    assert.equal(res.status, ok ? 200 : 409, `${status}: ${JSON.stringify(res.body)}`)
    assert.equal((db.tables.product_returns || []).length, ok ? 1 : 0, status)
    if (ok) assert.deepEqual([db.tables.product_returns[0].permit_id, db.tables.product_returns[0].so_id], ["1", 1], status)
  }
})

test("ROUTE. validation, idempotency and over-return on the real POST /api/returns", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(11))).status, 409) // more than delivered
  assert.equal((await postReturn(returnBody(0))).status, 400)
  assert.equal((await postReturn(returnBody(-1))).status, 400)
  assert.equal((await postReturn({ ...returnBody(1), permitId: 999 })).status, 404)
  assert.equal((await postReturn({ ...returnBody(1), permitId: "RET-1790257022809" })).status, 400)
  assert.equal((await postReturn({ ...returnBody(1), items: [{ productId: 99, productName: "Nope", quantityReturned: 1 }] })).status, 400)
  assert.equal(db.tables.product_returns.length, 0)
  const body = returnBody(3)
  const first = await postReturn(body)
  const replay = await postReturn(body) // same key, same request
  assert.equal(first.status, 200)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.isDuplicate, true)
  assert.equal(replay.body.returnId, first.body.returnId)
  assert.equal(db.tables.product_returns.length, 1)
  assert.equal((await postReturn(returnBody(8))).status, 409) // 3 + 8 > 10
  assert.equal((await postReturn(returnBody(7))).status, 200) // exactly the rest
})

// ---------------------------------------------------------------------------------------------------------
// 5. Process / reject / restock / remove through the real endpoints
// ---------------------------------------------------------------------------------------------------------
const processBody = (db: FakeDb, returnId: number) => ({
  returnId,
  status: "completed",
  processedBy: "wh",
  warehouseAssignments: db.tables.return_items.filter((i) => i.return_id === returnId).map((i) => ({ returnItemId: i.return_item_id, warehouseId: 1 })),
})

test("ROUTE. process -> holding row -> restock once; duplicate process / restock add nothing", async () => {
  const db = baseDb()
  const { body } = await postReturn(returnBody(2))
  const first = await call(returnsRoute.PUT, "PUT", processBody(db, body.returnId))
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal((await call(returnsRoute.PUT, "PUT", processBody(db, body.returnId))).status, 409)
  const holding = db.tables.inventory.find((r) => r.is_returned)!
  assert.equal(holding.quantity, 2)
  assert.equal(db.tables.inventory.find((r) => r.inventory_id === 100)!.quantity, 5) // sellable stock untouched by the return
  assert.equal((await call(restockRoute.POST, "POST", { inventoryId: holding.inventory_id })).status, 200)
  assert.equal((await call(restockRoute.POST, "POST", { inventoryId: holding.inventory_id })).status, 404)
  assert.equal(db.tables.inventory.find((r) => r.inventory_id === 100)!.quantity, 7)
})

test("ROUTE. write-off through the real endpoint happens once", async () => {
  const db = baseDb()
  const { body } = await postReturn(returnBody(2))
  await call(returnsRoute.PUT, "PUT", processBody(db, body.returnId))
  const holding = db.tables.inventory.find((r) => r.is_returned)!
  const input = { inventoryId: holding.inventory_id, supplierNameId: 3, productName: "Pump A" }
  assert.equal((await call(removeRoute.POST, "POST", input)).status, 200)
  assert.equal((await call(removeRoute.POST, "POST", input)).status, 404)
  assert.equal(db.tables.supplier_credits.length, 1)
})

test("ROUTE. reject: valid and invalid transitions on the real PUT /api/returns; the order total follows", async () => {
  const db = baseDb()
  const { body } = await postReturn(returnBody(2))
  assert.equal(order(db).net_total, round2(80000 * 1.14))
  assert.equal((await call(returnsRoute.PUT, "PUT", { returnId: body.returnId, status: "rejected" })).status, 400) // reason required
  assert.equal((await call(returnsRoute.PUT, "PUT", { returnId: body.returnId, status: "rejected", reason: "no" })).status, 400)
  const ok = await call(returnsRoute.PUT, "PUT", { returnId: body.returnId, status: "rejected", reason: "Refusal withdrawn by the customer" })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(db.tables.product_returns[0].status, "rejected")
  assert.equal(db.tables.inventory.filter((r) => r.is_returned).length, 0) // no inventory
  assert.equal(order(db).net_total, 114000) // the rejected quantity counts again
  assert.equal((await call(returnsRoute.PUT, "PUT", { returnId: body.returnId, status: "rejected", reason: "second attempt" })).status, 409)
  assert.equal((await call(returnsRoute.PUT, "PUT", processBody(db, body.returnId))).status, 409) // cannot be processed afterwards
  assert.equal((await call(returnsRoute.PUT, "PUT", { returnId: body.returnId, status: "restocked" })).status, 400) // no arbitrary transitions
  assert.equal((await postReturn(returnBody(10))).status, 200) // the quantity is free again
})

// ---------------------------------------------------------------------------------------------------------
// 6. Concurrency through the real endpoints
// ---------------------------------------------------------------------------------------------------------
test("ROUTE (concurrency). parallel POST /api/returns never exceed the DP quantity and the order total converges", async () => {
  for (let run = 0; run < 25; run++) {
    const db = baseDb()
    const results = await Promise.all(Array.from({ length: 5 }, () => postReturn(returnBody(3))))
    const kept = db.tables.return_items.reduce((s, i) => s + i.returned_quantity, 0)
    assert.ok(kept <= 10 && kept >= 3, `run ${run}: returned ${kept} of 10`)
    assert.equal(results.filter((r) => r.status === 200).length, kept / 3, `run ${run}`)
    assert.ok(results.every((r) => r.status === 200 || r.status === 409), `run ${run}`)
    assert.equal(db.tables.product_returns.length, kept / 3) // losers left nothing behind
    // the stored current total equals the value of what was really returned (derived data converged)
    assert.equal(order(db).net_total, round2((100000 - kept * 10000) * 1.14), `run ${run}: net_total ${order(db).net_total} for ${kept} returned`)
  }
})

test("ROUTE (concurrency). parallel process requests: one wins; parallel restocks: one wins", async () => {
  for (let run = 0; run < 15; run++) {
    const db = baseDb()
    const { body } = await postReturn(returnBody(4))
    const processed = await Promise.all(Array.from({ length: 5 }, () => call(returnsRoute.PUT, "PUT", processBody(db, body.returnId))))
    assert.equal(processed.filter((r) => r.status === 200).length, 1, `run ${run}`)
    const holding = db.tables.inventory.find((r) => r.is_returned)!
    assert.equal(holding.quantity, 4)
    const restocked = await Promise.all(Array.from({ length: 5 }, () => call(restockRoute.POST, "POST", { inventoryId: holding.inventory_id })))
    assert.equal(restocked.filter((r) => r.status === 200).length, 1, `run ${run}`)
    assert.equal(db.tables.inventory.find((r) => r.inventory_id === 100)!.quantity, 9)
  }
})

test("ROUTE (concurrency). a reject racing a process has a single winner", async () => {
  for (let run = 0; run < 15; run++) {
    const db = baseDb()
    const { body } = await postReturn(returnBody(4))
    const [rej, proc] = await Promise.all([
      call(returnsRoute.PUT, "PUT", { returnId: body.returnId, status: "rejected", reason: "race reject" }),
      call(returnsRoute.PUT, "PUT", processBody(db, body.returnId)),
    ])
    assert.equal([rej, proc].filter((r) => r.status === 200).length, 1, `run ${run}: ${rej.status}/${proc.status}`)
    assert.equal(db.tables.inventory.filter((r) => r.is_returned).length, rej.status === 200 ? 0 : 1)
  }
})

test("ROUTE (concurrency). two parallel PUTs of the same order edit leave consistent lines (no duplicate replacement beyond what was sent)", async () => {
  const db = baseDb()
  assert.equal((await postReturn(returnBody(2))).status, 200)
  const results = await Promise.all([putSo(editPayload([lineA(8), lineB(2)])), putSo(editPayload([lineA(8), lineB(2)]))])
  assert.ok(results.every((r) => r.status === 200))
  assert.equal(db.tables.sales_order_items.find((r) => r.so_item_id === 1)!.quantity, 8)
  assert.equal(db.tables.sales_orders.length, 1)
})

// ---------------------------------------------------------------------------------------------------------
// 7. Historical returns stay untouched through all of the above
// ---------------------------------------------------------------------------------------------------------
test("ROUTE. historical returns (no SO / DP link) are never touched or counted", async () => {
  const historical = {
    product_returns: [
      { return_id: 1, permit_id: "RET-1788710867230", so_id: null, customer_id: 1, status: "received", so_number: "SO-OLD", customer_name: "Old", total_items_returned: 1, created_at: "2026-09-06T16:07:47+00:00" },
      { return_id: 4, permit_id: "RET-1790547338408", so_id: null, customer_id: 2, status: "pending_warehouse", so_number: "SO-OLD-4", customer_name: "Old", total_items_returned: 1, created_at: "2026-09-27T22:15:38+00:00" },
    ],
    return_items: [
      { return_item_id: 1, return_id: 1, product_id: 7, product_name: "Pump A", original_quantity: 40, returned_quantity: 2, return_reason: "wrong_item", item_condition: "good", restocked: true, unit_cost: 21600 },
      { return_item_id: 4, return_id: 4, product_id: 7, product_name: "Pump A", original_quantity: 1, returned_quantity: 1, return_reason: "damaged", item_condition: "good", restocked: false, unit_cost: 26000 },
    ],
    supplier_credits: [{ credit_id: 1, supplier_id: 1, amount: 4000, credit_type: "return", status: "active" }],
    inventory_batches: [{ batch_id: 5, product_id: 7, po_number: null, quantity_received: 2, quantity_available: 2, unit_cost: 21600, received_date: "2020-01-01", batch_sequence: 2, warehouse_id: 1, is_returned: true }],
  }
  const db = baseDb(historical)
  const keep = () => JSON.stringify({ r: db.tables.product_returns.filter((x) => x.return_id === 1 || x.return_id === 4), i: db.tables.return_items.filter((x) => x.return_item_id === 1 || x.return_item_id === 4), c: db.tables.supplier_credits.filter((x) => x.credit_id === 1), b: db.tables.inventory_batches.filter((x) => x.batch_id === 5) })
  const before = keep()
  const created = await postReturn(returnBody(10)) // all 10: the historical 2 + 1 returns do not count against DP 1
  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.equal(order(db).net_total, 0) // everything returned: nothing left to charge
  await call(returnsRoute.PUT, "PUT", processBody(db, created.body.returnId))
  const holding = db.tables.inventory.find((r) => r.is_returned)!
  await call(restockRoute.POST, "POST", { inventoryId: holding.inventory_id })
  await putSo(editPayload([lineA(0), lineB(10)]))
  assert.equal(keep(), before)
})
