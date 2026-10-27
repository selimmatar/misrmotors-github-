// Returns are valued at cost, and credits are used while settling invoices.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { createReturn, previewReturnedItemCredit, processReturn, removeReturnedItem } from "../returns"

// ---------------------------------------------------------------------------------------------------------
// 1. A returned item is stored at what it cost us (the goods receipt), never its selling price
// ---------------------------------------------------------------------------------------------------------
// SO 1: 2 x Pump sold at 50,000; bought on PO 3 / GRN 4 at 30,000 each. DP 1 delivered both.
function costDb(withReceipt: boolean) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-C-1", customer_id: 5, status: "delivered", subtotal: 100000, discount_amount: 0, total: 114000, net_total: 114000 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 2, unit_price: 50000, total: 100000 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    warehouses: [{ warehouse_id: 1 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-C-1", sales_order_id: 1, customer_id: 5, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump", sku_snapshot: "P", quantity: 2, unit_price: 50000, total: 100000, supplier_id: null, outsourced_name: null }],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10 }],
    goods_receipt_lines: withReceipt ? [{ line_id: 1, receipt_id: 4, po_item_id: 9, product_id: 7, item_type: "stock", quantity_received: 2, unit_cost: 30000, source_so_item_id: 1 }] : [],
    goods_receipts: withReceipt ? [{ receipt_id: 4, grn_number: "GRN-4", po_id: 3 }] : [],
    purchase_orders: withReceipt ? [{ po_id: 3, po_number: "PO-3", supplier_id: 2, total: 68400 }] : [],
    purchase_order_items: [], accounts_payable: [],
    accounts_receivable: [], invoice_delivery_permits: [],
    product_returns: [], return_items: [], inventory_batches: [{ batch_id: 1, product_id: 7, unit_cost: 28000, received_date: "2026-09-01" }], idempotency_log: [], customer_credits: [],
  })
}
async function returnOne(db: FakeDb) {
  const created = await createReturn(db, { permitId: 1, idempotencyKey: `rc-${Math.random().toString(36).slice(2)}`, createdBy: "t", items: [{ productId: 7, productName: "Pump", quantityReturned: 1, reason: "wrong_item", condition: "good" }] })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const id = created.body.returnId
  const items = db.tables.return_items.filter((i: Row) => i.return_id === id)
  const res = await processReturn(db, { returnId: id, status: "completed", processedBy: "wh", warehouseAssignments: items.map((i: Row) => ({ returnItemId: i.return_item_id, warehouseId: 1 })) })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return items[0]
}

test("1. a returned pump sold at 50,000 and bought at 30,000 is stored and restocked at 30,000", async () => {
  const db = costDb(true)
  const item = await returnOne(db)
  assert.equal(item.unit_cost, 30000)
  const batch = db.tables.inventory_batches.find((b: Row) => b.batch_id !== 1)
  assert.equal(batch?.unit_cost, 30000)
})

test("1. with no goods receipt the return is valued at the latest stock cost, not the selling price", async () => {
  const db = costDb(false)
  const item = await returnOne(db)
  assert.equal(item.unit_cost, null)
  const batch = db.tables.inventory_batches.find((b: Row) => b.batch_id !== 1)
  assert.equal(batch?.unit_cost, 28000)
})

test("1. the write-off dialog preview shows the cost-based credit and changes nothing; the write-off records the same", async () => {
  const db = costDb(true)
  db.tables.goods_receipt_lines[0].quantity_received = 2
  db.tables.inventory_batches = []
  db.tables.supplier_credits = []
  db.tables.suppliers = [{ supplier_id: 2, supplier_name: "Supplier" }]
  await returnOne(db)
  const holding = db.tables.inventory.find((r: Row) => r.is_returned)!
  const before = JSON.stringify(db.tables)
  const preview = await previewReturnedItemCredit(db, { inventoryId: holding.inventory_id })
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.deepEqual([preview.body.unitCost, preview.body.amount], [30000, 30000])
  assert.equal(JSON.stringify(db.tables), before)
  const res = await removeReturnedItem(db, { inventoryId: holding.inventory_id, unitCost: 50000 })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.supplier_credits[0].amount, 30000)
})
