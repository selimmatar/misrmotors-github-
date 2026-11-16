import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { parsePositiveId } from "@/lib/parse-id"
import { portalPrintout } from "@/lib/eta/after-send"

export const dynamic = "force-dynamic"

// GET ?docId=N (our valid / cancelled document) or ?receivedId=N (a received supplier document): the portal's own
// printout (PDF with its QR code). The portal allows one printout every 5 s; a request waits for its turn.
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams
    const docId = q.has("docId") ? parsePositiveId(q.get("docId")) : null
    const receivedId = q.has("receivedId") ? parsePositiveId(q.get("receivedId")) : null
    if ((docId === null) === (receivedId === null)) return NextResponse.json({ error: "docId or receivedId is required" }, { status: 400 })
    const result = await portalPrintout(createAdminClient(), docId !== null ? { docId } : { receivedId: receivedId! })
    if (!result.ok)
      return NextResponse.json({ error: result.message, code: result.code, ...(result.messageAr ? { errorAr: result.messageAr } : {}) }, { status: result.status || 409 })
    return new NextResponse(result.pdf, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.filename}"`, "Cache-Control": "private, no-store" },
    })
  } catch (error: any) {
    console.error("Error fetching the portal printout:", error)
    return NextResponse.json({ error: "Failed to fetch the portal printout" }, { status: 500 })
  }
}
