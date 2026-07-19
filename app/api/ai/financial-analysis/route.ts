export async function POST(req: Request) {
  try {
    const { prepaidBalance, accountsPayable, accountsReceivable, inventoryValue, supplierInvoices, customerInvoices } =
      await req.json()

      prepaidBalance,
      accountsPayable,
    // Calculate key financial metrics
    const totalAssets = prepaidBalance + accountsReceivable + inventoryValue
    const liquidityRatio = accountsPayable > 0 ? (prepaidBalance + accountsReceivable) / accountsPayable : 999
    const debtToAssetRatio = totalAssets > 0 ? accountsPayable / totalAssets : 0
    const workingCapital = prepaidBalance + accountsReceivable - accountsPayable

    // Calculate cash flow predictions
    const monthlyReceivables = customerInvoices.reduce((sum: number, inv: any) => {
      const remaining = inv.installmentMonths - inv.monthsReceived
      if (remaining > 0) {
        return sum + inv.totalAmount / inv.installmentMonths
      }
      return sum
    }, 0)

    const monthlyPayables = supplierInvoices.reduce((sum: number, inv: any) => {
      const remaining = inv.installmentMonths - inv.monthsPaid
      if (remaining > 0) {
        return sum + inv.totalAmount / inv.installmentMonths
      }
      return sum
    }, 0)

    const nextMonthCashFlow = prepaidBalance + monthlyReceivables - monthlyPayables
    const nextQuarterCashFlow = prepaidBalance + monthlyReceivables * 3 - monthlyPayables * 3

    // Identify payment risks
    const paymentRisks: any[] = []
    const today = new Date()

    // Check overdue receivables
    customerInvoices.forEach((inv: any) => {
      if (inv.nextDueDate) {
        const dueDate = new Date(inv.nextDueDate)
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

        if (daysOverdue > 0) {
          paymentRisks.push({
            customerOrSupplier: inv.customerName,
            type: "receivable",
            amount: inv.totalAmount / inv.installmentMonths,
            riskLevel: daysOverdue > 30 ? "high" : daysOverdue > 10 ? "medium" : "low",
            daysOverdue,
            recommendation: `Contact ${inv.customerName} immediately to collect overdue payment of $${(inv.totalAmount / inv.installmentMonths).toFixed(2)}`,
          })
        }
      }
    })

    // Check overdue payables
    supplierInvoices.forEach((inv: any) => {
      if (inv.nextDueDate) {
        const dueDate = new Date(inv.nextDueDate)
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

        if (daysOverdue > 0) {
          paymentRisks.push({
            customerOrSupplier: inv.supplierName,
            type: "payable",
            amount: inv.totalAmount / inv.installmentMonths,
            riskLevel: daysOverdue > 30 ? "high" : daysOverdue > 10 ? "medium" : "low",
            daysOverdue,
            recommendation: `Pay ${inv.supplierName} immediately to avoid supplier relationship damage ($${(inv.totalAmount / inv.installmentMonths).toFixed(2)} overdue)`,
          })
        }
      }
    })

    // Calculate financial health score (0-100)
    let healthScore = 50 // Start at neutral

    // Positive factors
    if (liquidityRatio > 2) healthScore += 20
    else if (liquidityRatio > 1.5) healthScore += 15
    else if (liquidityRatio > 1) healthScore += 10

    if (workingCapital > 0) healthScore += 15
    if (debtToAssetRatio < 0.3) healthScore += 15
    else if (debtToAssetRatio < 0.5) healthScore += 10

    // Negative factors
    if (liquidityRatio < 1) healthScore -= 20
    if (workingCapital < 0) healthScore -= 15
    if (debtToAssetRatio > 0.7) healthScore -= 15
    if (paymentRisks.length > 5) healthScore -= 10

    healthScore = Math.max(0, Math.min(100, healthScore))

    const healthStatus =
      healthScore >= 80 ? "excellent" : healthScore >= 60 ? "good" : healthScore >= 40 ? "fair" : "poor"

    // Generate insights
    let insights = ""
    if (liquidityRatio > 2) {
      insights = "Strong liquidity position with sufficient cash to cover obligations. "
    } else if (liquidityRatio < 1) {
      insights = "Warning: Liquidity concerns - current liabilities exceed liquid assets. "
    } else {
      insights = "Adequate liquidity but monitor cash flow closely. "
    }

    if (workingCapital > 0) {
      insights += `Positive working capital of $${workingCapital.toFixed(2)} indicates healthy short-term financial position.`
    } else {
      insights += `Negative working capital of $${Math.abs(workingCapital).toFixed(2)} requires immediate attention.`
    }

    // Generate recommendations
    const recommendations: string[] = []

    if (liquidityRatio < 1.5) {
      recommendations.push(
        "Improve cash position by accelerating receivables collection or negotiating extended payment terms with suppliers",
      )
    }

    if (paymentRisks.filter((r) => r.type === "receivable").length > 0) {
      recommendations.push("Implement stricter credit control and follow-up procedures for overdue customer payments")
    }

    if (debtToAssetRatio > 0.5) {
      recommendations.push("Consider reducing debt levels or increasing asset base to improve financial stability")
    }

    if (workingCapital < prepaidBalance * 0.2) {
      recommendations.push("Build cash reserves to at least 20% of monthly operating expenses for financial cushion")
    }

    if (recommendations.length === 0) {
      recommendations.push("Maintain current financial discipline and continue monitoring key metrics")
      recommendations.push("Consider strategic investments to grow the business given strong financial position")
    }

    const analysis = {
      cashFlowPrediction: {
        nextMonth: Math.round(nextMonthCashFlow),
        nextQuarter: Math.round(nextQuarterCashFlow),
        confidence: liquidityRatio > 1.5 ? "high" : liquidityRatio > 1 ? "medium" : "low",
        reasoning: `Based on current payment schedules: expecting $${monthlyReceivables.toFixed(2)} in collections and $${monthlyPayables.toFixed(2)} in payments monthly`,
      },
      paymentRisks: paymentRisks.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5),
      financialHealth: {
        score: Math.round(healthScore),
        status: healthStatus,
        keyMetrics: {
          liquidityRatio: Math.round(liquidityRatio * 100) / 100,
          debtToAssetRatio: Math.round(debtToAssetRatio * 100) / 100,
          workingCapital: Math.round(workingCapital),
        },
        insights,
      },
      recommendations: recommendations.slice(0, 3),
    }


    return Response.json({ analysis })
  } catch (error: any) {
    console.error("[v0] Financial analysis error:", error)
    return Response.json({ error: error.message || "Failed to analyze finances" }, { status: 500 })
  }
}
