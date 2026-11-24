// One invoice line per item (owner report, 2026-11-24: an invoice built from several delivery permits went to the
// e-invoice portal with "air pump ... qty 1 @ 18,900" three times). Pure, no I/O.
//
// Lines that bill the same item - the same product (a line without a product: the same trimmed name), at the same
// unit price, and where known the same e-invoice item code and unit type - become ONE line with the summed quantity,
// at the position of the first of them. Lines that differ in price (or code / unit) stay separate. The order discount
// is one rate per sales order, so the same unit price before the discount is the same unit price after it.
//
// Quantities are merged AFTER returns were netted per permit (callers pass net quantities). VAT per line
// (lib/vat-lines.ts) is then computed on the merged line.

export interface MergeKeyParts {
  productId: number | null | undefined
  name: string | null | undefined
  unitPrice: number
  itemCode?: string | null
  unit?: string | null
}

// Unit prices may come from total / quantity (etaUnitPrice), so float noise is ignored below 1e-5.
const priceKey = (price: number) => String(Math.round((Number(price) || 0) * 1e5))
const qtySum = (a: number, b: number) => Math.round(((Number(a) || 0) + (Number(b) || 0)) * 1e6) / 1e6

/** The key two lines must share to be merged; null = never merged (a line with neither a product nor a name). */
export function mergeKey(p: MergeKeyParts): string | null {
  const name = String(p.name ?? "").trim()
  const item = p.productId != null ? `p:${p.productId}` : name ? `n:${name}` : null
  if (item == null) return null
  return [item, priceKey(p.unitPrice), String(p.itemCode ?? "").trim(), String(p.unit ?? "").trim()].join("|")
}

/**
 * `items` with every group of same-key items merged into its first item (first-occurrence order kept), the quantity
 * being the group's sum. `merge(first, next, quantity)` builds the merged item (default: first with the summed quantity).
 */
export function mergeSameLines<T>(
  items: T[],
  keyOf: (item: T) => string | null,
  quantityOf: (item: T) => number,
  merge: (first: T, next: T, quantity: number) => T,
): T[] {
  const out: T[] = []
  const at = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    const idx = key == null ? undefined : at.get(key)
    if (idx === undefined) {
      if (key != null) at.set(key, out.length)
      out.push(item)
      continue
    }
    out[idx] = merge(out[idx], item, qtySum(quantityOf(out[idx]), quantityOf(item)))
  }
  return out
}

/** Printed invoice rows (AR print routes): same product / name and unit price -> one row, quantity and total summed. */
export function mergePrintItems<T extends Record<string, any>>(items: T[], unitPriceOf: (item: T) => number, nameOf: (item: T) => string): T[] {
  return mergeSameLines(
    items,
    (it) => (it.eta_line ? null : mergeKey({ productId: it.product_id ?? null, name: nameOf(it), unitPrice: unitPriceOf(it) })),
    (it) => Number(it.quantity) || 0,
    (first, next, quantity) => {
      const totalOf = (it: T) => Number(it.total) || (Number(it.unit_price) || 0) * (Number(it.quantity) || 0)
      return { ...first, quantity, total: Math.round((totalOf(first) + totalOf(next)) * 100) / 100 }
    },
  )
}
