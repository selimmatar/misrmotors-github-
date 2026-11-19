import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { renameInvoiceNumber } from "@/lib/eta/rename-invoice"

export const dynamic = "force-dynamic"

// POST { invoiceId, invoiceNumber }: changes the internal number of an invoice that is not on the portal yet
// (accountant, CEO, admin: /api/eta rule).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const invoiceId = Number(body?.invoiceId)
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return NextResponse.json({ error: "Invalid invoice" }, { status: 400 })
    const r = await renameInvoiceNumber(createAdminClient(), invoiceId, body?.invoiceNumber, actorUserId(request))
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json({ ok: true, invoiceNumber: r.invoiceNumber })
  } catch (error) {
    console.error("Invoice number change failed:", error)
    return NextResponse.json({ error: "Could not change the invoice number." }, { status: 500 })
  }
}
