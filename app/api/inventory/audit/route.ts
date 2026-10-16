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

// Saves a stock count (BIZ-P-01). Each counted row is written with a guard on the system quantity the screen loaded
// (UPDATE ... WHERE quantity = <loaded>), so stock that moved during the count (a delivery, a receipt, a transfer) is
// never overwritten. Rows that changed are not saved: the answer is 409 STOCK_CHANGED listing them (product,
// warehouse, quantity loaded, quantity now) while every other row is saved. An audit record is written only for the
// rows that were saved or confirmed unchanged.
export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { adjustments, auditedBy } = body

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      return NextResponse.json({ error: "No adjustments provided" }, { status: 400 })
    }

    const auditDate = new Date().toISOString()
    type Counted = {
      productId: any
      inventoryId: any
      warehouseId: any
      systemQuantity: number
      physicalCount: number
      notes: string | null
    }
    const counted: Counted[] = []

    for (const adjustment of adjustments) {
      const { productId, systemQuantity, physicalCount, notes, warehouseId, inventoryId } = adjustment

      if (physicalCount === null || physicalCount === undefined) {
        continue
      }
      const loaded = Number(systemQuantity)
      const count = Number(physicalCount)
      if (systemQuantity === null || systemQuantity === undefined || systemQuantity === "" || !Number.isFinite(loaded)) {
        return NextResponse.json(
          { error: `The system quantity the count started from is missing for product ${productId}. Reload and count again. Nothing was saved.` },
          { status: 400 },
        )
      }
      if (physicalCount === "" || !Number.isFinite(count) || count < 0) {
        return NextResponse.json({ error: `The counted quantity for product ${productId} is not valid. Nothing was saved.` }, { status: 400 })
      }
      counted.push({
        productId,
        inventoryId: inventoryId || null,
        warehouseId: warehouseId || null,
        systemQuantity: loaded,
        physicalCount: count,
        notes: notes || null,
      })
    }
    const inventoryUpdates = counted.filter((c) => c.physicalCount !== c.systemQuantity)

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

    // inventoryId was checked above to be this product's row.
    const rowFilter = (query: any, item: Counted) => {
      if (item.inventoryId) return query.eq("inventory_id", item.inventoryId)
      query = query.eq("product_id", item.productId)
      return item.warehouseId ? query.eq("warehouse_id", item.warehouseId) : query
    }

    const applied: Counted[] = []
    const changedItems: Counted[] = []
    const changedNow = new Map<Counted, number | null>()
    // Puts the rows this request already wrote back to the loaded quantity (guarded on what it wrote).
    const undoApplied = async () => {
      for (const item of applied) {
        const { error } = await rowFilter(
          supabase.from("inventory").update({ quantity: item.systemQuantity, last_updated: auditDate }),
          item,
        ).eq("quantity", item.physicalCount)
        if (error) console.error("Inventory Audit: could not put back the count of product", item.productId, ":", error.message)
      }
    }

    for (const item of counted) {
      if (item.physicalCount === item.systemQuantity) {
        // Nothing to write, but a count that matches a quantity that has since moved is no longer a valid count.
        const { data: rows, error } = await rowFilter(supabase.from("inventory").select("inventory_id, quantity"), item)
        if (error) {
          await undoApplied()
          return NextResponse.json({ error: `${error.message}. Nothing was saved.` }, { status: 500 })
        }
        if (Array.isArray(rows) && rows.length === 1 && Number(rows[0].quantity) !== item.systemQuantity) {
          changedItems.push(item)
          changedNow.set(item, Number(rows[0].quantity))
        }
        continue
      }

      // UPDATE ... WHERE <row> AND quantity = <system quantity the screen loaded>
      const { data: rows, error: updateError } = await rowFilter(
        supabase.from("inventory").update({ quantity: item.physicalCount, last_updated: auditDate }),
        item,
      )
        .eq("quantity", item.systemQuantity)
        .select("inventory_id")

      if (updateError) {
        console.error("Inventory Audit: Error updating inventory for product", item.productId, ":", updateError)
        await undoApplied()
        return NextResponse.json({ error: `${updateError.message}. Nothing was saved.` }, { status: 500 })
      }
      if (Array.isArray(rows) && rows.length > 0) {
        applied.push(item)
        continue
      }
      // 0 rows: the quantity moved since the screen loaded it (or the row is gone). Not overwritten.
      const { data: now } = await rowFilter(supabase.from("inventory").select("inventory_id, quantity"), item)
      changedItems.push(item)
      changedNow.set(item, Array.isArray(now) && now.length === 1 ? Number(now[0].quantity) : null)
    }

    // Insert audit records for the rows that were saved (or confirmed unchanged)
    const saved = counted.filter((c) => !changedItems.includes(c))
    const auditRecords = saved.map((c) => ({
      product_id: c.productId,
      system_quantity: c.systemQuantity,
      physical_count: c.physicalCount,
      difference: c.physicalCount - c.systemQuantity,
      notes: c.notes,
      audited_by: auditedBy || null,
      audit_date: auditDate,
    }))
    if (auditRecords.length > 0) {
      const { error: auditError } = await supabase.from("inventory_audits").insert(auditRecords)

      if (auditError) {
        console.error("Inventory Audit: Error inserting audit records:", auditError)
        await undoApplied()
        return NextResponse.json({ error: `${auditError.message}. Nothing was saved.` }, { status: 500 })
      }
    }

    const summary = {
      totalAudited: auditRecords.length,
      adjustmentsMade: applied.length,
      noChangeItems: saved.length - applied.length,
      changedItems: changedItems.length,
    }

    if (changedItems.length > 0) {
      const productIds = [...new Set(changedItems.map((c) => c.productId).filter((id) => id !== null && id !== undefined))]
      const { data: products } = productIds.length
        ? await supabase.from("products").select("product_id, product_name").in("product_id", productIds)
        : { data: [] as any[] }
      return NextResponse.json(
        {
          error: "Some items changed during the count and were not saved. Recheck them.",
          code: "STOCK_CHANGED",
          changed: changedItems.map((c) => ({
            inventoryId: c.inventoryId,
            productId: c.productId,
            productName: (products || []).find((p: any) => p.product_id === c.productId)?.product_name ?? null,
            warehouseId: c.warehouseId,
            quantityLoaded: c.systemQuantity,
            quantityNow: changedNow.get(c) ?? null,
          })),
          summary,
        },
        { status: 409 },
      )
    }

    return NextResponse.json({
      success: true,
      message: `${auditRecords.length} audit records saved, ${applied.length} inventory items updated`,
      summary,
    })
  } catch (error) {
    console.error("Inventory Audit: Error in POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
