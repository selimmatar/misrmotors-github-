import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { quotation_id, rejection_reason } = body

    if (!quotation_id || !rejection_reason) {
      return NextResponse.json({ error: "Quotation ID and rejection reason are required" }, { status: 400 })
    }

    // Fetch existing quotation (draft sales order)
    const { data: existingQuotation } = await supabase
      .from("sales_orders")
      .select("notes")
      .eq("so_id", quotation_id)
      .eq("status", "draft")
      .single()

    if (!existingQuotation) {
      return NextResponse.json({ error: "Quotation not found or already processed" }, { status: 404 })
    }

    // Update quotation status to cancelled (rejected)
    const { data: updatedQuotation, error: updateError } = await supabase
      .from("sales_orders")
      .update({
        status: "cancelled",
        notes: `REJECTED: ${rejection_reason}${existingQuotation?.notes ? `\n\nOriginal notes: ${existingQuotation.notes}` : ""}`,
        updated_at: new Date().toISOString(),
      })
      .eq("so_id", quotation_id)
      .select()
      .single()

    if (updateError) {
      console.error("[v0] Reject quotation error:", updateError)
      return NextResponse.json({ error: "Failed to reject quotation" }, { status: 500 })
    }

    return NextResponse.json({
      message: "Quotation rejected successfully",
      quotation: updatedQuotation,
    })
  } catch (error) {
    console.error("[v0] Reject quotation error:", error)
    return NextResponse.json({ error: "Failed to reject quotation" }, { status: 500 })
  }
}
