import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"
import { loadHoldSplit } from "@/lib/stock-hold"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data, error } = await supabase
        .from("inventory")
        .select(`
          *,
          products:product_id (
            product_id,
            product_name,
            sku,
            unit
          ),
          warehouses:warehouse_id (
            warehouse_id,
            warehouse_name,
            location
          )
        `)
        .order("last_updated", { ascending: false })

      if (error) throw error

      return data || []
    })

    // Batch 4E-stock: stock on hold for approved sales orders (derived, product level) and what is left to sell.
    // onHold/available are null when the hold cannot be computed (the list itself is still returned).
    // onHoldByQuotations: the part held by quotations waiting for the customer (new quotation workflow).
    let heldByProduct: Map<number, number> | null = null
    let heldByQuotations: Map<number, number> = new Map()
    try {
      const split = await loadHoldSplit(createAdminClient())
      heldByProduct = split.total
      heldByQuotations = split.quotations.byProduct
    } catch (holdError) {
      console.error("Inventory GET: could not compute stock on hold:", holdError)
    }
    const onHandByProduct = new Map<number, number>()
    for (const item of result as any[]) {
      if (item.product_id && !item.is_returned) {
        onHandByProduct.set(item.product_id, (onHandByProduct.get(item.product_id) || 0) + (Number(item.quantity) || 0))
      }
    }

    const transformed = result.map((item: any) => {
      const sellable = !!item.product_id && !item.is_returned
      const onHold = heldByProduct && sellable ? heldByProduct.get(item.product_id) || 0 : heldByProduct ? 0 : null
      const available = heldByProduct && sellable ? Math.max(0, (onHandByProduct.get(item.product_id) || 0) - (onHold || 0)) : heldByProduct ? 0 : null
      const isOutsourced = item.is_outsourced || !item.product_id
      const productName = isOutsourced
        ? (item.outsourced_name || "Outsourced Item")
        : (item.products?.product_name || "Unknown")

      return {
        id: item.inventory_id?.toString() || "",
        inventoryId: item.inventory_id,
        productId: item.product_id?.toString() || "",
        quantity: item.quantity,
        // product-level (all warehouses): same value on every row of the product
        onHold,
        onHoldByQuotations: onHold === null ? null : sellable ? heldByQuotations.get(item.product_id) || 0 : 0,
        available,
        unitCost: item.unit_cost ?? 0,
        reorderPoint: item.reorder_point || 5,
        location: item.location || "Warehouse - Main",
        lastUpdated: item.last_updated,
        warehouseId: item.warehouse_id,
        warehouseName: item.warehouses?.warehouse_name || item.location || "Main Warehouse",
        productName: productName,
        sku: item.products?.sku || (isOutsourced ? "OUTSOURCED" : ""),
        unit: item.products?.unit || "unit",
        isOutsourced: isOutsourced,
        outsourcedName: item.outsourced_name,
        outsourcedDescription: item.outsourced_description,
        supplierName: item.supplier_name || null,
        isReturned: item.is_returned || false,
        soNumber: item.so_number || null,
        // raw fields kept for legacy compatibility
        inventory_id: item.inventory_id,
        product_id: item.product_id,
        unit_cost: item.unit_cost,
        reorder_point: item.reorder_point,
        last_updated: item.last_updated,
        warehouse_id: item.warehouse_id,
        products: item.products,
        warehouses: item.warehouses,
      }
    })

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("Error fetching inventory:", error)
    return NextResponse.json({ error: "Failed to fetch inventory" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const productId = body.productId || body.product_id
    const warehouseId = body.warehouseId || body.warehouse_id

    if (!productId) {
      throw new Error("product_id is required")
    }

    let query = supabase.from("inventory").select("*").eq("product_id", Number.parseInt(productId))

    if (warehouseId) {
      query = query.eq("warehouse_id", Number.parseInt(warehouseId))
    }

    const { data: existing, error: checkError } = await query.maybeSingle()

    if (checkError) {
      console.error("Inventory POST: Check error", checkError)
      throw checkError
    }

    if (existing) {
      return NextResponse.json(
        { error: "Inventory for this product already exists at this warehouse. Use PUT to update." },
        { status: 409 },
      )
    }

    const { data, error } = await supabase
      .from("inventory")
      .insert({
        product_id: Number.parseInt(productId),
        quantity: body.quantity,
        unit_cost: body.unitCost || body.unit_cost || 0,
        reorder_point: body.reorderPoint || body.reorder_point || 5,
        location: body.location || "Warehouse - Main",
        warehouse_id: warehouseId ? Number.parseInt(warehouseId) : null,
        last_updated: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error("Inventory POST: Error", error)
      throw error
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error creating inventory:", error.message || error)
    return NextResponse.json({ error: error.message || "Failed to create inventory" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const productId = body.productId || body.product_id
    const warehouseId = body.warehouseId || body.warehouse_id

    if (!productId) {
      throw new Error("product_id is required for update")
    }

    // Stock quantities move only through stock operations (receiving, delivery permits, transfers, returns, stock
    // count), never through this generic update (BIZ-P-09). The metadata fields below still update.
    if (body.quantity !== undefined || body.quantity_increment !== undefined) {
      return NextResponse.json(
        {
          error: "Stock quantities cannot be changed here. Use goods receiving, delivery permits, transfers, returns or the stock count.",
          code: "QUANTITY_NOT_EDITABLE",
        },
        { status: 400 },
      )
    }

    const updates: any = {
      last_updated: new Date().toISOString(),
    }

    if (body.unitCost !== undefined) updates.unit_cost = body.unitCost
    if (body.unit_cost !== undefined) updates.unit_cost = body.unit_cost
    if (body.reorderPoint !== undefined) updates.reorder_point = body.reorderPoint
    if (body.reorder_point !== undefined) updates.reorder_point = body.reorder_point
    if (body.location !== undefined) updates.location = body.location
    if (warehouseId !== undefined) updates.warehouse_id = warehouseId ? Number.parseInt(warehouseId) : null


    let updateQuery = supabase.from("inventory").update(updates).eq("product_id", Number.parseInt(productId))

    if (warehouseId) {
      updateQuery = updateQuery.eq("warehouse_id", Number.parseInt(warehouseId))
    }

    const { data, error } = await updateQuery.select().single()

    if (error) {
      console.error("Inventory PUT: Error", error)
      throw error
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error updating inventory:", error.message || error)
    return NextResponse.json({ error: error.message || "Failed to update inventory" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    const numericId = parsePositiveId(id)
    if (numericId === null) {
      return NextResponse.json({ error: "A valid numeric id is required" }, { status: 400 })
    }

    // A row that still holds stock is never deleted (BIZ-P-09): the units would vanish without a movement.
    const { data: row, error: readError } = await supabase
      .from("inventory")
      .select("inventory_id, quantity")
      .eq("inventory_id", numericId)
      .maybeSingle()
    if (readError) throw readError
    if (row && (Number(row.quantity) || 0) > 0) {
      return NextResponse.json(
        { error: "This inventory row still holds stock and cannot be deleted.", code: "INVENTORY_HAS_STOCK" },
        { status: 409 },
      )
    }

    const { error } = await supabase.from("inventory").delete().eq("inventory_id", numericId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting inventory:", error)
    return NextResponse.json({ error: "Failed to delete inventory" }, { status: 500 })
  }
}
