export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import {
  getAllKPIs,
  getSalesMetrics,
  getInventoryMetrics,
  getARMetrics,
  getAPMetrics,
  getOrderCountsByStatus,
  type DateRange,
} from "@/lib/metrics"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const metric = searchParams.get("metric") || "all"
    const fromDate = searchParams.get("from")
    const toDate = searchParams.get("to")

    const dateRange: DateRange | undefined =
      fromDate || toDate
        ? {
            from: fromDate ? new Date(fromDate) : undefined,
            to: toDate ? new Date(toDate) : undefined,
          }
        : undefined

    let result: any

    switch (metric) {
      case "sales":
        result = await getSalesMetrics(dateRange)
        break
      case "inventory":
        result = await getInventoryMetrics()
        break
      case "ar":
        result = await getARMetrics(dateRange)
        break
      case "ap":
        result = await getAPMetrics(dateRange)
        break
      case "orders":
        result = await getOrderCountsByStatus(dateRange)
        break
      case "all":
      default:
        result = await getAllKPIs(dateRange)
        break
    }

    return NextResponse.json({
      success: true,
      data: result,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Metrics API] Error:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch metrics" }, { status: 500 })
  }
}
