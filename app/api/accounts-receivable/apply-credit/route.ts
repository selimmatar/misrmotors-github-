import { createAdminClient } from "@/lib/supabase/admin"
import { applyCustomerCredits } from "@/lib/customer-credit-apply"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Uses open customer credits on an AR invoice. The operation (idempotency, guarded credit and invoice updates, the
// customer_payments row, rollback) lives in lib/customer-credit-apply.ts.
export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const result = await applyCustomerCredits(supabase, body)
  return NextResponse.json(result.body, { status: result.status })
}
