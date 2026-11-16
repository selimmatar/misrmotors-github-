import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { correctPermit } from "@/lib/eta/reissue"

export const dynamic = "force-dynamic"

// POST { permitId, lines: [{ permitItemId, quantity }] }: "Correct delivery permit" (spec §6.5a; accountant, CEO,
// admin). Only for a permit of an invoice open for correction; stock moves by the difference. Approved permits stay
// locked everywhere else (PUT /api/delivery-permits refuses DP_ALREADY_APPROVED as before).
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    const permitId = parsePositiveId(body && typeof body === "object" && (body as any).permitId != null ? String((body as any).permitId) : null)
    if (permitId === null) return NextResponse.json({ error: "permitId is required" }, { status: 400 })
    const raw = Array.isArray((body as any)?.lines) ? ((body as any).lines as any[]) : []
    const lines = raw.map((l) => ({ permitItemId: Number(l?.permitItemId), quantity: typeof l?.quantity === "number" ? l.quantity : Number.NaN }))
    const userId = await knownUserId(db, actorUserId(request))
    const result = await correctPermit(db, permitId, lines, userId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, errorAr: result.messageAr, code: result.code, ...("lines" in result && result.lines ? { lines: result.lines } : {}) },
        { status: result.status },
      )
    }
    return NextResponse.json({ success: true, correctionId: result.correctionId, lines: result.lines, stockMoves: result.stockMoves })
  } catch (error: any) {
    console.error("Error correcting the delivery permit:", error)
    return NextResponse.json({ error: "Failed to correct the delivery permit" }, { status: 500 })
  }
}
