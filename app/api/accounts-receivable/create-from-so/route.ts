import { createAdminClient } from "@/lib/supabase/admin"
import { createSoInvoice } from "@/lib/invoicing"
import { NextResponse } from "next/server"

// Workflow A: invoice the WHOLE sales order. All rules (no prior invoicing through delivery permits, no second
// whole-order invoice, concurrency re-check) live in lib/invoicing.ts.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const soId = Number(body?.so_id)

    if (!body?.so_id || !Number.isInteger(soId) || soId <= 0) {
      return NextResponse.json({ error: "Sales order ID is required" }, { status: 400 })
    }

    const result = await createSoInvoice(createAdminClient(), soId)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: any) {
    console.error("Error creating invoice from SO:", error)
    return NextResponse.json({ error: error.message || "Failed to create invoice" }, { status: 500 })
  }
}
