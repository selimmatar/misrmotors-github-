import { NextResponse } from "next/server"

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { historicalData, predictionType } = await request.json()

    if (predictionType === "demand") {
      const predictions = await generateDemandPredictions(historicalData)
      return NextResponse.json({ predictions })
    } else if (predictionType === "pricing") {
      const recommendations = await generatePricingRecommendations(historicalData)
      return NextResponse.json({ recommendations })
    } else if (predictionType === "churn") {
      const atRisk = await generateChurnAnalysis(historicalData)
      return NextResponse.json({ atRisk })
    }

    return NextResponse.json({ error: "Invalid prediction type" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Error generating predictions:", error)
    return NextResponse.json({ error: "Failed to generate predictions" }, { status: 500 })
  }
}

async function generateDemandPredictions(data: any) {
  if (!data?.products || !Array.isArray(data.products) || data.products.length === 0) {
    return []
  }

  // Always calculate fallback first - this ensures we have results
  const fallbackResults = data.products.map((product: any) => ({
    productName: product.productName || product.name || "Unknown",
    predictedDemand: Math.max(1, Math.round((product.totalSold || 0) * 1.05)),
    confidence: (product.totalSold || 0) > 10 ? "high" : "medium",
  }))

  // Return fallback results - AI enhancement is optional
  return fallbackResults
}

async function generatePricingRecommendations(data: any) {
  if (!data?.products || !Array.isArray(data.products) || data.products.length === 0) {
    return []
  }

  // Calculate recommendations locally
  return data.products.map((product: any) => {
    const price = product.unitPrice || product.price || 0
    const cost = product.lastLandedCost || product.cost || price * 0.6
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0
    const totalSold = product.totalSold || 0
    const currentStock = product.currentStock || 0

    let suggestedPrice = price
    let reasoning = "Current pricing is optimal"

    if (margin < 15) {
      suggestedPrice = Math.round(cost * 1.25)
      reasoning = "Low margin - recommend price increase"
    } else if (margin < 20) {
      suggestedPrice = Math.round(cost * 1.3)
      reasoning = "Below target margin - consider price adjustment"
    } else if (currentStock > 100 && totalSold < 10) {
      suggestedPrice = Math.round(price * 0.9)
      reasoning = "High stock, low sales - promotional pricing recommended"
    } else if (totalSold > 50 && margin > 30) {
      reasoning = "Strong performer - maintain current pricing"
    }

    return {
      productName: product.productName || product.name || "Unknown",
      currentPrice: price,
      suggestedPrice,
      reasoning,
    }
  })
}

async function generateChurnAnalysis(data: any) {
  if (!data?.customers || !Array.isArray(data.customers) || data.customers.length === 0) {
    return []
  }

  const today = new Date()

  return data.customers
    .map((customer: any) => {
      const lastOrderDate = customer.lastOrderDate ? new Date(customer.lastOrderDate) : null
      const daysSinceOrder = lastOrderDate
        ? Math.floor((today.getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24))
        : 999

      let riskLevel: "high" | "medium" | "low" = "low"
      let reasoning = "Active customer"

      if (daysSinceOrder > 90) {
        riskLevel = "high"
        reasoning = "No orders in 90+ days - urgent outreach needed"
      } else if (daysSinceOrder > 60) {
        riskLevel = "medium"
        reasoning = "No orders in 60-90 days - schedule follow-up"
      } else if (daysSinceOrder > 30) {
        riskLevel = "low"
        reasoning = "Recent activity but slowing down"
      }

      return {
        customerName: customer.customerName || customer.name || "Unknown",
        riskLevel,
        lastOrderDays: daysSinceOrder === 999 ? "Never ordered" : daysSinceOrder,
        reasoning,
      }
    })
    .filter((c: any) => c.riskLevel === "high" || c.riskLevel === "medium")
}
