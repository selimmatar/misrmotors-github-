// Inventory page, Sold tab (owner, 2026-11-17 / 18): our cost per unit and the supplier of a delivered line.
// No server imports: used by the screen (components/modules/inventory-module.tsx) and the tests.
//
//  - outsourced line (no product): from its sales order's outsourced costs (app/api/inventory/outsourced-costs, from
//    the purchase order: landed once finalized, else the PO unit price; a line taken from stock: its stock row's
//    cost). Matched by the ORDER (the permit's sales order id) and the ITEM NAME = the permit line's
//    item_name_snapshot (delivery_permit_items.outsourced_name holds the SUPPLIER name, never the item), with
//    whitespace and case ignored. No purchase order (old orders): cost unknown ("—").
//  - catalogue product: its stock value per unit over all warehouses (returned rows left out).
//  - supplier: the purchase order's; else the order line's; else the permit line's (its outsourced_name / supplier).

export interface SoldCostEntry {
  soId: number | string
  soItemId?: number
  name: string
  unitCost: number | null
  supplierName: string | null
}

const sameName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()
const squeezed = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase()

export function soldLineCostAndSupplier(input: {
  /** the delivery permit line as the delivery-permits API maps it */
  item: { productId?: string | number | null; itemNameSnapshot?: string | null; productName?: string | null; supplierName?: string | null; outsourcedName?: string | null }
  /** the permit's sales order id */
  soId: string | number | null | undefined
  /** that order's lines (app context), if loaded */
  soLines?: { productId?: unknown; productName?: string | null; outsourcedName?: string | null; outsourced_name?: string | null; supplierName?: string | null }[]
  costs: SoldCostEntry[]
  inventory?: { productId?: unknown; isReturned?: boolean; quantity?: unknown; unitCost?: unknown }[]
}): { unitCost: number | null; supplierName: string | null } {
  const { item } = input
  const productId = item.productId === undefined || item.productId === null || item.productId === "" ? null : String(item.productId)
  // the item's name: item_name_snapshot first (outsourced_name on a permit line is the supplier)
  const rawName = item.itemNameSnapshot || item.productName || ""
  const name = sameName(rawName)
  const lineName = (l: any) => l.outsourcedName || l.outsourced_name || l.productName
  const soLine = (input.soLines || []).find((l) =>
    productId ? String(l.productId ?? "") === productId : !l.productId && (sameName(lineName(l)) === name || squeezed(lineName(l)) === squeezed(rawName)),
  )
  let unitCost: number | null = null
  let poSupplier: string | null = null
  if (!productId) {
    const ofOrder = input.soId === undefined || input.soId === null || input.soId === "" ? [] : input.costs.filter((c) => String(c.soId) === String(input.soId))
    const named = ofOrder.filter((c) => sameName(c.name) === name)
    const candidates = named.length > 0 ? named : ofOrder.filter((c) => squeezed(c.name) === squeezed(rawName))
    const costed = candidates.find((c) => c.unitCost !== null && c.unitCost !== undefined) || candidates[0]
    unitCost = costed?.unitCost ?? null
    poSupplier = candidates.find((c) => c.supplierName)?.supplierName ?? null
  } else {
    const rows = (input.inventory || []).filter((r) => String(r.productId) === productId && !r.isReturned)
    const qty = rows.reduce((s, r) => s + Math.max(0, Number(r.quantity) || 0), 0)
    if (rows.length > 0) {
      unitCost =
        qty > 0
          ? rows.reduce((s, r) => s + Math.max(0, Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0) / qty
          : rows.reduce((s, r) => s + (Number(r.unitCost) || 0), 0) / rows.length
    }
  }
  const supplierName = poSupplier || soLine?.supplierName || item.supplierName || (!productId ? item.outsourcedName : null) || null
  return { unitCost, supplierName }
}
