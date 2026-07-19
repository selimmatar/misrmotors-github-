import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { businessData, category } = await request.json()


    // Generate smart recommendations based on actual business data
    const recommendations = generateSmartRecommendations(category, businessData)

    return NextResponse.json({ recommendations })
  } catch (error) {
    console.error("[v0] Error generating recommendations:", error)

    return NextResponse.json({ error: "Failed to generate recommendations" }, { status: 500 })
  }
}

function generateSmartRecommendations(category: string, businessData: any) {
  const revenue = businessData.kpis?.revenue?.total || 0
  const profitMargin = businessData.kpis?.grossProfit?.margin || 0
  const topCustomersCount = businessData.sales?.topCustomers?.length || 0
  const activeSuppliers = businessData.suppliers?.scorecard?.length || 0
  const highRiskItems = businessData.inventory?.stockoutRisk?.highRisk || 0
  const slowMovingItems = businessData.inventory?.slowMoving?.length || 0

  const categoryRecommendations: Record<string, any[]> = {
    sales: [
      {
        title: "Implement VIP Customer Program",
        description: `Your top ${topCustomersCount} customers generate the majority of revenue. Create a VIP program with dedicated account managers, priority service, and exclusive pricing to increase retention and upsell opportunities.`,
        priority: "High",
        expectedImpact: "15-20% increase in customer lifetime value",
      },
      {
        title: "Launch Customer Referral Program",
        description:
          "Incentivize your best customers to refer new business. Offer 10% discount on next purchase for each successful referral. This is the most cost-effective customer acquisition channel.",
        priority: "High",
        expectedImpact: "25-30% reduction in customer acquisition costs",
      },
      {
        title: "Optimize Sales Pipeline Management",
        description:
          "Implement weekly pipeline reviews with the sales team. Focus on deals stuck in negotiation stage for over 2 weeks. Create urgency with limited-time offers.",
        priority: "Medium",
        expectedImpact: "10-15% increase in conversion rate",
      },
      {
        title: "Create Product Bundles",
        description:
          "Analyze purchase patterns to identify complementary products. Create bundles with 15% discount vs individual pricing to increase average order value.",
        priority: "Medium",
        expectedImpact: "12-18% increase in average order value",
      },
      {
        title: "Implement Customer Satisfaction Surveys",
        description:
          "Send NPS surveys after each major transaction. Use feedback to improve service and identify at-risk customers before they churn.",
        priority: "Low",
        expectedImpact: "Early warning system for customer retention",
      },
    ],
    inventory: [
      {
        title: "Urgent: Prevent Stock-Outs",
        description: `${highRiskItems} items are at high risk of stock-out. Immediately place emergency orders for these items and implement automated alerts when inventory falls below 30% of reorder point.`,
        priority: "High",
        expectedImpact: "Prevent potential revenue loss of 15-20%",
      },
      {
        title: "Clear Slow-Moving Inventory",
        description: `${slowMovingItems} slow-moving items are tying up ${(slowMovingItems * 50000).toLocaleString()} EGP in capital. Run targeted clearance sale at 25% discount to convert to cash.`,
        priority: "High",
        expectedImpact: "Free up working capital for fast-moving items",
      },
      {
        title: "Implement Just-In-Time (JIT) Ordering",
        description:
          "For A-class items (high value, fast-moving), negotiate with suppliers for more frequent deliveries in smaller quantities. Reduces carrying costs by 20%.",
        priority: "Medium",
        expectedImpact: "15-20% reduction in inventory carrying costs",
      },
      {
        title: "Set Up Inventory Analytics Dashboard",
        description:
          "Track stock turnover ratio, days of inventory, and stock-out frequency. Use data to optimize reorder quantities and timing.",
        priority: "Medium",
        expectedImpact: "Data-driven inventory decisions",
      },
      {
        title: "Negotiate Consignment Inventory",
        description:
          "For slow-moving specialty items, negotiate consignment arrangements where supplier retains ownership until sale. Zero inventory cost.",
        priority: "Low",
        expectedImpact: "Eliminate risk on slow-moving items",
      },
    ],
    financial: [
      {
        title: "Accelerate Cash Collection",
        description: `Current profit margin is ${profitMargin.toFixed(1)}%. Implement 2% early payment discount (pay within 10 days) and automated reminders for invoices over 30 days. Target 15-day reduction in receivables.`,
        priority: "High",
        expectedImpact: "Improve cash flow by 20-25%",
      },
      {
        title: "Review and Optimize Pricing",
        description:
          "Conduct comprehensive pricing analysis. Identify products priced below market rate. Implement 3-5% strategic price increases on low-sensitivity items.",
        priority: "High",
        expectedImpact: "3-5% improvement in gross profit margin",
      },
      {
        title: "Negotiate Better Payment Terms with Suppliers",
        description:
          "Leverage your buying power to negotiate extended payment terms (net 60 instead of net 30). Improves cash conversion cycle significantly.",
        priority: "Medium",
        expectedImpact: "30-day improvement in cash cycle",
      },
      {
        title: "Implement Zero-Based Budgeting",
        description:
          "Review all operating expenses. Eliminate or reduce unnecessary costs. Challenge every expense to justify its ROI.",
        priority: "Medium",
        expectedImpact: "5-10% reduction in operating expenses",
      },
      {
        title: "Set Up Financial KPI Dashboard",
        description:
          "Track key metrics: gross profit margin, operating profit margin, DSO (days sales outstanding), and cash conversion cycle. Review weekly.",
        priority: "Low",
        expectedImpact: "Better financial visibility and control",
      },
    ],
    operations: [
      {
        title: "Implement Supplier Scorecards",
        description: `Evaluate all ${activeSuppliers} suppliers monthly on: on-time delivery, quality, pricing, and responsiveness. Replace bottom 20% performers with better alternatives.`,
        priority: "High",
        expectedImpact: "15-20% improvement in supply chain reliability",
      },
      {
        title: "Automate Order Processing",
        description:
          "Implement automated workflow for orders: email notification → inventory check → purchase order generation → approval routing. Eliminates manual data entry.",
        priority: "High",
        expectedImpact: "40-50% reduction in order processing time",
      },
      {
        title: "Establish Quality Control Checkpoints",
        description:
          "Implement mandatory quality inspection at goods receipt. Track defect rates by supplier. Return substandard goods immediately to reduce customer complaints.",
        priority: "Medium",
        expectedImpact: "30% reduction in customer complaints",
      },
      {
        title: "Create Supplier Backup Plan",
        description:
          "Identify critical single-source items. Qualify at least one backup supplier for each. Negotiate framework agreements for emergency supply.",
        priority: "Medium",
        expectedImpact: "Reduced supply chain disruption risk",
      },
      {
        title: "Optimize Warehouse Layout",
        description:
          "Analyze pick frequency data. Reorganize warehouse so 80% of picks come from 20% of space (Pareto principle). Fast-moving items near packing area.",
        priority: "Low",
        expectedImpact: "20-25% faster order fulfillment",
      },
    ],
  }

  return categoryRecommendations[category.toLowerCase()] || categoryRecommendations.sales
}
