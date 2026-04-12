import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const adminClient = createAdminClient()
    const { searchParams } = new URL(request.url)
    
    const department_id = searchParams.get("department_id")
    
    let query = adminClient
      .from("job_positions")
      .select(`
        *,
        department:departments(department_id, department_name)
      `)
      .eq("is_active", true)
      .order("position_title")
    
    if (department_id) {
      query = query.eq("department_id", parseInt(department_id))
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error("[v0] Error fetching positions:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in positions API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    console.log("[v0] Creating position:", body)
    
    const { data, error } = await adminClient
      .from("job_positions")
      .insert({
        position_title: body.position_title,
        position_code: body.position_code,
        department_id: body.department_id || null,
        grade_level: body.grade_level || null,
        salary_range_min: body.salary_range_min || null,
        salary_range_max: body.salary_range_max || null,
        description: body.description || null,
        requirements: body.requirements || null,
        responsibilities: body.responsibilities || null,
        is_active: true,
      })
      .select(`
        *,
        department:departments(department_id, department_name)
      `)
      .single()
    
    if (error) {
      console.error("[v0] Error creating position:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create position API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
