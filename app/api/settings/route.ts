import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const key = searchParams.get("key")

    if (!key) {
      return NextResponse.json({ error: "Setting key is required" }, { status: 400 })
    }

    const { data, error } = await supabase.from("company_settings").select("*").eq("setting_key", key).single()

    if (error && error.code !== "PGRST116") {
      throw error
    }

    return NextResponse.json(data || { key, value: null })
  } catch (error) {
    console.error("Error fetching setting:", error)
    return NextResponse.json({ error: "Failed to fetch setting" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { key, value, userId } = body

    if (!key || value === undefined) {
      return NextResponse.json({ error: "Key and value are required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("company_settings")
      .upsert({
        setting_key: key,
        setting_value: value,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error updating setting:", error)
    return NextResponse.json({ error: error.message || "Failed to update setting" }, { status: 500 })
  }
}
