import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { inDateRange, purchaseBySupplier, purchaseDetails, purchaseSummary } from "@/lib/reports/views"

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
        // Monthly purchase summary (was the report_purchase_summary view)
        data = inDateRange(await purchaseSummary(supabase), "month", fromDate, toDate)
        break

      case "details":
        // Detailed purchases with supplier info (was the report_purchase_details view)
        data = inDateRange(await purchaseDetails(supabase), "order_date", fromDate, toDate)
        break

      case "by_supplier":
        // Purchases aggregated by supplier (was the report_purchase_by_supplier view)
        data = await purchaseBySupplier(supabase)
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
