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
import { undoMoves, type StockMove } from "@/lib/dp-stock"
import { poMoney } from "@/lib/po-items"
import { ADVANCE_CREDIT_TYPE, advanceMethod } from "@/lib/po-bill"
import { exchangeOnPo, readPairs, type Undo } from "@/lib/po-exchange"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })
const PO_HISTORY_EVENTS = ["PO_ITEM_EXCHANGED", "PO_ITEM_SENT_BACK", "PO_CLOSED", "PO_REOPENED"]

export async function POST(request: Request) {
  const db = createAdminClient()
  const undo: Undo[] = []
  const moves: StockMove[] = []
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "Choose the purchase order")
    const read = readPairs(body)
    if ("error" in read) return refuse(400, "BAD_INPUT", read.error)
    const result = await exchangeOnPo(db, poId, read.pairs, body?.userId, undo, moves)
    if (!result.ok) return refuse(result.status, result.code, result.error)
    return NextResponse.json({ ok: true, total: result.total, exchange: result.exchanges[0], exchanges: result.exchanges, difference: result.difference })
  } catch (error) {
    console.error("PO exchange: failed", error)
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (e) {
        console.error("PO exchange: could not undo a step", e)
      }
    }
    if (moves.length > 0) await undoMoves(db, moves)
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
