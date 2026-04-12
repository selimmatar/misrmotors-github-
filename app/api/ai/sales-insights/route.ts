export async function POST(req: Request) {
  try {
    const { salesOrders, customers, products, inventory } = await req.json()

    console.log("[v0] Starting sales insights analysis")

    // Calculate product sales
    const productStats: { [key: string]: { quantity: number; revenue: number; orders: number[] } } = {}

    salesOrders.forEach((order: any, index: number) => {
      order.items?.forEach((item: any) => {
        if (!productStats[item.productName]) {
          productStats[item.productName] = { quantity: 0, revenue: 0, orders: [] }
        }
        productStats[item.productName].quantity += item.quantity
        productStats[item.productName].revenue += item.quantity * item.unitPrice
        productStats[item.productName].orders.push(index)
      })
    })

    // Determine trends (simple: recent vs older orders)
    const recentOrders = salesOrders.slice(-10)
    const olderOrders = salesOrders.slice(0, -10)

    const topProducts = Object.entries(productStats)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(([productName, stats]) => {
        // Calculate trend
        const recentSales = recentOrders.reduce((sum: number, order: any) => {
          return sum + (order.items?.find((i: any) => i.productName === productName)?.quantity || 0)
        }, 0)

        const olderSales =
          olderOrders.length > 0
            ? olderOrders.reduce((sum: number, order: any) => {
                return sum + (order.items?.find((i: any) => i.productName === productName)?.quantity || 0)
              }, 0)
            : 0

        const trend =
          olderSales === 0
            ? "rising"
            : recentSales > olderSales * 1.2
              ? "rising"
              : recentSales < olderSales * 0.8
                ? "declining"
                : "stable"

        return {
          productName,
          totalSales: stats.quantity,
          revenue: Math.round(stats.revenue),
          trend,
        }
      })

    // Customer segmentation
    const customerPurchases: { [key: string]: { orders: number; revenue: number; products: Set<string> } } = {}

    salesOrders.forEach((order: any) => {
      if (!customerPurchases[order.customerName]) {
        customerPurchases[order.customerName] = { orders: 0, revenue: 0, products: new Set() }
      }
      customerPurchases[order.customerName].orders += 1
      customerPurchases[order.customerName].revenue += order.totalAmount
      order.items?.forEach((item: any) => {
        customerPurchases[order.customerName].products.add(item.productName)
      })
    })

    const customerSegments: any[] = []

    // High-value customers
    const highValueCustomers = Object.entries(customerPurchases)
      .filter(([, data]) => data.revenue > 10000)
      .map(([name]) => name)

    if (highValueCustomers.length > 0) {
      customerSegments.push({
        segment: "High-Value Customers",
        characteristics: `${highValueCustomers.length} customers with >$10,000 in purchases. Loyal, high-spending accounts.`,
        recommendedProducts: topProducts.slice(0, 3).map((p) => p.productName),
      })
    }

    // Frequent buyers
    const frequentBuyers = Object.entries(customerPurchases)
      .filter(([, data]) => data.orders >= 3)
      .map(([name]) => name)

    if (frequentBuyers.length > 0) {
      customerSegments.push({
        segment: "Frequent Buyers",
        characteristics: `${frequentBuyers.length} customers with 3+ orders. Regular, repeat customers.`,
        recommendedProducts: topProducts.filter((p) => p.trend === "rising").map((p) => p.productName),
      })
    }

    // New customers
    const newCustomers = Object.entries(customerPurchases)
      .filter(([, data]) => data.orders === 1)
      .map(([name]) => name)

    if (newCustomers.length > 0) {
      customerSegments.push({
        segment: "New Customers",
        characteristics: `${newCustomers.length} first-time buyers. Focus on retention and upselling.`,
        recommendedProducts: topProducts.slice(0, 2).map((p) => p.productName),
      })
    }

    // Sales trends
    const totalRevenue = salesOrders.reduce((sum: number, order: any) => sum + order.totalAmount, 0)
    const avgOrderValue = salesOrders.length > 0 ? totalRevenue / salesOrders.length : 0

    const recentRevenue = recentOrders.reduce((sum: number, order: any) => sum + order.totalAmount, 0)
    const olderRevenue =
      olderOrders.length > 0 ? olderOrders.reduce((sum: number, order: any) => sum + order.totalAmount, 0) : 0

    const overallTrend =
      olderRevenue === 0
        ? "growing"
        : recentRevenue > olderRevenue * 1.2
          ? "growing"
          : recentRevenue < olderRevenue * 0.8
            ? "declining"
            : "stable"

    const insights = `Total revenue: $${totalRevenue.toFixed(2)} across ${salesOrders.length} orders. Average order value: $${avgOrderValue.toFixed(2)}. ${
      overallTrend === "growing"
        ? "Sales are trending upward - great momentum!"
        : overallTrend === "declining"
          ? "Sales declining - consider promotional campaigns."
          : "Sales are stable - focus on customer retention and upselling."
    }`

    // Product recommendations for customers
    const recommendations = Object.entries(customerPurchases)
      .slice(0, 5)
      .map(([customerName, data]) => {
        const purchasedProducts = Array.from(data.products)
        const notPurchased = topProducts
          .filter((p) => !purchasedProducts.includes(p.productName))
          .map((p) => p.productName)

        return {
          customer: customerName,
          suggestedProducts: notPurchased.slice(0, 3),
          reasoning:
            data.orders > 2
              ? `Loyal customer who hasn't tried these popular products yet`
              : `New customer - introduce them to our best sellers`,
        }
      })

    const salesInsights = {
      topProducts,
      customerSegments:
        customerSegments.length > 0
          ? customerSegments
          : [
              {
                segment: "All Customers",
                characteristics: "Building customer base. Focus on acquisition and first-time buyer experience.",
                recommendedProducts: topProducts.slice(0, 3).map((p) => p.productName),
              },
            ],
      salesTrends: {
        overallTrend,
        seasonalPatterns:
          salesOrders.length < 12
            ? "Insufficient data for seasonal analysis"
            : "Monitor quarterly patterns as more data accumulates",
        insights,
      },
      recommendations: recommendations.length > 0 ? recommendations : [],
    }

    console.log("[v0] Sales insights completed")

    return Response.json({ insights: salesInsights })
  } catch (error: any) {
    console.error("[v0] Sales insights error:", error)
    return Response.json({ error: "Failed to generate sales insights" }, { status: 500 })
  }
}
