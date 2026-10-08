import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordApPayment } from "@/lib/ap-payments"

export const dynamic = "force-dynamic"

// POST: record a supplier payment against an AP invoice.
// All rules (amount/method/receipt validation, overpayment guard, compare-and-swap on paid_amount, ledger rows,
// idempotency) live in lib/ap-payments.ts.
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const result = await recordApPayment(createAdminClient(), body)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error("Error recording AP payment:", error)
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 })
  }
}
