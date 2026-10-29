// "Use these costs": copy the supplier's prices from a price request (PR) into the quotation's outsourced lines as
// their cost. A PR line matches the quotation line with the same line number AND the same item name, so a quotation
// edited after the PR was sent (a line deleted, lines moved) never gets a cost from a different item. Stock lines
// are never touched. A line with no selling price yet (0) also gets the supplier's price as its price, so the
// quotation shows it; a line already priced keeps the sales rep's price.
export interface CostLine {
  lineNo: number
  outsourced: boolean
  productName: string
  unitCost?: number | null
  unitPrice?: number
}

export interface PrPriceItem {
  quotation_line_no?: number | null
  product_name?: string | null
  unit_price?: number | string | null
}

export const sameItemName = (a?: string | null, b?: string | null) =>
  (a || "").trim().replace(/\s+/g, " ").toLowerCase() === (b || "").trim().replace(/\s+/g, " ").toLowerCase()

export function applyPrCosts<T extends CostLine>(lines: T[], prItems: PrPriceItem[]): { lines: T[]; filled: number; skipped: number } {
  const next = lines.map((line) => ({ ...line }))
  let filled = 0
  let skipped = 0
  for (const item of prItems) {
    if (item.unit_price === null || item.unit_price === undefined || item.unit_price === "") continue
    const price = Number(item.unit_price)
    if (!Number.isFinite(price) || price < 0) continue
    const target = next.find((line) => line.outsourced && line.lineNo === item.quotation_line_no && sameItemName(line.productName, item.product_name))
    if (!target) {
      skipped++
      continue
    }
    target.unitCost = price
    if (!target.unitPrice) target.unitPrice = price
    filled++
  }
  return { lines: next, filled, skipped }
}
