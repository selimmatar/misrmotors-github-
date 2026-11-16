import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment, followUpQuietly, queueSend } from "@/lib/eta/send"

export const dynamic = "force-dynamic"

const MAX_PER_SEND = 100

// POST { invoiceIds: number[] }: "Send to portal" / "Send all ready" (accountant, CEO, admin - the /api/eta rule).
// Puts each ready invoice in the waiting-to-be-signed list of the portal chosen in E-invoice settings.
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => null)
    const raw = body && typeof body === "object" ? (body as any).invoiceIds : null
    if (!Array.isArray(raw) || raw.length === 0) return NextResponse.json({ error: "invoiceIds must be a list of invoice ids" }, { status: 400 })
    if (raw.length > MAX_PER_SEND) return NextResponse.json({ error: `At most ${MAX_PER_SEND} invoices at a time` }, { status: 400 })
    const ids = raw.map((v: unknown) => Number(v))
    if (ids.some((n: number) => !Number.isInteger(n) || n < 1)) return NextResponse.json({ error: "invoiceIds must be positive whole numbers" }, { status: 400 })

    const env = etaEnvironment(await readEtaSettings(db))
    const userId = await knownUserId(db, actorUserId(request))
    const result = await queueSend(db, ids, env, userId)
    await followUpQuietly(db)
    return NextResponse.json({ environment: env, ...result })
  } catch (error: any) {
    console.error("Error queueing e-invoices:", error)
    return NextResponse.json({ error: error.message || "Failed to send" }, { status: 500 })
  }
}
