import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [{ data: suppliers }, { data: purchaseOrders }, { data: inventory }] = await Promise.all([
      supabase.from("suppliers").select("*"),
      supabase.from("purchase_orders").select("*"),
      supabase.from("inventory").select("*"),
    ])

    const supplierScorecard = (suppliers || []).map((supplier) => {
      const supplierPOs = (purchaseOrders || []).filter((po) => Number(po.supplier_id) === Number(supplier.supplier_id))

      // On-time delivery rate
      const deliveredPOs = supplierPOs.filter((po) => po.status === "approved")
      const onTimeDeliveries = deliveredPOs.filter((po) => {
        const orderDate = new Date(po.order_date)
        const deliveryDate = new Date(po.delivery_date)
        const actualDelivery = new Date(po.approved_at || po.delivery_date)
        return actualDelivery <= deliveryDate
      }).length

      const onTimeRate = deliveredPOs.length > 0 ? (onTimeDeliveries / deliveredPOs.length) * 100 : 0

      // Average lead time
      const avgLeadTime =
        deliveredPOs.length > 0
          ? deliveredPOs.reduce((sum, po) => {
              const orderDate = new Date(po.order_date)
              const deliveryDate = new Date(po.delivery_date)
              return sum + (deliveryDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24)
            }, 0) / deliveredPOs.length
          : 0

      // Total purchase value
      const totalPurchaseValue = supplierPOs.reduce((sum, po) => sum + (Number(po.total) || 0), 0)

      // Quality score (simplified - would track defects in real system)
      const qualityScore = 95 // Placeholder

      // Overall score
      const overallScore = onTimeRate * 0.4 + qualityScore * 0.4 + (avgLeadTime < 14 ? 100 : 50) * 0.2

      return {
        supplierId: supplier.supplier_id,
        supplierName: supplier.supplier_name,
        onTimeRate,
        avgLeadTime,
        qualityScore,
        totalPurchaseValue,
        orderCount: supplierPOs.length,
        overallScore,
      }
    })

    const topSuppliers = supplierScorecard.sort((a, b) => b.overallScore - a.overallScore)

    return NextResponse.json({
      scorecard: topSuppliers,
    })
  } catch (error) {
    console.error("[v0] Error fetching supplier analytics:", error)
    return NextResponse.json({ error: "Failed to fetch supplier analytics" }, { status: 500 })
  }
}
