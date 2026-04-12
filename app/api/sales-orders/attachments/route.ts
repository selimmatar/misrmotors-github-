import { type NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// GET - Fetch attachments for a sales order
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const soId = searchParams.get("so_id") || searchParams.get("soId")

    if (!soId) {
      return NextResponse.json({ error: "Sales Order ID is required" }, { status: 400 })
    }

    console.log("[v0] SO Attachments GET: Fetching for SO ID:", soId)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("sales_order_attachments")
      .select("*")
      .eq("sales_order_id", Number.parseInt(soId))
      .is("deleted_at", null) // Only fetch non-deleted attachments
      .order("uploaded_at", { ascending: false })

    if (error) {
      console.error("[v0] SO Attachments GET: Error", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] SO Attachments GET: Found", data?.length || 0, "attachments")
    return NextResponse.json(data || [])
  } catch (error: any) {
    console.error("[v0] SO Attachments GET: Error", error)
    return NextResponse.json({ error: "Failed to fetch attachments" }, { status: 500 })
  }
}

// POST - Upload new attachment
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const soId = formData.get("soId") as string
    const userId = formData.get("userId") as string
    const note = formData.get("note") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!soId) {
      return NextResponse.json({ error: "Sales Order ID is required" }, { status: 400 })
    }

    console.log("[v0] SO Attachments POST: Uploading file:", file.name, "for SO:", soId)

    // Upload to Vercel Blob
    const blob = await put(`so-attachments/${soId}/${Date.now()}-${file.name}`, file, {
      access: "public",
    })

    console.log("[v0] SO Attachments POST: File uploaded to Blob:", blob.url)

    // Store metadata in database
    const supabase = createAdminClient()
    const fileType = file.type.split("/")[1] || "pdf"

    const { data: attachment, error: dbError } = await supabase
      .from("sales_order_attachments")
      .insert({
        sales_order_id: Number.parseInt(soId),
        file_url: blob.url,
        file_name: file.name,
        file_type: fileType,
        uploaded_by: userId ? Number.parseInt(userId) : null,
        note: note || null,
      })
      .select()
      .single()

    if (dbError) {
      console.error("[v0] SO Attachments POST: Database error:", dbError)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    console.log("[v0] SO Attachments POST: Attachment saved to database")

    // Log workflow event
    await supabase.from("workflow_events").insert({
      entity_type: "SALES_ORDER",
      entity_id: Number.parseInt(soId),
      event_type: "PO_REQUEST_UPLOADED",
      new_value: blob.url,
      performed_by: userId ? Number.parseInt(userId) : null,
      notes: `PO Request uploaded: ${file.name}`,
    })

    return NextResponse.json({
      ...attachment,
      message: "PO Request uploaded successfully",
    })
  } catch (error: any) {
    console.error("[v0] SO Attachments POST: Error:", error)
    return NextResponse.json({ error: "Failed to upload attachment" }, { status: 500 })
  }
}

// DELETE - Soft delete attachment
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const attachmentId = searchParams.get("id")
    const userId = searchParams.get("userId")

    if (!attachmentId) {
      return NextResponse.json({ error: "Attachment ID is required" }, { status: 400 })
    }

    console.log("[v0] SO Attachments DELETE: Soft deleting attachment:", attachmentId)

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("sales_order_attachments")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId ? Number.parseInt(userId) : null,
      })
      .eq("id", attachmentId)

    if (error) {
      console.error("[v0] SO Attachments DELETE: Error", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] SO Attachments DELETE: Attachment soft deleted")
    return NextResponse.json({ message: "Attachment deleted successfully" })
  } catch (error: any) {
    console.error("[v0] SO Attachments DELETE: Error:", error)
    return NextResponse.json({ error: "Failed to delete attachment" }, { status: 500 })
  }
}
