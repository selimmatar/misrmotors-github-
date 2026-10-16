import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"

export const dynamic = "force-dynamic"

export async function GET() {
  try {

    const result = await withRetry(async () => {
      const supabase = getAdminClient()
      const { data, error } = await (supabase as any)
        .from("balance_entries")
        .select("*")
        .order("created_at", { ascending: false })
      if (error) throw error
      return data || []
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Balance API - Error fetching balance entries:", error)
    return NextResponse.json({ error: "Failed to fetch balance entries" }, { status: 500 })
  }
}

// RETIRED (BIZ-P-14). Ledger rows are written only by the operations that move money (AR / AP payments, invoicing);
// no screen posts manual entries.
export async function POST() {
  return NextResponse.json(
    { error: "Balance entries are written by the payment and invoice operations only", code: "ENDPOINT_RETIRED" },
    { status: 410 },
  )
}

// Hardening: this handler used to delete EVERY balance entry on an unauthenticated, id-less DELETE. No UI caller
// uses it, and a ledger row must not be deletable through it (voiding is the supported way), so it now refuses.
export async function DELETE() {
  return NextResponse.json(
    { error: "Deleting balance entries is not allowed. Void the entry instead." },
    { status: 400 },
  )
}
