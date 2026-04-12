import { type NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] QR Upload: Starting")
    const formData = await request.formData()
    const file = formData.get("file") as File
    const soId = formData.get("soId") as string
    const userId = formData.get("userId") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!soId) {
      return NextResponse.json({ error: "Sales Order ID is required" }, { status: 400 })
    }

    console.log("[v0] QR Upload: File:", file.name, "SO ID:", soId)

    const blob = await put(`quotation-requests/${soId}/${Date.now()}-${file.name}`, file, {
      access: "public",
    })

    console.log("[v0] QR Upload: File uploaded to Blob:", blob.url)

    const supabase = createAdminClient()

    const { data: qrData, error: qrError } = await supabase.rpc("generate_qr_number")

    if (qrError) {
      console.error("[v0] QR Upload: Error generating QR number:", qrError)
      return NextResponse.json({ error: "Failed to generate QR number" }, { status: 500 })
    }

    const qrNumber = qrData as string
    console.log("[v0] QR Upload: Generated QR number:", qrNumber)

    const { data: soUpdate, error: soError } = await withRetry(() =>
      supabase
        .from("sales_orders")
        .update({
          quotation_request_number: qrNumber,
          quotation_request_file_path: blob.url,
          quotation_request_file_name: file.name,
          quotation_request_mime_type: file.type,
          quotation_request_uploaded_at: new Date().toISOString(),
          quotation_request_uploaded_by: userId || null,
        })
        .eq("so_id", Number.parseInt(soId))
        .select()
        .single(),
    )

    if (soError) {
      console.error("[v0] QR Upload: Error updating SO:", soError)
      return NextResponse.json({ error: soError.message }, { status: 500 })
    }

    console.log("[v0] QR Upload: SO updated successfully")

    await withRetry(() =>
      supabase.from("workflow_events").insert({
        entity_type: "SALES_ORDER",
        entity_id: Number.parseInt(soId),
        event_type: "QUOTATION_REQUEST_UPLOADED",
        new_value: blob.url,
        performed_by: userId ? Number.parseInt(userId) : null,
        notes: `Quotation request uploaded: ${file.name} (${qrNumber})`,
      }),
    )

    return NextResponse.json({
      qrNumber,
      url: blob.url,
      fileName: file.name,
      message: "Quotation request uploaded successfully",
    })
  } catch (error) {
    console.error("[v0] QR Upload: Error:", error)
    return NextResponse.json({ error: "Failed to upload quotation request" }, { status: 500 })
  }
}
