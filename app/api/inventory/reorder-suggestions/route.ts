import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Calculate suggested reorder point based on sales velocity and supplier lead time
export async function GET() {
  try {
    const supabase = createAdminClient()

    // Get all products with inventory from all warehouses
    const { data: rawInventory, error: invError } = await supabase.from("inventory").select(`
        inventory_id,
        product_id,
        quantity,
        reorder_point,
        warehouse_id,
        products:product_id (
          product_id,
          product_name,
          sku,
          moq,
          unit
        )
      `)

    if (invError) throw invError
    
    // Aggregate inventory quantities by product_id across all warehouses
    const aggregatedInventoryMap = new Map<number, any>()
    
    ;(rawInventory || []).forEach((inv: any) => {
      const pid = inv.product_id
      if (aggregatedInventoryMap.has(pid)) {
        const existing = aggregatedInventoryMap.get(pid)
        existing.quantity += inv.quantity || 0
        // Take the max reorder point from all warehouses
        existing.reorder_point = Math.max(existing.reorder_point || 0, inv.reorder_point || 0)
      } else {
        aggregatedInventoryMap.set(pid, {
          inventory_id: inv.inventory_id,
          product_id: pid,
          quantity: inv.quantity || 0,
          reorder_point: inv.reorder_point || 0,
          products: inv.products,
        })
      }
    })
    
    const inventory = Array.from(aggregatedInventoryMap.values())

    const { data: supplierProducts, error: spError } = await supabase.from("supplier_products").select(`
        product_id,
        supplier_id,
        suppliers:supplier_id (
          supplier_id,
          supplier_name,
          lead_time_days
        )
      `)

    if (spError) {
      console.log("[v0] supplier_products error:", spError.message)
    }

    const { data: poItems, error: poError } = await supabase.from("purchase_order_items").select(`
        product_id,
        po_id,
        purchase_orders:po_id (
          supplier_id,
          suppliers:supplier_id (
            supplier_id,
            supplier_name,
            lead_time_days
          )
        )
      `)

    if (poError) {
      console.log("[v0] purchase_order_items error:", poError.message)
    }

    // Build product -> supplier mapping
    const productLeadTimes: Record<number, { leadTime: number; supplierName: string; supplierId: number }> = {}

    // First, try supplier_products table
    ;(supplierProducts || []).forEach((sp: any) => {
      const pid = sp.product_id
      const leadTime = sp.suppliers?.lead_time_days || 14
      const supplierName = sp.suppliers?.supplier_name || "Unknown"
      const supplierId = sp.supplier_id

      if (!productLeadTimes[pid] || leadTime < productLeadTimes[pid].leadTime) {
        productLeadTimes[pid] = { leadTime, supplierName, supplierId }
      }
    })
    ;(poItems || []).forEach((poi: any) => {
      const pid = poi.product_id
      const po = poi.purchase_orders
      if (!po || !po.suppliers) return

      const leadTime = po.suppliers.lead_time_days || 14
      const supplierName = po.suppliers.supplier_name || "Unknown"
      const supplierId = po.supplier_id

      // Only use PO data if we don't already have supplier info from supplier_products
      if (!productLeadTimes[pid]) {
        productLeadTimes[pid] = { leadTime, supplierName, supplierId }
      }
    })

    console.log("[v0] Product supplier mappings found:", Object.keys(productLeadTimes).length)

    // Get sales order items from last 90 days for demand analysis
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const { data: salesData, error: salesError } = await supabase.from("sales_order_items").select(`
        product_id,
        quantity,
        sales_orders:so_id (
          order_date,
          status
        )
      `)

    if (salesError) throw salesError

    // Filter to completed/shipped orders in last 90 days
    const recentSales = (salesData || []).filter((item: any) => {
      const orderDate = new Date(item.sales_orders?.order_date)
      const status = item.sales_orders?.status
      return orderDate >= ninetyDaysAgo && ["shipped", "delivered", "accountant_approved", "approved"].includes(status)
    })

    // Calculate sales velocity per product (units sold per day)
    const productSales: Record<number, { totalQty: number; orderDates: Date[] }> = {}

    recentSales.forEach((item: any) => {
      const pid = item.product_id
      if (!productSales[pid]) {
        productSales[pid] = { totalQty: 0, orderDates: [] }
      }
      productSales[pid].totalQty += item.quantity
      productSales[pid].orderDates.push(new Date(item.sales_orders?.order_date))
    })

    // Calculate suggestions for each inventory item
    const suggestions = (inventory || []).map((inv: any) => {
      const product = inv.products
      const pid = inv.product_id
      const salesInfo = productSales[pid]

      let dailyDemand = 0
      let totalSold = 0
      let salesCount = 0
      let demandTrend = "stable"

      if (salesInfo && salesInfo.totalQty > 0) {
        totalSold = salesInfo.totalQty
        salesCount = salesInfo.orderDates.length

        // Calculate days between first and last sale (or 90 days if only one sale)
        const sortedDates = salesInfo.orderDates.sort((a, b) => a.getTime() - b.getTime())
        const firstSale = sortedDates[0]
        const lastSale = sortedDates[sortedDates.length - 1]
        const daySpan = Math.max(1, Math.ceil((lastSale.getTime() - firstSale.getTime()) / (1000 * 60 * 60 * 24)))

        dailyDemand = totalSold / Math.max(daySpan, 30) // Use at least 30 days to avoid spikes

        // Analyze trend - compare first half vs second half of period
        const midPoint = new Date(ninetyDaysAgo.getTime() + (Date.now() - ninetyDaysAgo.getTime()) / 2)
        const firstHalfSales = recentSales
          .filter((s: any) => s.product_id === pid && new Date(s.sales_orders?.order_date) < midPoint)
          .reduce((sum: number, s: any) => sum + s.quantity, 0)

        const secondHalfSales = recentSales
          .filter((s: any) => s.product_id === pid && new Date(s.sales_orders?.order_date) >= midPoint)
          .reduce((sum: number, s: any) => sum + s.quantity, 0)

        if (secondHalfSales > firstHalfSales * 1.2) {
          demandTrend = "increasing"
        } else if (secondHalfSales < firstHalfSales * 0.8) {
          demandTrend = "decreasing"
        }
      }

      const supplierInfo = productLeadTimes[pid]
      const leadTimeDays = supplierInfo?.leadTime || 14
      const supplierName = supplierInfo?.supplierName || "No supplier linked"

      // Safety stock: proportional to lead time (longer lead = more safety stock)
      // Formula: safetyStock = leadTime * 0.5 (half of lead time as buffer)
      const safetyStockDays = Math.ceil(leadTimeDays * 0.5)

      // Suggested reorder point = (Daily demand × Lead time) + Safety stock
      // Reorder Point = (Average Daily Demand × Lead Time) + (Daily Demand × Safety Days)
      let suggestedReorderPoint = Math.ceil(dailyDemand * (leadTimeDays + safetyStockDays))

      // Adjust for trend
      if (demandTrend === "increasing") {
        suggestedReorderPoint = Math.ceil(suggestedReorderPoint * 1.2) // 20% buffer for growth
      } else if (demandTrend === "decreasing") {
        suggestedReorderPoint = Math.ceil(suggestedReorderPoint * 0.9) // Reduce for declining demand
      }

      // Ensure minimum is at least the MOQ
      const moq = product?.moq || 5
      suggestedReorderPoint = Math.max(suggestedReorderPoint, moq)

      // Calculate difference from current
      const currentReorderPoint = inv.reorder_point || 0
      const difference = suggestedReorderPoint - currentReorderPoint
      const percentChange = currentReorderPoint > 0 ? Math.round((difference / currentReorderPoint) * 100) : 100

      return {
        inventoryId: inv.inventory_id,
        productId: pid,
        productName: product?.product_name || "Unknown",
        sku: product?.sku || "",
        unit: product?.unit || "pcs",
        currentQuantity: inv.quantity,
        currentReorderPoint,
        suggestedReorderPoint,
        difference,
        percentChange,
        dailyDemand: Math.round(dailyDemand * 100) / 100,
        totalSold90Days: totalSold,
        salesCount90Days: salesCount,
        demandTrend,
        moq,
        leadTimeDays,
        supplierName,
        safetyStockDays,
        needsUpdate: Math.abs(percentChange) >= 15,
        urgency:
          inv.quantity <= currentReorderPoint
            ? "low_stock"
            : inv.quantity <= suggestedReorderPoint
              ? "near_reorder"
              : "healthy",
      }
    })

    // Sort by urgency and difference
    suggestions.sort((a, b) => {
      const urgencyOrder = { low_stock: 0, near_reorder: 1, healthy: 2 }
      if (
        urgencyOrder[a.urgency as keyof typeof urgencyOrder] !== urgencyOrder[b.urgency as keyof typeof urgencyOrder]
      ) {
        return (
          urgencyOrder[a.urgency as keyof typeof urgencyOrder] - urgencyOrder[b.urgency as keyof typeof urgencyOrder]
        )
      }
      return Math.abs(b.percentChange) - Math.abs(a.percentChange)
    })

    return NextResponse.json({
      suggestions,
      summary: {
        totalProducts: suggestions.length,
        needsUpdate: suggestions.filter((s) => s.needsUpdate).length,
        lowStock: suggestions.filter((s) => s.urgency === "low_stock").length,
        nearReorder: suggestions.filter((s) => s.urgency === "near_reorder").length,
        averageDailyDemand: suggestions.reduce((sum, s) => sum + s.dailyDemand, 0) / suggestions.length,
        averageLeadTime: suggestions.reduce((sum, s) => sum + s.leadTimeDays, 0) / suggestions.length,
        analysisDate: new Date().toISOString(),
        periodDays: 90,
      },
    })
  } catch (error: any) {
    console.error("Error calculating reorder suggestions:", error)
    return NextResponse.json({ error: error.message || "Failed to calculate suggestions" }, { status: 500 })
  }
}

// Apply suggested reorder points
export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    // body.updates = [{ productId, reorderPoint }, ...]
    const updates = body.updates || []

    if (updates.length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 })
    }

    const results = []
    for (const update of updates) {
      const { data, error } = await supabase
        .from("inventory")
        .update({
          reorder_point: update.reorderPoint,
          last_updated: new Date().toISOString(),
        })
        .eq("product_id", update.productId)
        .select()
        .single()

      if (error) {
        results.push({ productId: update.productId, success: false, error: error.message })
      } else {
        results.push({ productId: update.productId, success: true, data })
      }
    }

    return NextResponse.json({
      success: true,
      updated: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    })
  } catch (error: any) {
    console.error("Error applying reorder suggestions:", error)
    return NextResponse.json({ error: error.message || "Failed to apply suggestions" }, { status: 500 })
  }
}
