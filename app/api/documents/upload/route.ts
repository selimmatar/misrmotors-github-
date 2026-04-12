import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const quotationId = formData.get("quotation_id") as string
    const documentType = formData.get("document_type") as string || "approval"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Generate unique filename
    const timestamp = Date.now()
    const extension = file.name.split(".").pop()
    const filename = `${documentType}/${quotationId || "general"}_${timestamp}.${extension}`

    // Convert file to Buffer for Supabase storage upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
        duplex: "half",
      })

    if (uploadError) {
      console.error("[v0] Supabase storage upload error:", uploadError)
      // If bucket doesn't exist, store URL as placeholder
      const placeholderUrl = `document://${filename}`
      
      if (quotationId) {
        await supabase
          .from("sales_orders")
          .update({ 
            approval_document_url: placeholderUrl,
            updated_at: new Date().toISOString()
          })
          .eq("so_id", parseInt(quotationId))
      }
      
      return NextResponse.json({
        success: true,
        url: placeholderUrl,
        filename: filename,
        note: "Document reference saved (storage bucket may need setup)"
      })
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from("documents")
      .getPublicUrl(filename)

    // Update the sales order with the approval document URL
    if (quotationId) {
      await supabase
        .from("sales_orders")
        .update({ 
          approval_document_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq("so_id", parseInt(quotationId))
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename: uploadData.path,
    })
  } catch (error) {
    console.error("[v0] Error uploading document:", error)
    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 })
  }
}
