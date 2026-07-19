import { createServerClient, createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Helper function to check if user is CEO
async function checkCEOAccess(): Promise<{ isCEO: boolean; error?: string }> {
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
      return { isCEO: false, error: "Forbidden - Only CEO can access compensation data" }
    }
    
    return { isCEO: true }
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
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 })
    }
    
    const { data, error} = await adminClient
      .from("employee_compensation")
      .select(`
        *,
        employee:hr_employees(employee_id, full_name, employee_number)
      `)
      .eq("employee_id", parseInt(employee_id))
      .order("effective_date", { ascending: false })
    
    if (error) {
      console.error("[v0] Error fetching compensation:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in compensation API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // Check CEO access
    const { isCEO, error: accessError } = await checkCEOAccess()
    if (!isCEO) {
      return NextResponse.json({ error: accessError }, { status: accessError?.includes("Forbidden") ? 403 : 401 })
    }
    
    const adminClient = createAdminClient()
    const body = await request.json()
    
    
    // Deactivate previous active compensation records for this employee
    const { error: deactivateError } = await adminClient
      .from("employee_compensation")
      .update({
        is_active: false,
        end_date: new Date(new Date(body.effective_date).getTime() - 86400000).toISOString().split("T")[0], // day before new effective date
      })
      .eq("employee_id", body.employee_id)
      .eq("is_active", true)
    
    if (deactivateError) {
      console.error("[v0] Error deactivating previous compensation:", deactivateError)
    }
    
    // Create new compensation record
    const { data, error } = await adminClient
      .from("employee_compensation")
      .insert({
        employee_id: body.employee_id,
        effective_date: body.effective_date,
        base_salary: body.base_salary,
        housing_allowance: body.housing_allowance || 0,
        transportation_allowance: body.transportation_allowance || 0,
        meal_allowance: body.meal_allowance || 0,
        other_allowances: body.other_allowances || 0,
        allowances_description: body.allowances_description || null,
        social_insurance: body.social_insurance || 0,
        income_tax: body.income_tax || 0,
        other_deductions: body.other_deductions || 0,
        deductions_description: body.deductions_description || null,
        payment_frequency: body.payment_frequency || "monthly",
        payment_method: body.payment_method || null,
        bank_name: body.bank_name || null,
        bank_account_number: body.bank_account_number || null,
        change_reason: body.change_reason || null,
        notes: body.notes || null,
        is_active: true,
      })
      .select(`
        *,
        employee:hr_employees(employee_id, full_name, employee_number)
      `)
      .single()
    
    if (error) {
      console.error("[v0] Error creating compensation:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create compensation API:", error)
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
    const { compensation_id, ...updates } = body
    
    if (!compensation_id) {
      return NextResponse.json({ error: "Compensation ID is required" }, { status: 400 })
    }
    
    
    const { data, error } = await adminClient
      .from("employee_compensation")
      .update(updates)
      .eq("compensation_id", compensation_id)
      .select(`
        *,
        employee:hr_employees(employee_id, full_name, employee_number)
      `)
      .single()
    
    if (error) {
      console.error("[v0] Error updating compensation:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in update compensation API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
