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
      const isOutsourced = item.is_outsourced || !item.product_id

      console.log("[v0] Processing transfer item:", {
        sourceInventoryId: item.source_inventory_id,
        productId: item.product_id,
        isOutsourced,
        quantity: transferQuantity,
        fromWarehouse: transfer.source_warehouse_id,
        toWarehouse: transfer.destination_warehouse_id,
      })

      // 1) Find the source inventory row. Prefer source_inventory_id; fall back to product+warehouse.
      let sourceInv: any = null
      if (item.source_inventory_id) {
        const { data } = await supabase
          .from("inventory")
          .select("inventory_id, quantity, unit_cost, reorder_point, is_outsourced, outsourced_name, outsourced_description, supplier_name")
          .eq("inventory_id", item.source_inventory_id)
          .maybeSingle()
        sourceInv = data
      }
      if (!sourceInv && item.product_id) {
        const { data } = await supabase
          .from("inventory")
          .select("inventory_id, quantity, unit_cost, reorder_point, is_outsourced, outsourced_name, outsourced_description, supplier_name")
          .eq("product_id", item.product_id)
          .eq("warehouse_id", transfer.source_warehouse_id)
          .maybeSingle()
        sourceInv = data
      }

      if (!sourceInv) {
        return NextResponse.json(
          { error: `Cannot find source inventory for ${item.product_name || "item"}` },
          { status: 404 }
        )
      }

      // 2) Deduct from source
      const { error: deductError } = await supabase
        .from("inventory")
        .update({ quantity: Math.max(0, (sourceInv.quantity || 0) - transferQuantity) })
        .eq("inventory_id", sourceInv.inventory_id)

      if (deductError) {
        console.error("[v0] Error deducting from source:", deductError)
        return NextResponse.json({ error: `Failed to deduct from source: ${deductError.message}` }, { status: 500 })
      }

      // 3) Find matching destination inventory row
      let destInv: any = null
      if (isOutsourced) {
        const { data } = await supabase
          .from("inventory")
          .select("inventory_id, quantity")
          .eq("warehouse_id", transfer.destination_warehouse_id)
          .eq("is_outsourced", true)
          .eq("outsourced_name", sourceInv.outsourced_name || item.outsourced_name || item.product_name || "Outsourced Item")
          .maybeSingle()
        destInv = data
      } else {
        const { data } = await supabase
          .from("inventory")
          .select("inventory_id, quantity")
          .eq("product_id", item.product_id)
          .eq("warehouse_id", transfer.destination_warehouse_id)
          .maybeSingle()
        destInv = data
      }

      // 4) Add to destination (update existing or insert new)
      if (destInv) {
        const newQty = (destInv.quantity || 0) + transferQuantity
        const { error: destUpdateError } = await supabase
          .from("inventory")
          .update({ quantity: newQty })
          .eq("inventory_id", destInv.inventory_id)

        if (destUpdateError) {
          console.error("[v0] Error updating destination inventory:", destUpdateError)
          return NextResponse.json({ error: `Failed to add to destination: ${destUpdateError.message}` }, { status: 500 })
        }
      } else {
        const insertPayload: any = {
          warehouse_id: transfer.destination_warehouse_id,
          quantity: transferQuantity,
          reorder_point: sourceInv.reorder_point ?? (isOutsourced ? 0 : 10),
          unit_cost: sourceInv.unit_cost || 0,
          location: "Transfer",
          is_outsourced: isOutsourced,
          supplier_name: sourceInv.supplier_name || null,
        }
        if (isOutsourced) {
          insertPayload.product_id = null
          insertPayload.outsourced_name = sourceInv.outsourced_name || item.outsourced_name || item.product_name || "Outsourced Item"
          insertPayload.outsourced_description = sourceInv.outsourced_description || "Transferred outsourced item"
        } else {
          insertPayload.product_id = item.product_id
        }

        const { error: insertError } = await supabase.from("inventory").insert(insertPayload)
        if (insertError) {
          console.error("[v0] Error inserting destination inventory:", insertError)
          return NextResponse.json({ error: `Failed to create destination inventory: ${insertError.message}` }, { status: 500 })
        }
      }

      // 5) Audit log (best-effort; skip for outsourced since product_id is null)
      if (item.product_id) {
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
          // best-effort
        }
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
