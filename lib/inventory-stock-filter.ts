// Inventory on-hand tab: the stock filter (owner, 2026-11-17). Applied to the rows as shown, so with "all warehouses"
// it looks at the product's quantity summed over its warehouses.
export type StockFilter = "all" | "in-stock" | "out-of-stock"
export const STOCK_FILTERS: StockFilter[] = ["all", "in-stock", "out-of-stock"]

/**
 * On hand tab rows (owner, 2026-11-17): catalogue stock (not returned) and every outsourced item in a warehouse
 * (received into it, taken from stock, or an outsourced return put there) while any of it is left.
 */
export function isOnHandRow(item: { isOutsourced?: boolean; isReturned?: boolean; productId?: unknown; quantity?: unknown; warehouseId?: unknown }): boolean {
  const outsourced = !!item.isOutsourced || !item.productId
  if (outsourced) {
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
