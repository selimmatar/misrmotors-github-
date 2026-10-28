// Reads item rows from an Excel sheet (already turned into objects by XLSX.utils.sheet_to_json). Column names are
// matched without case, spaces or underscores, with the usual variants ("Qty", "Unit Price", "Supplier", ...).
// Used by the quotation Excel upload, the price request (PR) upload and the supplier-prices upload.
export interface ItemRow {
  productName: string
  /** 1 when the column is empty or not a number */
  quantity: number
  /** null when the sheet has no price for the row */
  unitPrice: number | null
  supplierName: string
  /** raw "Outsourced" cell, when there is one */
  outsourcedValue: unknown
}

const norm = (s: string) => s.toLowerCase().replace(/[_\s]/g, "")

const NAME_COLUMNS = ["Product Name", "ProductName", "product_name", "Name", "Item", "item_name", "ItemName"]
const QTY_COLUMNS = ["Quantity", "Qty", "quantity", "qty", "QTY", "Amount", "amount"]
const PRICE_COLUMNS = ["Unit Price", "UnitPrice", "unit_price", "Price", "price", "Unit price", "unit price", "PRICE", "Rate", "rate", "Cost", "cost"]
const SUPPLIER_COLUMNS = ["Supplier Name", "SupplierName", "supplier_name", "Supplier", "supplier"]
const OUTSOURCED_COLUMNS = ["Outsourced", "outsourced", "Is Outsourced", "is_outsourced"]

export function readItemRow(row: Record<string, unknown>): ItemRow {
  const keys = Object.keys(row)
  const findValue = (possibleNames: string[]) => {
    for (const name of possibleNames) {
      const key = keys.find((k) => norm(k) === norm(name))
      if (key && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key]
    }
    return null
  }
  const quantity = Number(findValue(QTY_COLUMNS) || 1)
  const priceRaw = findValue(PRICE_COLUMNS)
  const price = priceRaw !== null ? Number(priceRaw) : null
  return {
    productName: String(findValue(NAME_COLUMNS) || ""),
    quantity: isNaN(quantity) ? 1 : quantity,
    unitPrice: price === null || isNaN(price) ? null : price,
    supplierName: String(findValue(SUPPLIER_COLUMNS) || ""),
    outsourcedValue: findValue(OUTSOURCED_COLUMNS),
  }
}

/** Rows with an item name; empty rows are dropped. */
export function readItemRows(rows: Record<string, unknown>[]): ItemRow[] {
  return rows.map(readItemRow).filter((row) => row.productName.trim() !== "")
}
