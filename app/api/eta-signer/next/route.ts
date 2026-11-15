import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { signerFromRequest } from "@/lib/eta/signer-auth"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment, followUpQuietly, nextForSigner } from "@/lib/eta/send"

export const dynamic = "force-dynamic"

// GET (signer key in x-eta-signer-key; no login): the documents waiting to be signed on the selected portal.
// -> { environment, rin, documents: [{ docId, canonical }] }
export async function GET(request: Request) {
  try {
    const db = createAdminClient()
    const signer = await signerFromRequest(db, request)
    if (!signer) return NextResponse.json({ error: "Unknown or disconnected signer", code: "SIGNER_KEY" }, { status: 401 })
    const settings = await readEtaSettings(db)
    const documents = await nextForSigner(db, signer.signerId)
    await followUpQuietly(db)
    return NextResponse.json(
      { environment: etaEnvironment(settings), rin: String(settings.eta_rin || ""), documents },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error: any) {
    console.error("Error handing out documents to the signer:", error)
    return NextResponse.json({ error: "Failed to load the documents" }, { status: 500 })
  }
}
