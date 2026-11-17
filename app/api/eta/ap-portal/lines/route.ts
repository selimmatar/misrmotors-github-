import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { readEtaSettings } from "@/lib/eta/store"
import { etaEnvironment } from "@/lib/eta/send"
import { loadLineCompare, parseIds, parsePairRequest, saveLinePair, type Refusal } from "@/lib/eta/ap-line-compare"

export const dynamic = "force-dynamic"

// GET ?apInvoiceIds=1,2&receivedIds=3: item-by-item comparison of ERP supplier bills (their lines = what was received
// and billed) with the supplier's portal invoices (their lines from the portal details; read from the portal at its
// pace when not stored yet). POST { action: "pair" | "unpair", apInvoiceId, ourKey, portalKey }: the accountant pairs
// two lines (remembered for the supplier) or takes a pair apart (never paired automatically again); refused with
// "database update needed" until scripts/sql/2026-11-17-ap-line-pairs.sql is applied. Accounts Payable is never
// changed. Accountant, CEO, admin (the /api/eta rule).
const refusal = (r: Refusal) => NextResponse.json({ error: r.error, code: r.code, ...(r.errorAr ? { errorAr: r.errorAr } : {}) }, { status: r.status })

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams
    const apInvoiceIds = parseIds(q.get("apInvoiceIds"))
    const receivedIds = parseIds(q.get("receivedIds"))
    if (!apInvoiceIds || !receivedIds) return NextResponse.json({ error: "Invalid invoices" }, { status: 400 })
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    const r = await loadLineCompare(db, env, { apInvoiceIds, receivedIds })
    return r.ok ? NextResponse.json(r) : refusal(r)
  } catch (error) {
    console.error("Error loading the item comparison:", error)
    return NextResponse.json({ error: "Could not load the item comparison" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const req = parsePairRequest(await request.json().catch(() => null))
    if (!req) return NextResponse.json({ error: "Invalid lines" }, { status: 400 })
    const db = createAdminClient()
    const env = etaEnvironment(await readEtaSettings(db))
    const r = await saveLinePair(db, env, req, actorUserId(request))
    return r.ok ? NextResponse.json({ ok: true, changed: r.changed }) : refusal(r)
  } catch (error) {
    console.error("Saving the line pair failed:", error)
    return NextResponse.json({ error: "Could not save the line pair." }, { status: 500 })
  }
}
