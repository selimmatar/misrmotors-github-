import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { salesOrderId, items, method } = body

    if (!salesOrderId || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: "Sales order ID and items are required" }, { status: 400 })
    }

    // Get costing method from company settings if not provided
    let costingMethod = method
    if (!costingMethod) {
      const { data: settings } = await supabase
        .from("company_settings")
        .select("setting_value")
        .eq("setting_key", "inventory_costing_method")
        .single()

      costingMethod = settings?.setting_value || "FIFO"
    }

    const allocations = []

    for (const item of items) {
      const { soItemId, productId, quantityNeeded } = item

      if (!soItemId || !productId || !quantityNeeded) {
        throw new Error(`Invalid item data: ${JSON.stringify(item)}`)
      }

      let remainingQty = quantityNeeded

      // Get available batches sorted by method (FIFO = oldest first, LIFO = newest first)
      const orderDirection = costingMethod === "FIFO" ? "asc" : "desc"
      const { data: batches, error: batchError } = await supabase
        .from("inventory_batches")
        .select("*")
        .eq("product_id", productId)
        .gt("quantity_available", 0)
        .order("received_date", { ascending: costingMethod === "FIFO" })
        .order("batch_sequence", { ascending: costingMethod === "FIFO" })

      if (batchError) throw batchError

      if (!batches || batches.length === 0) {
        throw new Error(`No inventory available for product ${productId}`)
      }

      // Allocate from batches
      for (const batch of batches) {
        if (remainingQty <= 0) break

        const qtyToAllocate = Math.min(remainingQty, batch.quantity_available)
        const costPerUnit = batch.landed_cost_per_unit || batch.unit_cost
        const totalCogs = qtyToAllocate * costPerUnit

        // Create allocation record
        const { data: allocation, error: allocError } = await supabase
          .from("inventory_allocations")
          .insert({
            sales_order_item_id: soItemId,
            so_id: salesOrderId,
            batch_id: batch.batch_id,
            product_id: productId,
            quantity_allocated: qtyToAllocate,
            cost_per_unit: costPerUnit,
            total_cogs: totalCogs,
            allocation_method: costingMethod,
          })
          .select()
          .single()

        if (allocError) throw allocError

        // Update batch available quantity
        const { error: updateError } = await supabase
          .from("inventory_batches")
          .update({
            quantity_available: batch.quantity_available - qtyToAllocate,
          })
          .eq("batch_id", batch.batch_id)

        if (updateError) throw updateError

        allocations.push(allocation)
        remainingQty -= qtyToAllocate
      }

      if (remainingQty > 0) {
        throw new Error(
          `Insufficient inventory for product ${productId}. Needed: ${quantityNeeded}, Available: ${quantityNeeded - remainingQty}`,
        )
      }
    }

    return NextResponse.json({ success: true, allocations })
  } catch (error: any) {
    console.error("[v0] Error allocating inventory:", error)
    return NextResponse.json({ error: error.message || "Failed to allocate inventory" }, { status: 500 })
  }
}
