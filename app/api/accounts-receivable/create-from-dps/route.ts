import { createAdminClient } from "@/lib/supabase/admin"
import { createDpInvoices } from "@/lib/invoicing"
import { NextResponse } from "next/server"

// Workflow B: invoice only the items on the selected APPROVED delivery permit(s). All rules (approved only,
// same DP never twice, cumulative quantity/value per sales order, no invoice once the whole order has been
// invoiced, concurrency re-check) live in lib/invoicing.ts.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { permit_ids } = body

    if (!permit_ids || !Array.isArray(permit_ids) || permit_ids.length === 0) {
      return NextResponse.json({ error: "At least one delivery permit ID is required" }, { status: 400 })
    }
    const permitIds = permit_ids.map((id: any) => Number(id))
    if (permitIds.some((id: number) => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: "Invalid delivery permit ID" }, { status: 400 })
    }

    const result = await createDpInvoices(createAdminClient(), [...new Set(permitIds)])
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: any) {
    console.error("Error creating invoice from DPs:", error)
    return NextResponse.json({ error: error.message || "Failed to create invoice" }, { status: 500 })
  }
}
