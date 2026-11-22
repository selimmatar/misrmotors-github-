// "Close PO & send to Accounts Payable" (owner request, 2026-11-11; several bills per PO 2026-11-17): makes the closing
// bill for everything on the PO not billed yet ("bill received items" may have billed part of it already), except the
// quantities marked "not coming", which are recorded on the PO lines. After it the PO is final (lib/po-bill.ts).
// When nothing is left to bill (its bills for received items took everything) NO 0 EGP bill is made: the PO is only
// marked closed in its history (owner request, 2026-11-18; lib/po-closed-marker.ts).
//   body: { id, notComing?: [{ poItemId, quantity }], supplierInvoiceNumber?, invoiceDate? }
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { logPoEvent } from "@/lib/po-history"
import { PO_CLOSABLE_STATUSES, billDetails, closesWithoutBill, createBill, isMissingRelation, loadPoBilling, relinkUnlinkedCredits } from "@/lib/po-bill"
import { PO_CLOSED_NO_BILL, writeCloseMarker } from "@/lib/po-closed-marker"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "A valid purchase order id is required")
    const details = billDetails(body)
    if ("error" in details) return refuse(400, "BAD_INPUT", details.error)
    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    if (!PO_CLOSABLE_STATUSES.includes(String(po.status))) {
      return refuse(409, "PO_NOT_CLOSABLE", `A "${po.status}" purchase order cannot be closed; it must be approved first`)
    }
    const billing = await loadPoBilling(db, po)
    if (billing.closing) return refuse(409, "PO_ALREADY_CLOSED", "This purchase order is already closed (it has a supplier bill)")
    if (billing.closedWithoutBill) return refuse(409, "PO_ALREADY_CLOSED", "This purchase order is already closed")
    if (!billing.kept && billing.bills.length === 0 && !(Number(po.total) > 0)) return refuse(409, "PO_TOTAL_ZERO", "The purchase order total is 0, so there is nothing to bill")

    // "Not coming": only what was neither received nor billed can be left out of the bill.
    const notComing = new Map<number, number>()
    const sent = Array.isArray(body?.notComing) ? body.notComing : []
    for (const row of sent) {
      const id = parsePositiveId(row?.poItemId)
      const qty = Number(row?.quantity)
      if (id === null || !Number.isFinite(qty) || qty < 0) return refuse(400, "BAD_INPUT", "Each \"not coming\" row needs a line and a quantity of 0 or more")
      const line = billing.lines.find((l) => l.poItemId === id)
      if (!line) return refuse(404, "NOT_FOUND", "A \"not coming\" line is not on this purchase order")
      const most = money(Math.max(0, line.ordered - Math.max(line.received, line.billed)))
      if (qty > most + 1e-9) return refuse(409, "NOT_COMING_TOO_MANY", `Only ${most} of "${line.name}" were neither received nor billed, so only ${most} can be marked as not coming`)
      notComing.set(id, money(qty))
    }
    const marking = [...notComing.values()].some((q) => q > 0)
    if ((marking || billing.bills.length > 0) && !billing.ready) {
      return refuse(409, "MIGRATION_PENDING", "Bills for part of a purchase order need a database update that is not applied yet. Close it without \"not coming\" quantities, or ask the administrator.")
    }

    // record "not coming" on the lines (every line: what is not sent is 0); put back if the bill cannot be made
    const restore: { id: number; was: number }[] = []
    if (billing.ready) {
      for (const item of billing.items) {
        const want = notComing.get(Number(item.po_item_id)) || 0
        const was = Number(item.quantity_not_coming) || 0
        if (Math.abs(want - was) < 1e-9) continue
        const { error: e } = await db.from("purchase_order_items").update({ quantity_not_coming: want }).eq("po_item_id", item.po_item_id)
        if (e) {
          for (const r of restore) await db.from("purchase_order_items").update({ quantity_not_coming: r.was }).eq("po_item_id", r.id)
          if (isMissingRelation(e)) return refuse(409, "MIGRATION_PENDING", "The \"not coming\" quantity needs a database update that is not applied yet.")
          throw e
        }
        restore.push({ id: Number(item.po_item_id), was })
        item.quantity_not_coming = want
      }
    }
    const fresh = await loadPoBilling(db, po)
    const rest = new Map(fresh.lines.map((l) => [l.poItemId, l.rest]))
    const left = [...notComing].filter(([, q]) => q > 0)
    const notComingNote = left.length ? `; not coming: ${left.map(([id, q]) => `${fresh.lines.find((l) => l.poItemId === id)?.name || id} x ${q}`).join(", ")}` : ""

    // nothing left to bill: closed without a 0 bill; the marker event is what makes it closed, so it must be written
    // (a PO reopened with its closing bill kept always updates that bill, even to 0: it is never left out or deleted)
    if (!fresh.kept && closesWithoutBill(fresh, rest)) {
      try {
        await writeCloseMarker(db, poId, {
          event_type: "PO_CLOSED",
          new_value: PO_CLOSED_NO_BILL,
          userId: body?.userId,
          notes: `${po.po_number} closed; nothing was left to bill (${fresh.bills.length} earlier bill${fresh.bills.length === 1 ? "" : "s"}), so no closing bill${notComingNote}`,
        })
      } catch (markError) {
        for (const r of restore) await db.from("purchase_order_items").update({ quantity_not_coming: r.was }).eq("po_item_id", r.id)
        console.error("Close PO: the closed marker could not be recorded", markError)
        return refuse(500, "CLOSE_FAILED", "The purchase order could not be closed. It stays open; please try again.")
      }
      await relinkUnlinkedCredits(db, poId)
      return NextResponse.json({ ok: true, noBill: true, invoiceNumber: null, amount: 0 })
    }

    // closing again after a reopen that kept the closing bill: createBill updates that same row (2026-11-22)
    const result: any = await createBill(db, fresh, rest, { final: true, ...details })
    const { error: billError, invoice } = result
    if (billError) {
      for (const r of restore) await db.from("purchase_order_items").update({ quantity_not_coming: r.was }).eq("po_item_id", r.id)
      console.error("Close PO: the supplier bill could not be made", billError)
      return refuse(500, "BILL_FAILED", "The supplier bill could not be made. The purchase order stays open; please try again.")
    }
    // supplier credits a reopen unlinked from the old bill point at this one again
    await relinkUnlinkedCredits(db, poId)
    const notes =
      `${po.po_number} closed and sent to Accounts Payable (${fresh.kept ? `bill ${invoice.invoice_number} updated to` : "final bill"} ${invoice.amount}` +
      `${fresh.bills.length > 0 ? `, bill ${fresh.bills.length + 1} of ${fresh.bills.length + 1}` : ""})` +
      (result.excessCredit > 0 ? `; ${result.excessCredit} paid above it is a supplier credit` : "") +
      notComingNote
    if (fresh.kept) {
      // the close event is what ends the reopen, so it must be written (lib/po-closed-marker.ts)
      try {
        await writeCloseMarker(db, poId, { event_type: "PO_CLOSED", new_value: invoice.invoice_number, userId: body?.userId, notes })
      } catch (markError) {
        console.error("Close PO: the bill was updated but the close could not be recorded", markError)
        return refuse(500, "CLOSE_FAILED", "The supplier bill was updated but the purchase order could not be marked closed. Close it again.")
      }
    } else {
      await logPoEvent(db, poId, { event_type: "PO_CLOSED", new_value: invoice.invoice_number, userId: body?.userId, notes })
    }
    return NextResponse.json({ ok: true, invoiceNumber: invoice.invoice_number, amount: invoice.amount, updated: !!fresh.kept, supplierCredit: result.excessCredit || 0 })
  } catch (error) {
    console.error("Close PO: failed", error)
    return refuse(500, "CLOSE_FAILED", "The purchase order could not be closed. Please try again.")
  }
}
