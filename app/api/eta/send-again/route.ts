import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { parsePositiveId } from "@/lib/parse-id"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment, followUpQuietly, sendAgain } from "@/lib/eta/send"

export const dynamic = "force-dynamic"

// POST { invoiceId }: "Send again" after the portal marked the invoice (or its credit note) invalid. Creates the next
// version on the portal chosen in E-invoice settings; it waits for the signer.
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    const invoiceId = parsePositiveId(body && typeof body === "object" && (body as any).invoiceId != null ? String((body as any).invoiceId) : null)
    if (invoiceId === null) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    const env = etaEnvironment(await readEtaSettings(db))
    const userId = await knownUserId(db, actorUserId(request))
    const result = await sendAgain(db, invoiceId, env, userId)
    await followUpQuietly(db)
    if (!result.ok)
      return NextResponse.json({ error: result.message, code: result.code, ...(result.reasons ? { reasons: result.reasons } : {}) }, { status: result.code === "not_found" ? 404 : 409 })
    return NextResponse.json({ environment: env, documentType: result.documentType, docId: result.docId, version: result.version })
  } catch (error: any) {
    console.error("Error sending the e-invoice again:", error)
    return NextResponse.json({ error: "Failed to send again" }, { status: 500 })
  }
}
