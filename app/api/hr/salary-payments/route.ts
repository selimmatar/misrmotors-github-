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
      return { isCEO: false, error: "Forbidden - Only CEO can manage salary payments" }
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
    
    const employee_id = searchParams.get("employee_id")
    
    if (!employee_id) {
      return NextResponse.json({ error: "employee_id is required" }, { status: 400 })
    }
    
    const { data, error } = await adminClient
      .from("salary_payments")
      .select("*")
      .eq("employee_id", parseInt(employee_id))
      .order("payment_date", { ascending: false })
    
    if (error) {
      console.error("[v0] Error fetching salary payments:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in salary payments API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // Check CEO access
    const { isCEO, userId, error: accessError } = await checkCEOAccess()
    if (!isCEO) {
      return NextResponse.json({ error: accessError }, { status: accessError?.includes("Forbidden") ? 403 : 401 })
    }
    
    const adminClient = createAdminClient()
    const body = await request.json()
    
    
    const { data, error } = await adminClient
      .from("salary_payments")
      .insert({
        employee_id: body.employee_id,
        compensation_id: body.compensation_id || null,
        pay_period_start: body.pay_period_start,
        pay_period_end: body.pay_period_end,
        payment_date: body.payment_date,
        base_salary: body.base_salary || 0,
        total_allowances: body.total_allowances || 0,
        total_deductions: body.total_deductions || 0,
        gross_amount: body.gross_amount || 0,
        net_amount: body.net_amount || 0,
        bonus_amount: body.bonus_amount || 0,
        bonus_description: body.bonus_description || null,
        overtime_hours: body.overtime_hours || 0,
        overtime_amount: body.overtime_amount || 0,
        adjustments: body.adjustments || 0,
        adjustment_notes: body.adjustment_notes || null,
        payment_method: body.payment_method || null,
        payment_status: body.payment_status || "pending",
        notes: body.notes || null,
        processed_by: userId,
        processed_at: new Date().toISOString(),
      })
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error creating salary payment:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create salary payment API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    // Check CEO access
    const { isCEO, error: accessError } = await checkCEOAccess()
    if (!isCEO) {
      return NextResponse.json({ error: accessError }, { status: accessError?.includes("Forbidden") ? 403 : 401 })
    }
    
    const adminClient = createAdminClient()
    const body = await request.json()
    const { payment_id, ...updates } = body
    
    if (!payment_id) {
      return NextResponse.json({ error: "payment_id is required" }, { status: 400 })
    }
    
    
    const { data, error } = await adminClient
      .from("salary_payments")
      .update(updates)
      .eq("payment_id", payment_id)
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error updating salary payment:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in update salary payment API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
