// Inventory on-hand tab: the stock filter (owner, 2026-11-17). Applied to the rows as shown, so with "all warehouses"
// it looks at the product's quantity summed over its warehouses.
export type StockFilter = "all" | "in-stock" | "out-of-stock"
export const STOCK_FILTERS: StockFilter[] = ["all", "in-stock", "out-of-stock"]

export function matchesStockFilter(quantity: unknown, filter: StockFilter | string): boolean {
  const qty = Number(quantity) || 0
  if (filter === "in-stock") return qty > 0
  if (filter === "out-of-stock") return qty <= 0
  return true
}
