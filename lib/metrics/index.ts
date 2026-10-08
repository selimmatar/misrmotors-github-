/**
 * METRICS LAYER - Single Source of Truth for all KPIs
 *
 * All dashboards MUST consume metrics from this layer only.
 * Each KPI is defined with:
 * - Exact formula/calculation
 * - Source table(s)
 * - Status filters applied
 */

import { createAdminClient } from "@/lib/supabase/admin"

/** Sales order statuses that count as revenue (single definition used by every revenue KPI below). */
export const REVENUE_STATUSES = ["accountant_approved", "ready_for_delivery", "shipped", "delivered"]
const REVENUE_STATUSES_SQL = REVENUE_STATUSES.map((s) => `'${s}'`).join(", ")

export interface DateRange {
  from?: Date
  to?: Date
}

export interface SalesMetrics {
  totalRevenue: number
  totalOrders: number
  completedOrders: number
  pendingOrders: number
  averageOrderValue: number
  uniqueCustomers: number
  revenueByStatus: Record<string, number>
  monthlyRevenue: { month: string; revenue: number }[]
  // Drill-down data
  _query: string
  _recordCount: number
}

export interface InventoryMetrics {
  totalValue: number
  totalQuantity: number
  totalProducts: number
  lowStockCount: number
  outOfStockCount: number
  valueByCategory: { category: string; value: number; quantity: number }[]
  // Drill-down data
  _query: string
  _recordCount: number
}

export interface ARMetrics {
  totalInvoiced: number
  totalCollected: number
  totalOutstanding: number
  overdueAmount: number
  totalInvoices: number
  openInvoices: number
  paidInvoices: number
  overdueInvoices: number
  agingBuckets: {
    current: number
    days30: number
    days60: number
    days90plus: number
  }
  // Drill-down data
  _query: string
  _recordCount: number
}

export interface APMetrics {
  totalInvoiced: number
  totalPaid: number
  totalOutstanding: number
  overdueAmount: number
  totalInvoices: number
  openInvoices: number
  paidInvoices: number
  overdueInvoices: number
  agingBuckets: {
    current: number
    days30: number
    days60: number
    days90plus: number
  }
  // Drill-down data
  _query: string
  _recordCount: number
}

export interface OrderCountsByStatus {
  pending: number
  pendingAccountant: number
  accountantApproved: number
  shipped: number
  delivered: number
  cancelled: number
  total: number
  // Drill-down data
  _query: string
}

export interface KPIMetrics {
  // Revenue & Profit
  totalRevenue: number
  totalCosts: number
  grossProfit: number
  grossProfitMargin: number
  revenueTrend: number // Percentage change vs previous period

  // Cash Position
  cashPosition: number
  arBalance: number
  apBalance: number

  // Inventory
  inventoryValue: number
  inventoryTurnover: number

  // Operations
  avgOrderValue: number
  orderFulfillmentRate: number
  pendingOrdersCount: number

  // Customers
  totalCustomers: number
  newCustomersThisMonth: number

  // Metadata
  calculatedAt: string
  dateRange: DateRange
}

/**
 * FORMULA: Total Sales Revenue
 * = SUM(total) from sales_orders WHERE status IN ('accountant_approved', 'ready_for_delivery', 'shipped', 'delivered')
 * Optional date filter on order_date
 */
export async function getSalesMetrics(dateRange?: DateRange): Promise<SalesMetrics> {
  const supabase = createAdminClient()

  // Use the report_sales_summary view for aggregated data
  let query = supabase.from("sales_orders").select("*")

  if (dateRange?.from) {
    query = query.gte("order_date", dateRange.from.toISOString().split("T")[0])
  }
  if (dateRange?.to) {
    query = query.lte("order_date", dateRange.to.toISOString().split("T")[0])
  }

  const { data: salesOrders, error } = await query

  if (error) {
    console.error("[Metrics] Error fetching sales orders:", error)
    throw error
  }

  const orders = salesOrders || []

  // FORMULA: Revenue = SUM(total) WHERE status IN approved/shipped/delivered
  const completedStatuses = REVENUE_STATUSES
  const completedOrders = orders.filter((so) => completedStatuses.includes(so.status))
  const totalRevenue = completedOrders.reduce((sum, so) => sum + (Number(so.net_total) || Number(so.total) || 0), 0)

  // FORMULA: Pending Orders = COUNT WHERE status IN pending statuses
  const pendingStatuses = ["pending", "pending_accountant"]
  const pendingOrders = orders.filter((so) => pendingStatuses.includes(so.status))

  // Revenue by status
  const revenueByStatus: Record<string, number> = {}
  orders.forEach((so) => {
    const status = so.status || "unknown"
    revenueByStatus[status] = (revenueByStatus[status] || 0) + (Number(so.net_total) || Number(so.total) || 0)
  })

  // Unique customers
  const uniqueCustomerIds = new Set(orders.map((so) => so.customer_id))

  // Monthly revenue breakdown
  const monthlyMap = new Map<string, number>()
  completedOrders.forEach((so) => {
    const month = so.order_date?.substring(0, 7) || "unknown"
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + (Number(so.net_total) || Number(so.total) || 0))
  })
  const monthlyRevenue = Array.from(monthlyMap.entries())
    .map(([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    totalRevenue,
    totalOrders: orders.length,
    completedOrders: completedOrders.length,
    pendingOrders: pendingOrders.length,
    averageOrderValue: completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0,
    uniqueCustomers: uniqueCustomerIds.size,
    revenueByStatus,
    monthlyRevenue,
    _query: `SELECT * FROM sales_orders WHERE status IN (${REVENUE_STATUSES_SQL})${dateRange?.from ? ` AND order_date >= '${dateRange.from.toISOString().split("T")[0]}'` : ""}${dateRange?.to ? ` AND order_date <= '${dateRange.to.toISOString().split("T")[0]}'` : ""}`,
    _recordCount: orders.length,
  }
}

/**
 * FORMULA: Inventory Value
 * = SUM(quantity * unit_cost) from inventory JOIN products
 */
export async function getInventoryMetrics(): Promise<InventoryMetrics> {
  const supabase = createAdminClient()

  // The report_inventory_valuation view no longer exists: read the base tables with the same definition
  // (total_value = quantity * unit_cost; low_stock = 0 < quantity <= reorder_point; out_of_stock = quantity 0).
  const { data: rawInventory, error } = await supabase
    .from("inventory")
    .select("quantity, unit_cost, reorder_point, products(product_name, product_categories(category_name))")

  if (error) {
    console.error("[Metrics] Error fetching inventory:", error)
    throw error
  }

  const inventoryData = (rawInventory || []).map((row: any) => {
    const quantity = Number(row.quantity) || 0
    const reorderPoint = Number(row.reorder_point) || 0
    return {
      quantity,
      total_value: quantity * (Number(row.unit_cost) || 0),
      category: row.products?.product_categories?.category_name || null,
      stock_status: quantity <= 0 ? "out_of_stock" : quantity <= reorderPoint ? "low_stock" : "in_stock",
    }
  })

  const items = inventoryData || []

  // FORMULA: Total Value = SUM(total_value) from view
  const totalValue = items.reduce((sum, item) => sum + (Number(item.total_value) || 0), 0)
  const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)

  // FORMULA: Low Stock = COUNT WHERE stock_status = 'low_stock'
  const lowStockCount = items.filter((item) => item.stock_status === "low_stock").length

  // FORMULA: Out of Stock = COUNT WHERE quantity = 0 OR stock_status = 'out_of_stock'
  const outOfStockCount = items.filter(
    (item) => item.stock_status === "out_of_stock" || (Number(item.quantity) || 0) === 0,
  ).length

  // Group by category
  const categoryMap = new Map<string, { value: number; quantity: number }>()
  items.forEach((item) => {
    const category = item.category || "Uncategorized"
    const existing = categoryMap.get(category) || { value: 0, quantity: 0 }
    existing.value += Number(item.total_value) || 0
    existing.quantity += Number(item.quantity) || 0
    categoryMap.set(category, existing)
  })

  const valueByCategory = Array.from(categoryMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.value - a.value)

  return {
    totalValue,
    totalQuantity,
    totalProducts: items.length,
    lowStockCount,
    outOfStockCount,
    valueByCategory,
    _query: "SELECT quantity, unit_cost, reorder_point FROM inventory JOIN products",
    _recordCount: items.length,
  }
}

/**
 * FORMULA: Accounts Receivable
 * Calculated directly from accounts_receivable (the report_ar_* views were dropped)
 */
export async function getARMetrics(dateRange?: DateRange): Promise<ARMetrics> {
  const supabase = createAdminClient()

  // The report_ar_* views were dropped; the direct calculation below is the single implementation.
  return calculateARMetricsFallback(dateRange)
}

async function calculateARMetricsFallback(dateRange?: DateRange): Promise<ARMetrics> {
  const supabase = createAdminClient()

  let query = supabase.from("accounts_receivable").select("*")

  if (dateRange?.from) {
    query = query.gte("invoice_date", dateRange.from.toISOString().split("T")[0])
  }
  if (dateRange?.to) {
    query = query.lte("invoice_date", dateRange.to.toISOString().split("T")[0])
  }

  const { data: invoices } = await query
  const items = invoices || []

  const today = new Date()
  const agingBuckets = { current: 0, days30: 0, days60: 0, days90plus: 0 }

  let totalInvoiced = 0
  let totalCollected = 0
  let overdueAmount = 0
  let openCount = 0
  let paidCount = 0
  let overdueCount = 0

  items.forEach((inv) => {
    totalInvoiced += Number(inv.amount) || 0
    totalCollected += Number(inv.collected_amount) || 0

    if (inv.status === "paid") {
      paidCount++
      return
    }

    openCount++
    const balance = Number(inv.balance) || 0
    const dueDate = new Date(inv.due_date)
    const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysPastDue > 0) {
      overdueAmount += balance
      overdueCount++
    }

    if (daysPastDue < 0) agingBuckets.current += balance
    else if (daysPastDue <= 30) agingBuckets.days30 += balance
    else if (daysPastDue <= 60) agingBuckets.days60 += balance
    else agingBuckets.days90plus += balance
  })

  return {
    totalInvoiced,
    totalCollected,
    totalOutstanding: totalInvoiced - totalCollected,
    overdueAmount,
    totalInvoices: items.length,
    openInvoices: openCount,
    paidInvoices: paidCount,
    overdueInvoices: overdueCount,
    agingBuckets,
    _query: `SELECT * FROM accounts_receivable`,
    _recordCount: items.length,
  }
}

/**
 * FORMULA: Accounts Payable
 * Calculated directly from accounts_payable (the report_ap_* views were dropped)
 */
export async function getAPMetrics(dateRange?: DateRange): Promise<APMetrics> {
  const supabase = createAdminClient()

  // The report_ap_* views were dropped; the direct calculation below is the single implementation.
  return calculateAPMetricsFallback(dateRange)
}

async function calculateAPMetricsFallback(dateRange?: DateRange): Promise<APMetrics> {
  const supabase = createAdminClient()

  let query = supabase.from("accounts_payable").select("*")

  if (dateRange?.from) {
    query = query.gte("invoice_date", dateRange.from.toISOString().split("T")[0])
  }
  if (dateRange?.to) {
    query = query.lte("invoice_date", dateRange.to.toISOString().split("T")[0])
  }

  const { data: invoices } = await query
  const items = invoices || []

  const today = new Date()
  const agingBuckets = { current: 0, days30: 0, days60: 0, days90plus: 0 }

  let totalInvoiced = 0
  let totalPaid = 0
  let overdueAmount = 0
  let openCount = 0
  let paidCount = 0
  let overdueCount = 0

  items.forEach((inv) => {
    totalInvoiced += Number(inv.amount) || 0
    totalPaid += Number(inv.paid_amount) || 0

    if (inv.status === "paid") {
      paidCount++
      return
    }

    openCount++
    const balance = Number(inv.balance) || 0
    const dueDate = new Date(inv.due_date)
    const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysPastDue > 0) {
      overdueAmount += balance
      overdueCount++
    }

    if (daysPastDue < 0) agingBuckets.current += balance
    else if (daysPastDue <= 30) agingBuckets.days30 += balance
    else if (daysPastDue <= 60) agingBuckets.days60 += balance
    else agingBuckets.days90plus += balance
  })

  return {
    totalInvoiced,
    totalPaid,
    totalOutstanding: totalInvoiced - totalPaid,
    overdueAmount,
    totalInvoices: items.length,
    openInvoices: openCount,
    paidInvoices: paidCount,
    overdueInvoices: overdueCount,
    agingBuckets,
    _query: `SELECT * FROM accounts_payable`,
    _recordCount: items.length,
  }
}

/**
 * FORMULA: Order Counts by Status
 * = COUNT(*) GROUP BY status from sales_orders
 */
export async function getOrderCountsByStatus(dateRange?: DateRange): Promise<OrderCountsByStatus> {
  const supabase = createAdminClient()

  let query = supabase.from("sales_orders").select("status")

  if (dateRange?.from) {
    query = query.gte("order_date", dateRange.from.toISOString().split("T")[0])
  }
  if (dateRange?.to) {
    query = query.lte("order_date", dateRange.to.toISOString().split("T")[0])
  }

  const { data: orders, error } = await query

  if (error) {
    console.error("[Metrics] Error fetching order counts:", error)
    throw error
  }

  const items = orders || []
  const counts: Record<string, number> = {}

  items.forEach((order) => {
    const status = order.status || "unknown"
    counts[status] = (counts[status] || 0) + 1
  })

  return {
    pending: counts["pending"] || 0,
    pendingAccountant: counts["pending_accountant"] || 0,
    accountantApproved: counts["accountant_approved"] || 0,
    shipped: counts["shipped"] || 0,
    delivered: counts["delivered"] || 0,
    cancelled: counts["cancelled"] || 0,
    total: items.length,
    _query: `SELECT status, COUNT(*) FROM sales_orders GROUP BY status`,
  }
}

/**
 * Get all KPIs in a single call for dashboard consumption
 */
export async function getAllKPIs(dateRange?: DateRange): Promise<KPIMetrics> {
  const supabase = createAdminClient()

  // Fetch all metrics in parallel
  const [salesMetrics, inventoryMetrics, arMetrics, apMetrics, orderCounts] = await Promise.all([
    getSalesMetrics(dateRange),
    getInventoryMetrics(),
    getARMetrics(dateRange),
    getAPMetrics(dateRange),
    getOrderCountsByStatus(dateRange),
  ])

  // Calculate previous period for trend
  let revenueTrend = 0
  if (dateRange?.from && dateRange?.to) {
    const periodLength = dateRange.to.getTime() - dateRange.from.getTime()
    const prevFrom = new Date(dateRange.from.getTime() - periodLength)
    const prevTo = new Date(dateRange.from.getTime() - 1)

    try {
      const prevSales = await getSalesMetrics({ from: prevFrom, to: prevTo })
      if (prevSales.totalRevenue > 0) {
        revenueTrend = ((salesMetrics.totalRevenue - prevSales.totalRevenue) / prevSales.totalRevenue) * 100
      }
    } catch {
      // Ignore trend calculation errors
    }
  }

  // Get customer counts
  const { data: customers } = await supabase.from("customers").select("customer_id, created_at")
  const customerList = customers || []

  const today = new Date()
  const newCustomersThisMonth = customerList.filter((c) => {
    const created = new Date(c.created_at)
    return created.getMonth() === today.getMonth() && created.getFullYear() === today.getFullYear()
  }).length

  // Calculate costs from purchase orders
  let totalCostsQuery = supabase.from("purchase_orders").select("total, status")
  if (dateRange?.from) {
    totalCostsQuery = totalCostsQuery.gte("order_date", dateRange.from.toISOString().split("T")[0])
  }
  if (dateRange?.to) {
    totalCostsQuery = totalCostsQuery.lte("order_date", dateRange.to.toISOString().split("T")[0])
  }

  const { data: purchaseOrders } = await totalCostsQuery
  const completedPOStatuses = ["received", "received_with_issues", "approved", "completed"]
  const totalCosts = (purchaseOrders || [])
    .filter((po) => completedPOStatuses.includes(po.status))
    .reduce((sum, po) => sum + (Number(po.total) || 0), 0)

  const grossProfit = salesMetrics.totalRevenue - totalCosts
  const grossProfitMargin = salesMetrics.totalRevenue > 0 ? (grossProfit / salesMetrics.totalRevenue) * 100 : 0

  // Inventory turnover = COGS / Average Inventory Value
  const inventoryTurnover = inventoryMetrics.totalValue > 0 ? totalCosts / inventoryMetrics.totalValue : 0

  // Order fulfillment rate
  const fulfilledOrders = orderCounts.shipped + orderCounts.delivered
  const orderFulfillmentRate = orderCounts.total > 0 ? (fulfilledOrders / orderCounts.total) * 100 : 0

  return {
    totalRevenue: salesMetrics.totalRevenue,
    totalCosts,
    grossProfit,
    grossProfitMargin,
    revenueTrend,
    cashPosition: arMetrics.totalOutstanding - apMetrics.totalOutstanding,
    arBalance: arMetrics.totalOutstanding,
    apBalance: apMetrics.totalOutstanding,
    inventoryValue: inventoryMetrics.totalValue,
    inventoryTurnover,
    avgOrderValue: salesMetrics.averageOrderValue,
    orderFulfillmentRate,
    pendingOrdersCount: orderCounts.pending + orderCounts.pendingAccountant,
    totalCustomers: customerList.length,
    newCustomersThisMonth,
    calculatedAt: new Date().toISOString(),
    dateRange: dateRange || {},
  }
}

/**
 * Validation function to compare dashboard totals with raw sums
 */
export async function validateMetrics(): Promise<
  {
    kpi: string
    expected: number
    actual: number
    match: boolean
    query: string
  }[]
> {
  const supabase = createAdminClient()
  const results: { kpi: string; expected: number; actual: number; match: boolean; query: string }[] = []

  // Validate Sales Revenue
  const salesMetrics = await getSalesMetrics()
  const { data: rawSales } = await supabase
    .from("sales_orders")
    .select("total, net_total, status")
    .in("status", REVENUE_STATUSES)

  const rawSalesTotal = (rawSales || []).reduce((sum, so) => sum + (Number(so.net_total) || Number(so.total) || 0), 0)

  results.push({
    kpi: "Total Sales Revenue",
    expected: rawSalesTotal,
    actual: salesMetrics.totalRevenue,
    match: Math.abs(rawSalesTotal - salesMetrics.totalRevenue) < 0.01,
    query: `SELECT SUM(COALESCE(net_total, total)) FROM sales_orders WHERE status IN (${REVENUE_STATUSES_SQL})`,
  })

  // Validate Inventory Value
  const inventoryMetrics = await getInventoryMetrics()
  const { data: rawInventory } = await supabase.from("inventory").select("quantity, unit_cost")

  const rawInventoryValue = (rawInventory || []).reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0),
    0,
  )

  results.push({
    kpi: "Inventory Value",
    expected: rawInventoryValue,
    actual: inventoryMetrics.totalValue,
    match: Math.abs(rawInventoryValue - inventoryMetrics.totalValue) < 0.01,
    query: "SELECT SUM(quantity * unit_cost) FROM inventory",
  })

  // Validate AR Outstanding
  const arMetrics = await getARMetrics()
  const { data: rawAR } = await supabase.from("accounts_receivable").select("balance, status").neq("status", "paid")

  const rawARBalance = (rawAR || []).reduce((sum, inv) => sum + (Number(inv.balance) || 0), 0)

  results.push({
    kpi: "AR Outstanding",
    expected: rawARBalance,
    actual: arMetrics.totalOutstanding,
    match: Math.abs(rawARBalance - arMetrics.totalOutstanding) < 0.01,
    query: "SELECT SUM(balance) FROM accounts_receivable WHERE status != 'paid'",
  })

  // Validate AP Outstanding
  const apMetrics = await getAPMetrics()
  const { data: rawAP } = await supabase.from("accounts_payable").select("balance, status").neq("status", "paid")

  const rawAPBalance = (rawAP || []).reduce((sum, inv) => sum + (Number(inv.balance) || 0), 0)

  results.push({
    kpi: "AP Outstanding",
    expected: rawAPBalance,
    actual: apMetrics.totalOutstanding,
    match: Math.abs(rawAPBalance - apMetrics.totalOutstanding) < 0.01,
    query: "SELECT SUM(balance) FROM accounts_payable WHERE status != 'paid'",
  })

  return results
}
