// Returns are valued at cost, and credits are used while settling invoices.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { createReturn, previewReturnedItemCredit, processReturn, removeReturnedItem } from "../returns"
import { applySupplierCredits } from "../supplier-credit-ap-apply"

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

// ---------------------------------------------------------------------------------------------------------
// 3. A supplier credit is used while settling the supplier's invoice (AP): the supplier is paid less, no cash moves
// ---------------------------------------------------------------------------------------------------------
// APINV-PO-3: 100,000 owed to supplier 2 for PO 3. Supplier 2 has a 30,000 return credit; supplier 9 has one too.
function apDb(paid = 0) {
  return new FakeDb({
    accounts_payable: [{ invoice_id: 1, invoice_number: "APINV-PO-3", supplier_id: 2, po_id: 3, amount: 100000, paid_amount: paid, status: paid > 0 ? "partially_paid" : "pending", months_paid: 0 }],
    supplier_credits: [
      { credit_id: 1, supplier_id: 2, amount: 30000, credit_type: "return", reference_type: "inventory", reference_id: 50, status: "active", notes: null, created_at: "2026-10-01" },
      { credit_id: 2, supplier_id: 9, amount: 5000, credit_type: "return", status: "active", notes: null },
    ],
    supplier_payments: [], balance_entries: [], idempotency_log: [],
  })
}
const useCredits = (db: FakeDb, credits: any[], key = `ap-${Math.random().toString(36).slice(2)}`) =>
  applySupplierCredits(db, { invoiceId: 1, idempotencyKey: key, credits })

test("3. using a 30,000 supplier credit on a 100,000 supplier invoice leaves 70,000 to pay and moves no cash", async () => {
  const db = apDb()
  const res = await useCredits(db, [{ creditId: 1, amount: 30000 }])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const inv = db.tables.accounts_payable[0]
  assert.deepEqual([inv.paid_amount, inv.status], [30000, "partially_paid"])
  const credit = db.tables.supplier_credits.find((c: Row) => c.credit_id === 1)!
  assert.deepEqual([credit.status, credit.used_in_po_id], ["used", 3])
  assert.equal(db.tables.supplier_payments.length, 1)
  assert.deepEqual([db.tables.supplier_payments[0].payment_method, db.tables.supplier_payments[0].amount], ["supplier_credit", 30000])
  assert.equal(db.tables.balance_entries.length, 0)
})

test("3. using part of a supplier credit keeps the rest open", async () => {
  const db = apDb()
  assert.equal((await useCredits(db, [{ creditId: 1, amount: 10000 }])).status, 200)
  const open = db.tables.supplier_credits.filter((c: Row) => c.supplier_id === 2 && c.status === "active")
  assert.deepEqual(open.map((c: Row) => c.amount), [20000])
  assert.equal(db.tables.accounts_payable[0].paid_amount, 10000)
})

test("3. a credit settles the invoice in full when it covers the remaining balance", async () => {
  const db = apDb(70000)
  assert.equal((await useCredits(db, [{ creditId: 1, amount: 30000 }])).status, 200)
  assert.deepEqual([db.tables.accounts_payable[0].paid_amount, db.tables.accounts_payable[0].status], [100000, "paid"])
})

test("3. another supplier's credit, or more than is owed, is refused and nothing changes", async () => {
  const db = apDb(80000)
  const before = JSON.stringify(db.tables.accounts_payable) + JSON.stringify(db.tables.supplier_credits)
  assert.equal((await useCredits(db, [{ creditId: 2, amount: 5000 }])).status, 409)
  assert.equal((await useCredits(db, [{ creditId: 1, amount: 30000 }])).status, 409) // only 20,000 left to pay
  assert.equal(JSON.stringify(db.tables.accounts_payable) + JSON.stringify(db.tables.supplier_credits), before)
  assert.equal(db.tables.supplier_payments.length, 0)
})

test("3. the same request sent twice uses the credit once", async () => {
  const db = apDb()
  const key = "ap-same-key-123"
  assert.equal((await useCredits(db, [{ creditId: 1, amount: 30000 }], key)).status, 200)
  const again = await useCredits(db, [{ creditId: 1, amount: 30000 }], key)
  assert.equal(again.status, 200)
  assert.equal(again.body.isDuplicate, true)
  assert.equal(db.tables.accounts_payable[0].paid_amount, 30000)
  assert.equal(db.tables.supplier_payments.length, 1)
})

test("3. both payment windows offer the open credit; the supplier one goes to the AP credit route", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const src = (f: string) => readFileSync(`${process.env.REPO_ROOT || "."}/${f}`, "utf8")
  assert.match(src("components/modules/accounts-receivable-module.tsx"), /<UseCreditButton\s+party="customer"/)
  const ap = src("components/modules/accounts-payable-module.tsx")
  assert.match(ap, /<UseCreditButton\s+party="supplier"/)
  assert.match(ap, /<SupplierCreditDialog/)
  assert.match(src("components/payment/customer-credit-dialog.tsx"), /supplier: "\/api\/accounts-payable\/apply-credit"/)
  assert.match(src("app/api/accounts-payable/apply-credit/route.ts"), /applySupplierCredits/)
})
