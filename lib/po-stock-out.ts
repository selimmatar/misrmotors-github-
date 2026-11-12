// Goods of a PO line handed back to the supplier from one of our warehouses (owner request, 2026-11-12): used by
// "Return to supplier" and by an exchange whose old item is still in stock. Catalogue items are taken from the
// product's row in that warehouse; outsourced items from the rows stored under the same name there.
import { takeFromRow, type StockMove } from "@/lib/dp-stock"

type Db = any
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const lineName = (l: any) => l.outsourced_name || l.item_name_snapshot || "item"

/** Takes `qty` of the line out of the warehouse; the moves are added to `moves`. Returns the quantity found when short. */
export async function takeLineFromStock(db: Db, line: any, warehouseId: number, qty: number, moves: StockMove[]): Promise<{ ok: true } | { ok: false; found: number }> {
  let query = db.from("inventory").select("inventory_id, quantity").eq("warehouse_id", warehouseId).eq("is_returned", false)
  query = line.product_id ? query.eq("product_id", line.product_id) : query.eq("is_outsourced", true).eq("outsourced_name", line.outsourced_name || line.item_name_snapshot || "")
  const { data: rows, error } = await query.order("inventory_id", { ascending: true })
  if (error) throw error
  let need = qty
  for (const s of rows || []) {
    if (need <= 0) break
    const take = Math.min(need, Number(s.quantity) || 0)
    if (take <= 0) continue
    const res = await takeFromRow(db, s.inventory_id, take)
    if (!res.ok) continue
    moves.push({ inventoryId: s.inventory_id, productId: line.product_id ?? null, warehouseId, quantity: take, before: res.before, after: res.after, productName: lineName(line), outsourced: !line.product_id } as StockMove)
    need = round(need - take)
  }
  return need > 1e-9 ? { ok: false, found: round(qty - need) } : { ok: true }
}

/** Stock log rows ('return') for catalogue items handed back; outsourced rows have no product and are not logged. */
export async function logHandedBack(db: Db, po: any, moves: StockMove[], createdBy: number | null, why: string) {
  const rows = moves
    .filter((m: any) => m.productId)
    .map((m: any) => ({
      product_id: m.productId,
      transaction_type: "return",
      reference_type: "PURCHASE_ORDER",
      reference_id: po.po_id,
      reference_number: po.po_number ?? null,
      quantity_change: -m.quantity,
      quantity_before: m.before,
      quantity_after: m.after,
      notes: `${why} on ${po.po_number} - warehouse ${m.warehouseId}`,
      created_by: createdBy,
    }))
  if (rows.length === 0) return
  const { error } = await db.from("inventory_transactions").insert(rows)
  if (error) console.error("PO stock out: could not write the stock log", error)
}
