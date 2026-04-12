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

    let data: any = null

    switch (reportType) {
      case "summary":
        // Overall financial summary
        const { data: summaryData, error: summaryError } = await supabase
          .from("report_financial_summary")
          .select("*")
          .single()
        if (summaryError) throw summaryError
        data = summaryData
        break

      case "ar_aging":
        // AR aging report
        const arQuery = supabase.from("report_ar_aging").select("*")
        const { data: arData, error: arError } = await arQuery
        if (arError) throw arError
        data = arData || []
        break

      case "ar_summary":
        // AR summary totals
        const { data: arSummaryData, error: arSummaryError } = await supabase
          .from("report_ar_summary")
          .select("*")
          .single()
        if (arSummaryError) throw arSummaryError
        data = arSummaryData
        break

      case "ap_aging":
        // AP aging report
        const apQuery = supabase.from("report_ap_aging").select("*")
        const { data: apData, error: apError } = await apQuery
        if (apError) throw apError
        data = apData || []
        break

      case "ap_summary":
        // AP summary totals
        const { data: apSummaryData, error: apSummaryError } = await supabase
          .from("report_ap_summary")
          .select("*")
          .single()
        if (apSummaryError) throw apSummaryError
        data = apSummaryData
        break

      case "cash_flow":
        // Cash flow by month
        let cashQuery = supabase.from("report_cash_flow").select("*")
        if (fromDate) cashQuery = cashQuery.gte("month", fromDate)
        if (toDate) cashQuery = cashQuery.lte("month", toDate)
        const { data: cashData, error: cashError } = await cashQuery
        if (cashError) throw cashError
        data = cashData || []
        break

      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 })
    }

    return NextResponse.json({ data, reportType, fromDate, toDate })
  } catch (error: any) {
    console.error("Financial Report Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
