import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const adminClient = createAdminClient()

export async function GET(request: Request) {
  // Use admin client to bypass RLS for reading returns
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  
  try {
    let query = adminClient
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
      const { data: soData } = await adminClient
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
        })),
      }
    })
    
    return NextResponse.json(transformed)
  } catch (error: any) {
    console.error("[v0] Returns GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  // Use admin client to bypass RLS for shipping department
  
  try {
    const body = await request.json()
    const {
      permitId,
      soId,
      soNumber,
      customerId,
      customerName,
      returnReason,
      notes,
      createdBy,
      courierName,
      items,
    } = body
    
    // Create the return record - using correct column names from schema
    const { data: returnData, error: returnError } = await adminClient
      .from("product_returns")
      .insert({
        permit_id: permitId || `RET-${Date.now()}`,
        so_id: soId ? Number(soId) : null,
        so_number: soNumber || null,
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerName || null,
        notes: notes || "",
        initiated_by: createdBy || "shipping",
        courier_name: courierName || "",
        status: "pending_warehouse",
        total_items_returned: items?.filter((i: any) => i.quantityReturned > 0).length || 0,
      })
      .select()
      .single()
    
    if (returnError) throw returnError
    
    // Create return items - using correct column names from schema
    if (items && items.length > 0) {
      const returnItems = items
        .filter((item: any) => item.quantityReturned > 0)
        .map((item: any) => ({
          return_id: returnData.return_id,
          product_id: item.productId ? Number(item.productId) : null,
          product_name: item.productName || "Unknown Product",
          sku: item.sku || "",
          original_quantity: Number(item.maxQuantity || item.quantityReturned) || 0,
          returned_quantity: Number(item.quantityReturned) || 0,
          return_reason: ["damaged", "wrong_item", "customer_refused", "excess_quantity", "quality_issue", "other"].includes(item.reason) ? item.reason : "other",
          item_condition: item.condition || "good",
          is_outsourced: item.isOutsourced || !item.productId || false,
        }))
      
      const { error: itemsError } = await adminClient
        .from("return_items")
        .insert(returnItems)
      
      if (itemsError) throw itemsError
    }
    
    return NextResponse.json({ success: true, returnId: returnData.return_id })
  } catch (error: any) {
    console.error("[v0] Returns POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  
  try {
    const body = await request.json()
    const {
      returnId,
      status,
      assignedWarehouseId,
      assignedWarehouseName,
      processedBy,
      restockItems,
      warehouseAssignments, // New format from warehouse module
    } = body
    
    // Update return status using correct column names from schema
    const updateData: any = {
      status,
      updated_at: new Date().toISOString(),
    }
    
    if (assignedWarehouseId) {
      updateData.assigned_warehouse_id = Number(assignedWarehouseId)
      updateData.assigned_by = processedBy || "warehouse_manager"
      updateData.assigned_at = new Date().toISOString()
    }
    
    // Map "completed" to valid status value "received" 
    if (status === "completed") {
      updateData.status = "received"
    }
    
    // Mark as received when completing
    if (status === "completed" || status === "received" || status === "restocked") {
      updateData.received_by = processedBy || "warehouse_manager"
      updateData.received_at = new Date().toISOString()
    }
    
    // Use admin client to bypass RLS for updating returns
    const { data: returnData, error: returnError } = await adminClient
      .from("product_returns")
      .update(updateData)
      .eq("return_id", returnId)
      .select()
      .single()
    
    if (returnError) {
      console.error("[v0] Returns PUT error:", returnError)
      throw returnError
    }
    
    // Handle warehouse assignments from warehouse module (new format)
    // Use admin client to bypass RLS for inventory operations
    console.log("[v0] Returns PUT: status =", status, ", warehouseAssignments =", warehouseAssignments?.length || 0, "items")
    
    if ((status === "completed" || status === "received") && warehouseAssignments && warehouseAssignments.length > 0) {
      console.log("[v0] Returns: Processing", warehouseAssignments.length, "warehouse assignments")
      
      for (const assignment of warehouseAssignments) {
        // Only restock items with "good" condition and assigned warehouse
        const productId = assignment.productId ? Number(assignment.productId) : null
        const warehouseId = assignment.warehouseId ? Number(assignment.warehouseId) : null
        const isOutsourced = !productId || assignment.isOutsourced
        
        console.log("[v0] Returns: Processing item:", {
          productId,
          productName: assignment.productName,
          warehouseId,
          isOutsourced,
          condition: assignment.condition,
          quantity: assignment.quantityReturned
        })
        
        // Skip if no warehouse assigned or condition is not good
        if (assignment.condition !== "good" || !warehouseId) {
          console.log("[v0] Skipping item - condition:", assignment.condition, "warehouseId:", warehouseId)
          continue
        }
        
        if (isOutsourced) {
          // Handle outsourced items - check if outsourced item with same name exists
          const { data: existingOutsourced } = await adminClient
            .from("inventory")
            .select("*")
            .eq("warehouse_id", warehouseId)
            .eq("is_outsourced", true)
            .eq("outsourced_name", assignment.productName || "Outsourced Item")
            .maybeSingle()
          
          if (existingOutsourced) {
            // Update existing outsourced inventory
            const newQuantity = (existingOutsourced.quantity || 0) + (assignment.quantityReturned || 0)
            const { error: updateError } = await adminClient
              .from("inventory")
              .update({ quantity: newQuantity })
              .eq("inventory_id", existingOutsourced.inventory_id)
            
            if (updateError) {
              console.error("[v0] Outsourced inventory update error:", updateError)
            } else {
              console.log("[v0] Updated outsourced inventory:", assignment.productName, "new qty:", newQuantity)
            }
          } else {
            // Create new outsourced inventory record
            const { error: insertError } = await adminClient
              .from("inventory")
              .insert({
                product_id: null,
                warehouse_id: warehouseId,
                quantity: assignment.quantityReturned || 0,
                reorder_point: 0,
                is_outsourced: true,
                outsourced_name: assignment.productName || "Outsourced Item",
                outsourced_description: `Returned item - ${assignment.reason || "customer return"}`,
              })
            
            if (insertError) {
              console.error("[v0] Outsourced inventory insert error:", insertError)
            } else {
              console.log("[v0] Created outsourced inventory record:", assignment.productName)
            }
          }
        } else {
          // Regular product - find or create inventory record
          const { data: invData } = await adminClient
            .from("inventory")
            .select("*")
            .eq("product_id", productId)
            .eq("warehouse_id", warehouseId)
            .maybeSingle()
          
          if (invData) {
            // Update existing inventory - just update quantity
            const newQuantity = (invData.quantity || 0) + (assignment.quantityReturned || 0)
            const { error: updateError } = await adminClient
              .from("inventory")
              .update({ quantity: newQuantity })
              .eq("inventory_id", invData.inventory_id)
            
            if (updateError) {
              console.error("[v0] Inventory update error:", updateError)
            } else {
              console.log("[v0] Updated inventory for product:", productId, "new qty:", newQuantity)
            }
          } else {
            // Create new inventory record
            const { error: insertError } = await adminClient
              .from("inventory")
              .insert({
                product_id: productId,
                warehouse_id: warehouseId,
                quantity: assignment.quantityReturned || 0,
                reorder_point: 10,
                is_outsourced: false,
              })
            
            if (insertError) {
              console.error("[v0] Inventory insert error:", insertError)
            } else {
              console.log("[v0] Created inventory record for product:", productId)
            }
          }
        }
      }
    }
    
    // Legacy format: If status is "restocked", update inventory
    if (status === "restocked" && restockItems && restockItems.length > 0) {
      const warehouseIdNum = assignedWarehouseId ? Number(assignedWarehouseId) : null
      
      for (const item of restockItems) {
        const productId = item.productId ? Number(item.productId) : null
        
        if (!productId || !warehouseIdNum) {
          console.log("[v0] Skipping restock - invalid productId or warehouseId")
          continue
        }
        
        // Get current inventory for product in assigned warehouse
        const { data: invData } = await adminClient
          .from("inventory")
          .select("*")
          .eq("product_id", productId)
          .eq("warehouse_id", warehouseIdNum)
          .maybeSingle()
        
        if (invData) {
          // Update existing inventory - just update quantity
          const { error: updateErr } = await adminClient
            .from("inventory")
            .update({ quantity: (invData.quantity || 0) + (item.quantityReturned || 0) })
            .eq("inventory_id", invData.inventory_id)
          
          if (updateErr) {
            console.error("[v0] Restock inventory update error:", updateErr)
          } else {
            console.log("[v0] Restocked inventory for product:", productId, "new qty:", (invData.quantity || 0) + (item.quantityReturned || 0))
          }
        } else {
          // Create new inventory record
          const { error: insertErr } = await adminClient
            .from("inventory")
            .insert({
              product_id: productId,
              warehouse_id: warehouseIdNum,
              quantity: item.quantityReturned || 0,
              reorder_point: 10,
            })
          
          if (insertErr) {
            console.error("[v0] Restock inventory insert error:", insertErr)
          } else {
            console.log("[v0] Created inventory for product:", productId, "qty:", item.quantityReturned)
          }
        }
        
        // Mark item as restocked
        await adminClient
          .from("return_items")
          .update({ restocked: true })
          .eq("return_item_id", item.id)
      }
    }
    
    return NextResponse.json({ success: true, data: returnData })
  } catch (error: any) {
    console.error("[v0] Returns PUT error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
