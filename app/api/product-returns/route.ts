import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  
  let query = supabase
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
  
  if (error) {
    console.error("Product Returns GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  // Transform to camelCase
  const transformed = (data || []).map((r: any) => ({
    id: r.return_id,
    returnId: r.return_id,
    soId: r.so_id,
    soNumber: r.so_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    returnedBy: r.returned_by,
    returnDate: r.return_date,
    status: r.status,
    assignedWarehouseId: r.assigned_warehouse_id,
    assignedWarehouseName: r.assigned_warehouse_name,
    processedBy: r.processed_by,
    processedAt: r.processed_at,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: (r.return_items || []).map((item: any) => ({
      id: item.return_item_id,
      returnId: item.return_id,
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      quantityReturned: item.quantity_returned,
      reason: item.reason,
      condition: item.condition,
      restocked: item.restocked,
    })),
  }))
  
  return NextResponse.json(transformed)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  
  const {
    soId,
    soNumber,
    customerId,
    customerName,
    returnedBy,
    items,
    notes,
  } = body
  
  // Create the return record
  const { data: returnData, error: returnError } = await supabase
    .from("product_returns")
    .insert({
      so_id: soId,
      so_number: soNumber,
      customer_id: customerId,
      customer_name: customerName,
      returned_by: returnedBy || "shipping_team",
      return_date: new Date().toISOString(),
      status: "pending_warehouse",
      notes,
    })
    .select()
    .single()
  
  if (returnError) {
    console.error("Product Returns POST error:", returnError)
    return NextResponse.json({ error: returnError.message }, { status: 500 })
  }
  
  // Insert return items
  if (items && items.length > 0) {
    const returnItems = items.map((item: any) => ({
      return_id: returnData.return_id,
      product_id: item.productId,
      product_name: item.productName,
      sku: item.sku,
      quantity_returned: item.quantityReturned,
      reason: item.reason,
      condition: item.condition || "good",
    }))
    
    const { error: itemsError } = await supabase
      .from("return_items")
      .insert(returnItems)
    
    if (itemsError) {
      console.error("Return Items insert error:", itemsError)
    }
  }
  
  return NextResponse.json({ success: true, returnId: returnData.return_id })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  
  const {
    returnId,
    status,
    assignedWarehouseId,
    assignedWarehouseName,
    processedBy,
  } = body
  
  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  }
  
  if (assignedWarehouseId) {
    updateData.assigned_warehouse_id = assignedWarehouseId
    updateData.assigned_warehouse_name = assignedWarehouseName
  }
  
  if (status === "restocked") {
    updateData.processed_by = processedBy
    updateData.processed_at = new Date().toISOString()
    
    // Get return items
    const { data: returnData } = await supabase
      .from("product_returns")
      .select(`*, return_items (*)`)
      .eq("return_id", returnId)
      .single()
    
    if (returnData && returnData.return_items) {
      // Update inventory for each returned item
      for (const item of returnData.return_items) {
        // Find existing inventory record for this product in the assigned warehouse
        const { data: existingInv } = await supabase
          .from("inventory")
          .select("*")
          .eq("product_id", item.product_id)
          .eq("warehouse_id", assignedWarehouseId)
          .single()
        
        if (existingInv) {
          // Update existing inventory
          await supabase
            .from("inventory")
            .update({
              quantity: existingInv.quantity + item.quantity_returned,
              updated_at: new Date().toISOString(),
            })
            .eq("inventory_id", existingInv.inventory_id)
        } else {
          // Create new inventory record
          await supabase
            .from("inventory")
            .insert({
              product_id: item.product_id,
              warehouse_id: assignedWarehouseId,
              quantity: item.quantity_returned,
              reorder_point: 10,
            })
        }
        
        // Mark item as restocked
        await supabase
          .from("return_items")
          .update({ restocked: true })
          .eq("return_item_id", item.return_item_id)
      }
    }
  }
  
  const { error } = await supabase
    .from("product_returns")
    .update(updateData)
    .eq("return_id", returnId)
  
  if (error) {
    console.error("Product Returns PUT error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}
