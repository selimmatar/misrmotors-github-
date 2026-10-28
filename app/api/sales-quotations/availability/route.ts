import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { loadAvailability } from "@/lib/stock-hold"
import { type NextRequest, NextResponse } from "next/server"

// Stock a quotation can use, per product: on hand minus what sales orders and the other waiting quotations hold.
// GET ?product_ids=7,9&quotation_id=12 -> { availability: { "7": 3, "9": 0 } }. quotation_id leaves that
// quotation's own hold out, the same rule conversion uses, so "N missing" on screen matches what conversion says.
export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams
    const productIds = (params.get("product_ids") || "")
      .split(",")
      .map((s) => parsePositiveId(s.trim()))
      .filter((id): id is number => id !== null)
    const rawQuotation = params.get("quotation_id")
    const quotationId = rawQuotation ? parsePositiveId(rawQuotation) : null
    if (rawQuotation && quotationId === null) {
      return NextResponse.json({ error: "Invalid quotation_id" }, { status: 400 })
    }
    const availability = await loadAvailability(createAdminClient(), productIds, quotationId ? { excludeQuotationId: quotationId } : {})
    return NextResponse.json({ availability: Object.fromEntries([...availability].map(([id, a]) => [String(id), a.available])) })
  } catch (error) {
    console.error("Error loading quotation availability:", error)
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 })
  }
}
