import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Fetch inventory with product details
    const { data: inventory, error } = await supabase
      .from("inventory")
      .select(`
        *,
        products:product_id (
          product_id,
          product_name,
          sku,
          unit,
          supplier_id,
          moq,
          desired_excess
        )
      `)
      .order("quantity", { ascending: true })

    if (error) {
      console.error("[v0] Low stock API error:", error)
      throw error
    }

    // Filter items where quantity <= reorder_point
    const lowStockItems = (inventory || []).filter((item: any) => item.quantity <= item.reorder_point)

    // Transform for easier n8n usage
    const result = lowStockItems.map((item: any) => ({
      inventoryId: item.inventory_id,
      productId: item.product_id,
      productName: item.products?.product_name || "Unknown",
      sku: item.products?.sku || "",
      unit: item.products?.unit || "unit",
      currentQuantity: item.quantity,
      reorderPoint: item.reorder_point,
      shortfall: item.reorder_point - item.quantity,
      suggestedOrderQuantity: Math.max(
        item.products?.moq || 10,
        item.reorder_point - item.quantity + (item.products?.desired_excess || 20),
      ),
      supplierId: item.products?.supplier_id || null,
      moq: item.products?.moq || 1,
      location: item.location,
      lastUpdated: item.last_updated,
    }))

    return NextResponse.json({
      count: result.length,
      items: result,
    })
  } catch (error) {
    console.error("[v0] Error fetching low stock items:", error)
    return NextResponse.json({ error: "Failed to fetch low stock items" }, { status: 500 })
  }
}
