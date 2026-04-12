import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    console.log("[v0] QR Download: SO ID:", id)

    const supabase = createAdminClient()
    const { data: so, error } = await withRetry(() =>
      supabase
        .from("sales_orders")
        .select("quotation_request_file_path, quotation_request_file_name, quotation_request_mime_type")
        .eq("so_id", Number.parseInt(id))
        .single(),
    )

    if (error || !so) {
      console.error("[v0] QR Download: SO not found:", error)
      return NextResponse.json({ error: "Sales order not found" }, { status: 404 })
    }

    if (!so.quotation_request_file_path) {
      console.error("[v0] QR Download: No QR file for SO:", id)
      return NextResponse.json({ error: "No quotation request file found" }, { status: 404 })
    }

    console.log("[v0] QR Download: Redirecting to:", so.quotation_request_file_path)

    return NextResponse.redirect(so.quotation_request_file_path)
  } catch (error) {
    console.error("[v0] QR Download: Error:", error)
    return NextResponse.json({ error: "Failed to download quotation request" }, { status: 500 })
  }
}
