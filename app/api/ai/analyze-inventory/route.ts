export async function POST(req: Request) {
  try {
    const { inventory, salesOrders, products } = await req.json()

    console.log("[v0] Starting inventory analysis")

    // Analyze low stock items
    const lowStockItems: any[] = []

    inventory.forEach((item: any) => {
      const product = products.find((p: any) => p.name === item.productName)
      if (!product) return

      const reorderLevel = product.reorderLevel || 10
      const desiredExcess = product.desiredExcess || 5
      const targetLevel = reorderLevel + desiredExcess

      if (item.quantity <= targetLevel) {
        const deficit = targetLevel - item.quantity
        const urgency =
          item.quantity === 0
            ? "critical"
            : item.quantity <= reorderLevel * 0.5
              ? "critical"
              : item.quantity <= reorderLevel
                ? "high"
                : "medium"

        lowStockItems.push({
          productName: item.productName,
          currentQuantity: item.quantity,
          reorderLevel,
          suggestedOrderQuantity: Math.max(deficit, desiredExcess),
          urgency,
          reasoning:
            urgency === "critical"
              ? `Stock critically low at ${item.quantity} units. Immediate reorder required to avoid stockouts.`
              : urgency === "high"
                ? `Stock below reorder level (${reorderLevel}). Order soon to maintain buffer.`
                : `Stock approaching reorder level. Consider ordering to maintain desired excess.`,
        })
      }
    })

    // Sort by urgency
    const urgencyOrder = { critical: 0, high: 1, medium: 2 }
    lowStockItems.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])

    // Analyze stock movement trends
    const productSales: { [key: string]: number } = {}

    salesOrders.forEach((order: any) => {
      order.items?.forEach((item: any) => {
        productSales[item.productName] = (productSales[item.productName] || 0) + item.quantity
      })
    })

    const sortedProducts = Object.entries(productSales).sort(([, a], [, b]) => (b as number) - (a as number))

    const fastMoving = sortedProducts.slice(0, 3).map(([name]) => name)
    const slowMoving = sortedProducts.slice(-3).map(([name]) => name)

    let insights = ""
    if (fastMoving.length > 0) {
      insights = `Top sellers: ${fastMoving.join(", ")}. `
    }
    if (slowMoving.length > 0 && sortedProducts.length > 3) {
      insights += `Slow movers: ${slowMoving.join(", ")}. Consider promotions or reduced ordering.`
    }

    // Generate recommendations
    const recommendations: string[] = []

    if (lowStockItems.filter((i) => i.urgency === "critical").length > 0) {
      recommendations.push(
        "Urgent: Place emergency orders for critically low stock items to avoid customer disappointment",
      )
    }

    if (fastMoving.length > 0) {
      recommendations.push(`Increase stock levels for fast-moving items: ${fastMoving.join(", ")}`)
    }

    if (slowMoving.length > 0 && sortedProducts.length > 3) {
      recommendations.push(`Review pricing or marketing for slow-moving items: ${slowMoving.join(", ")}`)
    }

    const totalValue = inventory.reduce((sum: number, item: any) => sum + item.totalValue, 0)
    if (totalValue > 100000) {
      recommendations.push("High inventory value detected. Consider optimizing stock levels to free up working capital")
    }

    const analysis = {
      lowStockItems: lowStockItems.slice(0, 10),
      stockTrends: {
        fastMoving,
        slowMoving,
        insights:
          insights || "Insufficient sales data to determine trends. Continue monitoring as more orders are placed.",
      },
      recommendations:
        recommendations.length > 0
          ? recommendations
          : ["Inventory levels are well-balanced. Continue current ordering practices."],
    }

    console.log("[v0] Inventory analysis completed")

    return Response.json({ analysis })
  } catch (error: any) {
    console.error("[v0] Inventory analysis error:", error)
    return Response.json({ error: "Failed to analyze inventory" }, { status: 500 })
  }
}
