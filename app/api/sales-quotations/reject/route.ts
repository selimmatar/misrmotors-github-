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

    // Fetch existing quotation from sales_quotations table
    const { data: existingQuotation, error: fetchError } = await supabase
      .from("sales_quotations")
      .select("*")
      .eq("id", quotation_id)
      .single()

    if (fetchError || !existingQuotation) {
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }

    // Check if already processed
    if (existingQuotation.status === "approved" || existingQuotation.status === "rejected") {
      return NextResponse.json({ error: "Quotation has already been processed" }, { status: 400 })
    }

    // Update quotation status to rejected
    const { data: updatedQuotation, error: updateError } = await supabase
      .from("sales_quotations")
      .update({
        status: "rejected",
        notes: `REJECTED: ${rejection_reason}${existingQuotation?.notes ? `\n\nOriginal notes: ${existingQuotation.notes}` : ""}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quotation_id)
      .select()
      .single()

    if (updateError) {
      console.error("Reject quotation error:", updateError)
      return NextResponse.json({ error: "Failed to reject quotation" }, { status: 500 })
    }

    return NextResponse.json({
      message: "Quotation rejected successfully",
      quotation: updatedQuotation,
    })
  } catch (error) {
    console.error("Reject quotation error:", error)
    return NextResponse.json({ error: "Failed to reject quotation" }, { status: 500 })
  }
}
