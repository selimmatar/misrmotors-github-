// "Add from inventory" on the sales order and quotation forms (owner, 2026-11-17 / 18): what is free to sell.
// No server imports: used by the screens and the tests. Works on the app context's inventory rows
// (GET /api/inventory: `available` = what no order / waiting quotation holds; null when that could not be worked out).
//
//  - catalogue product: free = its `available` (product level, the same on each of its non-returned rows); when the
//    hold is unknown, its quantity summed over its non-returned rows. Returned rows (Returns tab) never count.
//  - stored outsourced item (no catalogue product) in a warehouse that no order holds (a customer return put into a
//    warehouse, or what an order no longer needs): offered by name (no SKU) with its cost, as "stored-<inventory id>".
//    One bought for an open order is that order's (Pending tab) and is not offered.

export interface StockRow {
  id?: string
  inventoryId?: number | string
  productId?: string | null
  productName?: string
  sku?: string
  quantity?: unknown
  available?: unknown
  isReturned?: boolean
  isOutsourced?: boolean
  warehouseId?: unknown
  unitCost?: unknown
  supplierName?: string | null
  purchasedFor?: boolean
}

export const STORED_PREFIX = "stored-"
export const storedOptionId = (inv: StockRow) => `${STORED_PREFIX}${inv.inventoryId ?? inv.id}`
export const storedIdOf = (value: string | null | undefined): string | null =>
  value && value.startsWith(STORED_PREFIX) ? value.slice(STORED_PREFIX.length) : null

/** Free units of a stored outsourced row (0 while unknown). */
export const storedAvailable = (inv: StockRow | null | undefined) => Math.max(0, Number(inv?.available ?? 0) || 0)

/** A stored outsourced row any order can take now (in a warehouse, not held). */
export const isFreeStoredRow = (inv: StockRow) =>
  !inv.productId && !inv.purchasedFor && storedAvailable(inv) > 0 &&
  (!inv.isReturned || (inv.warehouseId !== null && inv.warehouseId !== undefined && inv.warehouseId !== ""))

/** Free stock of a catalogue product over all warehouses. */
export function productFreeStock(inventory: StockRow[], productId: string | number | null | undefined): number {
  if (productId === null || productId === undefined || productId === "") return 0
  const rows = (inventory || []).filter((r) => r.productId && String(r.productId) === String(productId) && !r.isReturned)
  if (rows.length === 0) return 0
  const known = rows.find((r) => typeof r.available === "number")
  if (known) return Math.max(0, known.available as number)
  return Math.max(0, rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0))
}

export interface FreeStockChoice {
  /** product id, or "stored-<inventory id>" for a stored outsourced item */
  id: string
  name: string
  sku: string
  available: number
  stored: boolean
  inventoryId?: string
  unitCost?: number
  supplierName?: string | null
}

/**
 * Every item free to sell now: catalogue products with free stock, then free stored outsourced items. With
 * `includeOutOfStock`, catalogue products without free stock follow (a quotation may ask for more than is free).
 */
export function freeStockChoices(
  products: { id?: string | number | null; productName?: string; sku?: string }[],
  inventory: StockRow[],
  opts: { includeOutOfStock?: boolean } = {},
): FreeStockChoice[] {
  const catalogue = (products || [])
    .filter((p) => p.id !== null && p.id !== undefined && p.id !== "")
    .map((p) => ({ id: String(p.id), name: p.productName || "", sku: p.sku || "", available: productFreeStock(inventory, p.id), stored: false }))
  const inStock = catalogue.filter((c) => c.available > 0)
  const stored = (inventory || []).filter(isFreeStoredRow).map((inv) => ({
    id: storedOptionId(inv),
    name: inv.productName || "",
    sku: inv.sku && inv.sku !== "OUTSOURCED" ? inv.sku : "",
    available: storedAvailable(inv),
    stored: true,
    inventoryId: String(inv.inventoryId ?? inv.id),
    unitCost: Number(inv.unitCost) || 0,
    supplierName: inv.supplierName ?? null,
  }))
  return [...inStock, ...stored, ...(opts.includeOutOfStock ? catalogue.filter((c) => c.available <= 0) : [])]
}
