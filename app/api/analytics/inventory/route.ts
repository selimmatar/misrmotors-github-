import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [{ data: inventory }, { data: products }, { data: salesOrderItems }, { data: purchaseOrders }] =
      await Promise.all([
        supabase.from("inventory").select("*"),
        supabase.from("products").select("*"),
        supabase.from("sales_order_items").select("*, sales_orders(order_date)"),
        supabase.from("purchase_orders").select("*, suppliers(supplier_name)"),
      ])

    // ABC Analysis
    const inventoryWithValue = (inventory || []).map((item) => {
      const product = (products || []).find((p) => Number(p.product_id) === Number(item.product_id))
      const unitPrice = product?.unit_price || 0
      const totalValue = item.quantity * Number(unitPrice)
      return {
        ...item,
        productName: product?.product_name || "Unknown",
        unitPrice,
        totalValue,
      }
    })

    const sortedByValue = inventoryWithValue.sort((a, b) => b.totalValue - a.totalValue)
    const totalValue = sortedByValue.reduce((sum, item) => sum + item.totalValue, 0)

    let cumulativeValue = 0
    const abcClassification = sortedByValue.map((item) => {
      cumulativeValue += item.totalValue
      const cumulativePercent = (cumulativeValue / totalValue) * 100

      let category = "C"
      if (cumulativePercent <= 80) category = "A"
      else if (cumulativePercent <= 95) category = "B"

      return {
        ...item,
        abcCategory: category,
      }
    })

    // Stock-out risk (low stock items with sales velocity)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const stockoutRisk = (inventory || []).map((item) => {
      const product = (products || []).find((p) => Number(p.product_id) === Number(item.product_id))
      const recentSales = (salesOrderItems || []).filter((soItem) => {
        const orderDate = soItem.sales_orders?.order_date
        return (
          Number(soItem.product_id) === Number(item.product_id) && orderDate && new Date(orderDate) >= thirtyDaysAgo
        )
      })

      const totalSold = recentSales.reduce((sum, soItem) => sum + (soItem.quantity || 0), 0)
      const dailyVelocity = totalSold / 30
      const daysUntilStockout = dailyVelocity > 0 ? item.quantity / dailyVelocity : 999

      // Get supplier lead time
      const supplierPOs = (purchaseOrders || []).filter((po) =>
        po.purchase_order_items?.some((poItem: any) => Number(poItem.product_id) === Number(item.product_id)),
      )
      const avgLeadTime =
        supplierPOs.length > 0
          ? supplierPOs.reduce((sum, po) => {
              const orderDate = new Date(po.order_date)
              const deliveryDate = new Date(po.delivery_date)
              return sum + (deliveryDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24)
            }, 0) / supplierPOs.length
          : 14 // Default 14 days

      const riskLevel =
        daysUntilStockout < avgLeadTime ? "high" : daysUntilStockout < avgLeadTime * 2 ? "medium" : "low"

      return {
        productId: item.product_id,
        productName: product?.product_name || "Unknown",
        currentStock: item.quantity,
        reorderPoint: item.reorder_point,
        dailyVelocity,
        daysUntilStockout,
        leadTime: avgLeadTime,
        riskLevel,
      }
    })

    const highRiskItems = stockoutRisk.filter((item) => item.riskLevel === "high")

    // Slow-moving inventory (low turnover)
    const slowMoving = abcClassification
      .filter((item) => {
        const sales = (salesOrderItems || []).filter((soItem) => Number(soItem.product_id) === Number(item.product_id))
        const totalSold = sales.reduce((sum, soItem) => sum + (soItem.quantity || 0), 0)
        return totalSold < item.quantity * 0.1 // Less than 10% sold
      })
      .slice(0, 20)

    return NextResponse.json({
      abcAnalysis: {
        aItems: abcClassification.filter((i) => i.abcCategory === "A").length,
        bItems: abcClassification.filter((i) => i.abcCategory === "B").length,
        cItems: abcClassification.filter((i) => i.abcCategory === "C").length,
        details: abcClassification.slice(0, 20),
      },
      stockoutRisk: {
        highRisk: highRiskItems.length,
        mediumRisk: stockoutRisk.filter((i) => i.riskLevel === "medium").length,
        lowRisk: stockoutRisk.filter((i) => i.riskLevel === "low").length,
        details: highRiskItems.slice(0, 10),
      },
      slowMoving: slowMoving,
      inventoryValue: totalValue,
    })
  } catch (error) {
    console.error("[v0] Error fetching inventory analytics:", error)
    return NextResponse.json({ error: "Failed to fetch inventory analytics" }, { status: 500 })
  }
}
