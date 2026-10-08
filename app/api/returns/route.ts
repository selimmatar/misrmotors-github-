import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { createReturn, processReturn, rejectReturn } from "@/lib/returns"

export const dynamic = "force-dynamic"

// Create admin client lazily to ensure env vars are available
function getAdmin() {
  return createAdminClient()
}

export async function GET(request: Request) {
  // Use admin client to bypass RLS for reading returns
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  
  try {
    let query = getAdmin()
      .from("product_returns")
      .select(`
        *,
        return_items (*)
      `)
      .order("created_at", { ascending: false })
    
    if (status) {
      query = query.eq("status", status)
    }
    
    const { data, error } = await query
    
    if (error) throw error
    
    // Get sales order and customer info for display
    const soIds = [...new Set((data || []).map((r: any) => r.so_id).filter(Boolean))]
    let soLookup: Record<number, any> = {}
    
    if (soIds.length > 0) {
      const { data: soData } = await getAdmin()
        .from("sales_orders")
        .select("so_id, so_number, customer_id, customers(customer_name)")
        .in("so_id", soIds)
      
      soData?.forEach((so: any) => {
        soLookup[so.so_id] = so
      })
    }
    
    // Transform to camelCase using correct schema columns
    const transformed = (data || []).map((r: any) => {
      const so = soLookup[r.so_id] || {}
      return {
        id: r.return_id,
        returnId: r.return_id,
        permitId: r.permit_id,
        soId: r.so_id,
        soNumber: r.so_number || so.so_number || (r.so_id ? `SO-${r.so_id}` : "N/A"),
        customerId: r.customer_id || so.customer_id,
        customerName: r.customer_name || so.customers?.customer_name || "Unknown",
        status: r.status,
        notes: r.notes,
        courierName: r.courier_name,
        initiatedBy: r.initiated_by,
        initiatedAt: r.initiated_at,
        assignedWarehouseId: r.assigned_warehouse_id,
        assignedBy: r.assigned_by,
        assignedAt: r.assigned_at,
        receivedBy: r.received_by,
        receivedAt: r.received_at,
        returnedBy: r.initiated_by,
        returnDate: r.initiated_at || r.created_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        items: (r.return_items || []).map((item: any) => ({
          id: item.return_item_id,
          returnId: item.return_id,
          productId: item.product_id,
          productName: item.product_name || "Unknown Item",
          sku: item.sku,
          originalQuantity: item.original_quantity,
          quantityReturned: item.returned_quantity,
          reason: item.return_reason,
          condition: item.item_condition,
          restocked: item.restocked,
          isOutsourced: item.is_outsourced || !item.product_id,
          supplierName: item.supplier_name || null,
          unitCost: item.unit_cost || null,
        })),
      }
    })
    
    return NextResponse.json(transformed)
  } catch (error: any) {
    console.error("Returns GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Batch 2: creation is validated against the real delivery permit (status, items, cumulative quantity) and is
// idempotent. See lib/returns.ts. Requests must carry { permitId, idempotencyKey, items[] }.
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const result = await createReturn(getAdmin(), body)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: any) {
    console.error("Returns POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Batch 2: the supported transitions are the warehouse "process" step (pending_warehouse -> received) and the
// API-controlled reject (pending_warehouse -> rejected, reason required). Both are guarded so they run once.
export async function PUT(request: Request) {
  let input: any
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const result = input?.status === "rejected" ? await rejectReturn(getAdmin(), input) : await processReturn(getAdmin(), input)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error: any) {
    console.error("Returns PUT error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
