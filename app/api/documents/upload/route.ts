import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { checkUpload } from "@/lib/upload-allowlist"

// Stores a quotation's approval document in Vercel Blob (like every other upload in the app) and returns its URL.
// The caller passes that URL to POST /api/sales-quotations/approve, which saves it on the new sales order.
// Nothing is written to the database here: quotation_id is a sales_quotations id, not a sales order id.
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const quotationId = formData.get("quotation_id") as string
    const documentType = formData.get("document_type") as string || "approval"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const rejection = checkUpload(file)
    if (rejection) return NextResponse.json({ error: rejection.error }, { status: rejection.status })

    const folder = documentType.replace(/[^a-zA-Z0-9_-]/g, "_") || "approval"
    const owner = (quotationId || "general").replace(/[^a-zA-Z0-9_-]/g, "_")
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_")
    const filename = `${folder}-documents/${owner}/${Date.now()}-${safeName}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const blob = await put(filename, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type || undefined,
    })

    return NextResponse.json({
      success: true,
      url: blob.url,
      filename,
    })
  } catch (error) {
    console.error("Error uploading document:", error)
    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 })
  }
}
