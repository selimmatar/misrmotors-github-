// "Reopen PO" (owner request, 2026-11-11; several bills per PO 2026-11-17): removes the LAST supplier bill of the PO,
// and only while nothing has been paid on it. When that bill is the closing bill the PO is open again; when it is a
// bill for received items (the PO is open already) only that bill goes ("Remove last bill").
// The bill is removed with only the credit / advance rows it wrote, its lines and its unpaid schedule; the credits and
// advances stay reserved on the PO and come off the next bill.
// A PO closed WITHOUT a closing bill (nothing was left to bill, 2026-11-18; lib/po-closed-marker.ts) is reopened by
// clearing that marker only: no bill is removed. "Remove last bill" on the open PO then works as before.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { logPoEvent } from "@/lib/po-history"
import { billHasPayments, billsOf, lastBillOf, removePoBills, removedBillDates } from "@/lib/po-bill"
import { closingBillOf, isPartialBill } from "@/lib/po-bill-number"
import { PO_CLOSED_NO_BILL, isClosedWithoutBill, writeCloseMarker } from "@/lib/po-closed-marker"

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
    const all = await billsOf(db, poId)
    if (!closingBillOf(all, po.po_number) && (await isClosedWithoutBill(db, poId))) {
      await writeCloseMarker(db, poId, {
        event_type: "PO_REOPENED",
        old_value: PO_CLOSED_NO_BILL,
        new_value: JSON.stringify({ unlinkedCreditIds: [] }),
        userId: body?.userId,
        notes: `${po.po_number} reopened (it was closed without a closing bill; no bill removed)`,
      })
      return NextResponse.json({ ok: true, removed: null, reopened: true })
    }
    const last = lastBillOf(all)
    if (!last) return NextResponse.json({ error: "This purchase order is already open", code: "PO_ALREADY_OPEN" }, { status: 409 })
    if (await billHasPayments(db, [last])) {
      return NextResponse.json(
        {
          error: `A payment is already recorded on the supplier bill ${last.invoice_number}, so it stays as it is and the purchase order cannot be reopened. To send an item back, use "Return to supplier" on the closed PO: it gives a supplier credit.`,
          code: "PO_PAID",
        },
        { status: 409 },
      )
    }
    const { unlinkedCreditIds } = await removePoBills(db, [last])
    const closing = !isPartialBill(last, po.po_number)
    await logPoEvent(db, poId, {
      event_type: closing ? "PO_REOPENED" : "PO_BILL_REMOVED",
      old_value: last.invoice_number,
      // supplier credits that pointed at the removed bill: the next close links them to the new one; the removed
      // closing bill's number and dates: the next close makes it again with the same date (owner request, 2026-11-22)
      new_value: JSON.stringify(closing ? { unlinkedCreditIds, removedBill: removedBillDates(last) } : { unlinkedCreditIds }),
      userId: body?.userId,
      notes: closing ? `${po.po_number} reopened; supplier bill ${last.invoice_number} removed` : `${po.po_number}: bill ${last.invoice_number} removed`,
    })
    return NextResponse.json({ ok: true, removed: last.invoice_number, reopened: closing })
  } catch (error) {
    console.error("Reopen PO: failed", error)
    return NextResponse.json({ error: "The purchase order could not be reopened. Please try again.", code: "REOPEN_FAILED" }, { status: 500 })
  }
}
