// Advance paid to a supplier on an OPEN purchase order (owner request, 2026-11-11). The cash leaves now (a ledger entry
// like any supplier payment); the advance is kept against the PO (a reserved supplier credit of type "advance") and is
// taken off the supplier bill when the PO is closed (lib/po-bill.ts). Not allowed once the PO is closed.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { AP_PAYMENT_METHODS } from "@/lib/ap-payments"
import { ADVANCE_CREDIT_TYPE, billsOf } from "@/lib/po-bill"
import { reservedCreditTotal } from "@/lib/supplier-credit-apply"

export const dynamic = "force-dynamic"

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const refuse = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status })

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const poId = parsePositiveId(body?.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "A valid purchase order id is required")
    const amount = money(Number(body?.amount))
    if (!(amount > 0)) return refuse(400, "BAD_INPUT", "Enter an amount above 0")
    const method = String(body?.paymentMethod || "")
    if (!(AP_PAYMENT_METHODS as readonly string[]).includes(method)) return refuse(400, "BAD_INPUT", `Payment method must be one of: ${AP_PAYMENT_METHODS.join(", ")}`)
    const reference = String(body?.referenceNumber || "").trim().slice(0, 100)
    const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.paymentDate || "")) ? String(body.paymentDate) : new Date().toISOString().split("T")[0]

    const db = createAdminClient()
    const { data: po, error } = await db.from("purchase_orders").select("po_id, po_number, supplier_id, status, total").eq("po_id", poId).maybeSingle()
    if (error) throw error
    if (!po) return refuse(404, "NOT_FOUND", "Purchase order not found")
    if (["rejected", "draft"].includes(String(po.status))) return refuse(409, "PO_NOT_OPEN", `An advance cannot be paid on a "${po.status}" purchase order`)
    if ((await billsOf(db, poId)).length > 0) return refuse(409, "PO_CLOSED", "This purchase order is closed: record the payment on its supplier bill in Accounts Payable")
    const reserved = await reservedCreditTotal(db, poId)
    if (reserved.error) throw new Error(reserved.error)
    if (reserved.total + amount > (Number(po.total) || 0) + 0.005) {
      return refuse(409, "ADVANCE_EXCEEDS_TOTAL", `Advances and credits on this PO (${money(reserved.total + amount)}) would be more than its total (${po.total})`)
    }

    const now = new Date().toISOString()
    const { data: credit, error: creditError } = await db
      .from("supplier_credits")
      .insert({
        supplier_id: po.supplier_id,
        amount,
        credit_type: ADVANCE_CREDIT_TYPE,
        invoice_id: null,
        reference_type: "purchase_order",
        reference_id: poId,
        description: `Advance paid on ${po.po_number}${reference ? ` (ref ${reference})` : ""}`,
        notes: `method=${method}; paid=${paidOn}${reference ? `; ref=${reference}` : ""}`,
        status: "used",
        used_in_po_id: poId,
        used_at: now,
        created_at: now,
      })
      .select("credit_id")
      .single()
    if (creditError) throw creditError

    // Same ledger convention as a supplier payment (lib/ap-payments.ts): money out, reference = the PO.
    const { error: ledgerError } = await db.from("balance_entries").insert({
      entry_type: "ap_payment",
      reference_type: "purchase_order",
      reference_id: poId,
      reference_number: reference || `ADV-${po.po_number}`,
      amount: -amount,
      description: `Advance to supplier on ${po.po_number} (${method})`,
      status: "active",
      created_by: parsePositiveId(body?.userId),
    })
    if (ledgerError) {
      await db.from("supplier_credits").delete().eq("credit_id", credit.credit_id)
      throw ledgerError
    }
    return NextResponse.json({ ok: true, creditId: credit.credit_id, amount })
  } catch (error) {
    console.error("PO advance: failed", error)
    return refuse(500, "ADVANCE_FAILED", "The advance could not be recorded. Nothing was changed; please try again.")
  }
}
