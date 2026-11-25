// "Reject receipt" on the goods receiving screen = refuse THIS delivery (owner decision 2026-11-25). The purchase order
// is approved, so it is not cancelled and nothing about money changes: the reason is saved as a note on the PO (the
// Notes badge purchasing and the CEO see on the PO list) and as a DELIVERY_REFUSED event in its history. The order
// stays open for a correct delivery. Warehouse, CEO, admin (the /api/goods-receipts rule).
//   body: { id, reason, userId? }
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { knownUserId } from "@/lib/po-history"
import { actorUserId } from "@/lib/auth/actor"

export const dynamic = "force-dynamic"

const REFUSABLE_STATUSES = ["approved", "partially_received"]
const MAX = 2000
const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id == null ? null : String(body.id))
    const reason = String(body?.reason ?? "").trim()
    if (poId === null) return refuse(400, "BAD_INPUT", "Choose the purchase order")
    if (!reason) return refuse(400, "BAD_INPUT", "Write the reason first")
    if (reason.length > MAX) return refuse(400, "BAD_INPUT", `The reason can be at most ${MAX} characters`)
    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("po_id, po_number, status").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    if (!REFUSABLE_STATUSES.includes(String(po.status))) {
      return refuse(409, "NOT_OPEN", `A "${po.status}" purchase order is not waiting for a delivery`)
    }
    const performedBy = await knownUserId(db, actorUserId(request, body?.userId))
    const note = `رفض الاستلام / Delivery refused at receiving: ${reason}`
    const noteRow = await db
      .from("workflow_events")
      .insert({ entity_type: "PURCHASE_ORDER", entity_id: poId, event_type: "NOTE", notes: note, performed_by: performedBy, metadata: { delivery_refused: true } })
    if (noteRow.error) throw noteRow.error
    const eventRow = await db
      .from("workflow_events")
      .insert({ entity_type: "PURCHASE_ORDER", entity_id: poId, event_type: "DELIVERY_REFUSED", old_value: String(po.status), new_value: String(po.status), notes: reason, performed_by: performedBy })
    if (eventRow.error) console.error(`PO history: could not record DELIVERY_REFUSED for PO ${poId}`, eventRow.error)
    return NextResponse.json({ ok: true, poNumber: po.po_number, status: po.status })
  } catch (error) {
    console.error("Refusing a delivery failed", error)
    return refuse(500, "FAILED", "The refusal could not be saved")
  }
}
