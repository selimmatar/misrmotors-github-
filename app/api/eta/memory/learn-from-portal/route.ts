import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { credentialsSet, EtaBusyError, EtaCredentialsError, EtaError } from "@/lib/eta/portal"
import { plainError } from "@/lib/eta/portal-errors"
import { learnFromPortalWindow, windowError } from "@/lib/eta/learn"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST { from, to } (YYYY-MM-DD, at most 31 days): reads the sent invoices of that window from the portal (read-only)
// and fills the code memory as 'imported'. Accountant, CEO, admin (the /api/eta rule).
// -> { invoices, lines, learned, alreadyKnown, conflicts, unknownCodes }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const bad = !body || typeof body !== "object" ? "Invalid body" : windowError(body.from, body.to)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    if (!credentialsSet(env)) return NextResponse.json({ error: new EtaCredentialsError(env).message }, { status: 400 })
    const userId = await knownUserId(db, actorUserId(request))
    return NextResponse.json({ environment: env, ...(await learnFromPortalWindow(db, env, { from: body.from, to: body.to }, { userId })) })
  } catch (error: any) {
    if (error instanceof EtaBusyError) return NextResponse.json({ error: plainError("TooManyRequests", undefined, "en"), code: error.code }, { status: 429 })
    if (error instanceof EtaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "Timeout" ? 504 : 502 })
    console.error("Error learning codes from the portal:", error)
    return NextResponse.json({ error: "Could not read the portal invoices. Nothing was changed on the portal." }, { status: 500 })
  }
}
