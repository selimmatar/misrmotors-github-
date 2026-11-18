// A quotation line taken from free stored stock (owner, 2026-11-18): "Add from inventory" on the quotation form offers
// free stored outsourced items too (lib/free-stock.ts). The line is saved as an outsourced line (by name, its stock
// cost as unit_cost) with sales_quotation_items.from_inventory_id = the picked inventory row; approving the quotation
// reserves that row for the new sales order exactly like the sales order form does (lib/outsourced-hold.ts).
// The column comes from scripts/sql/2026-11-18-quotation-from-stock.sql; until it is applied the line is saved as a
// plain outsourced line (nothing is reserved at approval).
import { hasColumn } from "@/lib/line-order"

export const QUOTATION_FROM_STOCK_COLUMN = "from_inventory_id"

export const hasQuotationFromStockColumn = (db: any) => hasColumn(db, "sales_quotation_items", QUOTATION_FROM_STOCK_COLUMN)

/** The picked inventory row of a quotation line (request body or saved row), or null. */
export function quotationFromInventoryId(item: any): number | null {
  const raw = item?.from_inventory_id ?? item?.fromInventoryId
  if (raw === undefined || raw === null || raw === "") return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** The column's value for a line being saved: only outsourced lines carry it; {} while the column is missing. */
export function fromStockField(item: any, withColumn: boolean): Record<string, number | null> {
  if (!withColumn) return {}
  const outsourced = (item?.item_type || "inventory") === "outsourced"
  return { [QUOTATION_FROM_STOCK_COLUMN]: outsourced ? quotationFromInventoryId(item) : null }
}
