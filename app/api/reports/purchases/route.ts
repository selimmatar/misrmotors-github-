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
        // Monthly purchase summary from view
        let summaryQuery = supabase.from("report_purchase_summary").select("*")
        if (fromDate) summaryQuery = summaryQuery.gte("month", fromDate)
        if (toDate) summaryQuery = summaryQuery.lte("month", toDate)
        const { data: summaryData, error: summaryError } = await summaryQuery
        if (summaryError) throw summaryError
        data = summaryData || []
        break

      case "details":
        // Detailed purchases with supplier info
        let detailsQuery = supabase.from("report_purchase_details").select("*")
        if (fromDate) detailsQuery = detailsQuery.gte("order_date", fromDate)
        if (toDate) detailsQuery = detailsQuery.lte("order_date", toDate)
        const { data: detailsData, error: detailsError } = await detailsQuery
        if (detailsError) throw detailsError
        data = detailsData || []
        break

      case "by_supplier":
        // Purchases aggregated by supplier
        const { data: supplierData, error: supplierError } = await supabase
          .from("report_purchase_by_supplier")
          .select("*")
        if (supplierError) throw supplierError
        data = supplierData || []
        break

      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 })
    }

    return NextResponse.json({ data, reportType, fromDate, toDate })
  } catch (error: any) {
    console.error("Purchase Report Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
