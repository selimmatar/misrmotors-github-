import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { parsePositiveId } from "@/lib/parse-id"
import { portalPrintout } from "@/lib/eta/after-send"

export const dynamic = "force-dynamic"

// GET: the portal's own printout (PDF) of one received supplier document (by received_id). One printout every 5 s.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const receivedId = parsePositiveId((await params).id)
    if (receivedId === null) return NextResponse.json({ error: "A valid id is required" }, { status: 400 })
    const result = await portalPrintout(createAdminClient(), { receivedId })
    if (!result.ok)
      return NextResponse.json({ error: result.message, code: result.code, ...(result.messageAr ? { errorAr: result.messageAr } : {}) }, { status: result.status || 409 })
    return new NextResponse(result.pdf, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.filename}"`, "Cache-Control": "private, no-store" },
    })
  } catch (error: any) {
    console.error("Error fetching a supplier e-invoice printout:", error)
    return NextResponse.json({ error: "Failed to fetch the portal printout" }, { status: 500 })
  }
}
