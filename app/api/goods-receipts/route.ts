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
    console.error("[v0] Error fetching goods receipts:", error)
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

    console.log("[v0] Creating goods receipt for PO:", poId, "with", lines?.length, "lines")

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
      product_id: Number.parseInt(line.productId),
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

    // Update inventory and create batches for ALL received items (including those with discrepancies)
    // The physical items were received even if there's a quantity discrepancy
    for (const line of lines) {
      if (line.quantityReceived > 0) {
        const productId = Number.parseInt(line.productId)
        const warehouseId = line.warehouseId ? Number.parseInt(line.warehouseId) : null

        console.log(`[v0] Updating inventory for product ${productId} in warehouse ${warehouseId}: +${line.quantityReceived} units`)

        // Update or create inventory record - use maybeSingle() to avoid error when no record exists
        let query = supabase
          .from("inventory")
          .select("inventory_id, quantity")
          .eq("product_id", productId)
        
        // Handle null warehouse_id properly
        if (warehouseId !== null) {
          query = query.eq("warehouse_id", warehouseId)
        } else {
          query = query.is("warehouse_id", null)
        }
        
        const { data: existingInv, error: invError } = await query.maybeSingle()
        
        if (invError) {
          console.error(`[v0] Error checking existing inventory for product ${productId}:`, invError)
        }

        if (existingInv) {
          const { error: updateError } = await supabase
            .from("inventory")
            .update({
              quantity: existingInv.quantity + line.quantityReceived,
              unit_cost: line.unitCost,
              last_updated: new Date().toISOString(),
            })
            .eq("inventory_id", existingInv.inventory_id)
          
          if (updateError) {
            console.error(`[v0] Error updating inventory for product ${productId}:`, updateError)
          } else {
            console.log(`[v0] Updated existing inventory ${existingInv.inventory_id}: ${existingInv.quantity} + ${line.quantityReceived} = ${existingInv.quantity + line.quantityReceived}`)
          }
        } else {
          const { data: newInv, error: insertError } = await supabase.from("inventory").insert({
            product_id: productId,
            quantity: line.quantityReceived,
            unit_cost: line.unitCost,
            warehouse_id: warehouseId,
            reorder_point: 0,
            last_updated: new Date().toISOString(),
          }).select()
          
          if (insertError) {
            console.error(`[v0] Error creating inventory for product ${productId}:`, insertError)
          } else {
            console.log(`[v0] Created new inventory record for product ${productId} with ${line.quantityReceived} units`, newInv)
          }
        }

        // Get the next batch sequence for this product
        const { data: lastBatch } = await supabase
          .from("inventory_batches")
          .select("batch_sequence")
          .eq("product_id", productId)
          .order("batch_sequence", { ascending: false })
          .limit(1)
          .single()

        const nextSequence = (lastBatch?.batch_sequence || 0) + 1

        // Create inventory batch
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
        console.log(`[v0] Created inventory batch ${nextSequence} for product ${productId}, PO ${po.po_number}`)
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

    console.log("[v0] Goods receipt created:", grnNumber, "status:", receiptStatus)

    return NextResponse.json({
      success: true,
      receipt: {
        id: receipt.receipt_id.toString(),
        grnNumber,
        status: receiptStatus,
      },
    })
  } catch (error) {
    console.error("[v0] Error creating goods receipt:", error)
    return NextResponse.json(
      { error: "Failed to create goods receipt" },
      { status: 500 },
    )
  }
}
