import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get("type") || "valuation"
    const category = searchParams.get("category")
    const stockStatus = searchParams.get("stockStatus")

    let data: any[] = []

    switch (reportType) {
      case "valuation":
        // Full inventory valuation
        let valuationQuery = supabase.from("report_inventory_valuation").select("*")
        if (category) valuationQuery = valuationQuery.eq("category", category)
        if (stockStatus) valuationQuery = valuationQuery.eq("stock_status", stockStatus)
        const { data: valuationData, error: valuationError } = await valuationQuery
        if (valuationError) throw valuationError
        data = valuationData || []
        break

      case "by_category":
        // Inventory summary by category
        const { data: categoryData, error: categoryError } = await supabase
          .from("report_inventory_by_category")
          .select("*")
        if (categoryError) throw categoryError
        data = categoryData || []
        break

      case "low_stock":
        // Low stock items only
        const { data: lowStockData, error: lowStockError } = await supabase
          .from("report_inventory_valuation")
          .select("*")
          .in("stock_status", ["Low Stock", "Out of Stock"])
        if (lowStockError) throw lowStockError
        data = lowStockData || []
        break

      case "product_performance":
        // Products with sales performance
        const { data: perfData, error: perfError } = await supabase.from("report_product_performance").select("*")
        if (perfError) throw perfError
        data = perfData || []
        break

      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 })
    }

    return NextResponse.json({ data, reportType, category, stockStatus })
  } catch (error: any) {
    console.error("Inventory Report Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
