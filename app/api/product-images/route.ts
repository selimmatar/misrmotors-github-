import { put, del } from "@vercel/blob"
import { getAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { checkUpload } from "@/lib/upload-allowlist"

export const dynamic = "force-dynamic"

// GET - Fetch images for a product
export async function GET(request: NextRequest) {
  try {
    // Created inside the handler (not at module scope) so this file can be
    // imported during `next build`'s page-data collection without requiring
    // the Supabase env vars to be present at build time.
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get("productId")

    let query = supabase.from("product_images").select("*").order("created_at", { ascending: false })

    if (productId) {
      query = query.eq("product_id", productId)
    }

    const { data, error } = await query

    if (error) {
      console.error("Error fetching product images:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Error in GET product-images:", error)
    return NextResponse.json({ error: "Failed to fetch product images" }, { status: 500 })
  }
}

// POST - Upload a new product image
export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient()
    const formData = await request.formData()
    const file = formData.get("file") as File
    const productId = formData.get("productId") as string
    const uploadedBy = formData.get("uploadedBy") as string
    const poId = formData.get("poId") as string
    const poNumber = formData.get("poNumber") as string
    const notes = formData.get("notes") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!productId) {
      return NextResponse.json({ error: "Product ID is required" }, { status: 400 })
    }

    const rejection = checkUpload(file)
    if (rejection) return NextResponse.json({ error: rejection.error }, { status: rejection.status })

    // Generate unique filename with product info
    const timestamp = Date.now()
    const extension = file.name.split(".").pop()
    const filename = `product-${productId}-${timestamp}.${extension}`

    // Upload to Vercel Blob
    const blob = await put(filename, file, {
      access: "public",
    })

    // Save to database
    const { data, error } = await supabase
      .from("product_images")
      .insert({
        product_id: Number.parseInt(productId),
        image_url: blob.url,
        uploaded_by: uploadedBy ? Number.parseInt(uploadedBy) : null,
        po_id: poId ? Number.parseInt(poId) : null,
        po_number: poNumber || null,
        notes: notes || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error saving product image:", error)
      // Try to delete the uploaded blob if database insert fails
      try {
        await del(blob.url)
      } catch (delError) {
        console.error("Error deleting blob after failed insert:", delError)
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ...data,
      url: blob.url,
      filename: file.name,
      size: file.size,
      type: file.type,
    })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}

// DELETE - Remove a product image
export async function DELETE(request: NextRequest) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const imageId = searchParams.get("imageId")

    if (!imageId) {
      return NextResponse.json({ error: "Image ID is required" }, { status: 400 })
    }

    // First get the image URL to delete from Blob storage
    const { data: image, error: fetchError } = await supabase
      .from("product_images")
      .select("image_url")
      .eq("image_id", imageId)
      .single()

    if (fetchError) {
      console.error("Error fetching image:", fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    // Delete from Blob storage
    if (image?.image_url) {
      try {
        await del(image.image_url)
      } catch (delError) {
        console.error("Error deleting blob:", delError)
        // Continue with database deletion even if blob deletion fails
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase.from("product_images").delete().eq("image_id", imageId)

    if (deleteError) {
      console.error("Error deleting image record:", deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete error:", error)
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
