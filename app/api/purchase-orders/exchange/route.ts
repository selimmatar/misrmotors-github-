// Exchange items on an OPEN purchase order (owner request, 2026-11-11; several at once 2026-11-12): each X (some or all
// of a line) is replaced by its Y
// (a catalogue product, or a typed outsourced item) with its own quantity and cost. X is lowered (removed when all of
// it goes; kept at 0 when goods were already received on it), Y is added, the PO total follows, and the exchange is
// kept in the PO's history (workflow_events) with both costs and the difference.
// Stock is not moved here: sending X back and receiving Y go through receiving / returns as usual.
//
// GET ?poId= : the PO's history for the details view (exchanges, items sent back, close / reopen, advances).
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { logPoEvent } from "@/lib/po-history"
import { computePoTotals, poMoney } from "@/lib/po-items"
import { editBlocker, syncPoStatus } from "@/lib/po-edit"
import { ADVANCE_CREDIT_TYPE, advanceMethod } from "@/lib/po-bill"
import { reservedCreditTotal } from "@/lib/supplier-credit-apply"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })
const lineName = (row: any, products: Map<number, string>) =>
  row.item_type === "outsourced" ? row.outsourced_name || row.item_name_snapshot || "" : products.get(row.product_id) || row.item_name_snapshot || ""

const PO_HISTORY_EVENTS = ["PO_ITEM_EXCHANGED", "PO_ITEM_SENT_BACK", "PO_CLOSED", "PO_REOPENED"]

interface Pair {
  fromItemId: number
  qty: number
  toProductId: number | null
  toName: string
  toQty: number
  toPrice: number
  description: string | null
  unit: string | null
  notes: string | null
}

/** One exchange (fromItemId, quantity, to) or several at once (exchanges: [...]); null + message when one is wrong. */
function readPairs(body: any): { pairs: Pair[] } | { error: string } {
  const raw: any[] = Array.isArray(body?.exchanges) ? body.exchanges : [body]
  if (raw.length === 0) return { error: "Add at least one exchange" }
  if (raw.length > 50) return { error: "At most 50 exchanges at once" }
  const pairs: Pair[] = []
  for (const [i, r] of raw.entries()) {
    const n = raw.length > 1 ? ` (exchange ${i + 1})` : ""
    const to = r?.to || {}
    const fromItemId = parsePositiveId(r?.fromItemId)
    if (fromItemId === null) return { error: `Choose the item to exchange${n}` }
    const qty = Number(r?.quantity)
    const toQty = Number(to.quantity)
    const toPrice = Number(to.unitPrice)
    const toProductId = parsePositiveId(to.productId)
    const toName = String(to.name || "").trim()
    if (!(qty > 0) || !(toQty > 0)) return { error: `Both quantities must be above 0${n}` }
    if (!(toPrice >= 0)) return { error: `Enter the cost of the new item${n}` }
    if (!toProductId && !toName) return { error: `Choose or type the new item${n}` }
    pairs.push({
      fromItemId, qty, toProductId, toName, toQty, toPrice,
      description: String(to.description || "").trim() || null,
      unit: String(to.unit || "").trim() || null,
      notes: String(r?.notes ?? body?.notes ?? "").trim().slice(0, 500) || null,
    })
  }
  return { pairs }
}

export async function POST(request: Request) {
  const db = createAdminClient()
  const undo: (() => PromiseLike<unknown>)[] = []
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "Choose the purchase order")
    const read = readPairs(body)
    if ("error" in read) return refuse(400, "BAD_INPUT", read.error)
    const { pairs } = read

    const { data: po, error } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    const blocker = await editBlocker(db, po)
    if (blocker) return refuse(409, blocker.code, blocker.error)

    // Every line being exchanged is on this PO, and no line gives away more than it holds (several exchanges may take
    // from the same line).
    const fromIds = [...new Set(pairs.map((p) => p.fromItemId))]
    const { data: fromRows, error: fromError } = await db.from("purchase_order_items").select("*").eq("po_id", poId).in("po_item_id", fromIds)
    if (fromError) throw fromError
    const fromById = new Map<number, any>((fromRows || []).map((r: any) => [r.po_item_id, r]))
    const takenById = new Map<number, number>()
    for (const p of pairs) {
      const from = fromById.get(p.fromItemId)
      if (!from) return refuse(404, "NOT_FOUND", "An item to exchange is not on this purchase order")
      takenById.set(p.fromItemId, (takenById.get(p.fromItemId) || 0) + p.qty)
    }
    for (const [id, taken] of takenById) {
      const from = fromById.get(id)
      if (taken > (Number(from.quantity) || 0) + 1e-9) {
        return refuse(409, "EXCHANGE_TOO_MANY", `Only ${from.quantity} of "${from.outsourced_name || from.item_name_snapshot || "that item"}" are on the purchase order`)
      }
    }

    const productIds = [...new Set([...(fromRows || []).map((r: any) => r.product_id), ...pairs.map((p) => p.toProductId)].filter(Boolean))]
    const names = new Map<number, string>()
    if (productIds.length > 0) {
      const { data: products } = await db.from("products").select("product_id, product_name").in("product_id", productIds)
      for (const p of products || []) names.set(p.product_id, p.product_name)
    }
    if (pairs.some((p) => p.toProductId && !names.has(p.toProductId))) return refuse(400, "BAD_INPUT", "A new product was not found")

    // 1. Each X line goes down by what its exchanges take (removed when nothing is left and nothing was received on it).
    for (const [id, taken] of takenById) {
      const from = fromById.get(id)
      const leftQty = poMoney((Number(from.quantity) || 0) - taken)
      const { data: receivedRows } = await db.from("goods_receipt_lines").select("quantity_received").eq("po_item_id", id)
      const received = (receivedRows || []).reduce((s: number, r: any) => s + (Number(r.quantity_received) || 0), 0)
      if (leftQty <= 0 && received <= 0) {
        const { error: e } = await db.from("purchase_order_items").delete().eq("po_item_id", id)
        if (e) throw e
        undo.push(() => db.from("purchase_order_items").insert(from))
      } else {
        const { error: e } = await db.from("purchase_order_items").update({ quantity: leftQty, total: poMoney(leftQty * (Number(from.unit_price) || 0)) }).eq("po_item_id", id)
        if (e) throw e
        undo.push(() => db.from("purchase_order_items").update({ quantity: from.quantity, total: from.total }).eq("po_item_id", id))
      }
    }

    // 2. Each Y is added; it keeps its X's sales-order link so it still counts for the customer's order.
    const results: { from: any; to: any; difference: number; notes: string | null }[] = []
    for (const p of pairs) {
      const from = fromById.get(p.fromItemId)
      const outsourced = !p.toProductId
      const yRow = {
        po_id: poId,
        product_id: p.toProductId,
        item_name_snapshot: p.toProductId ? names.get(p.toProductId) || null : p.toName,
        quantity: p.toQty,
        unit_price: p.toPrice,
        total: poMoney(p.toQty * p.toPrice),
        item_type: outsourced ? "outsourced" : "stock",
        outsourced_name: outsourced ? p.toName : null,
        outsourced_description: outsourced ? p.description : null,
        outsourced_unit: outsourced ? p.unit : null,
        source_so_id: from.source_so_id ?? null,
        source_so_item_id: from.source_so_item_id ?? null,
      }
      const { data: added, error: addError } = await db.from("purchase_order_items").insert(yRow).select("po_item_id").single()
      if (addError) throw addError
      undo.push(() => db.from("purchase_order_items").delete().eq("po_item_id", added.po_item_id))
      const fromPrice = Number(from.unit_price) || 0
      const oldSide = { name: lineName(from, names), quantity: p.qty, unitPrice: fromPrice, total: poMoney(p.qty * fromPrice) }
      const newSide = { name: lineName(yRow, names), quantity: p.toQty, unitPrice: p.toPrice, total: yRow.total }
      results.push({ from: oldSide, to: newSide, difference: poMoney(newSide.total - oldSide.total), notes: p.notes })
    }

    // 3. The PO total (VAT stays as the PO had it) and its receiving status follow.
    const { data: lines, error: linesError } = await db.from("purchase_order_items").select("total").eq("po_id", poId)
    if (linesError) throw linesError
    const vatOn = Number(po.tax_amount) > 0
    const totals = computePoTotals(lines || [], vatOn)
    const reserved = await reservedCreditTotal(db, poId)
    if (reserved.error) throw new Error(reserved.error)
    if (reserved.total > totals.total + 0.005) {
      for (const step of undo.reverse()) await step()
      return refuse(409, "CREDIT_EXCEEDS_TOTAL", `The new total (${totals.total.toFixed(2)}) would be less than the advances and credits on this PO (${reserved.total.toFixed(2)})`)
    }
    const { error: totalError } = await db.from("purchase_orders").update({ total: totals.total, tax_amount: vatOn ? totals.tax : null }).eq("po_id", poId)
    if (totalError) throw totalError
    undo.push(() => db.from("purchase_orders").update({ total: po.total, tax_amount: po.tax_amount }).eq("po_id", poId))
    await syncPoStatus(db, po, undo)

    for (const r of results) {
      await logPoEvent(db, poId, {
        event_type: "PO_ITEM_EXCHANGED",
        old_value: JSON.stringify(r.from),
        new_value: JSON.stringify(r.to),
        userId: body?.userId,
        notes: r.notes,
      })
    }
    const difference = poMoney(results.reduce((s, r) => s + r.difference, 0))
    return NextResponse.json({ ok: true, total: totals.total, exchange: results[0], exchanges: results, difference })
  } catch (error) {
    console.error("PO exchange: failed", error)
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (e) {
        console.error("PO exchange: could not undo a step", e)
      }
    }
    return refuse(500, "EXCHANGE_FAILED", "The exchanges could not be saved. Nothing was changed; please try again.")
  }
}

export async function GET(request: Request) {
  try {
    const poId = parsePositiveId(new URL(request.url).searchParams.get("poId"))
    if (poId === null) return refuse(400, "BAD_INPUT", "poId is required")
    const db = createAdminClient()
    const { data: events, error } = await db
      .from("workflow_events")
      .select("event_type, old_value, new_value, notes, performed_by, performed_at")
      .eq("entity_type", "PURCHASE_ORDER")
      .eq("entity_id", poId)
      .in("event_type", PO_HISTORY_EVENTS)
    if (error) throw error
    const parse = (v: any) => {
      try {
        return typeof v === "string" ? JSON.parse(v) : v
      } catch {
        return null
      }
    }
    const { data: advances, error: advError } = await db
      .from("supplier_credits")
      .select("credit_id, amount, notes, created_at, status")
      .eq("credit_type", ADVANCE_CREDIT_TYPE)
      .eq("reference_type", "purchase_order")
      .eq("reference_id", poId)
    if (advError) throw advError
    const exchanges = (events || [])
      .filter((e: any) => e.event_type === "PO_ITEM_EXCHANGED")
      .map((e: any) => {
        const from = parse(e.old_value) || {}
        const to = parse(e.new_value) || {}
        return { date: e.performed_at, by: e.performed_by, notes: e.notes, from, to, difference: poMoney((Number(to.total) || 0) - (Number(from.total) || 0)) }
      })
    const sentBack = (events || []).filter((e: any) => e.event_type === "PO_ITEM_SENT_BACK").map((e: any) => ({ date: e.performed_at, ...(parse(e.old_value) || {}), notes: e.notes }))
    const closings = (events || [])
      .filter((e: any) => e.event_type === "PO_CLOSED" || e.event_type === "PO_REOPENED")
      .map((e: any) => ({ date: e.performed_at, kind: e.event_type === "PO_CLOSED" ? "closed" : "reopened", notes: e.notes }))
    const byDate = (a: any, b: any) => String(a.date || "").localeCompare(String(b.date || ""))
    return NextResponse.json({
      exchanges: exchanges.sort(byDate),
      sentBack: sentBack.sort(byDate),
      closings: closings.sort(byDate),
      advances: (advances || [])
        .map((a: any) => ({ id: a.credit_id, amount: Number(a.amount) || 0, method: advanceMethod(a), date: /paid=([\d-]+)/.exec(String(a.notes || ""))?.[1] || a.created_at, ref: /ref=([^;]+)/.exec(String(a.notes || ""))?.[1] || "", released: a.status !== "used" }))
        .sort(byDate),
    })
  } catch (error) {
    console.error("PO history: failed", error)
    return refuse(500, "HISTORY_FAILED", "Could not load the purchase order history")
  }
}
