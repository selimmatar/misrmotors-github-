import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { signerFromRequest, signerPing } from "@/lib/eta/signer-auth"
import { followUpQuietly } from "@/lib/eta/send"

export const dynamic = "force-dynamic"

// POST { unlocked: boolean, version } (signer key in x-eta-signer-key; no login): the signer's heartbeat.
// `version` (the signer program's version) is accepted but not stored: there is no column for it and none is added.
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const signer = await signerFromRequest(db, request)
    if (!signer) return NextResponse.json({ error: "Unknown or disconnected signer", code: "SIGNER_KEY" }, { status: 401 })
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || typeof (body as any).unlocked !== "boolean") {
      return NextResponse.json({ error: "unlocked must be true or false" }, { status: 400 })
    }
    await signerPing(db, signer.signerId, (body as any).unlocked)
    await followUpQuietly(db)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error recording the signer heartbeat:", error)
    return NextResponse.json({ error: "Failed to record the heartbeat" }, { status: 500 })
  }
}
