import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { actorUserId } from "@/lib/auth/actor"
import { setLoginActive } from "@/lib/auth/login-switch"
import { cleanEmployeeUpdate, deleteBlocker, isInactiveStatus, statusDates } from "@/lib/hr/employee-rules"

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
      console.error("Error fetching employees:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Error in employees API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    
    // Generate employee number
    const { data: employeeNumberData, error: employeeNumberError } = await adminClient
      .rpc("generate_employee_number")
    
    if (employeeNumberError) {
      console.error("Error generating employee number:", employeeNumberError)
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
      console.error("Error creating employee:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error in create employee API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Edit an employee. Only the form's fields are saved. Moving into Suspended / Terminated / Resigned also switches off
// any login linked to this employee (owner decision 2026-10-31); coming back does NOT switch the login on again.
export async function PUT(request: Request) {
  try {
    const db: any = createAdminClient()
    const body = await request.json().catch(() => null)
    const employeeId = Number(body?.employee_id)
    if (!Number.isInteger(employeeId) || employeeId < 1) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 })
    }
    const checked = cleanEmployeeUpdate(body)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

    const { data: before } = await db.from("hr_employees").select("*").eq("employee_id", employeeId).maybeSingle()
    if (!before) return NextResponse.json({ error: "Employee not found" }, { status: 404 })

    const updates: Record<string, unknown> = { ...checked.value }
    if (updates.employment_status !== undefined) {
      Object.assign(updates, statusDates(before.employment_status, updates.employment_status, new Date().toISOString().split("T")[0]))
    }
    updates.updated_at = new Date().toISOString()

    const { data, error } = await db
      .from("hr_employees")
      .update(updates)
      .eq("employee_id", employeeId)
      .select(`
        *,
        department:departments(department_id, department_name),
        position:job_positions(position_id, position_title)
      `)
      .single()
    if (error) {
      console.error("Error updating employee:", error)
      const duplicate = error.code === "23505"
      return NextResponse.json(
        { error: duplicate ? "This email or national ID is already used by another employee" : error.message },
        { status: duplicate ? 409 : 500 },
      )
    }

    let loginsTurnedOff = 0
    let loginError: string | null = null
    if (isInactiveStatus(updates.employment_status) && !isInactiveStatus(before.employment_status)) {
      const actor = actorUserId(request)
      const { data: logins } = await db.from("users").select("*").eq("employee_id", employeeId)
      for (const row of logins || []) {
        if (row.is_active === false || (actor !== null && row.user_id === actor)) continue
        const err = await setLoginActive(db, row, false)
        if (err) loginError = err
        else loginsTurnedOff++
      }
    }

    return NextResponse.json({ employee: data, loginsTurnedOff, loginError })
  } catch (error) {
    console.error("Error in update employee API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Delete an employee for good. Only allowed with no salary payments, pay records, documents or linked login;
// otherwise the answer is 409 and they should be made Inactive instead.
export async function DELETE(request: Request) {
  try {
    const db: any = createAdminClient()
    const body = await request.json().catch(() => null)
    const employeeId = Number(body?.employee_id)
    if (!Number.isInteger(employeeId) || employeeId < 1) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 })
    }
    const { data: emp } = await db.from("hr_employees").select("employee_id").eq("employee_id", employeeId).maybeSingle()
    if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 })

    const count = async (table: string) => {
      const { count: n, error } = await db.from(table).select("employee_id", { count: "exact", head: true }).eq("employee_id", employeeId)
      if (error) throw error
      return n || 0
    }
    const blocker = deleteBlocker({
      salaryPayments: await count("salary_payments"),
      payRecords: await count("employee_compensation"),
      documents: await count("employee_documents"),
      logins: await count("users"),
    })
    if (blocker) return NextResponse.json({ error: blocker, keep: true }, { status: 409 })

    const { error } = await db.from("hr_employees").delete().eq("employee_id", employeeId)
    if (error) {
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "This employee is used elsewhere in the system (for example a shipment or work order). Make them Inactive instead.", keep: true },
          { status: 409 },
        )
      }
      console.error("Error deleting employee:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in delete employee API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
