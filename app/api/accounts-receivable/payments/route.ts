import { createAdminClient } from "@/lib/supabase/admin"
import { recordArPayment } from "@/lib/ar-payments"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Authoritative AR payment endpoint. The operation itself (idempotency, guarded invoice update, customer_payments,
// balance_entries, schedule row) lives in lib/ar-payments.ts so the payment-schedules PUT writes the same rows.
export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const result = await recordArPayment(supabase, body)
  return NextResponse.json(result.body, { status: result.status })
}
