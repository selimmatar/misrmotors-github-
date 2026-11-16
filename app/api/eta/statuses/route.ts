import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { allRows, readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { invoiceBadge } from "@/lib/eta/badge"
import { credentialsSet } from "@/lib/eta/portal"
import { cairoToday } from "@/lib/eta/go-live"

export const dynamic = "force-dynamic"

// GET: the e-invoice state of every invoice that has a document on the selected portal ({ environment, statuses:
// { [invoiceId]: badge } }); an invoice not listed was never sent there. Also what the settings screen shows: whether
// each portal has its login set, how many documents wait to be signed and how many were sent today (Cairo day).
// Read-only (accountant, CEO, admin).
export async function GET() {
  try {
    const db = createAdminClient()
    const environment = etaEnvironment(await readEtaSettings(db))
    // every row, in pages with a stable order (one read is capped at 1000 rows)
    const data = await allRows(db, "eta_documents", "doc_id, invoice_id, document_type, environment, status, errors, submitted_at", [{ column: "doc_id" }])
    const today = cairoToday()
    let waiting = 0
    let sentToday = 0
    const byInvoice = new Map<number, any[]>()
    for (const row of data) {
      if ((row.environment || "real") !== environment) continue
      if (row.status === "pending_signature") waiting++
      if (row.submitted_at && cairoToday(new Date(row.submitted_at)) === today) sentToday++
      byInvoice.set(row.invoice_id, [...(byInvoice.get(row.invoice_id) || []), row])
    }
    const statuses: Record<string, string> = {}
    for (const [id, rows] of byInvoice) statuses[String(id)] = invoiceBadge(rows)
    return NextResponse.json({ environment, statuses, waiting, sentToday, credentials: { test: credentialsSet("test"), real: credentialsSet("real") } })
  } catch (error: any) {
    console.error("Error reading e-invoice states:", error)
    return NextResponse.json({ error: "Failed to read e-invoice states" }, { status: 500 })
  }
}
