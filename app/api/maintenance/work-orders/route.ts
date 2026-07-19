import { createServerClient, createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Helper function to check if user is CEO
async function checkCEOAccess(): Promise<{ isCEO: boolean; userId?: string; error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { isCEO: false, error: "Unauthorized - Not authenticated" }
    }
    
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single()
    
    if (userData?.role !== "ceo") {
      return { isCEO: false, error: "Forbidden - Only CEO can manage maintenance" }
    }
    
    return { isCEO: true, userId: user.id }
  } catch (error) {
    return { isCEO: false, error: "Authentication error" }
  }
}

export async function GET(request: Request) {
  try {
    const adminClient = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const customerId = searchParams.get("customer_id")
    
    let query = adminClient
      .from("maintenance_work_orders")
      .select(`
        *,
        customer:customers(customer_id, customer_name),
        assigned_employee:hr_employees!maintenance_work_orders_assigned_to_fkey(employee_id, full_name)
      `)
      .order("created_at", { ascending: false })
    
    if (status) {
      query = query.eq("status", status)
    }
    
    if (customerId) {
      query = query.eq("customer_id", parseInt(customerId))
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error("[v0] Error fetching work orders:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in work orders API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    // Generate work order number
    const { data: woNumberData } = await adminClient.rpc("generate_work_order_number")
    
    const insertData = {
      work_order_number: woNumberData || `WO-${Date.now()}`,
      sales_order_id: body.salesOrderId || body.sales_order_id || null,
      customer_id: body.customerId || body.customer_id,
      title: body.title || "Maintenance Request",
      description: body.description || "",
      priority: body.priority || "medium",
      category: body.workType || body.category || body.work_type || "repair",
      location: body.location || null,
      scheduled_date: body.scheduledDate || body.scheduled_date || null,
      assigned_to: body.assignedTo || body.assigned_to || null,
      status: "pending",
      notes: body.notes || null,
    }
    
    
    const { data, error } = await adminClient
      .from("maintenance_work_orders")
      .insert(insertData)
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error creating work order:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create work order API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    const { work_order_id, ...updates } = body
    
    if (!work_order_id) {
      return NextResponse.json({ error: "work_order_id is required" }, { status: 400 })
    }
    
    
    const { data, error } = await adminClient
      .from("maintenance_work_orders")
      .update(updates)
      .eq("work_order_id", work_order_id)
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error updating work order:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in update work order API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
