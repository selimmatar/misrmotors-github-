import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  loadPendingPriceRequests,
  loadPendingPurchaseOrders,
  loadReportsToReview,
  loadSalesOrdersNeedingPo,
  loadUnappliedPrices,
} from "@/lib/notifications/waiting"

export const dynamic = "force-dynamic"

// GET ?screen=sales-orders|purchase-orders|po-requests&role=... -> the items behind that screen's sidebar counter
// (the "Waiting for you" box). Roles see the same screens as their counters.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const screen = searchParams.get("screen") || ""
    const role = searchParams.get("role") || ""
    const db = createAdminClient()

    if (screen === "sales-orders" && ["sales-rep", "ceo"].includes(role)) {
      const [prices, reports] = await Promise.all([loadUnappliedPrices(db), loadReportsToReview(db)])
      return NextResponse.json({ prices, reports })
    }
    if (screen === "purchase-orders" && ["po-rep", "ceo"].includes(role)) {
      const [orders, purchaseOrders] = await Promise.all([loadSalesOrdersNeedingPo(db), loadPendingPurchaseOrders(db)])
      return NextResponse.json({ orders, purchaseOrders })
    }
    if (screen === "po-requests" && ["po-rep", "ceo"].includes(role)) {
      return NextResponse.json({ requests: await loadPendingPriceRequests(db) })
    }
    return NextResponse.json({})
  } catch (error) {
    console.error("pending-counts details error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
