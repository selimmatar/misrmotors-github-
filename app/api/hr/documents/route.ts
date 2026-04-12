import { createServerClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { searchParams } = new URL(request.url)
    
    const employee_id = searchParams.get("employee_id")
    
    if (!employee_id) {
      return NextResponse.json({ error: "employee_id is required" }, { status: 400 })
    }
    
    const { data, error } = await supabase
      .from("employee_documents")
      .select("*")
      .eq("employee_id", parseInt(employee_id))
      .order("uploaded_at", { ascending: false })
    
    if (error) {
      console.error("[v0] Error fetching documents:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error in documents API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    
    const body = await request.json()
    
    const { data, error } = await supabase
      .from("employee_documents")
      .insert({
        employee_id: body.employee_id,
        document_type: body.document_type,
        document_name: body.document_name,
        file_url: body.file_url,
        file_size_kb: body.file_size_kb || null,
        mime_type: body.mime_type || null,
        document_date: body.document_date || null,
        expiry_date: body.expiry_date || null,
        description: body.description || null,
        is_confidential: true,
        uploaded_by: user.id,
      })
      .select()
      .single()
    
    if (error) {
      console.error("[v0] Error creating document:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in create document API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
