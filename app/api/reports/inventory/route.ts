import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { inventoryByCategory, inventoryValuation, productPerformance, whereEq, whereIn } from "@/lib/reports/views"

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
        // Full inventory valuation (was the report_inventory_valuation view)
        let valuationData = await inventoryValuation(supabase)
        if (category) valuationData = whereEq(valuationData, "category", category)
        if (stockStatus) valuationData = whereEq(valuationData, "stock_status", stockStatus)
        data = valuationData
        break

      case "by_category":
        // Inventory summary by category (was the report_inventory_by_category view)
        data = await inventoryByCategory(supabase)
        break

      case "low_stock":
        // Low stock items only
        data = whereIn(await inventoryValuation(supabase), "stock_status", ["Low Stock", "Out of Stock"])
        break

      case "product_performance":
        // Products with sales performance (was the report_product_performance view)
        data = await productPerformance(supabase)
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
