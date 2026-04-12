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
        inventory_id,
        product_id,
        quantity,
        reorder_point,
        unit_cost,
        location,
        warehouse_id
      `)
      .order("product_id")

    if (error) {
      console.error("[v0] Error fetching inventory for audit:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Fetch products to get names and SKUs
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("product_id, product_name, sku")

    if (productsError) {
      console.error("[v0] Error fetching products:", productsError)
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    // Merge inventory with product details
    const inventoryWithProducts =
      inventory?.map((item) => {
        const product = products?.find((p) => p.product_id === item.product_id)
        return {
          ...item,
          productName: product?.product_name || "Unknown",
          sku: product?.sku || "N/A",
        }
      }) || []

    return NextResponse.json(inventoryWithProducts)
  } catch (error) {
    console.error("[v0] Error in inventory audit GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { adjustments, auditedBy } = body

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      return NextResponse.json({ error: "No adjustments provided" }, { status: 400 })
    }

    console.log("[v0] Inventory Audit: Starting audit with", adjustments.length, "items")

    const auditDate = new Date().toISOString()
    const auditRecords = []
    const inventoryUpdates = []

    for (const adjustment of adjustments) {
      const { productId, systemQuantity, physicalCount, notes, warehouseId } = adjustment

      if (physicalCount === null || physicalCount === undefined) {
        continue
      }

      const difference = physicalCount - systemQuantity

      auditRecords.push({
        product_id: productId,
        system_quantity: systemQuantity,
        physical_count: physicalCount,
        difference: difference,
        notes: notes || null,
        audited_by: auditedBy || null,
        audit_date: auditDate,
      })

      if (difference !== 0) {
        inventoryUpdates.push({
          productId,
          warehouseId: warehouseId || null,
          newQuantity: physicalCount,
        })
      }
    }

    // Insert audit records
    if (auditRecords.length > 0) {
      const { error: auditError } = await supabase.from("inventory_audits").insert(auditRecords)

      if (auditError) {
        console.error("[v0] Inventory Audit: Error inserting audit records:", auditError)
        return NextResponse.json({ error: auditError.message }, { status: 500 })
      }

      console.log("[v0] Inventory Audit: Inserted", auditRecords.length, "audit records")
    }

    let updatedCount = 0
    for (const update of inventoryUpdates) {
      let query = supabase
        .from("inventory")
        .update({
          quantity: update.newQuantity,
          last_updated: auditDate,
        })
        .eq("product_id", update.productId)

      if (update.warehouseId) {
        query = query.eq("warehouse_id", update.warehouseId)
      }

      const { error: updateError } = await query

      if (updateError) {
        console.error("[v0] Inventory Audit: Error updating inventory for product", update.productId, ":", updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      updatedCount++
    }

    console.log(
      "[v0] Inventory Audit: Completed. Items audited:",
      auditRecords.length,
      "Inventory updated:",
      updatedCount,
    )

    return NextResponse.json({
      success: true,
      message: `${auditRecords.length} audit records saved, ${updatedCount} inventory items updated`,
      summary: {
        totalAudited: auditRecords.length,
        adjustmentsMade: updatedCount,
        noChangeItems: auditRecords.length - inventoryUpdates.length,
      },
    })
  } catch (error) {
    console.error("[v0] Inventory Audit: Error in POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
