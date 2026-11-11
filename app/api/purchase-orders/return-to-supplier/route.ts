// Return items to the supplier WITHOUT an exchange, on an OPEN purchase order (owner request, 2026-11-12).
// Each row takes some of a PO line back: the line and the PO total go down (the bill made at close is the final one),
// the receiving status follows, and the PO history shows it under "Items sent back to the supplier".
// When the goods are in one of our warehouses, they also leave stock there (choose the warehouse); when they are not
// in stock any more (never received, or already gone), only the PO changes. All rows save together or not at all.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { logPoEvent, knownUserId } from "@/lib/po-history"
import { computePoTotals, poMoney } from "@/lib/po-items"
import { editBlocker, receivedByItem, syncPoStatus } from "@/lib/po-edit"
import { reservedCreditTotal } from "@/lib/supplier-credit-apply"
import { takeFromRow, undoMoves, type StockMove } from "@/lib/dp-stock"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })

/** Quantity already returned to the supplier per PO line (from the PO history). */
async function returnedSoFar(db: any, poId: number): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  const { data } = await db.from("workflow_events").select("old_value").eq("entity_type", "PURCHASE_ORDER").eq("entity_id", poId).eq("event_type", "PO_ITEM_SENT_BACK")
  for (const e of data || []) {
    try {
      const v = JSON.parse(e.old_value || "{}")
      const id = Number(v.poItemId)
      if (id) out.set(id, (out.get(id) || 0) + (Number(v.quantity) || 0))
    } catch {
      // an entry without a line id
    }
  }
  return out
}

export async function POST(request: Request) {
  const db = createAdminClient()
  const undo: (() => PromiseLike<unknown>)[] = []
  const moves: StockMove[] = []
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "Choose the purchase order")
    const raw: any[] = Array.isArray(body?.items) ? body.items : []
    if (raw.length === 0 || raw.length > 50) return refuse(400, "BAD_INPUT", "Add the items to return")
    const rows = raw.map((r, i) => ({
      n: i + 1,
      fromItemId: parsePositiveId(r?.fromItemId),
      qty: Number(r?.quantity),
      warehouseId: parsePositiveId(r?.warehouseId),
      reason: String(r?.reason || "").trim().slice(0, 300) || null,
    }))
    for (const r of rows) {
      if (r.fromItemId === null) return refuse(400, "BAD_INPUT", `Choose the item to return (row ${r.n})`)
      if (!(r.qty > 0)) return refuse(400, "BAD_INPUT", `The quantity must be above 0 (row ${r.n})`)
    }

    const { data: po, error } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    const blocker = await editBlocker(db, po)
    if (blocker) return refuse(409, blocker.code, blocker.error)

    const ids = [...new Set(rows.map((r) => r.fromItemId as number))]
    const { data: lines, error: linesError } = await db.from("purchase_order_items").select("*").eq("po_id", poId).in("po_item_id", ids)
    if (linesError) throw linesError
    const lineById = new Map<number, any>((lines || []).map((l: any) => [l.po_item_id, l]))
    const takenById = new Map<number, number>()
    for (const r of rows) {
      if (!lineById.has(r.fromItemId as number)) return refuse(404, "NOT_FOUND", `An item to return is not on this purchase order (row ${r.n})`)
      takenById.set(r.fromItemId as number, (takenById.get(r.fromItemId as number) || 0) + r.qty)
    }
    const nameOf = (l: any) => l.outsourced_name || l.item_name_snapshot || "item"
    for (const [id, taken] of takenById) {
      const l = lineById.get(id)
      if (taken > (Number(l.quantity) || 0) + 1e-9) return refuse(409, "RETURN_TOO_MANY", `Only ${l.quantity} of "${nameOf(l)}" are on the purchase order`)
    }
    // Only what was received can go back (owner rule, 2026-11-12); what was not received yet is removed with Edit.
    const received = await receivedByItem(db, ids)
    const sentBack = await returnedSoFar(db, poId)
    for (const [id, taken] of takenById) {
      const l = lineById.get(id)
      const returnable = poMoney(Math.max(0, (received.get(id) || 0) - (sentBack.get(id) || 0)))
      if (taken > returnable + 1e-9) {
        return refuse(
          409,
          "NOT_RECEIVED",
          returnable > 0
            ? `Only ${returnable} of "${nameOf(l)}" were received and not yet returned, so only ${returnable} can go back. What was not received can be removed from the PO with Edit.`
            : `"${nameOf(l)}" was not received yet, so there is nothing to return. Remove it from the PO with Edit (the pencil).`,
        )
      }
    }

    // 1. Stock out of the chosen warehouse, where the goods are.
    for (const r of rows) {
      if (r.warehouseId === null) continue
      const l = lineById.get(r.fromItemId as number)
      let query = db.from("inventory").select("inventory_id, quantity").eq("warehouse_id", r.warehouseId).eq("is_returned", false)
      query = l.product_id ? query.eq("product_id", l.product_id) : query.eq("is_outsourced", true).eq("outsourced_name", l.outsourced_name || l.item_name_snapshot || "")
      const { data: stockRows, error: stockError } = await query.order("inventory_id", { ascending: true })
      if (stockError) throw stockError
      let need = r.qty
      for (const s of stockRows || []) {
        if (need <= 0) break
        const take = Math.min(need, Number(s.quantity) || 0)
        if (take <= 0) continue
        const res = await takeFromRow(db, s.inventory_id, take)
        if (!res.ok) continue
        moves.push({ inventoryId: s.inventory_id, productId: l.product_id ?? null, warehouseId: r.warehouseId, quantity: take, before: res.before, after: res.after, productName: nameOf(l), outsourced: !l.product_id } as StockMove)
        need = poMoney(need - take)
      }
      if (need > 1e-9) {
        await undoMoves(db, moves)
        moves.length = 0
        return refuse(409, "NOT_IN_STOCK", `Row ${r.n}: only ${poMoney(r.qty - need)} of "${nameOf(l)}" are in that warehouse. Choose another warehouse, or "Not in our stock".`)
      }
    }

    // 2. The PO lines go down.
    for (const [id, taken] of takenById) {
      const l = lineById.get(id)
      const left = poMoney((Number(l.quantity) || 0) - taken)
      const { error: e } = await db.from("purchase_order_items").update({ quantity: left, total: poMoney(left * (Number(l.unit_price) || 0)) }).eq("po_item_id", id)
      if (e) throw e
      undo.push(() => db.from("purchase_order_items").update({ quantity: l.quantity, total: l.total }).eq("po_item_id", id))
    }

    // 3. The PO total (VAT as the PO had it), never below the advances / credits on it; the receiving status follows.
    const { data: all, error: allError } = await db.from("purchase_order_items").select("total").eq("po_id", poId)
    if (allError) throw allError
    const vatOn = Number(po.tax_amount) > 0
    const totals = computePoTotals(all || [], vatOn)
    const reserved = await reservedCreditTotal(db, poId)
    if (reserved.error) throw new Error(reserved.error)
    if (reserved.total > totals.total + 0.005) {
      for (const step of undo.reverse()) await step()
      await undoMoves(db, moves)
      return refuse(409, "CREDIT_EXCEEDS_TOTAL", `The new total (${totals.total.toFixed(2)}) would be less than the advances and credits on this PO (${reserved.total.toFixed(2)})`)
    }
    const { error: totalError } = await db.from("purchase_orders").update({ total: totals.total, tax_amount: vatOn ? totals.tax : null }).eq("po_id", poId)
    if (totalError) throw totalError
    undo.push(() => db.from("purchase_orders").update({ total: po.total, tax_amount: po.tax_amount }).eq("po_id", poId))
    await syncPoStatus(db, po, undo)

    // 4. Stock log (catalogue items) and PO history.
    const createdBy = await knownUserId(db, body?.userId)
    const stockLog = moves.filter((m: any) => m.productId).map((m: any) => ({
      product_id: m.productId,
      transaction_type: "return",
      reference_type: "PURCHASE_ORDER",
      reference_id: poId,
      reference_number: po.po_number ?? null,
      quantity_change: -m.quantity,
      quantity_before: m.before,
      quantity_after: m.after,
      notes: `Returned to the supplier on ${po.po_number} - warehouse ${m.warehouseId}`,
      created_by: createdBy,
    }))
    if (stockLog.length > 0) {
      const { error: logError } = await db.from("inventory_transactions").insert(stockLog)
      if (logError) console.error("Return to supplier: could not write the stock log", logError)
    }
    for (const r of rows) {
      const l = lineById.get(r.fromItemId as number)
      const unit = Number(l.unit_price) || 0
      await logPoEvent(db, poId, {
        event_type: "PO_ITEM_SENT_BACK",
        old_value: JSON.stringify({ poItemId: l.po_item_id, name: nameOf(l), quantity: r.qty, unitPrice: unit, total: poMoney(r.qty * unit), warehouseId: r.warehouseId }),
        new_value: null,
        notes: r.reason ? `Returned to the supplier: ${r.reason}` : "Returned to the supplier",
        userId: body?.userId,
      })
    }
    const value = poMoney(rows.reduce((s, r) => s + r.qty * (Number(lineById.get(r.fromItemId as number).unit_price) || 0), 0))
    return NextResponse.json({ ok: true, total: totals.total, returnedValue: value, stockMoved: moves.length > 0 })
  } catch (error) {
    console.error("Return to supplier: failed", error)
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (e) {
        console.error("Return to supplier: could not undo a step", e)
      }
    }
    if (moves.length > 0) await undoMoves(db, moves)
    return refuse(500, "RETURN_FAILED", "The return could not be saved. Nothing was changed; please try again.")
  }
}
