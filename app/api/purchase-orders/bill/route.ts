// "Bill received items" (owner request, 2026-11-17): suppliers deliver in parts and want paying for what they delivered,
// so an OPEN purchase order can get several supplier bills, each for received quantities not billed yet. The PO stays
// open; "Close PO" makes the final bill (app/api/purchase-orders/close). See lib/po-bill.ts.
//   GET  ?poId=N  -> each line: ordered / received / already billed / not coming / what can be billed now; the bills
//   POST { id, lines: [{ poItemId, quantity }], supplierInvoiceNumber?, invoiceDate? } -> a new bill for those quantities
// Who may: the /api/purchase-orders write rule (po-rep, accountant, admin, CEO), the same people as PO_CLOSE_ROLES.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { logPoEvent } from "@/lib/po-history"
import { PO_CLOSABLE_STATUSES, billDetails, createBill, loadPoBilling, relinkUnlinkedCredits } from "@/lib/po-bill"
import { isPartialBill } from "@/lib/po-bill-number"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export async function GET(request: Request) {
  const poId = parsePositiveId(new URL(request.url).searchParams.get("poId"))
  if (poId === null) return refuse(400, "BAD_INPUT", "Choose a purchase order")
  try {
    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    const b = await loadPoBilling(db, po)
    return NextResponse.json({
      poId: po.po_id,
      poNumber: po.po_number,
      total: Number(po.total) || 0,
      closed: b.closed,
      ready: b.ready,
      factor: b.factor,
      billedAmount: b.billedAmount,
      billedPercent: b.billedPercent,
      lines: b.lines,
      bills: b.bills.map((bill, i) => ({
        invoiceId: bill.invoice_id,
        invoiceNumber: bill.invoice_number,
        supplierInvoiceNumber: bill.supplier_invoice_number ?? null,
        date: bill.invoice_date,
        amount: Number(bill.amount) || 0,
        paidAmount: Number(bill.paid_amount) || 0,
        final: !isPartialBill(bill, po.po_number),
        no: i + 1,
      })),
    })
  } catch (error) {
    console.error("PO bill: could not read", error)
    return refuse(500, "READ_FAILED", "Could not read the bills of this purchase order")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "A valid purchase order id is required")
    const details = billDetails(body)
    if ("error" in details) return refuse(400, "BAD_INPUT", details.error)
    const rows = Array.isArray(body?.lines) ? body.lines : null
    if (!rows || rows.length === 0) return refuse(400, "BAD_INPUT", "Choose what to bill")

    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    if (!PO_CLOSABLE_STATUSES.includes(String(po.status))) return refuse(409, "PO_NOT_BILLABLE", `A "${po.status}" purchase order cannot be billed`)
    const billing = await loadPoBilling(db, po)
    if (billing.closing) return refuse(409, "PO_CLOSED", "This purchase order is closed: it has its final supplier bill")
    if (billing.closedWithoutBill) return refuse(409, "PO_CLOSED", "This purchase order is closed: reopen it to bill more")
    if (!billing.ready) {
      return refuse(409, "MIGRATION_PENDING", "Bills for part of a purchase order need a database update that is not applied yet. Close the PO to bill all of it, or ask the administrator.")
    }

    // never more than was received and not billed yet, per line
    const qty = new Map<number, number>()
    for (const row of rows) {
      const id = parsePositiveId(row?.poItemId)
      const q = Number(row?.quantity)
      if (id === null || !Number.isFinite(q) || q < 0) return refuse(400, "BAD_INPUT", "Each line needs a quantity of 0 or more")
      qty.set(id, money((qty.get(id) || 0) + q))
    }
    for (const [id, q] of qty) {
      const line = billing.lines.find((l) => l.poItemId === id)
      if (!line) return refuse(404, "NOT_FOUND", "A line to bill is not on this purchase order")
      if (q > line.open + 1e-9) {
        return refuse(
          409,
          "BILL_TOO_MANY",
          line.open > 0
            ? `Only ${line.open} of "${line.name}" were received and not billed yet, so only ${line.open} can be billed`
            : `Nothing of "${line.name}" is received and not billed yet`,
        )
      }
    }
    if (![...qty.values()].some((q) => q > 0)) return refuse(400, "NOTHING_TO_BILL", "Enter a quantity to bill on at least one line")

    const { error: billError, invoice } = await createBill(db, billing, qty, { final: false, ...details })
    if (billError || !invoice) {
      console.error("PO bill: the bill could not be made", billError)
      return refuse(500, "BILL_FAILED", "The supplier bill could not be made. Nothing was changed; please try again.")
    }
    await relinkUnlinkedCredits(db, poId)
    const no = billing.bills.length + 1
    await logPoEvent(db, poId, {
      event_type: "PO_BILLED",
      new_value: invoice.invoice_number,
      userId: body?.userId,
      notes: `${po.po_number}: bill ${no} (${invoice.invoice_number}${details.supplierInvoiceNumber ? `, supplier invoice ${details.supplierInvoiceNumber}` : ""}) for received items, ${invoice.amount}`,
    })
    return NextResponse.json({ ok: true, invoiceNumber: invoice.invoice_number, amount: Number(invoice.amount) || 0, paidAmount: Number(invoice.paid_amount) || 0, billNo: no })
  } catch (error) {
    console.error("PO bill: failed", error)
    return refuse(500, "BILL_FAILED", "The supplier bill could not be made. Please try again.")
  }
}
