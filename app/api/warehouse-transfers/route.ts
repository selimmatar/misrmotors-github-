import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data: transfers, error } = await supabase
      .from("warehouse_transfers")
      .select(`
        *,
        from_warehouse:source_warehouse_id(warehouse_id, warehouse_name),
        to_warehouse:destination_warehouse_id(warehouse_id, warehouse_name),
        warehouse_transfer_items(
          *,
          products:product_id(product_id, product_name, sku)
        )
      `)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching transfers:", error)
      return NextResponse.json({ error: "Failed to fetch transfers" }, { status: 500 })
    }

    const formattedTransfers = transfers.map((transfer: any) => ({
      id: transfer.transfer_id,
      transferNumber: transfer.transfer_number,
      fromWarehouseId: transfer.source_warehouse_id,
      fromWarehouseName: transfer.from_warehouse?.warehouse_name || "Unknown",
      toWarehouseId: transfer.destination_warehouse_id,
      toWarehouseName: transfer.to_warehouse?.warehouse_name || "Unknown",
      status: transfer.status,
      notes: transfer.notes,
      createdAt: transfer.created_at,
      completedAt: transfer.completion_date,
      items: (transfer.warehouse_transfer_items || []).map((item: any) => ({
        id: item.item_id,
        productId: item.product_id,
        productName: item.products?.product_name || item.product_name || "Unknown",
        sku: item.products?.sku || item.sku || "",
        quantity: item.quantity_requested || item.quantity_sent || 0,
      })),
    }))

    return NextResponse.json(formattedTransfers)
  } catch (error) {
    console.error("[v0] Error in warehouse transfers GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { fromWarehouseId, toWarehouseId, items, notes } = body

    if (!fromWarehouseId || !toWarehouseId || !items?.length) {
      return NextResponse.json(
        { error: "From warehouse, to warehouse, and items are required" },
        { status: 400 }
      )
    }

    if (fromWarehouseId === toWarehouseId) {
      return NextResponse.json(
        { error: "Cannot transfer to the same warehouse" },
        { status: 400 }
      )
    }

    // Validate inventory availability in source warehouse
    for (const item of items) {
      const { data: inventory, error: invError } = await supabase
        .from("inventory")
        .select("quantity")
        .eq("product_id", item.productId)
        .eq("warehouse_id", fromWarehouseId)
        .single()

      if (invError || !inventory) {
        return NextResponse.json(
          { error: `Product ${item.productName} not found in source warehouse` },
          { status: 400 }
        )
      }

      if (inventory.quantity < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient quantity for ${item.productName}. Available: ${inventory.quantity}` },
          { status: 400 }
        )
      }
    }

    // Create transfer record
    const { data: transfer, error: transferError } = await supabase
      .from("warehouse_transfers")
      .insert({
        source_warehouse_id: fromWarehouseId,
        destination_warehouse_id: toWarehouseId,
        status: "pending",
        notes: notes || "",
      })
      .select()
      .single()

    if (transferError || !transfer) {
      console.error("[v0] Error creating transfer:", transferError)
      return NextResponse.json({ error: "Failed to create transfer" }, { status: 500 })
    }

    // Create transfer items
    const transferItems = items.map((item: any) => ({
      transfer_id: transfer.transfer_id,
      product_id: item.productId,
      product_name: item.productName,
      sku: item.sku,
      quantity_requested: item.quantity,
      quantity_sent: item.quantity,
      quantity_received: 0,
    }))

    const { error: itemsError } = await supabase
      .from("warehouse_transfer_items")
      .insert(transferItems)

    if (itemsError) {
      console.error("[v0] Error creating transfer items:", itemsError)
      // Rollback transfer
      await supabase.from("warehouse_transfers").delete().eq("transfer_id", transfer.transfer_id)
      return NextResponse.json({ error: "Failed to create transfer items" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      transfer: {
        id: transfer.transfer_id,
        transferNumber: transfer.transfer_number,
      },
    })
  } catch (error) {
    console.error("[v0] Error in warehouse transfers POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
