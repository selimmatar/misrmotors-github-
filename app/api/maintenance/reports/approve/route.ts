import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    const { report_id, work_order_id, approved, rejection_reason } = body
    

    if (approved) {
      // Fetch the report to get materials/parts_used
      const { data: report, error: reportError } = await adminClient
        .from("maintenance_reports")
        .select("*")
        .eq("report_id", report_id)
        .single()

      if (reportError || !report) {
        console.error("Report not found:", reportError)
        return NextResponse.json({ error: "Report not found" }, { status: 404 })
      }

      // Deduct inventory items used in maintenance
      const materials = report.parts_used || []
      const inventoryItems = materials.filter((m: any) => m.type === "inventory" && m.productId)
      
      
      for (const item of inventoryItems) {
        const { productId, quantity } = item
        
        // Get current inventory for this product
        const { data: invRecords, error: invError } = await adminClient
          .from("inventory")
          .select("inventory_id, quantity, product_id")
          .eq("product_id", productId)
        
        if (invError || !invRecords || invRecords.length === 0) {
          console.error("Inventory not found for product:", productId)
          continue
        }

        // Deduct from the first matching inventory record
        const inv = invRecords[0]
        const newQty = Math.max(0, inv.quantity - quantity)
        
        const { error: updateError } = await adminClient
          .from("inventory")
          .update({ 
            quantity: newQty,
            last_updated: new Date().toISOString()
          })
          .eq("inventory_id", inv.inventory_id)
        
        if (updateError) {
          console.error("Failed to deduct inventory:", updateError)
          continue
        }


        // Log the inventory transaction
        await adminClient
          .from("inventory_transactions")
          .insert({
            product_id: productId,
            transaction_type: "maintenance_deduction",
            quantity_change: -quantity,
            quantity_before: inv.quantity,
            quantity_after: newQty,
            reference_type: "maintenance_work_order",
            reference_id: work_order_id,
            reference_number: `WO-${work_order_id}`,
            notes: `Maintenance deduction - Report #${report_id} - ${item.productName || 'Unknown'}`,
            created_at: new Date().toISOString(),
          })
      }

      // Mark report as approved
      await adminClient
        .from("maintenance_reports")
        .update({
          approved_by: "sales",
          approved_at: new Date().toISOString(),
        })
        .eq("report_id", report_id)

      // Update work order status to completed (approved)
      const { error: woError } = await adminClient
        .from("maintenance_work_orders")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("work_order_id", work_order_id)

      if (woError) {
        console.error("Error updating work order:", woError)
        return NextResponse.json({ error: "Failed to update work order" }, { status: 500 })
      }

      
      return NextResponse.json({ 
        success: true, 
        message: "Report approved and inventory updated",
        workflow_stage: "approved",
        items_deducted: inventoryItems.length
      })
    } else {
      // Reject: change work order back to in_progress
      const { error: woError } = await adminClient
        .from("maintenance_work_orders")
        .update({
          status: "in_progress",
          notes: rejection_reason ? `REJECTED: ${rejection_reason}` : "Report rejected by sales",
          updated_at: new Date().toISOString(),
        })
        .eq("work_order_id", work_order_id)

      if (woError) {
        console.error("Error updating work order:", woError)
        return NextResponse.json({ error: "Failed to update work order" }, { status: 500 })
      }

      
      return NextResponse.json({ 
        success: true, 
        message: "Report rejected and sent back to shipping",
        workflow_stage: "assigned"
      })
    }
  } catch (error) {
    console.error("Error in approval process:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
