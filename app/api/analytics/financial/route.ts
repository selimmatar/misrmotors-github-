import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [
      { data: arInvoices },
      { data: apInvoices },
      { data: customerPayments },
      { data: supplierPayments },
      { data: salesOrders },
      { data: purchaseOrders },
    ] = await Promise.all([
      supabase.from("accounts_receivable").select("*"),
      supabase.from("accounts_payable").select("*"),
      supabase.from("customer_payments").select("*"),
      supabase.from("supplier_payments").select("*"),
      supabase.from("sales_orders").select("*"),
      supabase.from("purchase_orders").select("*"),
    ])

    const today = new Date()

    // AR Aging
    const arAging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90plus: 0,
    }
    ;(arInvoices || []).forEach((inv) => {
      if (inv.status === "paid") return

      const dueDate = new Date(inv.due_date)
      const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      const balance = Number(inv.balance) || 0

      if (daysPastDue < 0) arAging.current += balance
      else if (daysPastDue <= 30) arAging.days30 += balance
      else if (daysPastDue <= 60) arAging.days60 += balance
      else arAging.days90plus += balance
    })

    // AP Aging
    const apAging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90plus: 0,
    }
    ;(apInvoices || []).forEach((inv) => {
      if (inv.status === "paid") return

      const dueDate = new Date(inv.due_date)
      const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      const balance = Number(inv.balance) || 0

      if (daysPastDue < 0) apAging.current += balance
      else if (daysPastDue <= 30) apAging.days30 += balance
      else if (daysPastDue <= 60) apAging.days60 += balance
      else apAging.days90plus += balance
    })

    // Cash Conversion Cycle
    const avgPaymentPeriod = 30 // Simplified
    const avgCollectionPeriod = 45 // Simplified
    const cashConversionCycle = avgCollectionPeriod - avgPaymentPeriod

    // Profitability by product (top 10)
    const productProfitability = new Map<number, { name: string; revenue: number; cost: number; profit: number }>()
    ;(salesOrders || []).forEach((so) => {
      so.sales_order_items?.forEach((item: any) => {
        const existing = productProfitability.get(item.product_id) || {
          name: item.product_name || "Unknown",
          revenue: 0,
          cost: 0,
          profit: 0,
        }
        existing.revenue += Number(item.total) || 0
        productProfitability.set(item.product_id, existing)
      })
    })
    ;(purchaseOrders || []).forEach((po) => {
      po.purchase_order_items?.forEach((item: any) => {
        const existing = productProfitability.get(item.product_id)
        if (existing) {
          existing.cost += Number(item.total) || 0
          existing.profit = existing.revenue - existing.cost
        }
      })
    })

    const topProfitableProducts = Array.from(productProfitability.values())
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10)

    return NextResponse.json({
      arAging,
      apAging,
      cashConversionCycle,
      profitability: topProfitableProducts,
      paymentMetrics: {
        avgCollectionPeriod,
        avgPaymentPeriod,
      },
    })
  } catch (error) {
    console.error("Error fetching financial analytics:", error)
    return NextResponse.json({ error: "Failed to fetch financial analytics" }, { status: 500 })
  }
}
