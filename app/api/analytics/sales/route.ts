import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") || "6months"

    const supabase = createAdminClient()

    const [{ data: salesOrders }, { data: customers }, { data: products }, { data: salesOrderItems }] =
      await Promise.all([
        supabase.from("sales_orders").select("*"),
        supabase.from("customers").select("*"),
        supabase.from("products").select("*"),
        supabase.from("sales_order_items").select("*"),
      ])

    // Calculate CLV (Customer Lifetime Value)
    const customerCLV = (customers || []).map((customer) => {
      const customerOrders = (salesOrders || []).filter((so) => Number(so.customer_id) === Number(customer.customer_id))
      const totalSpent = customerOrders.reduce((sum, so) => sum + (Number(so.total) || 0), 0)
      const orderCount = customerOrders.length
      const avgOrderValue = orderCount > 0 ? totalSpent / orderCount : 0

      return {
        customerId: customer.customer_id,
        customerName: customer.customer_name,
        totalSpent,
        orderCount,
        avgOrderValue,
        clv: totalSpent, // Simplified CLV
      }
    })

    // Top customers by revenue
    const topCustomers = customerCLV.sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10)

    // Product affinity analysis (products bought together)
    const productPairs = new Map<string, number>()
    ;(salesOrders || []).forEach((so) => {
      const items = (salesOrderItems || []).filter((item) => Number(item.so_id) === Number(so.so_id))
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const pair = [items[i].product_id, items[j].product_id].sort().join("-")
          productPairs.set(pair, (productPairs.get(pair) || 0) + 1)
        }
      }
    })

    const topProductPairs = Array.from(productPairs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pair, count]) => {
        const [p1, p2] = pair.split("-").map(Number)
        const product1 = (products || []).find((p) => Number(p.product_id) === p1)
        const product2 = (products || []).find((p) => Number(p.product_id) === p2)
        return {
          product1: product1?.product_name || "Unknown",
          product2: product2?.product_name || "Unknown",
          count,
        }
      })

    // Sales funnel conversion
    const pendingOrders = (salesOrders || []).filter((so) => so.status === "pending_accountant").length
    const approvedOrders = (salesOrders || []).filter((so) => so.status === "accountant_approved").length
    const shippedOrders = (salesOrders || []).filter((so) => so.status === "shipped").length
    const totalOrders = (salesOrders || []).length

    const conversionRate = totalOrders > 0 ? (shippedOrders / totalOrders) * 100 : 0

    return NextResponse.json({
      topCustomers,
      productAffinity: topProductPairs,
      funnel: {
        pending: pendingOrders,
        approved: approvedOrders,
        shipped: shippedOrders,
        conversionRate,
      },
      clvData: customerCLV.slice(0, 20),
    })
  } catch (error) {
    console.error("Error fetching sales analytics:", error)
    return NextResponse.json({ error: "Failed to fetch sales analytics" }, { status: 500 })
  }
}
