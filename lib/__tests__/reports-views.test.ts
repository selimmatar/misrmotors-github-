// /api/reports/*: the report_* views were dropped from production (057_fix_all_security_issues.sql), so the routes now
// compute the same rows in lib/reports/views.ts from the base tables. Real handlers on the in-memory FakeDb, which has
// no report_* tables.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as salesRoute from "../../app/api/reports/sales/route"
import * as purchasesRoute from "../../app/api/reports/purchases/route"
import * as inventoryRoute from "../../app/api/reports/inventory/route"
import * as financialRoute from "../../app/api/reports/financial/route"
import * as customersRoute from "../../app/api/reports/customers/route"
import * as suppliersRoute from "../../app/api/reports/suppliers/route"

/** UTC date n days from today (CURRENT_DATE in the views is today's UTC date) */
const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const seed = (): Record<string, Row[]> => ({
  customers: [
    { customer_id: 1, customer_name: "Alpha", email: "a@x.eg", phone: "111", city: "Cairo", country: "EG", status: "active" },
    { customer_id: 2, customer_name: "Beta", email: "b@x.eg", phone: "222", city: "Giza", country: "EG", status: "active" },
    { customer_id: 3, customer_name: "Gamma", email: null, phone: null, city: null, country: null, status: "inactive" },
  ],
  sales_orders: [
    { so_id: 1, so_number: "SO-1", customer_id: 1, order_date: "2026-08-05", delivery_date: "2026-08-10", total: 100, status: "delivered", payment_terms: "prepaid", installments: null },
    { so_id: 2, so_number: "SO-2", customer_id: 1, order_date: "2026-08-20", delivery_date: null, total: 300, status: "pending_accountant", payment_terms: "installment", installments: 3 },
    { so_id: 3, so_number: "SO-3", customer_id: 2, order_date: "2026-09-02", delivery_date: null, total: 50, status: "completed", payment_terms: "prepaid", installments: null },
    { so_id: 4, so_number: "SO-4", customer_id: 99, order_date: "2026-10-01", delivery_date: null, total: 25, status: "shipped", payment_terms: "prepaid", installments: null },
  ],
  product_categories: [
    { category_id: 1, category_name: "Filters" },
    { category_id: 2, category_name: "Belts" },
  ],
  products: [
    { product_id: 10, product_name: "Filter", sku: "F-1", category_id: 1, unit_price: 50, last_landed_cost: 30, markup_percentage: 40 },
    { product_id: 11, product_name: "Pump", sku: "P-1", category_id: null, unit_price: 60, last_landed_cost: null, markup_percentage: null },
    { product_id: 12, product_name: "Belt", sku: "B-1", category_id: 2, unit_price: 10, last_landed_cost: 5, markup_percentage: 100 },
  ],
  sales_order_items: [
    { so_item_id: 1, so_id: 1, product_id: 10, quantity: 2, total: 100 },
    { so_item_id: 2, so_id: 2, product_id: 10, quantity: 5, total: 300 }, // pending order: not counted as sold
    { so_item_id: 3, so_id: 3, product_id: 11, quantity: 1, total: 50 },
    { so_item_id: 4, so_id: 4, product_id: 10, quantity: 1, total: 25 },
  ],
  inventory: [
    { inventory_id: 1, product_id: 10, quantity: 5, unit_cost: 30, reorder_point: 10, location: "Main", last_updated: "2026-10-01T00:00:00Z" },
    { inventory_id: 2, product_id: 10, quantity: 0, unit_cost: 30, reorder_point: 2, location: "Annex", last_updated: "2026-10-02T00:00:00Z" },
    { inventory_id: 3, product_id: 12, quantity: 50, unit_cost: 5, reorder_point: 10, location: "Main", last_updated: "2026-10-03T00:00:00Z" },
    { inventory_id: 4, product_id: 999, quantity: 1, unit_cost: 7, reorder_point: 0, location: "Main", last_updated: null }, // no product
    { inventory_id: 5, product_id: 11, quantity: 2, unit_cost: null, reorder_point: 1, location: "Main", last_updated: null },
  ],
  suppliers: [
    { supplier_id: 1, supplier_name: "Acme", email: "acme@x.eg", phone: "333", city: "Alex", country: "EG", lead_time_days: 14, is_active: true },
    { supplier_id: 2, supplier_name: "Bolt", email: "bolt@x.cn", phone: "444", city: "Ningbo", country: "CN", lead_time_days: null, is_active: false },
  ],
  purchase_orders: [
    { po_id: 1, po_number: "PO-1", supplier_id: 1, order_date: "2026-07-03", delivery_date: "2026-07-20", total: 1000, tax_amount: 140, other_costs: null, status: "received", payment_terms: "prepaid", installments: null, currency: "EGP", cost_finalized: true },
    { po_id: 2, po_number: "PO-2", supplier_id: 1, order_date: "2026-07-15", delivery_date: null, total: 500, tax_amount: null, other_costs: 20, status: "pending_ceo", payment_terms: "installment", installments: 2, currency: "USD", cost_finalized: false },
    { po_id: 3, po_number: "PO-3", supplier_id: 2, order_date: "2026-09-01", delivery_date: null, total: 200, tax_amount: 28, other_costs: 0, status: "approved", payment_terms: "prepaid", installments: null, currency: "EGP", cost_finalized: false },
  ],
  accounts_receivable: [
    { invoice_id: 1, invoice_number: "INV-1", invoice_date: d(-40), due_date: d(-10), amount: 400, collected_amount: 100, status: "partially_paid", payment_terms: "installment", installment_months: 4, months_paid: 1, customer_id: 1 },
    { invoice_id: 2, invoice_number: "INV-2", invoice_date: d(-5), due_date: d(5), amount: 50, collected_amount: null, status: "pending", payment_terms: "prepaid", installment_months: null, months_paid: 0, customer_id: 2 },
    { invoice_id: 3, invoice_number: "INV-3", invoice_date: d(-100), due_date: d(-95), amount: 100, collected_amount: 100, status: "paid", payment_terms: "prepaid", installment_months: null, months_paid: 1, customer_id: 1 },
    { invoice_id: 4, invoice_number: "INV-4", invoice_date: d(-70), due_date: d(-65), amount: 30, collected_amount: 0, status: "pending", payment_terms: "prepaid", installment_months: null, months_paid: 0, customer_id: 99 }, // no customer
  ],
  accounts_payable: [
    { invoice_id: 1, invoice_number: "AP-1", invoice_date: d(-50), due_date: d(-45), amount: 1000, paid_amount: 400, status: "partially_paid", payment_terms: "installment", installment_months: 5, months_paid: 2, supplier_id: 1 },
    { invoice_id: 2, invoice_number: "AP-2", invoice_date: d(-1), due_date: d(30), amount: 200, paid_amount: null, status: "pending", payment_terms: "prepaid", installment_months: null, months_paid: 0, supplier_id: 2 },
    { invoice_id: 3, invoice_number: "AP-3", invoice_date: d(-200), due_date: d(-120), amount: 70, paid_amount: 70, status: "paid", payment_terms: "prepaid", installment_months: null, months_paid: 1, supplier_id: 1 },
  ],
  balance_entries: [
    { entry_id: 1, created_at: "2026-08-03T10:00:00Z", entry_type: "credit", amount: 500 },
    { entry_id: 2, created_at: "2026-08-28T23:00:00Z", entry_type: "debit", amount: 200 },
    { entry_id: 3, created_at: "2026-09-10T00:00:00Z", entry_type: "ar_payment", amount: 75 },
  ],
})

const fresh = () => {
  const db = new FakeDb(seed())
  db.jitter = false
  useDb(db)
  return db
}
const get = async (handler: any, path: string) => {
  fresh()
  return call(handler, "GET", undefined, `http://test.local${path}`)
}
const ok = (r: { status: number; body: any }) => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

// ---------------------------------------------------------------------------------------------------------
// Expected rows
// ---------------------------------------------------------------------------------------------------------
const C1 = { customer_id: 1, customer_name: "Alpha", customer_email: "a@x.eg", customer_phone: "111", customer_city: "Cairo", customer_country: "EG" }
const C2 = { customer_id: 2, customer_name: "Beta", customer_email: "b@x.eg", customer_phone: "222", customer_city: "Giza", customer_country: "EG" }
const CNONE = { customer_id: null, customer_name: null, customer_email: null, customer_phone: null, customer_city: null, customer_country: null }
const SALES_DETAILS = [
  { so_id: 4, so_number: "SO-4", order_date: "2026-10-01", delivery_date: null, total: 25, status: "shipped", payment_terms: "prepaid", installments: null, ...CNONE },
  { so_id: 3, so_number: "SO-3", order_date: "2026-09-02", delivery_date: null, total: 50, status: "completed", payment_terms: "prepaid", installments: null, ...C2 },
  { so_id: 2, so_number: "SO-2", order_date: "2026-08-20", delivery_date: null, total: 300, status: "pending_accountant", payment_terms: "installment", installments: 3, ...C1 },
  { so_id: 1, so_number: "SO-1", order_date: "2026-08-05", delivery_date: "2026-08-10", total: 100, status: "delivered", payment_terms: "prepaid", installments: null, ...C1 },
]
const SALES_SUMMARY = [
  { month: "2026-10-01", total_orders: 1, completed_orders: 0, pending_orders: 0, total_revenue: 25, avg_order_value: 25, unique_customers: 1 },
  { month: "2026-09-01", total_orders: 1, completed_orders: 1, pending_orders: 0, total_revenue: 50, avg_order_value: 50, unique_customers: 1 },
  { month: "2026-08-01", total_orders: 2, completed_orders: 1, pending_orders: 1, total_revenue: 400, avg_order_value: 200, unique_customers: 1 },
]
const SALES_BY_CUSTOMER = [
  { customer_id: 1, customer_name: "Alpha", email: "a@x.eg", phone: "111", city: "Cairo", country: "EG", total_orders: 2, total_spent: 400, avg_order_value: 200, last_order_date: "2026-08-20" },
  { customer_id: 2, customer_name: "Beta", email: "b@x.eg", phone: "222", city: "Giza", country: "EG", total_orders: 1, total_spent: 50, avg_order_value: 50, last_order_date: "2026-09-02" },
  { customer_id: 3, customer_name: "Gamma", email: null, phone: null, city: null, country: null, total_orders: 0, total_spent: 0, avg_order_value: 0, last_order_date: null },
]
const PURCHASE_SUMMARY = [
  { month: "2026-09-01", total_orders: 1, received_orders: 0, pending_orders: 0, total_amount: 200, total_tax: 28, total_other_costs: 0, avg_order_value: 200, unique_suppliers: 1 },
  { month: "2026-07-01", total_orders: 2, received_orders: 1, pending_orders: 1, total_amount: 1500, total_tax: 140, total_other_costs: 20, avg_order_value: 750, unique_suppliers: 1 },
]
const S1 = { supplier_id: 1, supplier_name: "Acme", supplier_email: "acme@x.eg", supplier_phone: "333", supplier_city: "Alex", supplier_country: "EG", lead_time_days: 14 }
const S2 = { supplier_id: 2, supplier_name: "Bolt", supplier_email: "bolt@x.cn", supplier_phone: "444", supplier_city: "Ningbo", supplier_country: "CN", lead_time_days: null }
const PURCHASE_DETAILS = [
  { po_id: 3, po_number: "PO-3", order_date: "2026-09-01", delivery_date: null, total: 200, tax_amount: 28, other_costs: 0, status: "approved", payment_terms: "prepaid", installments: null, currency: "EGP", cost_finalized: false, ...S2 },
  { po_id: 2, po_number: "PO-2", order_date: "2026-07-15", delivery_date: null, total: 500, tax_amount: null, other_costs: 20, status: "pending_ceo", payment_terms: "installment", installments: 2, currency: "USD", cost_finalized: false, ...S1 },
  { po_id: 1, po_number: "PO-1", order_date: "2026-07-03", delivery_date: "2026-07-20", total: 1000, tax_amount: 140, other_costs: null, status: "received", payment_terms: "prepaid", installments: null, currency: "EGP", cost_finalized: true, ...S1 },
]
const PURCHASE_BY_SUPPLIER = [
  { supplier_id: 1, supplier_name: "Acme", email: "acme@x.eg", phone: "333", city: "Alex", country: "EG", lead_time_days: 14, total_orders: 2, total_amount: 1500, avg_order_value: 750, last_order_date: "2026-07-15" },
  { supplier_id: 2, supplier_name: "Bolt", email: "bolt@x.cn", phone: "444", city: "Ningbo", country: "CN", lead_time_days: null, total_orders: 1, total_amount: 200, avg_order_value: 200, last_order_date: "2026-09-01" },
]
const INV5 = { inventory_id: 5, product_id: 11, product_name: "Pump", sku: "P-1", category: null, quantity: 2, unit_cost: null, total_value: null, reorder_point: 1, location: "Main", stock_status: "In Stock", last_updated: null }
const INV3 = { inventory_id: 3, product_id: 12, product_name: "Belt", sku: "B-1", category: "Belts", quantity: 50, unit_cost: 5, total_value: 250, reorder_point: 10, location: "Main", stock_status: "In Stock", last_updated: "2026-10-03T00:00:00Z" }
const INV1 = { inventory_id: 1, product_id: 10, product_name: "Filter", sku: "F-1", category: "Filters", quantity: 5, unit_cost: 30, total_value: 150, reorder_point: 10, location: "Main", stock_status: "Low Stock", last_updated: "2026-10-01T00:00:00Z" }
const INV2 = { inventory_id: 2, product_id: 10, product_name: "Filter", sku: "F-1", category: "Filters", quantity: 0, unit_cost: 30, total_value: 0, reorder_point: 2, location: "Annex", stock_status: "Out of Stock", last_updated: "2026-10-02T00:00:00Z" }
const P10 = { product_id: 10, product_name: "Filter", sku: "F-1", category: "Filters", unit_price: 50, last_landed_cost: 30, markup_percentage: 40 }
const PERFORMANCE = [
  { ...P10, current_stock: 5, reorder_point: 10, total_quantity_sold: 3, total_revenue: 125, order_count: 2, profit_margin_pct: 28 },
  { ...P10, current_stock: 0, reorder_point: 2, total_quantity_sold: 3, total_revenue: 125, order_count: 2, profit_margin_pct: 28 },
  { product_id: 11, product_name: "Pump", sku: "P-1", category: null, unit_price: 60, last_landed_cost: null, markup_percentage: null, current_stock: 2, reorder_point: 1, total_quantity_sold: 1, total_revenue: 50, order_count: 1, profit_margin_pct: 100 },
  { product_id: 12, product_name: "Belt", sku: "B-1", category: "Belts", unit_price: 10, last_landed_cost: 5, markup_percentage: 100, current_stock: 50, reorder_point: 10, total_quantity_sold: 0, total_revenue: 0, order_count: 0, profit_margin_pct: 0 },
]
const AR_AGING = () => [
  { invoice_id: 3, invoice_number: "INV-3", invoice_date: d(-100), due_date: d(-95), total_amount: 100, paid_amount: 100, balance_due: 0, status: "paid", payment_terms: "prepaid", installment_months: null, months_paid: 1, customer_id: 1, customer_name: "Alpha", customer_email: "a@x.eg", customer_phone: "111", days_overdue: 95, aging_bucket: "Paid" },
  { invoice_id: 1, invoice_number: "INV-1", invoice_date: d(-40), due_date: d(-10), total_amount: 400, paid_amount: 100, balance_due: 300, status: "partially_paid", payment_terms: "installment", installment_months: 4, months_paid: 1, customer_id: 1, customer_name: "Alpha", customer_email: "a@x.eg", customer_phone: "111", days_overdue: 10, aging_bucket: "1-30 Days" },
  { invoice_id: 2, invoice_number: "INV-2", invoice_date: d(-5), due_date: d(5), total_amount: 50, paid_amount: null, balance_due: 50, status: "pending", payment_terms: "prepaid", installment_months: null, months_paid: 0, customer_id: 2, customer_name: "Beta", customer_email: "b@x.eg", customer_phone: "222", days_overdue: -5, aging_bucket: "Current" },
]
const AP_AGING = () => [
  { invoice_id: 3, invoice_number: "AP-3", invoice_date: d(-200), due_date: d(-120), total_amount: 70, paid_amount: 70, balance_due: 0, status: "paid", payment_terms: "prepaid", installment_months: null, months_paid: 1, supplier_id: 1, supplier_name: "Acme", supplier_email: "acme@x.eg", supplier_phone: "333", days_overdue: 120, aging_bucket: "Paid" },
  { invoice_id: 1, invoice_number: "AP-1", invoice_date: d(-50), due_date: d(-45), total_amount: 1000, paid_amount: 400, balance_due: 600, status: "partially_paid", payment_terms: "installment", installment_months: 5, months_paid: 2, supplier_id: 1, supplier_name: "Acme", supplier_email: "acme@x.eg", supplier_phone: "333", days_overdue: 45, aging_bucket: "31-60 Days" },
  { invoice_id: 2, invoice_number: "AP-2", invoice_date: d(-1), due_date: d(30), total_amount: 200, paid_amount: null, balance_due: 200, status: "pending", payment_terms: "prepaid", installment_months: null, months_paid: 0, supplier_id: 2, supplier_name: "Bolt", supplier_email: "bolt@x.cn", supplier_phone: "444", days_overdue: -30, aging_bucket: "Current" },
]
const CASH_FLOW = [
  { month: "2026-09-01", total_inflow: 0, total_outflow: 0, net_cash_flow: -75, transaction_count: 1 },
  { month: "2026-08-01", total_inflow: 500, total_outflow: 200, net_cash_flow: 300, transaction_count: 2 },
]

// ---------------------------------------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------------------------------------
test("sales summary: monthly buckets from sales_orders (newest first)", async () => {
  const body = ok(await get(salesRoute.GET, "/api/reports/sales?type=summary"))
  assert.deepEqual(body, { data: SALES_SUMMARY, reportType: "summary", fromDate: null, toDate: null })
})
test("sales summary: default type is summary; fromDate/toDate filter the month column", async () => {
  assert.deepEqual(ok(await get(salesRoute.GET, "/api/reports/sales")).data, SALES_SUMMARY)
  const body = ok(await get(salesRoute.GET, "/api/reports/sales?type=summary&fromDate=2026-08-15&toDate=2026-09-30"))
  assert.deepEqual(body, { data: [SALES_SUMMARY[1]], reportType: "summary", fromDate: "2026-08-15", toDate: "2026-09-30" })
})
test("sales details: orders LEFT JOIN customers, newest first", async () => {
  assert.deepEqual(ok(await get(salesRoute.GET, "/api/reports/sales?type=details")).data, SALES_DETAILS)
})
test("sales details: order_date filter", async () => {
  const body = ok(await get(salesRoute.GET, "/api/reports/sales?type=details&fromDate=2026-08-20&toDate=2026-09-02"))
  assert.deepEqual(body.data, [SALES_DETAILS[1], SALES_DETAILS[2]])
})
test("sales by_customer: every customer, totals coalesced to 0, biggest spender first", async () => {
  assert.deepEqual(ok(await get(salesRoute.GET, "/api/reports/sales?type=by_customer")).data, SALES_BY_CUSTOMER)
})
test("sales top_products: completed/delivered/shipped orders only", async () => {
  assert.deepEqual(ok(await get(salesRoute.GET, "/api/reports/sales?type=top_products")).data, [
    { product_id: 10, product_name: "Filter", sku: "F-1", category: "Filters", total_sold: 3, total_revenue: 125, order_count: 2, customer_count: 2 },
    { product_id: 11, product_name: "Pump", sku: "P-1", category: null, total_sold: 1, total_revenue: 50, order_count: 1, customer_count: 1 },
  ])
})
test("sales: invalid type is a 400", async () => {
  const r = await get(salesRoute.GET, "/api/reports/sales?type=nope")
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: "Invalid report type" })
})
test("sales: a base-table read error is a 500 with its message", async () => {
  const db = fresh()
  db.failOn["sales_orders:select"] = "boom"
  const r = await call(salesRoute.GET, "GET", undefined, "http://test.local/api/reports/sales?type=summary")
  assert.equal(r.status, 500)
  assert.deepEqual(r.body, { error: "boom" })
})

// ---------------------------------------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------------------------------------
test("purchases summary: monthly buckets from purchase_orders", async () => {
  const body = ok(await get(purchasesRoute.GET, "/api/reports/purchases"))
  assert.deepEqual(body, { data: PURCHASE_SUMMARY, reportType: "summary", fromDate: null, toDate: null })
})
test("purchases summary: month filter", async () => {
  const body = ok(await get(purchasesRoute.GET, "/api/reports/purchases?type=summary&fromDate=2026-08-01"))
  assert.deepEqual(body, { data: [PURCHASE_SUMMARY[0]], reportType: "summary", fromDate: "2026-08-01", toDate: null })
})
test("purchases details: orders LEFT JOIN suppliers, newest first", async () => {
  assert.deepEqual(ok(await get(purchasesRoute.GET, "/api/reports/purchases?type=details")).data, PURCHASE_DETAILS)
})
test("purchases details: order_date filter", async () => {
  assert.deepEqual(ok(await get(purchasesRoute.GET, "/api/reports/purchases?type=details&toDate=2026-07-10")).data, [PURCHASE_DETAILS[2]])
})
test("purchases by_supplier: every supplier, largest total first", async () => {
  assert.deepEqual(ok(await get(purchasesRoute.GET, "/api/reports/purchases?type=by_supplier")).data, PURCHASE_BY_SUPPLIER)
})
test("purchases: invalid type is a 400", async () => {
  const r = await get(purchasesRoute.GET, "/api/reports/purchases?type=nope")
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: "Invalid report type" })
})

// ---------------------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------------------
test("inventory valuation: inventory JOIN products, highest value first (NULL value first, as in Postgres DESC)", async () => {
  const body = ok(await get(inventoryRoute.GET, "/api/reports/inventory"))
  assert.deepEqual(body, { data: [INV5, INV3, INV1, INV2], reportType: "valuation", category: null, stockStatus: null })
})
test("inventory valuation: category and stockStatus filters", async () => {
  assert.deepEqual(ok(await get(inventoryRoute.GET, "/api/reports/inventory?type=valuation&category=Filters")).data, [INV1, INV2])
  const body = ok(await get(inventoryRoute.GET, "/api/reports/inventory?type=valuation&stockStatus=Low%20Stock"))
  assert.deepEqual(body, { data: [INV1], reportType: "valuation", category: null, stockStatus: "Low Stock" })
})
test("inventory by_category: grouped by category name, NULL category is Uncategorized", async () => {
  assert.deepEqual(ok(await get(inventoryRoute.GET, "/api/reports/inventory?type=by_category")).data, [
    { category: "Uncategorized", total_products: 1, total_quantity: 2, total_value: null, avg_unit_cost: null, low_stock_count: 0, out_of_stock_count: 0 },
    { category: "Belts", total_products: 1, total_quantity: 50, total_value: 250, avg_unit_cost: 5, low_stock_count: 0, out_of_stock_count: 0 },
    { category: "Filters", total_products: 2, total_quantity: 5, total_value: 150, avg_unit_cost: 30, low_stock_count: 2, out_of_stock_count: 1 },
  ])
})
test("inventory low_stock: Low Stock and Out of Stock rows only", async () => {
  assert.deepEqual(ok(await get(inventoryRoute.GET, "/api/reports/inventory?type=low_stock")).data, [INV1, INV2])
})
test("inventory product_performance: every product x inventory row with sold totals and margin", async () => {
  assert.deepEqual(ok(await get(inventoryRoute.GET, "/api/reports/inventory?type=product_performance")).data, PERFORMANCE)
})
test("inventory: invalid type is a 400", async () => {
  const r = await get(inventoryRoute.GET, "/api/reports/inventory?type=nope")
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: "Invalid report type" })
})

// ---------------------------------------------------------------------------------------------------------
// Financial
// ---------------------------------------------------------------------------------------------------------
test("financial summary: one object with the combined totals", async () => {
  const body = ok(await get(financialRoute.GET, "/api/reports/financial"))
  assert.deepEqual(body, {
    data: {
      total_revenue: 150, total_expenses: 1000, gross_profit: -850, ar_outstanding: 380, ap_outstanding: 800,
      total_sales_orders: 4, total_purchase_orders: 3, total_customers: 3, total_suppliers: 2, inventory_value: 407,
    },
    reportType: "summary", fromDate: null, toDate: null,
  })
})
test("financial summary: empty database still gives one row of zeros", async () => {
  useDb(new FakeDb({}))
  const r = await call(financialRoute.GET, "GET", undefined, "http://test.local/api/reports/financial?type=summary")
  assert.deepEqual(ok(r).data, {
    total_revenue: 0, total_expenses: 0, gross_profit: 0, ar_outstanding: 0, ap_outstanding: 0,
    total_sales_orders: 0, total_purchase_orders: 0, total_customers: 0, total_suppliers: 0, inventory_value: 0,
  })
})
test("financial ar_aging: accounts_receivable JOIN customers, earliest due first, aging buckets", async () => {
  assert.deepEqual(ok(await get(financialRoute.GET, "/api/reports/financial?type=ar_aging")).data, AR_AGING())
})
test("financial ar_summary: one object", async () => {
  assert.deepEqual(ok(await get(financialRoute.GET, "/api/reports/financial?type=ar_summary")).data, {
    total_invoices: 4, total_invoiced: 580, total_collected: 200, total_outstanding: 380,
    paid_invoices: 1, open_invoices: 3, overdue_invoices: 2, overdue_amount: 330,
  })
})
test("financial ap_aging: accounts_payable JOIN suppliers, earliest due first", async () => {
  assert.deepEqual(ok(await get(financialRoute.GET, "/api/reports/financial?type=ap_aging")).data, AP_AGING())
})
test("financial ap_summary: one object", async () => {
  assert.deepEqual(ok(await get(financialRoute.GET, "/api/reports/financial?type=ap_summary")).data, {
    total_invoices: 3, total_invoiced: 1270, total_paid: 470, total_outstanding: 800,
    paid_invoices: 1, open_invoices: 2, overdue_invoices: 1, overdue_amount: 600,
  })
})
test("financial cash_flow: monthly balance_entries totals, month filter", async () => {
  assert.deepEqual(ok(await get(financialRoute.GET, "/api/reports/financial?type=cash_flow")).data, CASH_FLOW)
  const body = ok(await get(financialRoute.GET, "/api/reports/financial?type=cash_flow&fromDate=2026-09-01&toDate=2026-12-31"))
  assert.deepEqual(body, { data: [CASH_FLOW[0]], reportType: "cash_flow", fromDate: "2026-09-01", toDate: "2026-12-31" })
})
test("financial: invalid type is a 400", async () => {
  const r = await get(financialRoute.GET, "/api/reports/financial?type=nope")
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: "Invalid report type" })
})

// ---------------------------------------------------------------------------------------------------------
// Customers / Suppliers
// ---------------------------------------------------------------------------------------------------------
test("customers sales: the sales-by-customer rows", async () => {
  const body = ok(await get(customersRoute.GET, "/api/reports/customers"))
  assert.deepEqual(body, { data: SALES_BY_CUSTOMER, reportType: "sales" })
})
test("customers ar_aging: unpaid invoices grouped per customer", async () => {
  assert.deepEqual(ok(await get(customersRoute.GET, "/api/reports/customers?type=ar_aging")).data, [
    { customer_id: 1, customer_name: "Alpha", customer_email: "a@x.eg", customer_phone: "111", total_outstanding: 300, overdue_amount: 300, invoice_count: 1 },
    { customer_id: 2, customer_name: "Beta", customer_email: "b@x.eg", customer_phone: "222", total_outstanding: 50, overdue_amount: 0, invoice_count: 1 },
  ])
})
test("customers directory: active customers by name (unchanged)", async () => {
  const data = ok(await get(customersRoute.GET, "/api/reports/customers?type=directory")).data
  assert.deepEqual(data.map((c: Row) => c.customer_id), [1, 2])
})
test("customers: invalid type is a 400", async () => {
  const r = await get(customersRoute.GET, "/api/reports/customers?type=nope")
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: "Invalid report type" })
})
test("suppliers purchases: the purchase-by-supplier rows", async () => {
  const body = ok(await get(suppliersRoute.GET, "/api/reports/suppliers"))
  assert.deepEqual(body, { data: PURCHASE_BY_SUPPLIER, reportType: "purchases" })
})
test("suppliers ap_aging: unpaid invoices grouped per supplier", async () => {
  assert.deepEqual(ok(await get(suppliersRoute.GET, "/api/reports/suppliers?type=ap_aging")).data, [
    { supplier_id: 1, supplier_name: "Acme", supplier_email: "acme@x.eg", supplier_phone: "333", total_outstanding: 600, overdue_amount: 600, invoice_count: 1 },
    { supplier_id: 2, supplier_name: "Bolt", supplier_email: "bolt@x.cn", supplier_phone: "444", total_outstanding: 200, overdue_amount: 0, invoice_count: 1 },
  ])
})
test("suppliers directory: active suppliers by name (unchanged)", async () => {
  const data = ok(await get(suppliersRoute.GET, "/api/reports/suppliers?type=directory")).data
  assert.deepEqual(data.map((s: Row) => s.supplier_id), [1])
})
test("suppliers: invalid type is a 400", async () => {
  const r = await get(suppliersRoute.GET, "/api/reports/suppliers?type=nope")
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: "Invalid report type" })
})

// ---------------------------------------------------------------------------------------------------------
// Paging past the PostgREST 1000-row cap
// ---------------------------------------------------------------------------------------------------------
test("paging: 1,500 sales_orders are all read (a read without .range is capped at 1000 rows, like PostgREST)", async () => {
  const orders: Row[] = []
  for (let i = 1; i <= 1500; i++) {
    orders.push({ so_id: i, so_number: `SO-${i}`, customer_id: 1, order_date: i <= 1000 ? "2026-01-15" : "2026-02-15", delivery_date: null, total: 1, status: "delivered", payment_terms: "prepaid", installments: null })
  }
  const db = new FakeDb({ customers: [seed().customers[0]], sales_orders: orders })
  db.jitter = false
  // Emulate the server cap: any read that does not ask for a .range gets at most 1000 rows.
  const from = db.from.bind(db)
  db.from = (table: string) => {
    const q: any = from(table)
    const then = q.then.bind(q)
    q.then = (a: any, b: any) => {
      if (!q.window && q.max === null) q.max = 1000
      return then(a, b)
    }
    return q
  }
  useDb(db)
  const details = ok(await call(salesRoute.GET, "GET", undefined, "http://test.local/api/reports/sales?type=details")).data
  assert.equal(details.length, 1500)
  assert.ok(details.some((r: Row) => r.so_id === 1500), "row 1500 is in the report")
  assert.ok(details.some((r: Row) => r.so_id === 1001), "row 1001 is in the report")
  const summary = ok(await call(salesRoute.GET, "GET", undefined, "http://test.local/api/reports/sales?type=summary")).data
  assert.deepEqual(summary.map((m: Row) => [m.month, m.total_orders]), [["2026-02-01", 500], ["2026-01-01", 1000]])
  const byCustomer = ok(await call(salesRoute.GET, "GET", undefined, "http://test.local/api/reports/sales?type=by_customer")).data
  assert.equal(byCustomer[0].total_orders, 1500)
  assert.equal(byCustomer[0].total_spent, 1500)
})
