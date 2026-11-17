import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { linkPortal, parsePair, unlinkPortal, type LinkResult } from "@/lib/eta/ap-portal"

export const dynamic = "force-dynamic"

// POST { receivedId, apInvoiceId, keep?: [{ receivedId, apInvoiceId }] }: a person links a portal invoice to an ERP
// supplier invoice (many-to-many). DELETE { receivedId, apInvoiceId }: removes a link; the pair is never suggested
// again. Both sides must be the same supplier (409 otherwise). Every change is written to workflow_events.
// Accountant, CEO, admin (the /api/eta rule).
const answer = (r: LinkResult) =>
  r.ok
    ? NextResponse.json({ ok: true, changed: r.changed })
    : NextResponse.json({ error: r.error, code: r.code, ...(r.errorAr ? { errorAr: r.errorAr } : {}) }, { status: r.status })

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const pair = parsePair(body)
    if (!pair) return NextResponse.json({ error: "Invalid invoices" }, { status: 400 })
    const rawKeep: unknown[] = Array.isArray(body?.keep) ? body.keep : []
    if (rawKeep.length > 50) return NextResponse.json({ error: "Too many links" }, { status: 400 })
    const keep = rawKeep.map(parsePair)
    if (keep.some((k) => k === null)) return NextResponse.json({ error: "Invalid invoices" }, { status: 400 })
    return answer(await linkPortal(createAdminClient(), pair, keep as NonNullable<(typeof keep)[number]>[], actorUserId(request)))
  } catch (error) {
    console.error("AP portal link failed:", error)
    return NextResponse.json({ error: "Could not save the link." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const pair = parsePair(await request.json().catch(() => null))
    if (!pair) return NextResponse.json({ error: "Invalid invoices" }, { status: 400 })
    return answer(await unlinkPortal(createAdminClient(), pair, actorUserId(request)))
  } catch (error) {
    console.error("AP portal unlink failed:", error)
    return NextResponse.json({ error: "Could not remove the link." }, { status: 500 })
  }
}
