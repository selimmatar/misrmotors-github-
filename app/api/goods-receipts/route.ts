import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// GET: Fetch all goods receipts (with filtering)
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const poId = searchParams.get("po_id")

    let query = supabase
      .from("goods_receipts")
      .select(`
        *,
        purchase_orders!inner(po_number, supplier_id, suppliers(supplier_name)),
        goods_receipt_lines(
          *,
          products(product_name, sku, unit),
          warehouses(warehouse_name)
        )
      `)
      .order("receipt_date", { ascending: false })

    if (poId) {
      query = query.eq("po_id", poId)
    }

    const { data: receipts, error } = await query

    if (error) throw error

    const formattedReceipts = receipts?.map((receipt: any) => ({
      id: receipt.receipt_id.toString(),
      grnNumber: receipt.grn_number,
      poId: receipt.po_id?.toString(),
      poNumber: receipt.po_number || receipt.purchase_orders?.po_number,
      supplierName: receipt.purchase_orders?.suppliers?.supplier_name,
      receiptDate: receipt.receipt_date,
      status: receipt.status,
      receivedBy: receipt.received_by,
      notes: receipt.notes,
      createdAt: receipt.created_at,
      lines: receipt.goods_receipt_lines?.map((line: any) => ({
        id: line.line_id.toString(),
        receiptId: line.receipt_id.toString(),
        poItemId: line.po_item_id?.toString(),
        productId: line.product_id.toString(),
        productName: line.products?.product_name,
        sku: line.products?.sku,
        unit: line.products?.unit,
        quantityOrdered: line.quantity_ordered,
        quantityReceived: line.quantity_received,
        quantityRemaining: line.quantity_remaining,
        discrepancyType: line.discrepancy_type,
        discrepancyNotes: line.discrepancy_notes,
        warehouseId: line.warehouse_id?.toString(),
        warehouseName: line.warehouses?.warehouse_name,
        unitCost: line.unit_cost,
        receivedDate: line.received_date,
      })) || [],
    }))

    return NextResponse.json(formattedReceipts)
  } catch (error) {
    console.error("Error fetching goods receipts:", error)
    return NextResponse.json(
      { error: "Failed to fetch goods receipts" },
      { status: 500 },
    )
  }
}

// POST: Create a new goods receipt
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { poId, lines, receivedBy, notes } = body


    // Fetch PO details
    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select("po_number, po_id")
      .eq("po_id", poId)
      .single()

    if (poError || !po) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 },
      )
    }

    // Auto-provision a catalog product for stock items that were added to the PO
    // manually (typed name, no matching catalog product). Without a real product_id,
    // these items could never be added to inventory when received.
    const provisionedProductIds = new Map<string, number>()
    for (const line of lines) {
      if (line.itemType !== "outsourced" && !line.productId && line.poItemId) {
        const cacheKey = String(line.poItemId)
        const cached = provisionedProductIds.get(cacheKey)
        if (cached) {
          line.productId = cached
          continue
        }

        const { data: newProduct, error: newProductError } = await supabase
          .from("products")
          .insert({
            product_name: line.productName || `PO Item ${line.poItemId}`,
            sku: `AUTO-${line.poItemId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            unit_price: line.unitCost || 0,
            unit: "pcs",
            is_active: true,
          })
          .select("product_id")
          .single()

        if (newProductError || !newProduct) {
          throw newProductError || new Error("Failed to create catalog product for stock item")
        }

        // Link the new product back to the PO item so future lookups (invoices,
        // reorder suggestions, tracking, etc.) resolve to a real catalog product.
        await supabase
          .from("purchase_order_items")
          .update({ product_id: newProduct.product_id })
          .eq("po_item_id", Number.parseInt(line.poItemId))

        provisionedProductIds.set(cacheKey, newProduct.product_id)
        line.productId = newProduct.product_id
      }
    }

    // Generate GRN number
    const { data: seqData } = await supabase.rpc("get_next_grn_number")
    const grnNumber = `GRN-${new Date().getFullYear()}-${String(seqData || 1).padStart(4, "0")}`

    // Determine overall receipt status
    const hasDiscrepancies = lines.some((l: any) => l.discrepancyType)
    const allFullyReceived = lines.every((l: any) => l.quantityReceived >= l.quantityOrdered)
    const anyReceived = lines.some((l: any) => l.quantityReceived > 0)

    let receiptStatus = "pending"
    if (hasDiscrepancies) {
      receiptStatus = "discrepancy"
    } else if (allFullyReceived) {
      receiptStatus = "complete"
    } else if (anyReceived) {
      receiptStatus = "partial"
    }

    // Create goods receipt header
    const { data: receipt, error: receiptError } = await supabase
      .from("goods_receipts")
      .insert({
        grn_number: grnNumber,
        po_id: poId,
        po_number: po.po_number,
        receipt_date: new Date().toISOString().split("T")[0],
        status: receiptStatus,
        received_by: receivedBy,
        notes: notes || null,
      })
      .select()
      .single()

    if (receiptError) throw receiptError

    // Create goods receipt lines
    const linesToInsert = lines.map((line: any) => ({
      receipt_id: receipt.receipt_id,
      po_item_id: line.poItemId ? Number.parseInt(line.poItemId) : null,
      // Outsourced items have no product_id — store null (column is now nullable)
      product_id: line.itemType === 'outsourced' ? null : (line.productId ? Number.parseInt(line.productId) : null),
      outsourced_name: line.outsourcedName || null,
      item_type: line.itemType || 'stock',
      source_so_item_id: line.sourceSoItemId ? Number.parseInt(line.sourceSoItemId) : null,
      quantity_ordered: line.quantityOrdered,
      quantity_received: line.quantityReceived,
      discrepancy_type: line.discrepancyType || null,
      discrepancy_notes: line.discrepancyNotes || null,
      warehouse_id: line.warehouseId ? Number.parseInt(line.warehouseId) : null,
      unit_cost: line.unitCost,
      received_date: new Date().toISOString().split("T")[0],
    }))

    const { error: linesError } = await supabase
      .from("goods_receipt_lines")
      .insert(linesToInsert)

    if (linesError) throw linesError

    // Update inventory for stock items only
    for (const line of lines) {
      if (line.quantityReceived > 0 && line.itemType !== 'outsourced' && line.productId) {
        const productId = Number.parseInt(line.productId)
        const warehouseId = line.warehouseId ? Number.parseInt(line.warehouseId) : null

        let query = supabase
          .from("inventory")
          .select("inventory_id, quantity")
          .eq("product_id", productId)

        if (warehouseId !== null) {
          query = query.eq("warehouse_id", warehouseId)
        } else {
          query = query.is("warehouse_id", null)
        }

        const { data: existingInv } = await query.maybeSingle()

        if (existingInv) {
          await supabase
            .from("inventory")
            .update({
              quantity: existingInv.quantity + line.quantityReceived,
              unit_cost: line.unitCost,
              last_updated: new Date().toISOString(),
            })
            .eq("inventory_id", existingInv.inventory_id)
        } else {
          await supabase.from("inventory").insert({
            product_id: productId,
            quantity: line.quantityReceived,
            unit_cost: line.unitCost,
            warehouse_id: warehouseId,
            reorder_point: 0,
            last_updated: new Date().toISOString(),
          })
        }

        const { data: lastBatch } = await supabase
          .from("inventory_batches")
          .select("batch_sequence")
          .eq("product_id", productId)
          .order("batch_sequence", { ascending: false })
          .limit(1)
          .single()

        const nextSequence = (lastBatch?.batch_sequence || 0) + 1

        await supabase.from("inventory_batches").insert({
          product_id: productId,
          po_id: poId,
          po_number: po.po_number,
          quantity_received: line.quantityReceived,
          quantity_available: line.quantityReceived,
          unit_cost: line.unitCost,
          landed_cost_per_unit: line.unitCost,
          received_date: new Date().toISOString().split("T")[0],
          warehouse_id: warehouseId,
          batch_sequence: nextSequence,
        })
      }
    }

    // Mark ALL linked SO items as fulfilled (both stock and outsourced lines)
    const soLinkedLines = lines.filter((l: any) => l.sourceSoItemId && l.quantityReceived > 0)
    if (soLinkedLines.length > 0) {
      const soItemIds = soLinkedLines.map((l: any) => Number.parseInt(l.sourceSoItemId))
      const { error: soUpdateError } = await supabase
        .from("sales_order_items")
        .update({ fulfilled_at: new Date().toISOString() })
        .in("so_item_id", soItemIds)
      if (soUpdateError) {
        console.error("Error marking SO items as fulfilled:", soUpdateError)
      } else {
      }

      // Find which sales orders these items belong to
      const { data: affectedItems } = await supabase
        .from("sales_order_items")
        .select("so_id")
        .in("so_item_id", soItemIds)

      const affectedSoIds = [...new Set((affectedItems || []).map((i: any) => i.so_id))]

      // For each affected SO, if ALL its items are now fulfilled, mark it ready for delivery
      for (const soId of affectedSoIds) {
        const { data: allItems } = await supabase
          .from("sales_order_items")
          .select("so_item_id, fulfilled_at")
          .eq("so_id", soId)

        const allFulfilled = (allItems || []).length > 0 && (allItems || []).every((i: any) => i.fulfilled_at)

        if (allFulfilled) {
          await supabase
            .from("sales_orders")
            .update({ fulfillment_status: "READY_FOR_FULFILLMENT" })
            .eq("so_id", soId)
        }
      }
    }

    // Update PO status when goods are received (even with discrepancies)
    // This removes the PO from the "awaiting receipt" list
    if (receiptStatus === "complete" || receiptStatus === "discrepancy") {
      await supabase
        .from("purchase_orders")
        .update({ status: "received" })
        .eq("po_id", poId)
    }


    return NextResponse.json({
      success: true,
      receipt: {
        id: receipt.receipt_id.toString(),
        grnNumber,
        status: receiptStatus,
      },
    })
  } catch (error) {
    console.error("Error creating goods receipt:", error)
    return NextResponse.json(
      { error: "Failed to create goods receipt" },
      { status: 500 },
    )
  }
}
