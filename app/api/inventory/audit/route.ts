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
        warehouse_id,
        is_outsourced,
        outsourced_name
      `)
      .order("product_id")

    if (error) {
      console.error("Error fetching inventory for audit:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Fetch products to get names and SKUs
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("product_id, product_name, sku")

    if (productsError) {
      console.error("Error fetching products:", productsError)
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    // Merge inventory with product details
    const inventoryWithProducts =
      inventory?.map((item) => {
        const isOutsourced = item.is_outsourced || !item.product_id
        const product = products?.find((p) => p.product_id === item.product_id)
        return {
          ...item,
          productName: isOutsourced
            ? item.outsourced_name || "Outsourced Item"
            : product?.product_name || "Unknown",
          sku: isOutsourced ? "OUTSOURCED" : product?.sku || "N/A",
          isOutsourced,
        }
      }) || []

    return NextResponse.json(inventoryWithProducts)
  } catch (error) {
    console.error("Error in inventory audit GET:", error)
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


    const auditDate = new Date().toISOString()
    const auditRecords = []
    const inventoryUpdates = []

    for (const adjustment of adjustments) {
      const { productId, systemQuantity, physicalCount, notes, warehouseId, inventoryId } = adjustment

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
          inventoryId: inventoryId || null,
          warehouseId: warehouseId || null,
          newQuantity: physicalCount,
        })
      }
    }

    // A count belongs to one inventory row (one product in one warehouse). Check every update before writing anything:
    // an inventoryId must be that product's row, and a product-only count is only safe when the product has one row.
    for (const update of inventoryUpdates) {
      if (update.inventoryId) {
        const { data: rows, error } = await supabase
          .from("inventory")
          .select("inventory_id, product_id")
          .eq("inventory_id", update.inventoryId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (!rows || rows.length === 0 || rows[0].product_id !== update.productId) {
          return NextResponse.json(
            { error: `Inventory row ${update.inventoryId} does not belong to product ${update.productId}. Nothing was saved.` },
            { status: 400 },
          )
        }
      } else if (!update.warehouseId) {
        const { data: rows, error } = await supabase.from("inventory").select("inventory_id").eq("product_id", update.productId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if ((rows || []).length > 1) {
          return NextResponse.json(
            { error: `Product ${update.productId} is stocked in more than one warehouse: choose the warehouse for this count. Nothing was saved.` },
            { status: 400 },
          )
        }
      }
    }

    // Insert audit records
    if (auditRecords.length > 0) {
      const { error: auditError } = await supabase.from("inventory_audits").insert(auditRecords)

      if (auditError) {
        console.error("Inventory Audit: Error inserting audit records:", auditError)
        return NextResponse.json({ error: auditError.message }, { status: 500 })
      }

    }

    let updatedCount = 0
    for (const update of inventoryUpdates) {
      let query = supabase
        .from("inventory")
        .update({
          quantity: update.newQuantity,
          last_updated: auditDate,
        })

      // inventoryId was checked above to be this product's row.
      if (update.inventoryId) {
        query = query.eq("inventory_id", update.inventoryId)
      } else {
        query = query.eq("product_id", update.productId)
        if (update.warehouseId) {
          query = query.eq("warehouse_id", update.warehouseId)
        }
      }

      const { error: updateError } = await query

      if (updateError) {
        console.error("Inventory Audit: Error updating inventory for product", update.productId, ":", updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      updatedCount++
    }

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
    console.error("Inventory Audit: Error in POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
