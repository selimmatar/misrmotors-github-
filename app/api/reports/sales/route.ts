import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { inDateRange, salesByCustomer, salesDetails, salesSummary, topProducts } from "@/lib/reports/views"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get("type") || "summary"
    const fromDate = searchParams.get("fromDate")
    const toDate = searchParams.get("toDate")

    let data: any[] = []

    switch (reportType) {
      case "summary":
        // Monthly sales summary (was the report_sales_summary view)
        data = inDateRange(await salesSummary(supabase), "month", fromDate, toDate)
        break

      case "details":
        // Detailed sales with customer info (was the report_sales_details view)
        data = inDateRange(await salesDetails(supabase), "order_date", fromDate, toDate)
        break

      case "by_customer":
        // Sales aggregated by customer (was the report_sales_by_customer view)
        data = await salesByCustomer(supabase)
        break

      case "top_products":
        // Top selling products (was the report_top_products view)
        data = await topProducts(supabase)
        break

      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 })
    }

    return NextResponse.json({ data, reportType, fromDate, toDate })
  } catch (error: any) {
    console.error("Sales Report Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
