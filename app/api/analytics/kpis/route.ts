import { NextResponse } from "next/server"
import { getAllKPIs, type DateRange } from "@/lib/metrics"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get("from")
    const toDate = searchParams.get("to")

    const dateRange: DateRange | undefined =
      fromDate || toDate
        ? {
            from: fromDate ? new Date(fromDate) : undefined,
            to: toDate ? new Date(toDate) : undefined,
          }
        : undefined

    const kpis = await getAllKPIs(dateRange)

    // Transform to expected format for backwards compatibility
    return NextResponse.json({
      revenue: {
        total: kpis.totalRevenue,
        trend: kpis.revenueTrend > 0 ? `+${kpis.revenueTrend.toFixed(1)}%` : `${kpis.revenueTrend.toFixed(1)}%`,
      },
      grossProfit: {
        total: kpis.grossProfit,
        margin: kpis.grossProfitMargin,
      },
      cashPosition: {
        total: kpis.cashPosition,
        ar: kpis.arBalance,
        ap: kpis.apBalance,
      },
      inventory: {
        value: kpis.inventoryValue,
        turnover: kpis.inventoryTurnover,
        count: 0, // Will be fetched from inventory metrics if needed
      },
      orders: {
        avgValue: kpis.avgOrderValue,
        fulfillmentRate: kpis.orderFulfillmentRate,
        pendingCount: kpis.pendingOrdersCount,
      },
      customers: {
        total: kpis.totalCustomers,
        newThisMonth: kpis.newCustomersThisMonth,
      },
      // Metadata for debugging
      _calculatedAt: kpis.calculatedAt,
      _dateRange: kpis.dateRange,
    })
  } catch (error) {
    console.error("[v0] Error fetching KPIs:", error)
    return NextResponse.json({ error: "Failed to fetch KPIs" }, { status: 500 })
  }
}
