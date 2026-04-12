import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { quotation_id } = body

    if (!quotation_id) {
      return NextResponse.json({ error: "Quotation ID is required" }, { status: 400 })
    }

    // Fetch the sales order (quotation)
    const { data: quotation, error: quotationError } = await supabase
      .from("sales_orders")
      .select("*")
      .eq("so_id", quotation_id)
      .single()

    if (quotationError || !quotation) {
      console.error("[v0] Fetch quotation error:", quotationError)
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }

    // Check if it's actually a draft (not already processed)
    if (quotation.status !== "draft") {
      console.error("[v0] Quotation already processed, current status:", quotation.status)
      return NextResponse.json({ 
        error: `This quotation has already been ${quotation.status === "cancelled" ? "rejected" : "approved"}. Current status: ${quotation.status}` 
      }, { status: 400 })
    }

    // Simply update the status from draft to pending_accountant to start the workflow
    const { data: updatedOrder, error: updateError } = await supabase
      .from("sales_orders")
      .update({
        status: "pending_accountant",
        updated_at: new Date().toISOString(),
      })
      .eq("so_id", quotation_id)
      .select()
      .single()

    if (updateError || !updatedOrder) {
      console.error("[v0] Update order status error:", updateError)
      return NextResponse.json({ error: "Failed to approve quotation" }, { status: 500 })
    }

    return NextResponse.json({
      sales_order: {
        so_id: updatedOrder.so_id,
        so_number: updatedOrder.so_number,
        total: updatedOrder.total,
      },
      message: `Quotation ${updatedOrder.so_number} approved and moved to pending accountant`,
    })
  } catch (error) {
    console.error("[v0] Approve quotation error:", error)
    return NextResponse.json({ error: "Failed to approve quotation" }, { status: 500 })
  }
}
