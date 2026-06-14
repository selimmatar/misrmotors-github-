import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const adminClient = createAdminClient()
    const { searchParams } = new URL(request.url)
    
    const status = searchParams.get("status")
    const department_id = searchParams.get("department_id")
    const position_id = searchParams.get("position_id")
    
    // Build query
    let query = adminClient
      .from("hr_employees")
      .select(`
        *,
        department:departments(department_id, department_name, department_code),
        position:job_positions(position_id, position_title, position_code)
      `)
      .order("created_at", { ascending: false })
    
    // Apply filters
    if (status) {
      query = query.eq("employment_status", status)
    }
    if (department_id) {
      query = query.eq("department_id", parseInt(department_id))
    }
    if (position_id) {
      query = query.eq("position_id", parseInt(position_id))
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error("[v0] Error fetching employees:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in employees API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    console.log("[v0] Creating employee:", body.full_name)
    
    // Generate employee number
    const { data: employeeNumberData, error: employeeNumberError } = await adminClient
      .rpc("generate_employee_number")
    
    if (employeeNumberError) {
      console.error("[v0] Error generating employee number:", employeeNumberError)
      return NextResponse.json({ error: "Failed to generate employee number" }, { status: 500 })
    }
    
    // If email provided, check it isn't already taken
    if (body.email) {
      const { data: existing } = await adminClient
        .from("hr_employees")
        .select("employee_id, full_name")
        .eq("email", body.email)
        .maybeSingle()

      if (existing) {
        return NextResponse.json(
          { error: `This email is already used by employee "${existing.full_name}". Please use a different email or leave it blank.` },
          { status: 409 }
        )
      }
    }

    // Create employee
    const { data, error } = await adminClient
      .from("hr_employees")
      .insert({
        employee_number: employeeNumberData,
        full_name: body.full_name,
        national_id: body.national_id || null,
        email: body.email,
        phone: body.phone || null,
        date_of_birth: body.date_of_birth || null,
        gender: body.gender || null,
        department_id: body.department_id || null,
        position_id: body.position_id || null,
        manager_id: body.manager_id || null,
        hire_date: body.hire_date,
        employment_status: body.employment_status || "active",
        employment_type: body.employment_type || "full_time",
        probation_end_date: body.probation_end_date || null,
        address: body.address || null,
        city: body.city || null,
        emergency_contact_name: body.emergency_contact_name || null,
        emergency_contact_phone: body.emergency_contact_phone || null,
        emergency_contact_relationship: body.emergency_contact_relationship || null,
        user_id: body.user_id || null,
      })
      .select(`
        *,
        department:departments(department_id, department_name),
        position:job_positions(position_id, position_title)
      `)
      .single()
    
    if (error) {
      console.error("[v0] Error creating employee:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create employee API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    const { employee_id, ...updates } = body
    
    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 })
    }
    
    console.log("[v0] Updating employee:", employee_id)
    
    // Add updated_at timestamp
    updates.updated_at = new Date().toISOString()
    
    const { data, error } = await adminClient
      .from("hr_employees")
      .update(updates)
      .eq("employee_id", employee_id)
      .select(`
        *,
        department:departments(department_id, department_name),
        position:job_positions(position_id, position_title)
      `)
      .single()
    
    if (error) {
      console.error("[v0] Error updating employee:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in update employee API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    const { employee_id, termination_reason } = body
    
    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 })
    }
    
    console.log("[v0] Terminating employee:", employee_id)
    
    // Soft delete: Update status to terminated
    const { data, error } = await adminClient
      .from("hr_employees")
      .update({
        employment_status: "terminated",
        termination_date: new Date().toISOString().split("T")[0],
        termination_reason: termination_reason || "Not specified",
        updated_at: new Date().toISOString(),
      })
      .eq("employee_id", employee_id)
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error terminating employee:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, message: "Employee terminated successfully", data })
  } catch (error) {
    console.error("[v0] Error in terminate employee API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
