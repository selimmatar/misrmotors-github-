// Every sales order can be edited (Sales Rep / Admin / CEO), except cancelled and rejected ones. Items already on a delivery
// permit are locked: their product, quantity and price cannot change and the line cannot be removed. Extra quantity
// or a different item goes on a new line. A line with a return keeps the exchange rules of so-edit.test.ts.
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { validateSoEdit } from "../so-edit"
import { canEditSalesOrder, isLineLocked } from "../so-edit-eligibility"

test("A1. Sales Rep, Admin and CEO can edit an order in every status except cancelled / rejected", () => {
  const editable = ["draft", "pending_accountant", "accountant_approved", "ready_for_delivery", "shipped", "delivered"]
  for (const status of editable) {
    assert.equal(canEditSalesOrder("sales-rep", status), true, status)
    assert.equal(canEditSalesOrder("admin", status), true, status)
    assert.equal(canEditSalesOrder("ceo", status), true, status)
  }
  for (const status of ["cancelled", "rejected_quotation"]) {
    assert.equal(canEditSalesOrder("admin", status), false, status)
    assert.equal(canEditSalesOrder("ceo", status), false, status)
  }
  for (const role of ["accountant", "po-rep", "warehouse-rep"]) assert.equal(canEditSalesOrder(role, "draft"), false, role)
})

test("A2. a line on a delivery permit is locked unless it has a return (exchange)", () => {
  assert.equal(isLineLocked({ onDeliveryPermit: true, returnedQuantity: 0 }), true)
  assert.equal(isLineLocked({ onDeliveryPermit: true }), true)
  assert.equal(isLineLocked({ onDeliveryPermit: true, returnedQuantity: 2 }), false)
  assert.equal(isLineLocked({ onDeliveryPermit: false }), false)
  assert.equal(isLineLocked({}), false)
})

// SO 1: line 1 = 10 x Pump A (on DP 1), line 2 = 3 x Belt (not on a permit).
function db(permitStatus = "APPROVED") {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-1", customer_id: 5, status: "ready_for_delivery" }],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 10, unit_price: 100, total: 1000, item_type: "stock" },
      { so_item_id: 2, so_id: 1, product_id: 9, outsourced_name: null, quantity: 3, unit_price: 20, total: 60, item_type: "stock" },
    ],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-1", sales_order_id: 1, customer_id: 5, status: permitStatus }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", quantity: 10 }],
    product_returns: [],
    return_items: [],
  })
}
const A = (extra: Row = {}) => ({ id: "1", productId: "7", productName: "Pump A", quantity: 10, unitPrice: 100, total: 1000, ...extra })
const BELT = (extra: Row = {}) => ({ id: "2", productId: "9", productName: "Belt", quantity: 3, unitPrice: 20, total: 60, ...extra })
const NEW = { productId: "8", productName: "Pump B", quantity: 2, unitPrice: 150, total: 300 }

test("A3. the other lines stay editable and new lines can be added while the delivered line is unchanged", async () => {
  assert.deepEqual(await validateSoEdit(db(), 1, { items: [A(), BELT({ quantity: 5, unitPrice: 25, total: 125 }), NEW] }), { ok: true })
  assert.deepEqual(await validateSoEdit(db(), 1, { items: [A()] }), { ok: true }) // the Belt line removed
})

test("A4. the quantity or price of a line on a delivery permit cannot change", async () => {
  for (const change of [{ quantity: 12, total: 1200 }, { quantity: 8, total: 800 }, { unitPrice: 90, total: 900 }]) {
    const r = await validateSoEdit(db(), 1, { items: [A(change), BELT()] })
    assert.equal(r.ok, false, JSON.stringify(change))
    assert.equal((r as any).status, 409)
    assert.match((r as any).error, /"Pump A" is on a delivery permit of SO-1/)
  }
})

test("A5. a line on a permit that is not delivered yet is locked too, and cannot be removed", async () => {
  const changed = await validateSoEdit(db("PENDING"), 1, { items: [A({ quantity: 4, total: 400 }), BELT()] })
  assert.equal(changed.ok, false)
  const removed = await validateSoEdit(db("PENDING"), 1, { items: [BELT()] })
  assert.equal(removed.ok, false)
  assert.match((removed as any).error, /"Pump A" is on a delivery permit of SO-1/)
})
