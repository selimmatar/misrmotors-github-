import { getAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// In-memory cache for rate-limit protection
let cachedLostSales: any[] | null = null
let cacheTimestamp = 0
const CACHE_DURATION_MS = 60000 // 1 minute cache

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const view = searchParams.get("view")

    // Check cache first
    const now = Date.now()
    if (
      cachedLostSales !== null &&
      now - cacheTimestamp < CACHE_DURATION_MS &&
      !status &&
      !startDate &&
      !endDate &&
      !view
    ) {
      console.log("[v0] Lost Sales GET: Returning cached data")
      return NextResponse.json(cachedLostSales, {
        headers: { ...corsHeaders, "X-Cache": "HIT" },
      })
    }

    let data: any[] | null = null
    let error: any = null

    try {
      const supabase = getAdminClient()
      let query

      if (view === "summary") {
        query = supabase.from("report_lost_sales_summary").select("*")
        if (startDate) query = query.gte("request_date", startDate)
        if (endDate) query = query.lte("request_date", endDate)
      } else if (view === "top-items") {
        query = supabase.from("report_top_lost_items").select("*")
        if (startDate) query = query.gte("first_request_date", startDate)
        if (endDate) query = query.lte("last_request_date", endDate)
        query = query.limit(50)
      } else {
        query = supabase.from("lost_sales").select("*").order("request_date", { ascending: false })
        if (status) query = query.eq("status", status)
        if (startDate) query = query.gte("request_date", startDate)
        if (endDate) query = query.lte("request_date", endDate)
      }

      const result = await query
      data = result.data
      error = result.error
    } catch (supabaseError: any) {
      const errorMessage = supabaseError?.message || String(supabaseError)
      console.error("[v0] Lost Sales GET: Supabase exception:", errorMessage)

      if (errorMessage.includes("Too") || errorMessage.includes("rate") || errorMessage.includes("429")) {
        if (cachedLostSales !== null) {
          console.log("[v0] Lost Sales GET: Rate limited, returning stale cache")
          return NextResponse.json(cachedLostSales, {
            headers: { ...corsHeaders, "X-Cache": "STALE", "X-Rate-Limited": "true" },
          })
        }
        return NextResponse.json(
          { error: "Service temporarily unavailable" },
          { status: 503, headers: { ...corsHeaders, "Retry-After": "60" } },
        )
      }

      return NextResponse.json({ error: errorMessage }, { status: 500, headers: corsHeaders })
    }

    if (error) {
      console.error("[v0] Lost Sales GET error:", error)
      if (cachedLostSales !== null) {
        return NextResponse.json(cachedLostSales, {
          headers: { ...corsHeaders, "X-Cache": "STALE" },
        })
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders })
    }

    // Update cache for default queries
    if (!status && !startDate && !endDate && !view) {
      cachedLostSales = data
      cacheTimestamp = now
    }

    return NextResponse.json(data, { headers: { ...corsHeaders, "X-Cache": "MISS" } })
  } catch (error: any) {
    console.error("[v0] Lost Sales GET exception:", error)
    if (cachedLostSales !== null) {
      return NextResponse.json(cachedLostSales, {
        headers: { ...corsHeaders, "X-Cache": "STALE" },
      })
    }
    return NextResponse.json({ error: "Failed to fetch lost sales" }, { status: 500, headers: corsHeaders })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const items = Array.isArray(body) ? body : [body]

    if (items.length === 0 || !items[0].requested_item_name) {
      return NextResponse.json({ error: "requested_item_name is required" }, { status: 400, headers: corsHeaders })
    }

    const lostSalesRecords = items.map((item) => ({
      requested_item_name: item.requested_item_name,
      customer_name: item.customer_name || null,
      requested_quantity: Number.parseInt(item.requested_quantity) || 1,
      customer_email: item.customer_email || null,
      customer_phone: item.customer_phone || null,
      request_date: item.request_date || new Date().toISOString(),
    }))

    const { data, error } = await supabase.from("lost_sales").insert(lostSalesRecords).select()

    if (error) {
      console.error("[v0] Lost Sales POST error:", error)
      return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders })
    }

    // Clear cache on write
    cachedLostSales = null

    return NextResponse.json(
      { success: true, message: `${data.length} lost sale(s) recorded`, data },
      { headers: corsHeaders },
    )
  } catch (error: any) {
    console.error("[v0] Lost Sales POST exception:", error)
    return NextResponse.json(
      { error: "Failed to record lost sale", details: error?.message },
      { status: 500, headers: corsHeaders },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const { lost_sale_id, status, notes, follow_up_date } = body

    if (!lost_sale_id) {
      return NextResponse.json({ error: "lost_sale_id is required" }, { status: 400, headers: corsHeaders })
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status) updateData.status = status
    if (notes !== undefined) updateData.notes = notes
    if (follow_up_date !== undefined) updateData.follow_up_date = follow_up_date

    const { data, error } = await supabase
      .from("lost_sales")
      .update(updateData)
      .eq("lost_sale_id", lost_sale_id)
      .select()

    if (error) {
      console.error("[v0] Lost Sales PATCH error:", error)
      return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders })
    }

    // Clear cache on write
    cachedLostSales = null

    return NextResponse.json({ success: true, data: data[0] }, { headers: corsHeaders })
  } catch (error: any) {
    console.error("[v0] Lost Sales PATCH exception:", error)
    return NextResponse.json({ error: "Failed to update lost sale" }, { status: 500, headers: corsHeaders })
  }
}
