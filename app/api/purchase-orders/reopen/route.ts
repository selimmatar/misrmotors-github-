// "Reopen PO" (owner request, 2026-11-11): a closed PO goes back to open while nothing has been paid on its bill.
// The bill is removed (with only the credit / advance rows the close wrote and its unpaid schedule); the credits and
// advances stay reserved on the PO and come back when it is closed again.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { billHasPayments, billsOf, removePoBills } from "@/lib/po-bill"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return NextResponse.json({ error: "A valid purchase order id is required", code: "BAD_INPUT" }, { status: 400 })
    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("po_id, po_number, status").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return NextResponse.json({ error: "Purchase order not found", code: "NOT_FOUND" }, { status: 404 })
    const bills = await billsOf(db, poId)
    if (bills.length === 0) return NextResponse.json({ error: "This purchase order is already open", code: "PO_ALREADY_OPEN" }, { status: 409 })
    if (await billHasPayments(db, bills)) {
      return NextResponse.json(
        { error: "A payment is already recorded on this purchase order's supplier bill, so it cannot be reopened", code: "PO_PAID" },
        { status: 409 },
      )
    }
    const { unlinkedCreditIds } = await removePoBills(db, bills)
    await db.from("workflow_events").insert({
      entity_type: "PURCHASE_ORDER",
      entity_id: poId,
      event_type: "PO_REOPENED",
      old_value: bills.map((b: any) => b.invoice_number).join(", "),
      // supplier credits that pointed at the removed bill: the next close links them to the new one
      new_value: JSON.stringify({ unlinkedCreditIds }),
      performed_by: parsePositiveId(body?.userId),
      notes: `${po.po_number} reopened; supplier bill removed`,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Reopen PO: failed", error)
    return NextResponse.json({ error: "The purchase order could not be reopened. Please try again.", code: "REOPEN_FAILED" }, { status: 500 })
  }
}
