// Supplier costs on a quotation: every price request (PR) sent for the quotation may come back with prices, often from
// different suppliers. Each outsourced quotation line lists the prices offered for it, and the person picks one per
// line. A PR line matches the quotation line with the same line number AND the same item name, so a quotation edited
// after the PR was sent (a line deleted, lines moved) never gets a cost from a different item. Stock lines are never
// touched.
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

export interface PriceRequestForCosts {
  request_id: number
  request_number: string
  status?: string | null
  supplier_id?: number | string | null
  suppliers?: { supplier_name?: string | null } | null
  po_request_items?: PrPriceItem[] | null
}

export interface SupplierOffer {
  requestId: number
  requestNumber: string
  supplierId: string
  supplierName: string
  price: number
}

export const sameItemName = (a?: string | null, b?: string | null) =>
  (a || "").trim().replace(/\s+/g, " ").toLowerCase() === (b || "").trim().replace(/\s+/g, " ").toLowerCase()

const round2 = (n: number) => Math.round(n * 100) / 100

// Selling price = cost + markup %.
export const priceWithMarkup = (cost: number, markup: number) => round2(cost * (1 + (markup || 0) / 100))
// The markup a typed price means; 0 when there is no cost to compare with.
export const markupFrom = (cost: number | null | undefined, price: number | null | undefined) =>
  cost && cost > 0 && price && price > 0 ? round2((price / cost - 1) * 100) : 0

// line number -> the prices offered for it, cheapest first. Cancelled PRs and empty prices are left out.
export function supplierOffers(lines: CostLine[], requests: PriceRequestForCosts[]): Record<number, SupplierOffer[]> {
  const offers: Record<number, SupplierOffer[]> = {}
  for (const pr of requests) {
    if (pr.status === "cancelled") continue
    for (const item of pr.po_request_items || []) {
      if (item.unit_price === null || item.unit_price === undefined || item.unit_price === "") continue
      const price = Number(item.unit_price)
      if (!Number.isFinite(price) || price < 0) continue
      const line = lines.find((l) => l.outsourced && l.lineNo === item.quotation_line_no && sameItemName(l.productName, item.product_name))
      if (!line) continue
      ;(offers[line.lineNo] ||= []).push({
        requestId: pr.request_id,
        requestNumber: pr.request_number,
        supplierId: pr.supplier_id == null ? "" : String(pr.supplier_id),
        supplierName: pr.suppliers?.supplier_name?.trim() || "",
        price,
      })
    }
  }
  for (const list of Object.values(offers)) list.sort((a, b) => a.price - b.price)
  return offers
}

// The chosen supplier's price becomes the line's cost and the supplier goes on the line (its purchase order goes to
// them). A line that had a selling price but no cost keeps its price (the markup shows what it means); otherwise the
// line's markup is kept and the price follows the new cost.
export function applyChosenCost<T extends CostLine & { markup?: number; supplierId?: string; supplierName?: string }>(
  line: T,
  offer: SupplierOffer,
): T {
  const next = { ...line, unitCost: offer.price, supplierId: offer.supplierId, supplierName: offer.supplierName }
  const hadCost = line.unitCost != null && line.unitCost > 0
  if (!hadCost && (line.unitPrice || 0) > 0) next.markup = markupFrom(offer.price, line.unitPrice)
  else next.unitPrice = priceWithMarkup(offer.price, line.markup || 0)
  return next
}
