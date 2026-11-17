import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { rangeError } from "@/lib/eta/receive"
import { loadApPortal } from "@/lib/eta/ap-portal"
import { parsePositiveId } from "@/lib/parse-id"

export const dynamic = "force-dynamic"

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&supplierId=]: Accounts Payable invoices and the supplier documents received on
// the selected portal in that period, linked (automatic matches overridden by the links people made) and grouped,
// with totals per side. Read-only. Accountant, CEO, admin (the /api/eta rule).
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams
    const from = q.get("from") || ""
    const to = q.get("to") || ""
    const bad = rangeError(from, to)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const rawSupplier = q.get("supplierId")
    const supplierId = rawSupplier ? parsePositiveId(rawSupplier) : null
    if (rawSupplier && supplierId === null) return NextResponse.json({ error: "Invalid supplier" }, { status: 400 })
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    return NextResponse.json(await loadApPortal(db, env, { from, to, supplierId }))
  } catch (error: any) {
    console.error("Error loading the AP / portal comparison:", error)
    return NextResponse.json({ error: "Could not load the portal comparison" }, { status: 500 })
  }
}
