import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { startReissue } from "@/lib/eta/reissue"

export const dynamic = "force-dynamic"

// POST { invoiceId }: "Correct and reissue" (spec §6.5a; accountant, CEO, admin - the /api/eta rule). Only when the
// invoice's real portal document is reversed (a valid credit note, or a cancellation the portal confirms). The invoice
// becomes Replaced and its sales order and delivery permits open for correction; the new invoice is then created the
// normal way from the corrected permits, which moves the payments to it.
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    const invoiceId = parsePositiveId(body && typeof body === "object" && (body as any).invoiceId != null ? String((body as any).invoiceId) : null)
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    const userId = await knownUserId(db, actorUserId(request))
    const result = await startReissue(db, invoiceId, userId)
    if (!result.ok) return NextResponse.json({ error: result.message, errorAr: result.messageAr, code: result.code }, { status: result.status })
    return NextResponse.json({ success: true, invoiceId, status: "replaced" })
  } catch (error: any) {
    console.error("Error starting correct and reissue:", error)
    return NextResponse.json({ error: "Failed to start correct and reissue" }, { status: 500 })
  }
}
