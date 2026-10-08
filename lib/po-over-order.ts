// Batch 4D: a sales-order line may not be ordered from suppliers in a total quantity above the SO line quantity.
// Counted: purchase_order_items.quantity of every PO that is not rejected (ordered, not received). A rejected PO
// releases its quantity. Known limit: this is a read-then-write check, so two concurrent requests can both pass;
// closing that needs a database constraint, which is not part of this change.

export type OverOrderLine = {
  sourceSoItemId: number
  soQty: number
  alreadyOrdered: number
  requested: number
  allowed: number
}

export type OverOrderResult =
  | { ok: true }
  | { ok: false; status: 400; error: string; code: "PO_UNKNOWN_SO_ITEM"; lines: OverOrderLine[] }
  | { ok: false; status: 409; error: string; code: "PO_OVER_ORDER"; lines: OverOrderLine[] }

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * @param items          incoming PO lines (camelCase or snake_case)
 * @param excludePoId    the PO being edited: its own current lines are not counted as "already ordered"
 */
export async function checkPoOverOrder(supabase: any, items: any[] | undefined, excludePoId?: number): Promise<OverOrderResult> {
  const requestedBySoItem = new Map<number, number>()
  for (const item of items || []) {
    const raw = item?.sourceSoItemId ?? item?.source_so_item_id
    const soItemId = toInt(raw)
    if (soItemId === null) {
      console.warn("PO over-order guard: line without source_so_item_id skipped", item?.productName || item?.product_name || "")
      continue
    }
    requestedBySoItem.set(soItemId, (requestedBySoItem.get(soItemId) || 0) + (Number(item.quantity) || 0))
  }
  if (requestedBySoItem.size === 0) return { ok: true }

  const soItemIds = [...requestedBySoItem.keys()]
  const { data: soItems, error: soError } = await supabase
    .from("sales_order_items")
    .select("so_item_id, quantity")
    .in("so_item_id", soItemIds)
  if (soError) throw soError
  const soQtyById = new Map<number, number>((soItems || []).map((r: any) => [Number(r.so_item_id), Number(r.quantity) || 0]))

  const missing = soItemIds.filter((id) => !soQtyById.has(id))
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "PO_UNKNOWN_SO_ITEM",
      error: `Sales order line ${missing.join(", ")} does not exist`,
      lines: missing.map((id) => ({ sourceSoItemId: id, soQty: 0, alreadyOrdered: 0, requested: requestedBySoItem.get(id) || 0, allowed: 0 })),
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("purchase_order_items")
    .select("po_id, source_so_item_id, quantity")
    .in("source_so_item_id", soItemIds)
  if (existingError) throw existingError

  const otherLines = (existing || []).filter((r: any) => excludePoId === undefined || Number(r.po_id) !== excludePoId)
  const poIds = [...new Set<number>(otherLines.map((r: any) => Number(r.po_id)))]
  const rejected = new Set<number>()
  if (poIds.length > 0) {
    const { data: pos, error: posError } = await supabase.from("purchase_orders").select("po_id, status").in("po_id", poIds)
    if (posError) throw posError
    for (const p of pos || []) if (p.status === "rejected") rejected.add(Number(p.po_id))
  }

  const orderedBySoItem = new Map<number, number>()
  for (const r of otherLines) {
    if (rejected.has(Number(r.po_id))) continue
    const key = Number(r.source_so_item_id)
    orderedBySoItem.set(key, (orderedBySoItem.get(key) || 0) + (Number(r.quantity) || 0))
  }

  const over: OverOrderLine[] = []
  for (const [id, requested] of requestedBySoItem) {
    const soQty = soQtyById.get(id) || 0
    const alreadyOrdered = orderedBySoItem.get(id) || 0
    if (alreadyOrdered + requested > soQty) {
      over.push({ sourceSoItemId: id, soQty, alreadyOrdered, requested, allowed: Math.max(0, soQty - alreadyOrdered) })
    }
  }
  if (over.length === 0) return { ok: true }
  return {
    ok: false,
    status: 409,
    code: "PO_OVER_ORDER",
    error:
      "Ordering more than the sales order needs: " +
      over
        .map((l) => `SO line ${l.sourceSoItemId} needs ${l.soQty}, already ordered ${l.alreadyOrdered}, requested ${l.requested} (max ${l.allowed})`)
        .join("; "),
    lines: over,
  }
}

/**
 * Over-order input for PUT: the incoming lines of every sales-order line whose requested total is higher than
 * what this PO already stores for it (new lines count as stored 0). Lines without a source_so_item_id are not
 * checked by the guard anyway and are passed through unchanged.
 */
export function linesWithIncreasedQuantity(items: any[], storedLines: any[]): any[] {
  const soItemOf = (l: any) => {
    const n = Number.parseInt(String(l?.sourceSoItemId ?? l?.source_so_item_id ?? ""), 10)
    return Number.isFinite(n) ? n : null
  }
  const stored = new Map<number, number>()
  for (const l of storedLines) {
    const k = soItemOf(l)
    if (k !== null) stored.set(k, (stored.get(k) || 0) + (Number(l.quantity) || 0))
  }
  const requested = new Map<number, number>()
  for (const l of items) {
    const k = soItemOf(l)
    if (k !== null) requested.set(k, (requested.get(k) || 0) + (Number(l.quantity) || 0))
  }
  return items.filter((l) => {
    const k = soItemOf(l)
    return k === null || (requested.get(k) || 0) > (stored.get(k) || 0)
  })
}
