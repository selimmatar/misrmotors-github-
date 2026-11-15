import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { signerFromRequest } from "@/lib/eta/signer-auth"
import { acceptSignatures, followUpQuietly, SIGNER_BATCH } from "@/lib/eta/send"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 2 * 1024 * 1024

// POST { items: [{ docId, signature }] } (signer key in x-eta-signer-key; no login): signatures back. Each is checked
// against the stored text before the batch goes to the portal.
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const signer = await signerFromRequest(db, request)
    if (!signer) return NextResponse.json({ error: "Unknown or disconnected signer", code: "SIGNER_KEY" }, { status: 401 })
    const raw = await request.text().catch(() => "")
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 })
    let body: any = null
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
    const items = body && typeof body === "object" ? body.items : null
    if (!Array.isArray(items)) return NextResponse.json({ error: "items must be a list" }, { status: 400 })
    if (items.length > SIGNER_BATCH) return NextResponse.json({ error: `At most ${SIGNER_BATCH} documents per delivery` }, { status: 400 })
    const result = await acceptSignatures(db, items)
    await followUpQuietly(db)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error("Error accepting signatures:", error)
    return NextResponse.json({ error: "Failed to accept the signatures" }, { status: 500 })
  }
}
