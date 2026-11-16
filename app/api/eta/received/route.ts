import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { rangeError } from "@/lib/eta/receive"
import { receivedList } from "@/lib/eta/received-list"

export const dynamic = "force-dynamic"

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD: the supplier e-invoices received on the selected portal in that period, each with
// its Accounts Payable match, the credit notes apart, the AP invoices not on the portal and per-supplier totals.
// Read-only. Accountant, CEO, admin (the /api/eta rule).
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams
    const from = q.get("from") || ""
    const to = q.get("to") || ""
    const bad = rangeError(from, to)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    return NextResponse.json(await receivedList(db, env, from, to))
  } catch (error: any) {
    console.error("Error listing supplier e-invoices:", error)
    return NextResponse.json({ error: "Could not list the supplier e-invoices" }, { status: 500 })
  }
}
