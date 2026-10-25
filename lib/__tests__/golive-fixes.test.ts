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
import * as dpRoute from "../../app/api/delivery-permits/route"
import { planAllocation } from "../dp-allocate"
import * as maintApprove from "../../app/api/maintenance/reports/approve/route"
import * as maintInvoice from "../../app/api/maintenance/invoices/route"
import * as auditRoute from "../../app/api/inventory/audit/route"
import { createReturn, processReturn } from "../returns"
import { scheduleShare, scaleSchedule } from "../invoicing"
import { withoutVat, supplierAmountWithoutVat, supplierPaid, supplierUnpaid, profitMarginPercent } from "../dashboard-figures"

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

// ---------------------------------------------------------------------------------------------------------
// 3. A delivery split across warehouses takes each share from its own warehouse
// ---------------------------------------------------------------------------------------------------------
function splitDb(cairo = 6, alex = 10) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-GL-3", customer_id: 5, status: "accountant_approved", fulfillment_status: "NOT_STARTED", total: 114000, net_total: 114000, subtotal: 100000, discount_amount: 0, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 1 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    warehouses: [{ warehouse_id: 1, warehouse_name: "Cairo" }, { warehouse_id: 2, warehouse_name: "Alexandria" }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, unit_price: 10000, total: 100000, item_type: "stock" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-GL-1", sales_order_id: 1, customer_id: 5, status: "DRAFT" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", sku_snapshot: "A", quantity: 10, unit_price: 10000, total: 100000, supplier_id: null, outsourced_name: null }],
    inventory: [
      { inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: cairo, unit_cost: 5000 },
      { inventory_id: 101, product_id: 7, warehouse_id: 2, is_returned: false, quantity: alex, unit_cost: 5000 },
    ],
    idempotency_log: [], inventory_transactions: [], invoice_delivery_permits: [], accounts_receivable: [], product_returns: [], return_items: [],
  })
  useDb(db)
  return db
}
const dpPut = (body: Row) => call(dpRoute.PUT, "PUT", { permitId: "1", userId: "1", driverName: "Driver", ...body })
const qtyOf = (db: FakeDb, id: number) => db.tables.inventory.find((r) => r.inventory_id === id)!.quantity

test("3. 6 from Cairo + 4 from Alexandria: two permit lines, and approval takes 6 from Cairo and 4 from Alexandria", async () => {
  const db = splitDb()
  const alloc = await dpPut({ action: "ALLOCATE_WAREHOUSES", allocations: [{ itemId: 11, warehouseId: 1, quantity: 6 }, { itemId: 11, warehouseId: 2, quantity: 4 }] })
  assert.equal(alloc.status, 200, JSON.stringify(alloc.body))
  const lines = db.tables.delivery_permit_items.filter((i) => i.permit_id === 1)
  assert.deepEqual(lines.map((l) => [l.warehouse_id, l.quantity, l.total]).sort(), [[1, 6, 60000], [2, 4, 40000]])
  assert.equal(lines.reduce((s, l) => s + l.total, 0), 100000, "the permit's value is unchanged")
  for (const action of ["MARK_READY_FOR_PICKUP", "MARK_OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED", "APPROVE"]) {
    const res = await dpPut({ action })
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(res.body)}`)
  }
  assert.equal(qtyOf(db, 100), 0, "Cairo gave 6")
  assert.equal(qtyOf(db, 101), 6, "Alexandria gave 4")
})

test("3. a split whose shares do not add up to the line, or names another permit's line, is refused and nothing changes", async () => {
  const db = splitDb()
  const before = JSON.stringify(db.tables.delivery_permit_items)
  const short = await dpPut({ action: "ALLOCATE_WAREHOUSES", allocations: [{ itemId: 11, warehouseId: 1, quantity: 6 }, { itemId: 11, warehouseId: 2, quantity: 3 }] })
  assert.equal(short.status, 400)
  const foreign = await dpPut({ action: "ALLOCATE_WAREHOUSES", allocations: [{ itemId: 99, warehouseId: 1, quantity: 10 }] })
  assert.equal(foreign.status, 400)
  assert.equal(JSON.stringify(db.tables.delivery_permit_items), before)
  assert.equal(db.tables.delivery_permits[0].status, "DRAFT")
})

test("3. a split line's totals follow the quantities and add up exactly (rounding goes to the last share)", () => {
  const planned = planAllocation(
    [{ item_id: 1, permit_id: 1, product_id: 7, quantity: 3, unit_price: 33.33, total: 100 }],
    [{ itemId: 1, warehouseId: 1, quantity: 1 }, { itemId: 1, warehouseId: 2, quantity: 1 }, { itemId: 1, warehouseId: 3, quantity: 1 }],
    null,
  )
  assert.ok(planned.ok)
  if (!planned.ok) return
  const totals = [planned.plan.updates[0].patch.total, ...planned.plan.inserts.map((r) => r.total)] as number[]
  assert.deepEqual(totals, [33.33, 33.33, 33.34])
  assert.equal(planned.plan.inserts[0].item_id, undefined, "a copy gets its own id")
})

// ---------------------------------------------------------------------------------------------------------
// 4. Approving a maintenance report takes the parts from a real sellable stock row, once, and records it
// ---------------------------------------------------------------------------------------------------------

function maintDb(inventory: Row[], parts: Row[] = [{ type: "inventory", productId: 7, productName: "Seal kit", quantity: 3, unitCost: 100, totalCost: 300 }]) {
  const db = new FakeDb({
    maintenance_reports: [{ report_id: 1, work_order_id: 9, parts_used: parts, approved_at: null, approved_by: null }],
    maintenance_work_orders: [{ work_order_id: 9, status: "in_progress" }],
    inventory, inventory_transactions: [], idempotency_log: [],
  })
  useDb(db)
  return db
}
const approveBody = { report_id: 1, work_order_id: 9, approved: true }

test("4. parts come from the sellable row with enough stock, not a returned row", async () => {
  const db = maintDb([
    { inventory_id: 1, product_id: 7, warehouse_id: 1, is_returned: true, quantity: 5 },
    { inventory_id: 2, product_id: 7, warehouse_id: 2, is_returned: false, quantity: 1 },
    { inventory_id: 3, product_id: 7, warehouse_id: 3, is_returned: false, quantity: 10 },
  ])
  const res = await call(maintApprove.POST, "POST", approveBody)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = Object.fromEntries(db.tables.inventory.map((r: Row) => [r.inventory_id, r.quantity]))
  assert.deepEqual(q, { 1: 5, 2: 1, 3: 7 })
  const tx = db.tables.inventory_transactions
  assert.equal(tx.length, 1)
  assert.equal(tx[0].transaction_type, "adjustment")
  assert.equal(tx[0].quantity_change, -3)
  assert.ok(tx[0].transaction_type.length <= 20 && String(tx[0].reference_type).length <= 20)
  assert.equal(db.tables.maintenance_work_orders[0].status, "completed")
})

test("4. not enough stock refuses the approval and changes nothing (no clamping to 0)", async () => {
  const db = maintDb([{ inventory_id: 3, product_id: 7, warehouse_id: 3, is_returned: false, quantity: 2 }])
  const res = await call(maintApprove.POST, "POST", approveBody)
  assert.equal(res.status, 409, JSON.stringify(res.body))
  assert.equal(db.tables.inventory[0].quantity, 2)
  assert.equal(db.tables.inventory_transactions.length, 0)
  assert.equal(db.tables.maintenance_reports[0].approved_at, null)
  assert.equal(db.tables.maintenance_work_orders[0].status, "in_progress")
})

test("4. approving the same report twice takes the parts only once", async () => {
  const db = maintDb([{ inventory_id: 3, product_id: 7, warehouse_id: 3, is_returned: false, quantity: 10 }])
  assert.equal((await call(maintApprove.POST, "POST", approveBody)).status, 200)
  const second = await call(maintApprove.POST, "POST", approveBody)
  assert.equal(second.status, 409, JSON.stringify(second.body))
  assert.equal(db.tables.inventory[0].quantity, 7)
  assert.equal(db.tables.inventory_transactions.length, 1)
})

test("4. if the work order cannot be closed, the parts are put back and the report is not approved", async () => {
  const db = maintDb([{ inventory_id: 3, product_id: 7, warehouse_id: 3, is_returned: false, quantity: 10 }])
  db.failOn["maintenance_work_orders:update"] = "boom"
  const res = await call(maintApprove.POST, "POST", approveBody)
  assert.equal(res.status, 500)
  assert.equal(db.tables.inventory[0].quantity, 10)
  assert.equal(db.tables.maintenance_reports[0].approved_at, null)
})

// ---------------------------------------------------------------------------------------------------------
// 5. A maintenance invoice is the price before VAT plus 14% VAT, never the cost by default
// ---------------------------------------------------------------------------------------------------------
function maintInvoiceDb() {
  const db = new FakeDb({
    maintenance_work_orders: [{ work_order_id: 9, work_order_number: "WO-9", sales_order_id: null }],
    maintenance_reports: [{ report_id: 1, work_order_id: 9, actual_cost: 5000, submitted_at: "2026-10-01", parts_used: [{ type: "inventory", totalCost: 2000 }] }],
    accounts_receivable: [], maintenance_ar_invoices: [],
  })
  useDb(db)
  return db
}
const invoiceBody = (extra: Row) => ({ work_order_id: 9, customer_id: 5, due_days: 30, payment_terms: "NET 30", ...extra })

test("5. a price of 6,250 before VAT is invoiced as 7,125 with 875 VAT", async () => {
  const db = maintInvoiceDb()
  const res = await call(maintInvoice.POST, "POST", invoiceBody({ amount_before_vat: 6250 }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.accounts_receivable[0].amount, 7125)
  const detail = db.tables.maintenance_ar_invoices[0]
  assert.equal(detail.invoice_amount, 7125)
  assert.equal(detail.tax_amount, 875)
  assert.equal(detail.parts_cost, 2000)
  assert.equal(detail.labor_cost, 4250)
})

test("5. a missing, zero or negative price is refused", async () => {
  for (const extra of [{}, { amount_before_vat: 0 }, { amount_before_vat: -5 }, { amount_before_vat: "abc" }]) {
    const db = maintInvoiceDb()
    const res = await call(maintInvoice.POST, "POST", invoiceBody(extra))
    assert.equal(res.status, 400, JSON.stringify(extra))
    assert.equal(db.tables.accounts_receivable.length, 0)
  }
})

test("5. if the invoice detail cannot be saved, the AR invoice is removed again", async () => {
  const db = maintInvoiceDb()
  db.failOn["maintenance_ar_invoices:insert"] = "boom"
  const res = await call(maintInvoice.POST, "POST", invoiceBody({ amount_before_vat: 6250 }))
  assert.equal(res.status, 500)
  assert.equal(db.tables.accounts_receivable.length, 0)
})

test("5. the invoice screen no longer falls back to the cost as the price", () => {
  const tab = src("components/accounting/maintenance-invoice-tab.tsx")
  assert.doesNotMatch(tab, /\|\|\s*selectedOrder\.actual_cost/)
  assert.match(tab, /amount_before_vat/)
})

// ---------------------------------------------------------------------------------------------------------
// 6. The stock count screen names each row's warehouse and marks returned rows
// ---------------------------------------------------------------------------------------------------------
test("6. the stock count list carries the warehouse name and whether the row is returned stock", async () => {
  useDb(new FakeDb({
    inventory: [
      { inventory_id: 1, product_id: 7, warehouse_id: 2, is_returned: false, quantity: 4 },
      { inventory_id: 2, product_id: 7, warehouse_id: 2, is_returned: true, quantity: 1 },
    ],
    products: [{ product_id: 7, product_name: "Pump A", sku: "P-A" }],
    warehouses: [{ warehouse_id: 2, warehouse_name: "Alexandria" }],
  }))
  const res = await call(auditRoute.GET, "GET")
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const rows = res.body as Row[]
  assert.deepEqual(rows.map((r) => [r.warehouse_name, r.is_returned]), [["Alexandria", false], ["Alexandria", true]])
})

test("6. the stock count screen labels returned rows", () => {
  const screen = src("components/modules/inventory-audit-module.tsx")
  assert.match(screen, /item\.is_returned/)
})

// ---------------------------------------------------------------------------------------------------------
// 7. Goods returned after they were invoiced become a customer credit (applied to the invoice from AR)
// ---------------------------------------------------------------------------------------------------------
// SO 1: 4 x Pump at 50,000, no discount, total 228,000 with VAT. DP 1 (APPROVED) delivered `delivered` pumps.
function returnDb(opts: { delivered: number; invoices: Row[]; links?: Row[] }) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-R-1", customer_id: 5, status: "delivered", subtotal: 200000, discount_amount: 0, total: 228000, net_total: 228000 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 4, unit_price: 50000, total: 200000 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    warehouses: [{ warehouse_id: 1 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-R-1", sales_order_id: 1, customer_id: 5, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump", sku_snapshot: "P", quantity: opts.delivered, unit_price: 50000, total: 50000 * opts.delivered, supplier_id: null, outsourced_name: null }],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 10 }],
    accounts_receivable: opts.invoices, invoice_delivery_permits: opts.links || [],
    product_returns: [], return_items: [], inventory_batches: [], idempotency_log: [], customer_credits: [],
  })
  return db
}
async function receiveReturn(db: FakeDb, qty: number) {
  const created = await createReturn(db, { permitId: 1, idempotencyKey: `gl-ret-${Math.random().toString(36).slice(2)}`, createdBy: "t", items: [{ productId: 7, productName: "Pump", quantityReturned: qty, reason: "wrong_item", condition: "good" }] })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const id = created.body.returnId
  const items = db.tables.return_items.filter((i: Row) => i.return_id === id).map((i: Row) => ({ returnItemId: i.return_item_id, warehouseId: 1 }))
  const res = await processReturn(db, { returnId: id, status: "completed", processedBy: "wh", warehouseAssignments: items })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return { id, res }
}
const wholeInvoice = { invoice_id: 1, invoice_number: "INV-R-1", so_id: 1, customer_id: 5, amount: 228000, collected_amount: 0, status: "pending", created_at: "2026-10-01T00:00:00Z" }

test("7. returning 1 of 4 invoiced pumps gives the customer a 57,000 credit (price + VAT)", async () => {
  const db = returnDb({ delivered: 4, invoices: [wholeInvoice] })
  const { id } = await receiveReturn(db, 1)
  const credits = db.tables.customer_credits
  assert.equal(credits.length, 1)
  assert.equal(credits[0].customer_id, 5)
  assert.equal(credits[0].amount, 57000)
  assert.equal(credits[0].status, "active")
  assert.equal(credits[0].credit_type, "sales_return")
  assert.equal(credits[0].reference_id, id)
  assert.equal(db.tables.accounts_receivable[0].amount, 228000) // the invoice itself is not rewritten
})

test("7. a return before anything was invoiced gives no credit (the invoice will leave it out)", async () => {
  const db = returnDb({ delivered: 4, invoices: [] })
  await receiveReturn(db, 1)
  assert.equal(db.tables.customer_credits.length, 0)
})

test("7. a return from a partly delivered order whose later invoices can still leave it out gives no credit", async () => {
  // 2 of 4 delivered and invoiced (114,000); 1 returned: the remaining invoices bill only 1 more pump
  const db = returnDb({
    delivered: 2,
    invoices: [{ ...wholeInvoice, so_id: null, amount: 114000 }],
    links: [{ invoice_id: 1, permit_id: 1 }],
  })
  await receiveReturn(db, 1)
  assert.equal(db.tables.customer_credits.length, 0)
})

test("7. two returns are credited separately and never more than was invoiced", async () => {
  const db = returnDb({ delivered: 4, invoices: [wholeInvoice] })
  await receiveReturn(db, 1)
  await receiveReturn(db, 3)
  const total = db.tables.customer_credits.reduce((s: number, c: Row) => s + c.amount, 0)
  assert.equal(db.tables.customer_credits.length, 2)
  assert.equal(total, 228000)
})

// ---------------------------------------------------------------------------------------------------------
// 8. The accountant's approval and quantity increases on approved orders re-check stock on the server
// ---------------------------------------------------------------------------------------------------------
function stockDb(opts: { onHand: number; otherHeld?: number; status?: string; qty?: number }) {
  const db = new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-S-1", customer_id: 5, status: opts.status || "pending_accountant", total: 0, net_total: 0 },
      { so_id: 2, so_number: "SO-S-2", customer_id: 6, status: "accountant_approved", total: 0, net_total: 0 },
    ],
    customers: [{ customer_id: 5, customer_name: "A" }, { customer_id: 6, customer_name: "B" }],
    products: [{ product_id: 7, product_name: "Pump A" }],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: 7, quantity: opts.qty ?? 3, unit_price: 100, total: 300, item_type: "stock" },
      { so_item_id: 2, so_id: 2, product_id: 7, quantity: opts.otherHeld ?? 0, unit_price: 100, total: 0, item_type: "stock" },
    ],
    delivery_permits: [], delivery_permit_items: [], accounts_receivable: [], invoice_delivery_permits: [],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: opts.onHand }],
  })
  useDb(db)
  return db
}

test("8. the accountant cannot approve an order whose stock another approved order already holds", async () => {
  const db = stockDb({ onHand: 3, otherHeld: 3 })
  const res = await call(soRoute.PUT, "PUT", { so_id: 1, status: "accountant_approved" })
  assert.equal(res.status, 409, JSON.stringify(res.body))
  assert.match(res.body.error, /Pump A/)
  assert.equal(db.tables.sales_orders[0].status, "pending_accountant")
})

test("8. the accountant can approve when enough stock is free", async () => {
  const db = stockDb({ onHand: 6, otherHeld: 3 })
  const res = await call(soRoute.PUT, "PUT", { so_id: 1, status: "accountant_approved" })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.sales_orders[0].status, "accountant_approved")
})

const qtyEdit = (qty: number, price = 100) => ({
  so_id: 1, status: "accountant_approved", customerId: "5",
  items: [{ id: "1", productId: "7", productName: "Pump A", quantity: qty, unitPrice: price, total: qty * price, itemType: "stock" }],
})

test("8. raising the quantity on an approved order beyond the free stock is refused and nothing changes", async () => {
  const db = stockDb({ onHand: 25, otherHeld: 10, status: "accountant_approved", qty: 10 })
  const res = await call(soRoute.PUT, "PUT", qtyEdit(20))
  assert.equal(res.status, 409, JSON.stringify(res.body))
  assert.equal(db.tables.sales_order_items[0].quantity, 10)
})

test("8. raising the quantity within the free stock is saved", async () => {
  const db = stockDb({ onHand: 30, otherHeld: 10, status: "accountant_approved", qty: 10 })
  const res = await call(soRoute.PUT, "PUT", qtyEdit(20))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.sales_order_items[0].quantity, 20)
})

test("8. an edit that does not raise any quantity is never blocked, even when stock is short", async () => {
  const db = stockDb({ onHand: 5, status: "accountant_approved", qty: 10 })
  const res = await call(soRoute.PUT, "PUT", qtyEdit(10, 120))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.sales_order_items[0].unit_price, 120)
})

// ---------------------------------------------------------------------------------------------------------
// 9. A hybrid order invoiced in parts shows each invoice its share of the down payment and installments
// ---------------------------------------------------------------------------------------------------------
test("9. an invoice for half the order carries half the down payment and half of each installment", () => {
  const share = scheduleShare(114000, 228000)
  assert.equal(share, 0.5)
  assert.deepEqual(scaleSchedule([28000, 50000, 50000, 50000, 50000], share), [14000, 25000, 25000, 25000, 25000])
})

test("9. an invoice for the whole order keeps the schedule as it is", () => {
  assert.equal(scheduleShare(228000, 228000), 1)
  assert.deepEqual(scaleSchedule([28000, 100000, 100000], 1), [28000, 100000, 100000])
})

test("9. rounding never makes the parts add up to more or less than the invoice's share", () => {
  const parts = scaleSchedule([10000, 10000, 10000], scheduleShare(10000, 30000))
  assert.equal(Math.round(parts.reduce((s, a) => s + a, 0) * 100) / 100, 10000)
})

test("9. the receivables screen scales the hybrid schedule to the invoice", () => {
  const ar = src("components/modules/accounts-receivable-module.tsx")
  assert.match(ar, /scheduleShare\(/)
  assert.match(ar, /scaleSchedule\(/)
})

// ---------------------------------------------------------------------------------------------------------
// 10. Financial dashboard figures
// ---------------------------------------------------------------------------------------------------------
test("10. revenue is shown before VAT", () => {
  assert.equal(withoutVat(114000), 100000)
})

test("10. supplier expenses drop the VAT their purchase order added, and only when it added some", () => {
  assert.equal(supplierAmountWithoutVat(57000, { total: 114000, taxAmount: 14000 }), 50000)
  assert.equal(supplierAmountWithoutVat(50000, { total: 100000, taxAmount: 0 }), 50000)
  assert.equal(supplierAmountWithoutVat(50000, null), 50000)
})

test("10. a part-paid supplier invoice counts its payment as paid and only the rest as owed", () => {
  const inv = { amount: 100000, paidAmount: 30000, status: "partially_paid" }
  assert.equal(supplierPaid(inv), 30000)
  assert.equal(supplierUnpaid(inv), 70000)
  assert.equal(supplierUnpaid({ amount: 100000, paidAmount: 0, status: "paid" }), 0)
})

test("10. margin is profit divided by revenue", () => {
  assert.equal(profitMarginPercent(20000, 100000), "20.00")
  assert.equal(profitMarginPercent(5000, 0), "N/A")
})

test("10. the dashboard uses these figures", () => {
  const fd = src("components/modules/financial-dashboard.tsx")
  for (const fn of ["withoutVat(", "supplierAmountWithoutVat(", "supplierPaid(", "supplierUnpaid(", "profitMarginPercent("]) assert.ok(fd.includes(fn), fn)
  assert.doesNotMatch(fd, /grossProfit \/ totalExpenses/)
})
