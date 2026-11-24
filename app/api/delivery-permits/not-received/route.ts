import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { createReturn } from "@/lib/returns"
import { actorName } from "@/lib/auth/actor"
import { loadSignedLines, notReceivedReturnBody } from "@/lib/dp-not-received"

export const dynamic = "force-dynamic"

// POST { permitId, idempotencyKey, lines: [{ itemId, notReceived, quantity }], createdBy? }
// The lines the shipping user confirmed as "Returned / لم يُستلم" after reading the signed permit become ONE return
// through the existing return flow (lib/returns.ts createReturn -> product_returns / return_items, pending the
// warehouse), exactly what "Return items" does by hand. Unticked lines are ignored; nothing confirmed -> nothing saved.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const permitId = parsePositiveId(body?.permitId === undefined || body?.permitId === null ? null : String(body.permitId))
    if (!permitId) return NextResponse.json({ error: "permitId is required" }, { status: 400 })
    const key = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
    if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) {
      return NextResponse.json({ error: "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)" }, { status: 400 })
    }
    const db = createAdminClient()
    const loaded = await loadSignedLines(db, permitId)
    if (!loaded) return NextResponse.json({ error: "Delivery permit not found" }, { status: 404 })
    const built = notReceivedReturnBody(permitId, key, loaded.lines, Array.isArray(body?.lines) ? body.lines : [], {
      createdBy: actorName(request) || (typeof body?.createdBy === "string" ? body.createdBy : null),
    })
    if (!built) return NextResponse.json({ success: true, returnId: null, lines: 0, message: "Nothing was marked as not received" })

    const result = await createReturn(db, built.body)
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status })

    // The received quantity per line, kept on the permit line when the column exists
    // (scripts/sql/2026-11-26-dp-not-received.sql, optional): a missing column changes nothing.
    for (const { line, quantity } of built.lines) {
      const { error } = await db
        .from("delivery_permit_items")
        .update({ received_quantity: Math.max(line.quantity - quantity, 0) })
        .eq("item_id", line.itemId)
        .eq("permit_id", permitId)
      if (error) {
        console.error("not-received: received_quantity not saved (column missing?):", error.message)
        break
      }
    }
    await db.from("workflow_events").insert({
      entity_type: "DELIVERY_PERMIT",
      entity_id: permitId,
      event_type: "NOT_RECEIVED_CONFIRMED",
      new_value: JSON.stringify(built.lines.map(({ line, quantity }) => ({ itemId: line.itemId, name: line.name, quantity }))),
      notes: `Not received on the signed permit: ${built.lines.map(({ line, quantity }) => `${line.name} x${quantity}`).join(", ")}`,
    })
    return NextResponse.json({ ...result.body, lines: built.lines.length })
  } catch (error) {
    console.error("not-received error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
