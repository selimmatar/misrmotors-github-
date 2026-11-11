// "Close PO & send to Accounts Payable" (owner request, 2026-11-11): makes the supplier bill from the FINAL PO.
// Until then the PO is open: it can be edited, exchanged, returned against and paid an advance on (lib/po-bill.ts).
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { PO_CLOSABLE_STATUSES, billsOf, createPoBill } from "@/lib/po-bill"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return NextResponse.json({ error: "A valid purchase order id is required", code: "BAD_INPUT" }, { status: 400 })
    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return NextResponse.json({ error: "Purchase order not found", code: "NOT_FOUND" }, { status: 404 })
    if (!PO_CLOSABLE_STATUSES.includes(String(po.status))) {
      return NextResponse.json({ error: `A "${po.status}" purchase order cannot be closed; it must be approved first`, code: "PO_NOT_CLOSABLE" }, { status: 409 })
    }
    if ((await billsOf(db, poId)).length > 0) {
      return NextResponse.json({ error: "This purchase order is already closed (it has a supplier bill)", code: "PO_ALREADY_CLOSED" }, { status: 409 })
    }
    if (!(Number(po.total) > 0)) {
      return NextResponse.json({ error: "The purchase order total is 0, so there is nothing to bill", code: "PO_TOTAL_ZERO" }, { status: 409 })
    }
    const billError = await createPoBill(db, po)
    if (billError) {
      console.error("Close PO: the supplier bill could not be made", billError)
      return NextResponse.json({ error: "The supplier bill could not be made. The purchase order stays open; please try again.", code: "BILL_FAILED" }, { status: 500 })
    }
    await db.from("workflow_events").insert({
      entity_type: "PURCHASE_ORDER",
      entity_id: poId,
      event_type: "PO_CLOSED",
      new_value: `APINV-${po.po_number}`,
      performed_by: parsePositiveId(body?.userId),
      notes: `${po.po_number} closed and sent to Accounts Payable (${po.total})`,
    })
    return NextResponse.json({ ok: true, invoiceNumber: `APINV-${po.po_number}` })
  } catch (error) {
    console.error("Close PO: failed", error)
    return NextResponse.json({ error: "The purchase order could not be closed. Please try again.", code: "CLOSE_FAILED" }, { status: 500 })
  }
}
