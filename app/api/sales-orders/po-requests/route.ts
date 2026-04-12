import { createClient } from "@/lib/supabase/server"
import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET: Fetch PO requests for a sales order
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const soId = searchParams.get("soId")
    const searchQuery = searchParams.get("search")

    let query = supabase
      .from("sales_order_po_requests")
      .select("*")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })

    if (soId) {
      query = query.eq("sales_order_id", Number.parseInt(soId))
    }

    if (searchQuery) {
      query = query.ilike("po_request_number", `%${searchQuery}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] PO Requests fetch error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ poRequests: data || [] })
  } catch (error: any) {
    console.error("[v0] PO Requests GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Upload new PO request
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const formData = await request.formData()

    const soId = formData.get("soId") as string
    const file = formData.get("file") as File
    const note = formData.get("note") as string
    const manualNumber = formData.get("manualNumber") as string | null

    if (!soId || !file) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Generate or use manual PO request number
    let poRequestNumber: string

    if (manualNumber) {
      // Check if manual number already exists
      const { data: existing } = await supabase
        .from("sales_order_po_requests")
        .select("id")
        .eq("po_request_number", manualNumber)
        .is("deleted_at", null)
        .single()

      if (existing) {
        return NextResponse.json({ error: "PO Request Number already exists" }, { status: 409 })
      }
      poRequestNumber = manualNumber
    } else {
      // Auto-generate using RPC
      const { data: generatedNumber, error: rpcError } = await supabase.rpc("generate_po_request_number")

      if (rpcError || !generatedNumber) {
        console.error("[v0] PO Request number generation error:", rpcError)
        return NextResponse.json({ error: "Failed to generate PO Request Number" }, { status: 500 })
      }
      poRequestNumber = generatedNumber
    }

    // Upload file to Vercel Blob
    const blob = await put(`po-requests/${poRequestNumber}-${file.name}`, file, {
      access: "public",
      addRandomSuffix: false,
    })

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Save to database
    const { data: poRequest, error: dbError } = await supabase
      .from("sales_order_po_requests")
      .insert({
        sales_order_id: Number.parseInt(soId),
        po_request_number: poRequestNumber,
        file_url: blob.url,
        file_name: file.name,
        file_type: file.type,
        note: note || null,
        uploaded_by: user?.id || null,
      })
      .select()
      .single()

    if (dbError) {
      console.error("[v0] PO Request DB insert error:", dbError)
      return NextResponse.json({ error: dbError.message }, { status: 400 })
    }

    return NextResponse.json({ poRequest, message: "PO Request uploaded successfully" })
  } catch (error: any) {
    console.error("[v0] PO Request POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Soft delete PO request
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = request.nextUrl
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Missing PO Request ID" }, { status: 400 })
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase
      .from("sales_order_po_requests")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq("id", id)

    if (error) {
      console.error("[v0] PO Request soft delete error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ message: "PO Request deleted successfully" })
  } catch (error: any) {
    console.error("[v0] PO Request DELETE error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
