// Go-live fixes: problems found by the go-live review that staff would hit through the normal screens.
// Real route handlers on the in-memory FakeDb; screen checks read the component source.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as soRoute from "../../app/api/sales-orders/route"

const ROOT = process.env.REPO_ROOT || join(__dirname, "../../../..")
const src = (file: string) => readFileSync(join(ROOT, file), "utf8")

// ---------------------------------------------------------------------------------------------------------
// 1. Removing a discount on an order is saved
// ---------------------------------------------------------------------------------------------------------
function discountedSoDb() {
  const db = new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-GL-1", customer_id: 5, status: "accountant_approved", total: 102600, net_total: 102600, subtotal: 90000, discount_type: "fixed", discount_value: 10000, discount_amount: 10000, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 1 },
    ],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, unit_price: 10000, total: 100000, item_type: "stock" }],
    delivery_permits: [], delivery_permit_items: [], inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 50 }],
    accounts_receivable: [], invoice_delivery_permits: [],
  })
  useDb(db)
  return db
}
const soEdit = (extra: Row) => ({
  so_id: 1, customerId: "5", payment_type: "bank_transfer", paymentDetails: { paymentType: "bank_transfer" },
  items: [{ id: "1", productId: "7", productName: "Pump A", quantity: 10, unitPrice: 10000, total: 100000, itemType: "stock" }],
  ...extra,
})

test("1. setting the discount back to none saves discount_amount 0 and discount_value 0", async () => {
  const db = discountedSoDb()
  const res = await call(soRoute.PUT, "PUT", soEdit({ subtotal: 100000, total: 114000, discountType: "none", discountValue: 0, discountAmount: 0 }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const so = db.tables.sales_orders[0]
  assert.equal(so.discount_type, "none")
  assert.equal(so.discount_amount, 0)
  assert.equal(so.discount_value, 0)
  assert.equal(so.net_total, 114000)
})

test("1. an edit that does not mention the discount leaves it as it was", async () => {
  const db = discountedSoDb()
  const res = await call(soRoute.PUT, "PUT", { so_id: 1, notes: "call before delivery" })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const so = db.tables.sales_orders[0]
  assert.equal(so.discount_amount, 10000)
  assert.equal(so.discount_value, 10000)
  assert.equal(so.discount_type, "fixed")
})

// ---------------------------------------------------------------------------------------------------------
// 2. A save the server rejects is reported, not shown as saved
// ---------------------------------------------------------------------------------------------------------
const fnBody = (source: string, name: string) => {
  const start = source.indexOf(`const ${name} = async`)
  assert.ok(start >= 0, `${name} not found`)
  const next = source.indexOf("\n  const ", start + 10)
  return source.slice(start, next < 0 ? undefined : next)
}

test("2. every add/update/delete of customers, suppliers, products and stock items checks the server's answer", () => {
  const ctx = src("lib/app-context.tsx")
  for (const name of [
    "addCustomer", "updateCustomer", "deleteCustomer", "addSupplier", "updateSupplier", "deleteSupplier",
    "addProduct", "updateProduct", "deleteProduct", "addInventoryItem", "updateInventoryItem",
    "addCustomerInvoice", "updateCustomerInvoice",
  ]) {
    const body = fnBody(ctx, name)
    assert.match(body, /await ensureOk\(response,/, `${name} ignores a rejected save`)
    assert.doesNotMatch(body, /\n\s+await fetch\(/, `${name} still has a bare fetch`)
  }
})

test("2. the customer, supplier and product forms show the reason and stay open when a save is refused", () => {
  const customer = src("components/modules/customer-module.tsx")
  assert.match(customer, /await addCustomer\(newCustomer\)\n    \} catch \(error\) \{\n      alert\(fill\(t\("message\.not-saved"\)/)
  const supplier = src("components/modules/supplier-module.tsx")
  assert.match(supplier, /const handleSubmit = async/)
  assert.match(supplier, /await addSupplier\(newSupplier[^\n]*\n    \} catch \(error\) \{\n      alert\(fill\(t\("message\.not-saved"\)/)
  assert.match(supplier, /t\("message\.not-deleted"\)/)
  const product = src("components/modules/product-module.tsx")
  assert.match(product, /await addProduct\(newProduct\)\n    \} catch \(error\) \{\n      alert\(fill\(t\("message\.not-saved"\)/)
  assert.match(product, /await deleteProduct\(id\)\n      \} catch \(error\) \{\n        alert\(fill\(t\("message\.not-deleted"\)/)
})
