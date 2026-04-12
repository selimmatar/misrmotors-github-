import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const adminClient = createAdminClient()
    
    const { data, error } = await adminClient
      .from("departments")
      .select("*")
      .eq("is_active", true)
      .order("department_name")
    
    if (error) {
      console.error("[v0] Error fetching departments:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in departments API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    console.log("[v0] Creating department:", body)
    
    const { data, error } = await adminClient
      .from("departments")
      .insert({
        department_name: body.department_name,
        department_code: body.department_code,
        manager_id: body.manager_id || null,
        description: body.description || null,
        is_active: true,
      })
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error creating department:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    console.log("[v0] Department created successfully:", data)
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create department API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
