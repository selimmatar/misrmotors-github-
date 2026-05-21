import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { quotation_id, approval_document_url } = body

    if (!quotation_id) {
      return NextResponse.json({ error: "Quotation ID is required" }, { status: 400 })
    }

    // Fetch the quotation from sales_quotations table
    const { data: quotation, error: quotationError } = await supabase
      .from("sales_quotations")
      .select("*, items:sales_quotation_items(*)")
      .eq("id", quotation_id)
      .single()

    if (quotationError || !quotation) {
      console.error("[v0] Fetch quotation error:", quotationError)
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    }

    // Check if it's a draft (not already processed)
    if (quotation.status !== "draft" && quotation.status !== "pending") {
      console.error("[v0] Quotation already processed, current status:", quotation.status)
      return NextResponse.json({ 
        error: `This quotation has already been ${quotation.status === "rejected" ? "rejected" : "approved"}. Current status: ${quotation.status}` 
      }, { status: 400 })
    }

    // Generate SO number
    const { data: soNumberData, error: soNumberError } = await supabase.rpc("generate_so_number")
    
    if (soNumberError) {
      console.error("[v0] Generate SO number error:", soNumberError)
      return NextResponse.json({ error: "Failed to generate sales order number" }, { status: 500 })
    }

    const soNumber = soNumberData as string

    // Create a new sales order from the approved quotation
    const { data: salesOrder, error: soError } = await supabase
      .from("sales_orders")
      .insert({
        so_number: soNumber,
        customer_id: null, // Customer not linked yet, using name from quotation
        status: "pending_accountant",
        subtotal: quotation.subtotal,
        total: quotation.total,
        notes: quotation.notes,
        order_date: new Date().toISOString().split('T')[0],
        parent_quotation_id: quotation.id,
        approval_document_url: approval_document_url || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (soError || !salesOrder) {
      console.error("[v0] Create sales order error:", soError)
      return NextResponse.json({ error: "Failed to create sales order" }, { status: 500 })
    }

    // Create sales order items from quotation items
    if (quotation.items && quotation.items.length > 0) {
      const soItems = quotation.items.map((item: any) => ({
        so_id: salesOrder.so_id,
        product_id: item.product_id || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
        item_type: item.item_type === "outsourced" ? "outsourced" : "stock",
        outsourced_name: item.item_type === "outsourced" ? item.product_name : null,
        outsourced_description: item.supplier_name ? `Supplier: ${item.supplier_name}` : null,
      }))

      const { error: itemsError } = await supabase
        .from("sales_order_items")
        .insert(soItems)

      if (itemsError) {
        console.error("[v0] Create SO items error:", itemsError)
        // Don't fail the whole operation, just log it
      }
    }

    // Update the quotation status to approved
    const { error: updateError } = await supabase
      .from("sales_quotations")
      .update({
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", quotation_id)

    if (updateError) {
      console.error("[v0] Update quotation status error:", updateError)
    }

    return NextResponse.json({
      sales_order: {
        so_id: salesOrder.so_id,
        so_number: salesOrder.so_number,
        total: salesOrder.total,
      },
      message: `Quotation approved! Sales Order ${salesOrder.so_number} created with status "pending_accountant".`,
    })
  } catch (error) {
    console.error("[v0] Approve quotation error:", error)
    return NextResponse.json({ error: "Failed to approve quotation" }, { status: 500 })
  }
}
