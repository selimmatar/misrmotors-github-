// Open purchase orders (owner request, 2026-11-11): a PO without a supplier bill is work in progress. It can be edited
// in any status, even after goods were received, and items can be exchanged on it or lowered when they go back to the
// supplier. Closing it (lib/po-bill.ts) makes the bill and locks it; reopening (while unpaid) unlocks it again.
// Editing a PO never moves stock: only receiving, delivering and returns do.

/** Statuses in which an OPEN purchase order can be edited (not rejected). */
export const PO_EDITABLE_STATUSES: readonly string[] = ["draft", "pending", "approved", "partially_received", "received", "received_with_issues"]
const RECEIVED_STATUSES = ["partially_received", "received", "received_with_issues"]
/** Who may close and reopen a PO, and record an advance on it. */
export const PO_CLOSE_ROLES: readonly string[] = ["accountant", "po-rep", "admin", "ceo"]
/** Statuses in which a PO can be closed: approved, or received in full or in part. */
export const PO_CLOSABLE_STATUSES: readonly string[] = ["approved", "partially_received", "received", "received_with_issues"]

type Undo = () => PromiseLike<unknown>

/** Why this PO cannot be edited, or null when it can. */
export async function editBlocker(db: any, po: any): Promise<{ code: string; error: string } | null> {
  if (!PO_EDITABLE_STATUSES.includes(String(po.status))) {
    return { code: "PO_NOT_EDITABLE", error: `A "${po.status}" purchase order cannot be edited` }
  }
  if (po.cost_finalized) return { code: "PO_COST_FINALIZED", error: "The cost of this purchase order is already finalized, so it can no longer be edited" }
  const { data: bills, error } = await db.from("accounts_payable").select("invoice_id").eq("po_id", po.po_id).limit(1)
  if (error) throw error
  if ((bills || []).length > 0) {
    return { code: "PO_CLOSED", error: "This purchase order is closed (sent to Accounts Payable). Reopen it first to change it." }
  }
  return null
}

/** Quantity received so far per PO line. */
export async function receivedByItem(db: any, poItemIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (poItemIds.length === 0) return out
  const { data, error } = await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", poItemIds)
  if (error) throw error
  for (const r of data || []) out.set(r.po_item_id, (out.get(r.po_item_id) || 0) + (Number(r.quantity_received) || 0))
  return out
}

/**
 * Writes the PO lines IN PLACE so goods-receipt lines keep pointing at them: `next` rows that carry the po_item_id of
 * an existing line update it, rows without one are added, and existing lines left out are deleted, or kept at quantity
 * 0 when goods were already received on them (the receipt history stays linked). Every write is undone on failure.
 */
export async function writePoLines(db: any, oldRows: any[], next: any[], undo: Undo[]): Promise<void> {
  const keep = new Set<number>()
  for (const row of next) {
    const { po_item_id, ...values } = row
    if (po_item_id) {
      const before = oldRows.find((o) => o.po_item_id === po_item_id)
      keep.add(po_item_id)
      const { error } = await db.from("purchase_order_items").update(values).eq("po_item_id", po_item_id)
      if (error) throw error
      if (before) {
        const restore: Record<string, any> = {}
        for (const key of Object.keys(values)) restore[key] = before[key] ?? null
        undo.push(() => db.from("purchase_order_items").update(restore).eq("po_item_id", po_item_id))
      }
    } else {
      const { data, error } = await db.from("purchase_order_items").insert(values).select("po_item_id").single()
      if (error) throw error
      undo.push(() => db.from("purchase_order_items").delete().eq("po_item_id", data.po_item_id))
    }
  }
  const gone = oldRows.filter((o) => !keep.has(o.po_item_id))
  const received = await receivedByItem(db, gone.map((o) => o.po_item_id))
  for (const old of gone) {
    if ((received.get(old.po_item_id) || 0) > 0) {
      const { error } = await db.from("purchase_order_items").update({ quantity: 0, total: 0 }).eq("po_item_id", old.po_item_id)
      if (error) throw error
      undo.push(() => db.from("purchase_order_items").update({ quantity: old.quantity, total: old.total }).eq("po_item_id", old.po_item_id))
    } else {
      const { error } = await db.from("purchase_order_items").delete().eq("po_item_id", old.po_item_id)
      if (error) throw error
      undo.push(() => db.from("purchase_order_items").insert(old))
    }
  }
}

/**
 * The receiving status a PO should have after its lines changed: unchanged until something was received; then
 * "received" when every line with a quantity is fully received, else "partially_received" (it can receive the rest).
 */
export async function statusAfterLineChange(db: any, po: any): Promise<string> {
  const status = String(po.status)
  if (!RECEIVED_STATUSES.includes(status) && status !== "approved") return status
  const { data: rows, error } = await db.from("purchase_order_items").select("po_item_id, quantity").eq("po_id", po.po_id)
  if (error) throw error
  const received = await receivedByItem(db, (rows || []).map((r: any) => r.po_item_id))
  const anyReceived = [...received.values()].some((q) => q > 0)
  if (!anyReceived) return status === "approved" ? "approved" : status
  const full = (rows || []).filter((r: any) => (Number(r.quantity) || 0) > 0).every((r: any) => (received.get(r.po_item_id) || 0) >= (Number(r.quantity) || 0))
  if (!full) return "partially_received"
  return status === "received_with_issues" ? "received_with_issues" : "received"
}

/** Puts the PO's status right after its lines changed (compare-and-swap on the status read). */
export async function syncPoStatus(db: any, po: any, undo: Undo[]): Promise<string> {
  const next = await statusAfterLineChange(db, po)
  if (next === po.status) return next
  const { data, error } = await db.from("purchase_orders").update({ status: next }).eq("po_id", po.po_id).eq("status", po.status).select("po_id")
  if (error) throw error
  if ((data || []).length === 1) undo.push(() => db.from("purchase_orders").update({ status: po.status }).eq("po_id", po.po_id))
  return next
}
