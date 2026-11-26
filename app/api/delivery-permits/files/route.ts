import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { cancelSignedFile } from "@/lib/dp-signed-choice"

export const dynamic = "force-dynamic"

// POST { permitId, fileId }: the approver (accountant, CEO, admin) cancels one sent signed photo while reviewing the
// permit. The photo is kept, not deleted; it is no longer shown or e-mailed (lib/dp-signed-choice.ts).
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = (await request.json().catch(() => null)) as any
    const permitId = parsePositiveId(body?.permitId != null ? String(body.permitId) : null)
    const fileId = parsePositiveId(body?.fileId != null ? String(body.fileId) : null)
    if (permitId === null || fileId === null) return NextResponse.json({ error: "permitId and fileId are required" }, { status: 400 })
    const userId = await knownUserId(db, actorUserId(request))
    const result = await cancelSignedFile(db, permitId, fileId, userId)
    if (!result.ok) return NextResponse.json({ error: result.error, errorAr: result.errorAr }, { status: result.status })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error cancelling the signed photo:", error)
    return NextResponse.json({ error: "Failed to cancel the photo" }, { status: 500 })
  }
}
