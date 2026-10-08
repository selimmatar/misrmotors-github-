import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { receiveGoods } from "@/lib/goods-receiving"

// GET: Fetch all goods receipts (with filtering)
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    // Created inside the handler (not at module scope) so this file can be
    // imported during `next build`'s page-data collection without requiring
    // the Supabase env vars to be present at build time.
    const supabase = createAdminClient()
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
        productId: line.product_id?.toString(),
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

// POST: Create a new goods receipt.
// All rules (receivable PO, line ownership, cumulative quantity cap, partial receipts, idempotency, per-PO
// serialisation, undo on failure) live in lib/goods-receiving.ts. The response shape is unchanged
// ({ success, receipt: { id, grnNumber, status } }) plus poStatus / replayed.
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", message: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const result = await receiveGoods(createAdminClient(), body)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error("Error creating goods receipt:", error)
    return NextResponse.json({ error: "Failed to create goods receipt" }, { status: 500 })
  }
}
