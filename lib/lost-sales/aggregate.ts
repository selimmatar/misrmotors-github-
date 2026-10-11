// The rows the dropped report_lost_sales_summary / report_top_lost_items views returned
// (scripts/archive/004-simplify-lost-sales-table.sql), computed from lost_sales rows.
// SUM ignores empty quantities and COUNT(DISTINCT ...) ignores empty customers, as in the SQL. A customer is
// identified by email, or by name when there is no email.

type LostSaleRow = {
  requested_item_name?: string | null
  customer_name?: string | null
  customer_email?: string | null
  requested_quantity?: number | string | null
  request_date?: string | null
}

const quantity = (row: LostSaleRow) => Number(row.requested_quantity) || 0
const customerKey = (row: LostSaleRow) => (row.customer_email || "").trim().toLowerCase() || (row.customer_name || "").trim().toLowerCase()
const distinctCount = (values: string[]) => new Set(values.filter(Boolean)).size

export function lostSalesByMonth(rows: LostSaleRow[]) {
  const months = new Map<string, LostSaleRow[]>()
  for (const row of rows) {
    if (!row.request_date) continue
    const month = `${String(row.request_date).slice(0, 7)}-01`
    months.set(month, [...(months.get(month) || []), row])
  }
  return [...months.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([month, group]) => {
      const total = group.reduce((sum, row) => sum + quantity(row), 0)
      return {
        month,
        total_requests: group.length,
        unique_customers: distinctCount(group.map(customerKey)),
        unique_items: distinctCount(group.map((row) => row.requested_item_name || "")),
        total_quantity_requested: total,
        total_quantity: total, // the name the report generator reads
      }
    })
}

export function topLostItems(rows: LostSaleRow[], limit = 50) {
  const items = new Map<string, LostSaleRow[]>()
  for (const row of rows) {
    const name = row.requested_item_name || ""
    items.set(name, [...(items.get(name) || []), row])
  }
  return [...items.entries()]
    .map(([name, group]) => {
      const dates = group.map((row) => row.request_date).filter((d): d is string => !!d).sort()
      return {
        product_name: name,
        requested_item_name: name, // the name the report generator reads
        request_count: group.length,
        total_quantity_requested: group.reduce((sum, row) => sum + quantity(row), 0),
        unique_customers: distinctCount(group.map(customerKey)),
        first_request_date: dates[0] || null,
        last_request_date: dates[dates.length - 1] || null,
        last_requested: dates[dates.length - 1] || null,
      }
    })
    .sort((a, b) => b.request_count - a.request_count || a.product_name.localeCompare(b.product_name))
    .slice(0, limit)
}
