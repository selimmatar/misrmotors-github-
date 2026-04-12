import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const adminClient = createAdminClient()
  
  try {
    const { data, error } = await adminClient
      .from("product_categories")
      .select("*")
      .order("category_name")
    
    if (error) throw error
    
    return NextResponse.json(data || [])
  } catch (error: any) {
    console.error("Error fetching categories:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const adminClient = createAdminClient()
  
  try {
    const body = await request.json()
    const { categoryName } = body
    
    if (!categoryName || !categoryName.trim()) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 })
    }
    
    // Check if category already exists
    const { data: existing } = await adminClient
      .from("product_categories")
      .select("category_id")
      .ilike("category_name", categoryName.trim())
      .single()
    
    if (existing) {
      return NextResponse.json({ error: "Category already exists" }, { status: 409 })
    }
    
    const { data, error } = await adminClient
      .from("product_categories")
      .insert({ category_name: categoryName.trim() })
      .select()
      .single()
    
    if (error) throw error
    
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error creating category:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
