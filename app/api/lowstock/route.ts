import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data: inventory, error } = await supabase.from("inventory").select(`
        *,
        products (
          product_id,
          name,
          sku,
          unit,
          supplier_id,
          moq
        )
      `)

    if (error) {
      console.error("Low stock API error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const lowStockItems = (inventory || [])
      .filter((item: any) => {
        const reorderPoint = item.reorder_point || 10
        return item.quantity <= reorderPoint
      })
      .map((item: any) => ({
        inventoryId: item.inventory_id,
        productId: item.product_id,
        productName: item.products?.name || "Unknown",
        sku: item.products?.sku || "",
        unit: item.products?.unit || "piece",
        currentQuantity: item.quantity,
        reorderPoint: item.reorder_point || 10,
        shortfall: (item.reorder_point || 10) - item.quantity,
        suggestedOrderQuantity: Math.max(item.products?.moq || 10, ((item.reorder_point || 10) - item.quantity) * 3),
        supplierId: item.products?.supplier_id,
        moq: item.products?.moq || 10,
        location: item.location,
        lastUpdated: item.last_updated,
      }))

    return NextResponse.json({
      count: lowStockItems.length,
      items: lowStockItems,
    })
  } catch (error) {
    console.error("Low stock API error:", error)
    return NextResponse.json({ error: "Failed to fetch low stock items" }, { status: 500 })
  }
}
