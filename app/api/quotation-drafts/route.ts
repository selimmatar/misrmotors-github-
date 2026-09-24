import { createServerClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// List every saved in-progress quotation draft for a user (most recently updated first).
export async function GET(request: NextRequest) {
  try {
    const ownerKey = request.nextUrl.searchParams.get("owner_key")
    if (!ownerKey) {
      return NextResponse.json({ error: "owner_key is required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from("quotation_drafts")
      .select("id, form_data, updated_at")
      .eq("owner_key", ownerKey)
      .order("updated_at", { ascending: false })

    if (error) {
      console.error("Fetch quotation drafts error:", error)
      return NextResponse.json({ error: "Failed to fetch drafts" }, { status: 500 })
    }

    return NextResponse.json({ drafts: data ?? [] })
  } catch (error) {
    console.error("Fetch quotation drafts error:", error)
    return NextResponse.json({ error: "Failed to fetch drafts" }, { status: 500 })
  }
}

// Create a new draft, or update an existing one when `id` is provided.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, owner_key, form_data } = body

    if (!owner_key) {
      return NextResponse.json({ error: "owner_key is required" }, { status: 400 })
    }

    const supabase = await createServerClient()

    if (id) {
      const { error } = await supabase
        .from("quotation_drafts")
        .update({ form_data, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("owner_key", owner_key)

      if (error) {
        console.error("Update quotation draft error:", error)
        return NextResponse.json({ error: "Failed to save draft" }, { status: 500 })
      }

      return NextResponse.json({ id })
    }

    const { data, error } = await supabase
      .from("quotation_drafts")
      .insert({ owner_key, form_data, updated_at: new Date().toISOString() })
      .select("id")
      .single()

    if (error) {
      console.error("Create quotation draft error:", error)
      return NextResponse.json({ error: "Failed to save draft" }, { status: 500 })
    }

    return NextResponse.json({ id: data.id })
  } catch (error) {
    console.error("Save quotation draft error:", error)
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 })
  }
}

// Discard a single saved draft (called once its quotation is finalized or explicitly discarded).
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { error } = await supabase.from("quotation_drafts").delete().eq("id", id)

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
