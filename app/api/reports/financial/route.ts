import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { apAging, apSummary, arAging, arSummary, cashFlow, financialSummary, inDateRange } from "@/lib/reports/views"

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
        // Overall financial summary (was the report_financial_summary view)
        data = await financialSummary(supabase)
        break

      case "ar_aging":
        // AR aging report (was the report_ar_aging view)
        data = await arAging(supabase)
        break

      case "ar_summary":
        // AR summary totals (was the report_ar_summary view)
        data = await arSummary(supabase)
        break

      case "ap_aging":
        // AP aging report (was the report_ap_aging view)
        data = await apAging(supabase)
        break

      case "ap_summary":
        // AP summary totals (was the report_ap_summary view)
        data = await apSummary(supabase)
        break

      case "cash_flow":
        // Cash flow by month (was the report_cash_flow view)
        data = inDateRange(await cashFlow(supabase), "month", fromDate, toDate)
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
