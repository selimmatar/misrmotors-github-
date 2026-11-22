// "Reopen PO" (owner request, 2026-11-11; several bills per PO 2026-11-17; owner decision 2026-11-22):
//  - a CLOSED PO is reopened and its closing bill is KEPT, paid or not: the same accounts_payable row (invoice_id,
//    number, invoice date, payments) stays, the PO can be edited again, and closing it again updates that row to the
//    new amount (lib/po-bill.ts updateKeptBill). A supplier bill is never deleted by a reopen;
//  - on an OPEN PO it is "Remove last bill": the last bill for received items goes, only while nothing is paid on it
//    (the bill, its lines, the credit / advance rows it wrote, its unpaid schedule). A paid one stays;
//  - a PO closed WITHOUT a closing bill (nothing was left to bill, 2026-11-18; lib/po-closed-marker.ts) is reopened by
//    clearing that marker only.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { logPoEvent } from "@/lib/po-history"
import { billHasPayments, billsOf, lastBillOf, removePoBills, reopenKeepingBill } from "@/lib/po-bill"
import { closingBillOf } from "@/lib/po-bill-number"
import { PO_CLOSED_NO_BILL, isClosedWithoutBill, keptBillId, writeCloseMarker } from "@/lib/po-closed-marker"

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
    const closing = closingBillOf(all, po.po_number)
    if (!closing && (await isClosedWithoutBill(db, poId))) {
      await writeCloseMarker(db, poId, {
        event_type: "PO_REOPENED",
        old_value: PO_CLOSED_NO_BILL,
        new_value: JSON.stringify({ unlinkedCreditIds: [] }),
        userId: body?.userId,
        notes: `${po.po_number} reopened (it was closed without a closing bill; no bill removed)`,
      })
      return NextResponse.json({ ok: true, removed: null, reopened: true, kept: null })
    }
    const kept = closing ? await keptBillId(db, poId) : null
    if (closing && kept !== Number(closing.invoice_id)) {
      await reopenKeepingBill(db, po, closing, `${po.po_number} reopened; supplier bill ${closing.invoice_number} kept (closing again updates it)`, body?.userId)
      return NextResponse.json({ ok: true, removed: null, reopened: true, kept: closing.invoice_number })
    }
    // open PO: "Remove last bill" (never the closing bill a reopen kept)
    const last = lastBillOf(all.filter((b) => Number(b.invoice_id) !== kept))
    if (!last) return NextResponse.json({ error: "This purchase order is already open", code: "PO_ALREADY_OPEN" }, { status: 409 })
    if (await billHasPayments(db, [last])) {
      return NextResponse.json(
        {
          error: `A payment is already recorded on the supplier bill ${last.invoice_number}, so it cannot be removed. It stays as it is.`,
          errorAr: `تم تسجيل دفعة على فاتورة المورد ${last.invoice_number}، فلا يمكن حذفها. تبقى كما هي.`,
          code: "PO_PAID",
        },
        { status: 409 },
      )
    }
    const { unlinkedCreditIds } = await removePoBills(db, [last])
    await logPoEvent(db, poId, {
      event_type: "PO_BILL_REMOVED",
      old_value: last.invoice_number,
      // supplier credits that pointed at the removed bill: the next bill links them again
      new_value: JSON.stringify({ unlinkedCreditIds }),
      userId: body?.userId,
      notes: `${po.po_number}: bill ${last.invoice_number} removed`,
    })
    return NextResponse.json({ ok: true, removed: last.invoice_number, reopened: false })
  } catch (error) {
    console.error("Reopen PO: failed", error)
    return NextResponse.json({ error: "The purchase order could not be reopened. Please try again.", code: "REOPEN_FAILED" }, { status: 500 })
  }
}
