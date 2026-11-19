import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { cancelMinvInvoice } from "@/lib/minv-cancel"

export const dynamic = "force-dynamic"

// POST { reason }: cancels a maintenance (MINV) invoice and frees its number (accountant: /api/invoices/ar rule).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invoiceId = Number((await params).id)
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return NextResponse.json({ error: "Invalid invoice" }, { status: 400 })
    const body = await request.json().catch(() => null)
    const r = await cancelMinvInvoice(createAdminClient(), invoiceId, body?.reason, actorUserId(request))
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json({ ok: true, invoiceNumber: r.invoiceNumber })
  } catch (error) {
    console.error("Invoice cancel failed:", error)
    return NextResponse.json({ error: "Could not cancel the invoice." }, { status: 500 })
  }
}
