import { type NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { checkUpload } from "@/lib/upload-allowlist"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const permitId = formData.get("permitId") as string
    const userId = formData.get("userId") as string
    const notes = formData.get("notes") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!permitId) {
      return NextResponse.json({ error: "Permit ID is required" }, { status: 400 })
    }

    const rejection = checkUpload(file)
    if (rejection) return NextResponse.json({ error: rejection.error }, { status: rejection.status })

    // Upload to Vercel Blob
    const blob = await put(`delivery-permits/${permitId}/${Date.now()}-${file.name}`, file, {
      access: "public",
    })

    // Save file reference to database
    const supabase = createAdminClient()
    const { data: fileRecord, error } = await withRetry(() =>
      supabase
        .from("delivery_permit_files")
        .insert({
          permit_id: Number.parseInt(permitId),
          file_type: "SIGNED_PERMIT",
          file_url: blob.url,
          file_name: file.name,
          uploaded_by: userId ? Number.parseInt(userId) : null,
          notes: notes || null,
        })
        .select()
        .single(),
    )

    if (error) {
      console.error("File record save error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log workflow event
    await withRetry(() =>
      supabase.from("workflow_events").insert({
        entity_type: "DELIVERY_PERMIT",
        entity_id: Number.parseInt(permitId),
        event_type: "FILE_UPLOADED",
        new_value: blob.url,
        performed_by: userId ? Number.parseInt(userId) : null,
        notes: `Signed permit uploaded: ${file.name}`,
      }),
    )

    return NextResponse.json({
      id: fileRecord.file_id.toString(),
      url: blob.url,
      fileName: file.name,
      message: "File uploaded successfully",
    })
  } catch (error) {
    console.error("Delivery Permit file upload error:", error)
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
  }
}
