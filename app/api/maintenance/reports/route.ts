import { createServerClient, createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const adminClient = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const workOrderId = searchParams.get("work_order_id")

    console.log("[v0] Fetching maintenance reports - status:", status, "workOrderId:", workOrderId)

    let query = adminClient
      .from("maintenance_reports")
      .select(`
        *,
        work_order:maintenance_work_orders!inner(
          work_order_id,
          work_order_number,
          title,
          description,
          status,
          sales_order_id,
          customer_id,
          sales_order:sales_orders!maintenance_work_orders_sales_order_id_fkey(so_number),
          customer:customers(customer_name)
        )
      `)
      .order("created_at", { ascending: false })

    if (workOrderId) {
      query = query.eq("work_order_id", workOrderId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching reports:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Transform data to flatten relationships
    const transformedData = data.map((report) => {
      const salesOrder = Array.isArray(report.work_order.sales_order) 
        ? report.work_order.sales_order[0] 
        : report.work_order.sales_order
      const customer = Array.isArray(report.work_order.customer) 
        ? report.work_order.customer[0] 
        : report.work_order.customer
        
      return {
        ...report,
        work_order_id: report.work_order.work_order_id,
        work_order_number: report.work_order.work_order_number,
        title: report.work_order.title,
        description: report.work_order.description,
        sales_order_id: report.work_order.sales_order_id,
        sales_order_number: salesOrder?.so_number || "N/A",
        customer_name: customer?.customer_name || "Unknown",
        status: report.work_order.status,
      }
    })

    console.log("[v0] Fetched", transformedData.length, "reports")
    return NextResponse.json(transformedData)
  } catch (error) {
    console.error("[v0] Error in reports GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

async function checkCEOAccess(): Promise<{ isCEO: boolean; userId?: string; error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { isCEO: false, error: "Unauthorized" }
    }
    
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single()
    
    if (userData?.role !== "ceo") {
      return { isCEO: false, error: "Forbidden" }
    }
    
    return { isCEO: true, userId: user.id }
  } catch (error) {
    return { isCEO: false, error: "Authentication error" }
  }
}

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    console.log("[v0] Creating maintenance report for work order:", body.work_order_id)
    console.log("[v0] Report body:", body)
    
    const { data, error } = await adminClient
      .from("maintenance_reports")
      .insert({
        work_order_id: body.work_order_id,
        report_type: "completion",
        summary: body.findings || body.work_performed || body.summary || "Maintenance completed",
        findings: body.findings || null,
        actions_taken: body.equipment_needed || body.actions_taken || null,
        actual_hours: body.labor_hours || body.actual_hours || 0,
        actual_cost: body.total_cost || body.actual_cost || 0,
        parts_used: body.materials && body.materials.length > 0 
          ? body.materials 
          : body.equipment_needed ? [{
              type: "outsourced",
              productName: body.equipment_needed,
              unitCost: body.equipment_cost || 0,
              quantity: 1,
              totalCost: body.equipment_cost || 0,
            }] : null,
        follow_up_required: body.is_settled === false,
        follow_up_notes: body.equipment_needed || null,
        uploaded_pdf_url: body.uploaded_pdf_url || null,
        submitted_at: new Date().toISOString(),
      })
      .select(`
        *,
        work_order:maintenance_work_orders!inner(
          work_order_id,
          work_order_number,
          customer_id
        )
      `)
      .single()
    
    if (error) {
      console.error("[v0] Error creating maintenance report:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    console.log("[v0] ✅ Maintenance report created successfully - awaiting sales approval")
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create report API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
