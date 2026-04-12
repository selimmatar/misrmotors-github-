import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

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
        // Monthly sales summary from view
        let summaryQuery = supabase.from("report_sales_summary").select("*")
        if (fromDate) summaryQuery = summaryQuery.gte("month", fromDate)
        if (toDate) summaryQuery = summaryQuery.lte("month", toDate)
        const { data: summaryData, error: summaryError } = await summaryQuery
        if (summaryError) throw summaryError
        data = summaryData || []
        break

      case "details":
        // Detailed sales with customer info
        let detailsQuery = supabase.from("report_sales_details").select("*")
        if (fromDate) detailsQuery = detailsQuery.gte("order_date", fromDate)
        if (toDate) detailsQuery = detailsQuery.lte("order_date", toDate)
        const { data: detailsData, error: detailsError } = await detailsQuery
        if (detailsError) throw detailsError
        data = detailsData || []
        break

      case "by_customer":
        // Sales aggregated by customer
        const { data: customerData, error: customerError } = await supabase.from("report_sales_by_customer").select("*")
        if (customerError) throw customerError
        data = customerData || []
        break

      case "top_products":
        // Top selling products
        const { data: topData, error: topError } = await supabase.from("report_top_products").select("*")
        if (topError) throw topError
        data = topData || []
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
