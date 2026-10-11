// TypeScript replacements for the report_* database views that /api/reports/* used to read.
// The views (scripts/archive/024_create_report_views.sql) were dropped in scripts/archive/057_fix_all_security_issues.sql
// because they were SECURITY DEFINER. Each function below reads the base tables with the caller's (admin) client and
// returns the rows the view returned: same column names, grouping, filtering and ORDER BY (Postgres NULL ordering:
// NULLS LAST for ASC, NULLS FIRST for DESC; ties keep primary-key order). SQL aggregate semantics are kept: SUM/AVG/MAX
// ignore NULLs and are NULL over no values; COUNT(col) skips NULLs. Month buckets (DATE_TRUNC('month', ...)::date) are
// ISO strings "YYYY-MM-01". CURRENT_DATE is today's UTC date.
export type Row = Record<string, any>
type Db = { from: (table: string) => any }

export const PAGE_SIZE = 1000

/** Reads every row of a table in pages of PAGE_SIZE (PostgREST caps a response at 1000 rows), ordered by its primary key. */
export async function readAll(db: Db, table: string, columns: string, pk: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from(table).select(columns).order(pk, { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page: Row[] = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

// ---------------------------------------------------------------------------------------------------------
// SQL-semantics helpers
// ---------------------------------------------------------------------------------------------------------
const num = (v: any): number | null => (v === null || v === undefined || v === "" ? null : Number(v))
const val = (v: any) => (v === undefined ? null : v)
function sum(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0)
}
function avg(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}
function max(values: any[]): any {
  const present = values.filter((v) => v !== null && v !== undefined)
  return present.length === 0 ? null : present.reduce((a, b) => (b > a ? b : a))
}
const countDistinct = (values: any[]) => new Set(values.filter((v) => v !== null && v !== undefined)).size
const coalesce0 = (v: number | null) => (v === null ? 0 : v)
const mul = (a: number | null, b: number | null) => (a === null || b === null ? null : a * b)
const minus = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b)
/** DATE_TRUNC('month', x)::date */
const monthOf = (v: any): string | null => (v === null || v === undefined ? null : `${String(v).slice(0, 7)}-01`)
const todayUtc = () => new Date().toISOString().slice(0, 10)
/** CURRENT_DATE - due_date (whole days) */
function daysSince(date: any, today: string): number | null {
  if (date === null || date === undefined) return null
  const d = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d)) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - d) / 86400000)
}
/** ROUND(x, 2) on numeric: half away from zero */
const round2 = (x: number) => (Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9)) / 100

/** Stable ORDER BY one column with Postgres NULL placement (ASC: nulls last, DESC: nulls first). */
function orderBy(rows: Row[], col: string, dir: "asc" | "desc"): Row[] {
  return [...rows].sort((a, b) => {
    const x = a[col]
    const y = b[col]
    const xn = x === null || x === undefined
    const yn = y === null || y === undefined
    if (xn || yn) {
      if (xn && yn) return 0
      return (xn ? 1 : -1) * (dir === "asc" ? 1 : -1)
    }
    const c = x > y ? 1 : x < y ? -1 : 0
    return dir === "asc" ? c : -c
  })
}
function groupBy<T>(rows: T[], key: (r: T) => any): Map<any, T[]> {
  const groups = new Map<any, T[]>()
  for (const r of rows) {
    const k = key(r)
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }
  return groups
}
const indexBy = (rows: Row[], col: string) => new Map(rows.map((r) => [r[col], r] as [any, Row]))

/** Applies a PostgREST-style `.gte(col, from)` / `.lte(col, to)` to computed rows (NULL never matches). */
export function inDateRange(rows: Row[], col: string, fromDate: string | null, toDate: string | null): Row[] {
  return rows.filter((r) => {
    const v = r[col]
    if (fromDate && !(v !== null && v !== undefined && String(v) >= fromDate)) return false
    if (toDate && !(v !== null && v !== undefined && String(v) <= toDate)) return false
    return true
  })
}
/** PostgREST `.neq(col, value)`: `col <> value`, so NULL never matches. */
export const whereNot = (rows: Row[], col: string, value: any) => rows.filter((r) => r[col] !== null && r[col] !== undefined && r[col] !== value)
/** PostgREST `.eq(col, value)` */
export const whereEq = (rows: Row[], col: string, value: any) => rows.filter((r) => r[col] === value)
/** PostgREST `.in(col, values)` */
export const whereIn = (rows: Row[], col: string, values: any[]) => rows.filter((r) => values.includes(r[col]))

// ---------------------------------------------------------------------------------------------------------
// Base-table readers (only the columns the views used)
// ---------------------------------------------------------------------------------------------------------
const readSalesOrders = (db: Db) =>
  readAll(db, "sales_orders", "so_id, so_number, customer_id, order_date, delivery_date, total, status, payment_terms, installments", "so_id")
const readPurchaseOrders = (db: Db) =>
  readAll(
    db,
    "purchase_orders",
    "po_id, po_number, supplier_id, order_date, delivery_date, total, tax_amount, other_costs, status, payment_terms, installments, currency, cost_finalized",
    "po_id",
  )
const readCustomers = (db: Db) => readAll(db, "customers", "customer_id, customer_name, email, phone, city, country", "customer_id")
const readSuppliers = (db: Db) => readAll(db, "suppliers", "supplier_id, supplier_name, email, phone, city, country, lead_time_days", "supplier_id")
const readInventory = (db: Db) =>
  readAll(db, "inventory", "inventory_id, product_id, quantity, unit_cost, reorder_point, location, last_updated", "inventory_id")
const readProducts = (db: Db) =>
  readAll(db, "products", "product_id, product_name, sku, category_id, unit_price, last_landed_cost, markup_percentage", "product_id")
const readCategories = (db: Db) => readAll(db, "product_categories", "category_id, category_name", "category_id")
const readSalesOrderItems = (db: Db) => readAll(db, "sales_order_items", "so_item_id, so_id, product_id, quantity, total", "so_item_id")
const readAR = (db: Db) =>
  readAll(
    db,
    "accounts_receivable",
    "invoice_id, invoice_number, invoice_date, due_date, amount, collected_amount, status, payment_terms, installment_months, months_paid, customer_id",
    "invoice_id",
  )
const readAP = (db: Db) =>
  readAll(
    db,
    "accounts_payable",
    "invoice_id, invoice_number, invoice_date, due_date, amount, paid_amount, status, payment_terms, installment_months, months_paid, supplier_id",
    "invoice_id",
  )

// ---------------------------------------------------------------------------------------------------------
// 1. report_sales_summary
// ---------------------------------------------------------------------------------------------------------
export async function salesSummary(db: Db): Promise<Row[]> {
  const orders = await readSalesOrders(db)
  const rows = [...groupBy(orders, (o) => monthOf(o.order_date))].map(([month, g]) => ({
    month,
    total_orders: g.length,
    completed_orders: g.filter((o) => o.status === "completed" || o.status === "delivered").length,
    pending_orders: g.filter((o) => o.status === "pending_ceo" || o.status === "pending_accountant").length,
    total_revenue: sum(g.map((o) => num(o.total))),
    avg_order_value: avg(g.map((o) => num(o.total))),
    unique_customers: countDistinct(g.map((o) => o.customer_id)),
  }))
  return orderBy(rows, "month", "desc")
}

// 2. report_sales_details
export async function salesDetails(db: Db): Promise<Row[]> {
  const [orders, customers] = await Promise.all([readSalesOrders(db), readCustomers(db)])
  const byId = indexBy(customers, "customer_id")
  const rows = orders.map((so) => {
    const c = so.customer_id === null || so.customer_id === undefined ? undefined : byId.get(so.customer_id)
    return {
      so_id: so.so_id,
      so_number: val(so.so_number),
      order_date: val(so.order_date),
      delivery_date: val(so.delivery_date),
      total: num(so.total),
      status: val(so.status),
      payment_terms: val(so.payment_terms),
      installments: num(so.installments),
      customer_id: c ? c.customer_id : null,
      customer_name: c ? val(c.customer_name) : null,
      customer_email: c ? val(c.email) : null,
      customer_phone: c ? val(c.phone) : null,
      customer_city: c ? val(c.city) : null,
      customer_country: c ? val(c.country) : null,
    }
  })
  return orderBy(rows, "order_date", "desc")
}

// 3. report_sales_by_customer
export async function salesByCustomer(db: Db): Promise<Row[]> {
  const [customers, orders] = await Promise.all([readCustomers(db), readSalesOrders(db)])
  const ordersBy = groupBy(orders, (o) => o.customer_id)
  const rows = customers.map((c) => {
    const g = ordersBy.get(c.customer_id) || []
    return {
      customer_id: c.customer_id,
      customer_name: val(c.customer_name),
      email: val(c.email),
      phone: val(c.phone),
      city: val(c.city),
      country: val(c.country),
      total_orders: g.length,
      total_spent: coalesce0(sum(g.map((o) => num(o.total)))),
      avg_order_value: coalesce0(avg(g.map((o) => num(o.total)))),
      last_order_date: max(g.map((o) => o.order_date)),
    }
  })
  return orderBy(rows, "total_spent", "desc")
}

// 4. report_purchase_summary
export async function purchaseSummary(db: Db): Promise<Row[]> {
  const orders = await readPurchaseOrders(db)
  const rows = [...groupBy(orders, (o) => monthOf(o.order_date))].map(([month, g]) => ({
    month,
    total_orders: g.length,
    received_orders: g.filter((o) => o.status === "received").length,
    pending_orders: g.filter((o) => o.status === "pending_ceo").length,
    total_amount: sum(g.map((o) => num(o.total))),
    total_tax: sum(g.map((o) => coalesce0(num(o.tax_amount)))),
    total_other_costs: sum(g.map((o) => coalesce0(num(o.other_costs)))),
    avg_order_value: avg(g.map((o) => num(o.total))),
    unique_suppliers: countDistinct(g.map((o) => o.supplier_id)),
  }))
  return orderBy(rows, "month", "desc")
}

// 5. report_purchase_details
export async function purchaseDetails(db: Db): Promise<Row[]> {
  const [orders, suppliers] = await Promise.all([readPurchaseOrders(db), readSuppliers(db)])
  const byId = indexBy(suppliers, "supplier_id")
  const rows = orders.map((po) => {
    const s = po.supplier_id === null || po.supplier_id === undefined ? undefined : byId.get(po.supplier_id)
    return {
      po_id: po.po_id,
      po_number: val(po.po_number),
      order_date: val(po.order_date),
      delivery_date: val(po.delivery_date),
      total: num(po.total),
      tax_amount: num(po.tax_amount),
      other_costs: num(po.other_costs),
      status: val(po.status),
      payment_terms: val(po.payment_terms),
      installments: num(po.installments),
      currency: val(po.currency),
      cost_finalized: val(po.cost_finalized),
      supplier_id: s ? s.supplier_id : null,
      supplier_name: s ? val(s.supplier_name) : null,
      supplier_email: s ? val(s.email) : null,
      supplier_phone: s ? val(s.phone) : null,
      supplier_city: s ? val(s.city) : null,
      supplier_country: s ? val(s.country) : null,
      lead_time_days: s ? num(s.lead_time_days) : null,
    }
  })
  return orderBy(rows, "order_date", "desc")
}

// 6. report_purchase_by_supplier
export async function purchaseBySupplier(db: Db): Promise<Row[]> {
  const [suppliers, orders] = await Promise.all([readSuppliers(db), readPurchaseOrders(db)])
  const ordersBy = groupBy(orders, (o) => o.supplier_id)
  const rows = suppliers.map((s) => {
    const g = ordersBy.get(s.supplier_id) || []
    return {
      supplier_id: s.supplier_id,
      supplier_name: val(s.supplier_name),
      email: val(s.email),
      phone: val(s.phone),
      city: val(s.city),
      country: val(s.country),
      lead_time_days: num(s.lead_time_days),
      total_orders: g.length,
      total_amount: coalesce0(sum(g.map((o) => num(o.total)))),
      avg_order_value: coalesce0(avg(g.map((o) => num(o.total)))),
      last_order_date: max(g.map((o) => o.order_date)),
    }
  })
  return orderBy(rows, "total_amount", "desc")
}

// ---------------------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------------------
/** inventory JOIN products LEFT JOIN product_categories */
async function inventoryJoined(db: Db) {
  const [inventory, products, categories] = await Promise.all([readInventory(db), readProducts(db), readCategories(db)])
  const productsById = indexBy(products, "product_id")
  const categoriesById = indexBy(categories, "category_id")
  const out: { i: Row; p: Row; category: string | null }[] = []
  for (const i of inventory) {
    const p = i.product_id === null || i.product_id === undefined ? undefined : productsById.get(i.product_id)
    if (!p) continue
    const pc = p.category_id === null || p.category_id === undefined ? undefined : categoriesById.get(p.category_id)
    out.push({ i, p, category: pc ? val(pc.category_name) : null })
  }
  return out
}
function stockStatus(quantity: number | null, reorderPoint: number | null) {
  if (quantity !== null && quantity <= 0) return "Out of Stock"
  if (quantity !== null && reorderPoint !== null && quantity <= reorderPoint) return "Low Stock"
  return "In Stock"
}

// 7. report_inventory_valuation
export async function inventoryValuation(db: Db): Promise<Row[]> {
  const rows = (await inventoryJoined(db)).map(({ i, p, category }) => {
    const quantity = num(i.quantity)
    const unitCost = num(i.unit_cost)
    const reorderPoint = num(i.reorder_point)
    return {
      inventory_id: i.inventory_id,
      product_id: i.product_id,
      product_name: val(p.product_name),
      sku: val(p.sku),
      category,
      quantity,
      unit_cost: unitCost,
      total_value: mul(quantity, unitCost),
      reorder_point: reorderPoint,
      location: val(i.location),
      stock_status: stockStatus(quantity, reorderPoint),
      last_updated: val(i.last_updated),
    }
  })
  return orderBy(rows, "total_value", "desc")
}

// 8. report_inventory_by_category
export async function inventoryByCategory(db: Db): Promise<Row[]> {
  const joined = await inventoryJoined(db)
  const rows = [...groupBy(joined, (j) => j.category)].map(([category, g]) => {
    const q = (j: { i: Row }) => num(j.i.quantity)
    const rp = (j: { i: Row }) => num(j.i.reorder_point)
    return {
      category: category === null ? "Uncategorized" : category,
      total_products: g.length,
      total_quantity: sum(g.map(q)),
      total_value: sum(g.map((j) => mul(q(j), num(j.i.unit_cost)))),
      avg_unit_cost: avg(g.map((j) => num(j.i.unit_cost))),
      low_stock_count: g.filter((j) => q(j) !== null && rp(j) !== null && q(j)! <= rp(j)!).length,
      out_of_stock_count: g.filter((j) => q(j) !== null && q(j)! <= 0).length,
    }
  })
  return orderBy(rows, "total_value", "desc")
}

// ---------------------------------------------------------------------------------------------------------
// AR / AP
// ---------------------------------------------------------------------------------------------------------
function agingBucket(status: any, days: number | null) {
  if (status === "paid") return "Paid"
  if (days !== null && days <= 0) return "Current"
  if (days !== null && days <= 30) return "1-30 Days"
  if (days !== null && days <= 60) return "31-60 Days"
  if (days !== null && days <= 90) return "61-90 Days"
  return "90+ Days"
}

// 9. report_ar_aging
export async function arAging(db: Db): Promise<Row[]> {
  const [invoices, customers] = await Promise.all([readAR(db), readCustomers(db)])
  const byId = indexBy(customers, "customer_id")
  const today = todayUtc()
  const rows: Row[] = []
  for (const ar of invoices) {
    const c = ar.customer_id === null || ar.customer_id === undefined ? undefined : byId.get(ar.customer_id)
    if (!c) continue
    const days = daysSince(ar.due_date, today)
    rows.push({
      invoice_id: ar.invoice_id,
      invoice_number: val(ar.invoice_number),
      invoice_date: val(ar.invoice_date),
      due_date: val(ar.due_date),
      total_amount: num(ar.amount),
      paid_amount: num(ar.collected_amount),
      balance_due: minus(num(ar.amount), coalesce0(num(ar.collected_amount))),
      status: val(ar.status),
      payment_terms: val(ar.payment_terms),
      installment_months: num(ar.installment_months),
      months_paid: num(ar.months_paid),
      customer_id: c.customer_id,
      customer_name: val(c.customer_name),
      customer_email: val(c.email),
      customer_phone: val(c.phone),
      days_overdue: days,
      aging_bucket: agingBucket(ar.status, days),
    })
  }
  return orderBy(rows, "due_date", "asc")
}

function invoiceSummary(invoices: Row[], paidCol: string) {
  const today = todayUtc()
  const amount = (r: Row) => num(r.amount)
  const paid = (r: Row) => coalesce0(num(r[paidCol]))
  const overdue = (r: Row) => r.status !== null && r.status !== undefined && r.status !== "paid" && r.due_date !== null && r.due_date !== undefined && today > String(r.due_date).slice(0, 10)
  return {
    total_invoices: invoices.length,
    total_invoiced: sum(invoices.map(amount)),
    paid_total: sum(invoices.map(paid)),
    total_outstanding: sum(invoices.map((r) => minus(amount(r), paid(r)))),
    paid_invoices: invoices.filter((r) => r.status === "paid").length,
    open_invoices: invoices.filter((r) => r.status === "pending" || r.status === "partially_paid").length,
    overdue_invoices: invoices.filter(overdue).length,
    overdue_amount: sum(invoices.map((r) => (overdue(r) ? minus(amount(r), paid(r)) : 0))),
  }
}

// 10. report_ar_summary (single row)
export async function arSummary(db: Db): Promise<Row> {
  const s = invoiceSummary(await readAR(db), "collected_amount")
  return {
    total_invoices: s.total_invoices,
    total_invoiced: s.total_invoiced,
    total_collected: s.paid_total,
    total_outstanding: s.total_outstanding,
    paid_invoices: s.paid_invoices,
    open_invoices: s.open_invoices,
    overdue_invoices: s.overdue_invoices,
    overdue_amount: s.overdue_amount,
  }
}

// 11. report_ap_aging
export async function apAging(db: Db): Promise<Row[]> {
  const [invoices, suppliers] = await Promise.all([readAP(db), readSuppliers(db)])
  const byId = indexBy(suppliers, "supplier_id")
  const today = todayUtc()
  const rows: Row[] = []
  for (const ap of invoices) {
    const s = ap.supplier_id === null || ap.supplier_id === undefined ? undefined : byId.get(ap.supplier_id)
    if (!s) continue
    const days = daysSince(ap.due_date, today)
    rows.push({
      invoice_id: ap.invoice_id,
      invoice_number: val(ap.invoice_number),
      invoice_date: val(ap.invoice_date),
      due_date: val(ap.due_date),
      total_amount: num(ap.amount),
      paid_amount: num(ap.paid_amount),
      balance_due: minus(num(ap.amount), coalesce0(num(ap.paid_amount))),
      status: val(ap.status),
      payment_terms: val(ap.payment_terms),
      installment_months: num(ap.installment_months),
      months_paid: num(ap.months_paid),
      supplier_id: s.supplier_id,
      supplier_name: val(s.supplier_name),
      supplier_email: val(s.email),
      supplier_phone: val(s.phone),
      days_overdue: days,
      aging_bucket: agingBucket(ap.status, days),
    })
  }
  return orderBy(rows, "due_date", "asc")
}

// 12. report_ap_summary (single row)
export async function apSummary(db: Db): Promise<Row> {
  const s = invoiceSummary(await readAP(db), "paid_amount")
  return {
    total_invoices: s.total_invoices,
    total_invoiced: s.total_invoiced,
    total_paid: s.paid_total,
    total_outstanding: s.total_outstanding,
    paid_invoices: s.paid_invoices,
    open_invoices: s.open_invoices,
    overdue_invoices: s.overdue_invoices,
    overdue_amount: s.overdue_amount,
  }
}

// 13. report_financial_summary (single row)
export async function financialSummary(db: Db): Promise<Row> {
  const [sales, purchases, ar, ap, customers, suppliers, inventory] = await Promise.all([
    readAll(db, "sales_orders", "so_id, total, status", "so_id"),
    readAll(db, "purchase_orders", "po_id, total, status", "po_id"),
    readAll(db, "accounts_receivable", "invoice_id, amount, collected_amount, status", "invoice_id"),
    readAll(db, "accounts_payable", "invoice_id, amount, paid_amount, status", "invoice_id"),
    readAll(db, "customers", "customer_id", "customer_id"),
    readAll(db, "suppliers", "supplier_id", "supplier_id"),
    readAll(db, "inventory", "inventory_id, quantity, unit_cost", "inventory_id"),
  ])
  const notPaid = (r: Row) => r.status !== null && r.status !== undefined && r.status !== "paid"
  const totalRevenue = coalesce0(sum(sales.filter((s) => s.status === "completed" || s.status === "delivered").map((s) => num(s.total))))
  const totalExpenses = coalesce0(sum(purchases.filter((p) => p.status === "received").map((p) => num(p.total))))
  return {
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    gross_profit: totalRevenue - totalExpenses,
    ar_outstanding: coalesce0(sum(ar.filter(notPaid).map((r) => minus(num(r.amount), coalesce0(num(r.collected_amount)))))),
    ap_outstanding: coalesce0(sum(ap.filter(notPaid).map((r) => minus(num(r.amount), coalesce0(num(r.paid_amount)))))),
    total_sales_orders: sales.length,
    total_purchase_orders: purchases.length,
    total_customers: customers.length,
    total_suppliers: suppliers.length,
    inventory_value: coalesce0(sum(inventory.map((i) => mul(num(i.quantity), num(i.unit_cost))))),
  }
}

// ---------------------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------------------
const SOLD_STATUSES = ["completed", "delivered", "shipped"]

/** sales_order_items JOIN sales_orders WHERE so.status IN SOLD_STATUSES */
async function soldItems(db: Db) {
  const [items, orders] = await Promise.all([readSalesOrderItems(db), readAll(db, "sales_orders", "so_id, customer_id, status", "so_id")])
  const ordersById = indexBy(orders, "so_id")
  const out: { item: Row; order: Row }[] = []
  for (const item of items) {
    const order = item.so_id === null || item.so_id === undefined ? undefined : ordersById.get(item.so_id)
    if (order && SOLD_STATUSES.includes(order.status)) out.push({ item, order })
  }
  return out
}

// 14. report_product_performance
export async function productPerformance(db: Db): Promise<Row[]> {
  const [products, categories, inventory, sold] = await Promise.all([readProducts(db), readCategories(db), readInventory(db), soldItems(db)])
  const categoriesById = indexBy(categories, "category_id")
  const inventoryBy = groupBy(inventory, (i) => i.product_id)
  const salesBy = new Map<any, { total_quantity_sold: number | null; total_revenue: number | null; order_count: number }>()
  for (const [productId, g] of groupBy(sold, (s) => s.item.product_id)) {
    if (productId === null || productId === undefined) continue
    salesBy.set(productId, {
      total_quantity_sold: sum(g.map((s) => num(s.item.quantity))),
      total_revenue: sum(g.map((s) => num(s.item.total))),
      order_count: countDistinct(g.map((s) => s.item.so_id)),
    })
  }
  const rows: Row[] = []
  for (const p of products) {
    const pc = p.category_id === null || p.category_id === undefined ? undefined : categoriesById.get(p.category_id)
    const sales = salesBy.get(p.product_id)
    let margin: number | null = 0
    if (sales && sales.total_quantity_sold !== null && sales.total_quantity_sold > 0) {
      const revenue = sales.total_revenue
      // SQL divides by total_revenue; a zero revenue would raise division_by_zero there. 0 is returned instead.
      if (revenue === null) margin = null
      else if (revenue === 0) margin = 0
      else margin = round2(((revenue - sales.total_quantity_sold * coalesce0(num(p.last_landed_cost))) / revenue) * 100)
    }
    // LEFT JOIN inventory: one output row per inventory row of the product (one row with NULLs when it has none)
    const invRows: (Row | null)[] = inventoryBy.get(p.product_id) || [null]
    for (const i of invRows) {
      rows.push({
        product_id: p.product_id,
        product_name: val(p.product_name),
        sku: val(p.sku),
        category: pc ? val(pc.category_name) : null,
        unit_price: num(p.unit_price),
        last_landed_cost: num(p.last_landed_cost),
        markup_percentage: num(p.markup_percentage),
        current_stock: coalesce0(i ? num(i.quantity) : null),
        reorder_point: coalesce0(i ? num(i.reorder_point) : null),
        total_quantity_sold: coalesce0(sales ? sales.total_quantity_sold : null),
        total_revenue: coalesce0(sales ? sales.total_revenue : null),
        order_count: sales ? sales.order_count : 0,
        profit_margin_pct: margin,
      })
    }
  }
  return orderBy(rows, "total_revenue", "desc")
}

// 15. report_cash_flow
export async function cashFlow(db: Db): Promise<Row[]> {
  const entries = await readAll(db, "balance_entries", "entry_id, created_at, entry_type, amount", "entry_id")
  const rows = [...groupBy(entries, (e) => monthOf(e.created_at))].map(([month, g]) => ({
    month,
    total_inflow: sum(g.map((e) => (e.entry_type === "credit" ? num(e.amount) : 0))),
    total_outflow: sum(g.map((e) => (e.entry_type === "debit" ? num(e.amount) : 0))),
    net_cash_flow: sum(g.map((e) => {
      const a = num(e.amount)
      return e.entry_type === "credit" ? a : a === null ? null : -a
    })),
    transaction_count: g.length,
  }))
  return orderBy(rows, "month", "desc")
}

// 16. report_top_products (LIMIT 20)
export async function topProducts(db: Db): Promise<Row[]> {
  const [products, categories, sold] = await Promise.all([readProducts(db), readCategories(db), soldItems(db)])
  const productsById = indexBy(products, "product_id")
  const categoriesById = indexBy(categories, "category_id")
  const joined = sold.filter((s) => s.item.product_id !== null && s.item.product_id !== undefined && productsById.has(s.item.product_id))
  const rows = [...groupBy(joined, (s) => s.item.product_id)].map(([productId, g]) => {
    const p = productsById.get(productId)!
    const pc = p.category_id === null || p.category_id === undefined ? undefined : categoriesById.get(p.category_id)
    return {
      product_id: p.product_id,
      product_name: val(p.product_name),
      sku: val(p.sku),
      category: pc ? val(pc.category_name) : null,
      total_sold: sum(g.map((s) => num(s.item.quantity))),
      total_revenue: sum(g.map((s) => num(s.item.total))),
      order_count: countDistinct(g.map((s) => s.order.so_id)),
      customer_count: countDistinct(g.map((s) => s.order.customer_id)),
    }
  })
  rows.sort((a, b) => a.product_id - b.product_id)
  return orderBy(rows, "total_revenue", "desc").slice(0, 20)
}
