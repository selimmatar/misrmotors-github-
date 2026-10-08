import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = getAdminClient()

    const { data: payments, error } = await supabase
      .from("supplier_payments")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Supplier Payments GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }


    return NextResponse.json(payments || [])
  } catch (error) {
    console.error("Supplier Payments GET exception:", error)
    return NextResponse.json({ error: "Failed to fetch supplier payments" }, { status: 500 })
  }
}

// Retired (Batch 4F): this wrote a non-existent column and bypassed the invoice update and the ledger. Supplier
// payments are recorded only by POST /api/accounts-payable/payments. GET above is still used by the UI.
export async function POST() {
  return NextResponse.json({ error: "Use POST /api/accounts-payable/payments", code: "ENDPOINT_RETIRED" }, { status: 410 })
}
