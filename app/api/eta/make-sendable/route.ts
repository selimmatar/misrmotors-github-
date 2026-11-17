import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { makeSendable } from "@/lib/eta/make-sendable"

export const dynamic = "force-dynamic"

// POST { invoiceId }: an invoice that was NOT typed on the portal becomes sendable (accountant, CEO, admin: /api/eta rule).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const invoiceId = Number(body?.invoiceId)
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return NextResponse.json({ error: "Invalid invoice" }, { status: 400 })
    const r = await makeSendable(createAdminClient(), invoiceId, actorUserId(request))
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("E-invoice make-sendable failed:", error)
    return NextResponse.json({ error: "Could not make the invoice sendable." }, { status: 500 })
  }
}
