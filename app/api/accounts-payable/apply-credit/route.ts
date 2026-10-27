import { createAdminClient } from "@/lib/supabase/admin"
import { applySupplierCredits } from "@/lib/supplier-credit-ap-apply"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Uses open supplier credits on an AP invoice. The operation (idempotency, guarded credit and invoice updates, the
// supplier_payments row, rollback) lives in lib/supplier-credit-ap-apply.ts.
export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const result = await applySupplierCredits(supabase, body)
  return NextResponse.json(result.body, { status: result.status })
}
