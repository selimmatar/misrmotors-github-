import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { credentialsSet, EtaBusyError, EtaCredentialsError, EtaError } from "@/lib/eta/portal"
import { plainError } from "@/lib/eta/portal-errors"
import { rangeError, receiveSupplierDocuments } from "@/lib/eta/receive"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST { from, to, cursor? } ("Check now"): reads the supplier documents received in that period from the portal in
// 30-day windows and stores new ones / status changes. A call stops after ~40 s and returns { cursor }; the screen
// calls again with it until it is null. Nothing in Accounts Payable changes. Accountant, CEO, admin (the /api/eta rule).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const bad = !body || typeof body !== "object" ? "Invalid body" : rangeError(body.from, body.to)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    if (!credentialsSet(env)) return NextResponse.json({ error: new EtaCredentialsError(env).message }, { status: 400 })
    const result = await receiveSupplierDocuments(db, env, { from: body.from, to: body.to, cursor: body.cursor ?? null })
    return NextResponse.json({ environment: env, ...result })
  } catch (error: any) {
    if (error instanceof EtaBusyError) return NextResponse.json({ error: plainError("TooManyRequests", undefined, "en"), code: error.code }, { status: 429 })
    if (error instanceof EtaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "Timeout" ? 504 : 502 })
    console.error("Error receiving supplier e-invoices:", error)
    return NextResponse.json({ error: "Could not read the supplier e-invoices. Nothing was changed." }, { status: 500 })
  }
}
