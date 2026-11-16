import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { knownUserId } from "@/lib/po-history"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { createPortal, credentialsSet, EtaBusyError, EtaCredentialsError, EtaError } from "@/lib/eta/portal"
import { plainError } from "@/lib/eta/portal-errors"
import { importCodesFromPortal } from "@/lib/eta/import-codes"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST: "Import codes from portal" (accountant, CEO, admin - the /api/eta rule). Reads the approved codes of the
// selected portal (read-only) and adds the new ones to eta_item_codes; existing codes only get their name updated.
// -> { imported, updated, unchanged, failed, pages }
export async function POST(request: Request) {
  try {
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    if (!credentialsSet(env)) return NextResponse.json({ error: new EtaCredentialsError(env).message }, { status: 400 })
    const userId = await knownUserId(db, actorUserId(request))
    const result = await importCodesFromPortal(db, createPortal(env), userId)
    return NextResponse.json({ environment: env, ...result })
  } catch (error: any) {
    if (error instanceof EtaBusyError) return NextResponse.json({ error: plainError("TooManyRequests", undefined, "en"), code: error.code }, { status: 429 })
    if (error instanceof EtaError) {
      const status = error.code === "Timeout" ? 504 : 502
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("Error importing item codes:", error)
    return NextResponse.json({ error: "Could not import the codes. Nothing was changed on the portal." }, { status: 500 })
  }
}
