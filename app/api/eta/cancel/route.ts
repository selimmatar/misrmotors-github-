import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { parsePositiveId } from "@/lib/parse-id"
import { cancelOnPortal } from "@/lib/eta/after-send"

export const dynamic = "force-dynamic"

// POST { docId, reason }: "Cancel on portal" for a valid invoice or credit note (accountant, CEO, admin - the /api/eta
// rule). The portal's refusal (e.g. the cancel window has passed) comes back in plain words; nothing changes then.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const docId = parsePositiveId((body as any).docId == null ? null : String((body as any).docId))
    if (docId === null) return NextResponse.json({ error: "docId is required" }, { status: 400 })
    const reason = (body as any).reason
    if (reason != null && typeof reason !== "string") return NextResponse.json({ error: "reason must be text" }, { status: 400 })
    const result = await cancelOnPortal(createAdminClient(), docId, reason || "")
    if (!result.ok)
      return NextResponse.json({ error: result.message, code: result.code, ...(result.messageAr ? { errorAr: result.messageAr } : {}) }, { status: result.status || 409 })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error cancelling on the portal:", error)
    return NextResponse.json({ error: "Failed to cancel on the portal" }, { status: 500 })
  }
}
