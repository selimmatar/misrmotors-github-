import { createServerClient } from "@/lib/supabase/server"
import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const formData = await request.formData()

    const salesQuotationId = formData.get("sales_quotation_id") as string
    const supplierName = formData.get("supplier_name") as string
    const supplierId = formData.get("supplier_id") as string | null
    const currency = (formData.get("currency") as string) || "EGP"
    const file = formData.get("file") as File

    if (!salesQuotationId || !supplierName || !file) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Upload to Vercel Blob
    const blob = await put(`supplier-quotes/${Date.now()}-${file.name}`, file, {
      access: "public",
    })

    // Store upload record
    const { data: upload, error: uploadError } = await supabase
      .from("supplier_quote_uploads")
      .insert({
        sales_quotation_id: Number.parseInt(salesQuotationId),
        supplier_id: supplierId ? Number.parseInt(supplierId) : null,
        supplier_name_raw: supplierName,
        file_url: blob.url,
        file_name: file.name,
        currency,
        status: "uploaded",
        created_by: "current_user", // TODO: Get from auth
      })
      .select()
      .single()

    if (uploadError) {
      console.error("[v0] Upload record error:", uploadError)
      return NextResponse.json({ error: "Failed to create upload record" }, { status: 500 })
    }

    return NextResponse.json({ upload }, { status: 201 })
  } catch (error) {
    console.error("[v0] Supplier quote upload error:", error)
    return NextResponse.json({ error: "Failed to upload supplier quote" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { searchParams } = new URL(request.url)
    const salesQuotationId = searchParams.get("sales_quotation_id")

    if (!salesQuotationId) {
      return NextResponse.json({ error: "Missing sales_quotation_id" }, { status: 400 })
    }

    const { data: uploads, error } = await supabase
      .from("supplier_quote_uploads")
      .select("*")
      .eq("sales_quotation_id", salesQuotationId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] Fetch uploads error:", error)
      return NextResponse.json({ error: "Failed to fetch uploads" }, { status: 500 })
    }

    return NextResponse.json({ uploads })
  } catch (error) {
    console.error("[v0] Supplier quote GET error:", error)
    return NextResponse.json({ error: "Failed to fetch supplier quotes" }, { status: 500 })
  }
}
