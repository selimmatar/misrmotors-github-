import { createServerClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Fetch the saved in-progress quotation draft for a user, if any.
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("user_id")
    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from("quotation_drafts")
      .select("form_data, updated_at")
      .eq("user_id", userId)
      .maybeSingle()

    if (error) {
      console.error("Fetch quotation draft error:", error)
      return NextResponse.json({ error: "Failed to fetch draft" }, { status: 500 })
    }

    return NextResponse.json({ draft: data ?? null })
  } catch (error) {
    console.error("Fetch quotation draft error:", error)
    return NextResponse.json({ error: "Failed to fetch draft" }, { status: 500 })
  }
}

// Save (upsert) the in-progress quotation draft for a user.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { user_id, form_data } = body

    if (!user_id) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { error } = await supabase.from("quotation_drafts").upsert({
      user_id,
      form_data,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error("Save quotation draft error:", error)
      return NextResponse.json({ error: "Failed to save draft" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Save quotation draft error:", error)
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 })
  }
}

// Discard the saved draft for a user (called once the quotation is finalized or explicitly discarded).
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("user_id")
    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { error } = await supabase.from("quotation_drafts").delete().eq("user_id", userId)

    if (error) {
      console.error("Delete quotation draft error:", error)
      return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete quotation draft error:", error)
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 })
  }
}
