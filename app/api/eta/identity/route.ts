import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { parsePositiveId } from "@/lib/parse-id"
import { chooseInvoiceIdentity } from "@/lib/eta/identities"

export const dynamic = "force-dynamic"

// POST { invoiceId, identityId | null }: which of the customer's companies (tax identities) the invoice is issued for
// on the portal (accountant, CEO, admin: /api/eta rule). Refused once a real document is live (ETA_LIVE).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const invoiceId = parsePositiveId(body.invoiceId == null ? null : String(body.invoiceId))
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    const identityId = body.identityId == null ? null : parsePositiveId(String(body.identityId))
    if (body.identityId != null && identityId === null) return NextResponse.json({ error: "Invalid identityId" }, { status: 400 })
    const r = await chooseInvoiceIdentity(createAdminClient(), invoiceId, identityId)
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json({ ok: true, identityId: r.value })
  } catch (error) {
    console.error("E-invoice identity choice failed:", error)
    return NextResponse.json({ error: "Could not save which company the invoice is for." }, { status: 500 })
  }
}
