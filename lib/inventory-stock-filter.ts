// Inventory on-hand tab: the stock filter (owner, 2026-11-17). Applied to the rows as shown, so with "all warehouses"
// it looks at the product's quantity summed over its warehouses.
export type StockFilter = "all" | "in-stock" | "out-of-stock"
export const STOCK_FILTERS: StockFilter[] = ["all", "in-stock", "out-of-stock"]

/**
 * On hand tab rows (owner, 2026-11-17): catalogue stock (not returned) and every FREE outsourced item in a warehouse
 * (a customer return put there, or taken from stock) while any of it is left. An outsourced item purchased for an open
 * order is on the Pending tab instead.
 */
export function isOnHandRow(item: { isOutsourced?: boolean; isReturned?: boolean; productId?: unknown; quantity?: unknown; warehouseId?: unknown; purchasedFor?: boolean }): boolean {
  const outsourced = !!item.isOutsourced || !item.productId
  if (outsourced) {
    // purchased for an open order: it is that order's, on the Pending tab (owner decision, 2026-11-17)
    if (item.purchasedFor) return false
    if (item.isReturned && (item.warehouseId === null || item.warehouseId === undefined || item.warehouseId === "")) return false
    return (Number(item.quantity) || 0) > 0
  }
  return !item.isReturned
}

export function matchesStockFilter(quantity: unknown, filter: StockFilter | string): boolean {
  const qty = Number(quantity) || 0
  if (filter === "in-stock") return qty > 0
  if (filter === "out-of-stock") return qty <= 0
  return true
}
