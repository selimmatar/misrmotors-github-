import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { parsePositiveId } from "@/lib/parse-id"
import { saveCustomerPo } from "@/lib/eta/customer-po"

export const dynamic = "force-dynamic"

// POST { invoiceId, soId, customerPo }: the customer's PO number of one of the invoice's sales orders, typed in the
// e-invoice window (accountant, CEO, admin: /api/eta rule). Empty clears it. Refused once the invoice is on the portal.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const invoiceId = parsePositiveId(body.invoiceId == null ? null : String(body.invoiceId))
    const soId = parsePositiveId(body.soId == null ? null : String(body.soId))
    if (invoiceId === null || soId === null) return NextResponse.json({ error: "invoiceId and soId are required" }, { status: 400 })
    const r = await saveCustomerPo(createAdminClient(), invoiceId, soId, body.customerPo)
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json({ ok: true, customerPo: r.value })
  } catch (error) {
    console.error("Saving the customer's PO number failed:", error)
    return NextResponse.json({ error: "Could not save the PO number." }, { status: 500 })
  }
}
