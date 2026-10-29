// Small sidebar counters (no pop-ups). Pure parts here; the queries live in app/api/pending-counts.
import { sameItemName } from "@/lib/po-requests/apply-costs"

// A sales order made from a quotation still needs a purchase order while any line says so.
export const SO_STATUSES_NEEDING_PO = ["pending_accountant", "accountant_approved", "ready_for_delivery", "shipped"]

export function rowsNeedPo(rows: { procurementStatus?: string | null }[]): boolean {
  return rows.some((r) => /Needs PO|Needs Reorder/.test(r.procurementStatus || ""))
}

export interface QuotedRequest {
  request_id: number
  sales_quotation_id: number | null
  po_request_items?: { product_name?: string | null; unit_price?: number | string | null }[] | null
}

export interface QuotationLineCost {
  quotation_id: number
  product_name?: string | null
  unit_cost?: number | string | null
  item_type?: string | null
}

const money = (v: unknown) => Math.round(Number(v || 0) * 100)

// A quoted price request counts for the sales rep until one of its prices is on its quotation
// (an outsourced line with the same item name and that cost), or the quotation is no longer open.
export function unappliedQuotedRequests(requests: QuotedRequest[], openQuotationIds: Set<number>, lines: QuotationLineCost[]): number {
  return requests.filter((r) => {
    if (!r.sales_quotation_id || !openQuotationIds.has(r.sales_quotation_id)) return false
    const own = lines.filter((l) => l.quotation_id === r.sales_quotation_id && l.item_type !== "inventory")
    const applied = (r.po_request_items || []).some(
      (i) => money(i.unit_price) > 0 && own.some((l) => sameItemName(l.product_name, i.product_name) && money(l.unit_cost) === money(i.unit_price)),
    )
    return !applied
  }).length
}
