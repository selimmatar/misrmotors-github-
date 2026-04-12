import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  console.log("[v0] Complete transfer API called")
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { transferId } = body
    console.log("[v0] Transfer ID to complete:", transferId)

    if (!transferId) {
      return NextResponse.json({ error: "Transfer ID is required" }, { status: 400 })
    }

    // Fetch transfer with items
    const { data: transfer, error: transferError } = await supabase
      .from("warehouse_transfers")
      .select(`
        *,
        warehouse_transfer_items(*)
      `)
      .eq("transfer_id", transferId)
      .single()

    if (transferError || !transfer) {
      console.error("[v0] Transfer not found:", transferError)
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 })
    }

    console.log("[v0] Transfer fetched:", {
      id: transfer.transfer_id,
      status: transfer.status,
      itemsCount: transfer.warehouse_transfer_items?.length || 0,
      fromWarehouse: transfer.source_warehouse_id,
      toWarehouse: transfer.destination_warehouse_id
    })

    if (transfer.status !== "pending" && transfer.status !== "in_transit") {
      console.log("[v0] Cannot complete - invalid status:", transfer.status)
      return NextResponse.json(
        { error: `Cannot complete transfer with status: ${transfer.status}` },
        { status: 400 }
      )
    }

    // Process each item - deduct from source, add to destination
    for (const item of transfer.warehouse_transfer_items) {
      const transferQuantity = item.quantity_sent || item.quantity_requested || 0
      
      console.log("[v0] Processing transfer item:", {
        productId: item.product_id,
        quantity: transferQuantity,
        fromWarehouse: transfer.source_warehouse_id,
        toWarehouse: transfer.destination_warehouse_id
      })
      
      // Deduct from source warehouse
      const { error: deductError } = await supabase.rpc("decrement_inventory", {
        p_product_id: item.product_id,
        p_warehouse_id: transfer.source_warehouse_id,
        p_quantity: transferQuantity,
      })

      if (deductError) {
        console.log("[v0] RPC decrement failed, trying manual update:", deductError)
        // Try manual update
        const { data: sourceInv, error: selectError } = await supabase
          .from("inventory")
          .select("inventory_id, quantity")
          .eq("product_id", item.product_id)
          .eq("warehouse_id", transfer.source_warehouse_id)
          .single()

        if (selectError) {
          console.error("[v0] Error fetching source inventory:", selectError)
          return NextResponse.json({ error: `Cannot find source inventory: ${selectError.message}` }, { status: 404 })
        }

        if (sourceInv) {
          console.log("[v0] Deducting from source:", sourceInv.quantity, "-", transferQuantity)
          const { error: updateError } = await supabase
            .from("inventory")
            .update({ quantity: sourceInv.quantity - transferQuantity })
            .eq("inventory_id", sourceInv.inventory_id)
          
          if (updateError) {
            console.error("[v0] Error updating source inventory:", updateError)
            return NextResponse.json({ error: `Failed to deduct from source: ${updateError.message}` }, { status: 500 })
          }
          console.log("[v0] Successfully deducted from source")
        } else {
          console.log("[v0] No source inventory found for product:", item.product_id)
          return NextResponse.json({ error: `No inventory found for product ${item.product_id} in source warehouse` }, { status: 404 })
        }
      } else {
        console.log("[v0] Successfully decremented source inventory via RPC")
      }

      // Add to destination warehouse using increment RPC to handle concurrency
      console.log("[v0] Adding to destination warehouse:", transfer.destination_warehouse_id)
      
      // Use the increment RPC function which handles upsert logic
      const { data: destResult, error: destError } = await supabase.rpc("increment_inventory_quantity", {
        p_product_id: item.product_id,
        p_warehouse_id: transfer.destination_warehouse_id,
        p_quantity_change: transferQuantity,
        p_unit_cost: sourceInvForCost?.unit_cost || item.unit_cost || 0,
        p_reorder_point: sourceInvForCost?.reorder_point || 10,
      })

      if (destError) {
        console.error("[v0] Error adding to destination inventory:", destError)
        return NextResponse.json({ error: `Failed to add to destination: ${destError.message}` }, { status: 500 })
      }
      
      console.log("[v0] Successfully added", transferQuantity, "to destination warehouse, new quantity:", destResult)

      if (destInv) {
        console.log("[v0] Found existing destination inventory:", destInv.quantity, "adding:", transferQuantity)
        const newQty = (destInv.quantity || 0) + transferQuantity
        const { error: destUpdateError } = await supabase
          .from("inventory")
          .update({ quantity: newQty })
          .eq("inventory_id", destInv.inventory_id)
        
        if (destUpdateError) {
          console.error("[v0] Error updating destination inventory:", destUpdateError)
          return NextResponse.json({ error: `Failed to add to destination: ${destUpdateError.message}` }, { status: 500 })
        }
        console.log("[v0] Successfully updated destination inventory to:", newQty)
        destUpdated = true
      }
      
      if (!destUpdated) {
        console.log("[v0] No existing destination inventory - creating new record")
        // No existing record - get unit cost from source and insert new
        const { data: sourceInvForCost } = await supabase
          .from("inventory")
          .select("unit_cost, reorder_point")
          .eq("product_id", item.product_id)
          .eq("warehouse_id", transfer.source_warehouse_id)
          .maybeSingle()
        
        const { error: insertError } = await supabase.from("inventory").insert({
          product_id: item.product_id,
          warehouse_id: transfer.destination_warehouse_id,
          quantity: transferQuantity,
          reorder_point: sourceInvForCost?.reorder_point || 10,
          unit_cost: sourceInvForCost?.unit_cost || item.unit_cost || 0,
          location: "Transfer",
        })
        
        if (insertError) {
          // Duplicate key - record already exists
          if (insertError.code === "23505") {
            console.log("[v0] Duplicate key - inventory record already exists, updating instead")
            const { data: existingInv, error: fetchErr } = await supabase
              .from("inventory")
              .select("inventory_id, quantity")
              .eq("product_id", item.product_id)
              .eq("warehouse_id", transfer.destination_warehouse_id)
              .maybeSingle()
            
            if (fetchErr) {
              console.error("[v0] Error fetching existing inventory:", fetchErr)
              return NextResponse.json({ error: `Failed to fetch existing inventory: ${fetchErr.message}` }, { status: 500 })
            }
            
            if (existingInv) {
              const newQty = (existingInv.quantity || 0) + transferQuantity
              console.log("[v0] Updating existing inventory from", existingInv.quantity, "to", newQty)
              const { error: raceUpdateError } = await supabase
                .from("inventory")
                .update({ quantity: newQty })
                .eq("inventory_id", existingInv.inventory_id)
              
              if (raceUpdateError) {
                console.error("[v0] Error updating after duplicate key:", raceUpdateError)
                return NextResponse.json({ error: `Failed to update destination inventory: ${raceUpdateError.message}` }, { status: 500 })
              }
              console.log("[v0] Successfully handled duplicate key and updated destination to quantity:", newQty)
            } else {
              console.error("[v0] Duplicate key error but record not found - data inconsistency")
              return NextResponse.json({ error: "Inventory data inconsistency - record exists but cannot be fetched" }, { status: 500 })
            }
          } else {
            console.error("[v0] Error inserting destination inventory:", insertError)
            return NextResponse.json({ error: `Failed to create destination inventory: ${insertError.message}` }, { status: 500 })
          }
        } else {
          console.log("[v0] Successfully created new destination inventory record with quantity:", transferQuantity)
        }
      }

      // Log the transfer transaction for audit (non-blocking - table may not exist)
      try {
        await supabase.from("inventory_transactions").insert([
          {
            product_id: item.product_id,
            transaction_type: "TRANSFER_OUT",
            quantity_change: -transferQuantity,
            reference_type: "WAREHOUSE_TRANSFER",
            reference_number: transfer.transfer_number,
            reference_id: transfer.transfer_id,
            notes: `Transfer to warehouse ${transfer.destination_warehouse_id}`,
          },
          {
            product_id: item.product_id,
            transaction_type: "TRANSFER_IN",
            quantity_change: transferQuantity,
            reference_type: "WAREHOUSE_TRANSFER",
            reference_number: transfer.transfer_number,
            reference_id: transfer.transfer_id,
            notes: `Transfer from warehouse ${transfer.source_warehouse_id}`,
          },
        ])
      } catch {
        // Audit logging is best-effort - do not fail the transfer if this table doesn't exist
      }
    }

    // Update transfer status
    const { error: updateError } = await supabase
      .from("warehouse_transfers")
      .update({
        status: "completed",
        completion_date: new Date().toISOString().split('T')[0], // Date only
      })
      .eq("transfer_id", transferId)

    if (updateError) {
      console.error("[v0] Error updating transfer status:", updateError)
      return NextResponse.json({ error: "Failed to complete transfer" }, { status: 500 })
    }

    console.log("[v0] Transfer completed successfully:", transferId)

    return NextResponse.json({
      success: true,
      message: "Transfer completed successfully",
    })
  } catch (error) {
    console.error("[v0] Error completing transfer:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
