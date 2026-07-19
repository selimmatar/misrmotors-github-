import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "@/lib/ai-client"

export async function POST(request: NextRequest) {
  try {
    const { message, businessData } = await request.json()


    const {
      purchaseOrders,
      salesOrders,
      inventory,
      supplierInvoices,
      customerInvoices,
      suppliers,
      customers,
      products,
      prepaidBalance,
    } = businessData

    // --- Helper Functions for Calculations ---

    const isPaymentDueInMonth = (
      invoiceDate: string,
      monthsPaid: number,
      installmentMonths: number,
      monthOffset = 0,
    ): boolean => {
      if (!invoiceDate) return false
      const invoiceCreatedDate = new Date(invoiceDate)
      if (isNaN(invoiceCreatedDate.getTime())) return false

      const today = new Date()
      const targetDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
      const monthsElapsed =
        (targetDate.getFullYear() - invoiceCreatedDate.getFullYear()) * 12 +
        (targetDate.getMonth() - invoiceCreatedDate.getMonth())

      return monthsElapsed === monthsPaid && monthsPaid < installmentMonths
    }

    const isPaymentDue = (invoiceDate: string, monthsPaid: number, installmentMonths: number): boolean => {
      if (!invoiceDate) return false
      const invoiceCreatedDate = new Date(invoiceDate)
      if (isNaN(invoiceCreatedDate.getTime())) return false

      const today = new Date()
      const monthsElapsed =
        (today.getFullYear() - invoiceCreatedDate.getFullYear()) * 12 +
        (today.getMonth() - invoiceCreatedDate.getMonth())

      return monthsElapsed > monthsPaid && monthsPaid < installmentMonths
    }

    const getSupplierInstallmentMonths = (poId: string): number => {
      const po = purchaseOrders.find((p: any) => p.id === poId)
      return po?.installmentMonths || 0
    }

    const getCustomerInstallmentMonths = (soId: string): number => {
      const so = salesOrders.find((s: any) => s.id === soId)
      return so?.installmentMonths || 0
    }

    // --- Calculate Business Metrics for Context ---

    // 1. Next Month Obligations
    const nextMonthPayables = supplierInvoices.filter((inv: any) => {
      if (inv.status === "paid") return false
      const installmentMonths = getSupplierInstallmentMonths(inv.poId)
      if (!installmentMonths) return false
      return isPaymentDueInMonth(inv.date, inv.monthsPaid || 0, installmentMonths, 1)
    })
    const totalNextMonthPayables = nextMonthPayables.reduce((sum: number, inv: any) => {
      const installmentMonths = getSupplierInstallmentMonths(inv.poId)
      const amount = inv.totalAmount || 0
      return sum + (installmentMonths > 0 ? amount / installmentMonths : 0)
    }, 0)

    const nextMonthReceivables = customerInvoices.filter((inv: any) => {
      if (inv.status === "paid") return false
      const installmentMonths = getCustomerInstallmentMonths(inv.soId)
      if (!installmentMonths) return false
      return isPaymentDueInMonth(inv.date, inv.monthsPaid || 0, installmentMonths, 1)
    })
    const totalNextMonthReceivables = nextMonthReceivables.reduce((sum: number, inv: any) => {
      const installmentMonths = getCustomerInstallmentMonths(inv.soId)
      const amount = inv.totalAmount || 0
      return sum + (installmentMonths > 0 ? amount / installmentMonths : 0)
    }, 0)

    // 2. Assets
    const inventoryValue = inventory.reduce((sum: number, item: any) => sum + item.totalValue, 0)
    const accountsReceivable = customerInvoices
      .filter((inv: any) => inv.status !== "paid")
      .reduce((sum: number, inv: any) => sum + inv.totalAmount, 0)
    const totalAssets = inventoryValue + prepaidBalance + accountsReceivable

    // 3. Debt (Accounts Payable)
    const duePayables = supplierInvoices.filter((inv: any) => {
      if (inv.status === "paid") return false
      const installmentMonths = getSupplierInstallmentMonths(inv.poId)
      if (!installmentMonths) return inv.status !== "paid"
      return isPaymentDue(inv.date, inv.monthsPaid || 0, installmentMonths)
    })
    const totalDuePayables = duePayables.reduce((sum: number, inv: any) => {
      const installmentMonths = getSupplierInstallmentMonths(inv.poId)
      const amount = inv.totalAmount || 0
      if (!installmentMonths) return sum + amount
      return sum + (installmentMonths > 0 ? amount / installmentMonths : 0)
    }, 0)
    const totalDebt = supplierInvoices
      .filter((inv: any) => inv.status !== "paid")
      .reduce((sum: number, inv: any) => sum + (inv.totalAmount || 0), 0)

    // 4. Purchase Orders
    const draftPOs = purchaseOrders.filter((po: any) => po.status === "draft")
    const pendingPOs = purchaseOrders.filter((po: any) => po.status === "pending")
    const approvedPOs = purchaseOrders.filter((po: any) => po.status === "approved")
    const receivedPOs = purchaseOrders.filter((po: any) => po.status === "received")

    // 5. Sales Orders
    const draftSOs = salesOrders.filter((so: any) => so.status === "draft")
    const pendingSOs = salesOrders.filter((so: any) => so.status === "pending")
    const approvedSOs = salesOrders.filter((so: any) => so.status === "approved")
    const shippedSOs = salesOrders.filter((so: any) => so.status === "shipped")
    const totalRevenue = salesOrders.reduce((sum: number, so: any) => sum + (so.totalAmount || 0), 0)

    // 6. Inventory
    const lowStock = inventory.filter((item: any) => item.quantity <= item.reorderLevel)

    // Construct the System Prompt
    const systemPrompt = `
You are the AI CEO Assistant for Misr Motors, a motor vehicle distribution company in Egypt.
Your role is to provide executive-level insights, analysis, and answers based on the company's real-time data.
You are powered by Google Gemini.

**Company Context:**
- Name: Misr Motors
- Industry: Automotive Distribution (B2B)
- Location: Egypt
- Business Model: Selling motors and vehicles with flexible installment plans (3, 6, 12, 24 months).

**Current Financial Snapshot:**
- **Total Assets:** $${totalAssets.toLocaleString()}
  - Cash/Prepaid Balance: $${prepaidBalance.toLocaleString()}
  - Inventory Value: $${inventoryValue.toLocaleString()}
  - Accounts Receivable (Total Owed to Us): $${accountsReceivable.toLocaleString()}
- **Total Liabilities (Debt):** $${totalDebt.toLocaleString()}
  - Accounts Payable (Total We Owe): $${totalDebt.toLocaleString()}
  - Payments Due IMMEDIATELY: $${totalDuePayables.toLocaleString()}

**Next Month Projections:**
- Expected Inflow (Receivables): $${totalNextMonthReceivables.toLocaleString()}
- Expected Outflow (Payables): $${totalNextMonthPayables.toLocaleString()}
- Net Cash Flow: $${(totalNextMonthReceivables - totalNextMonthPayables).toLocaleString()}

**Operational Status:**
- **Purchase Orders:**
  - Draft: ${draftPOs.length}
  - Pending Approval: ${pendingPOs.length} (Requires attention)
  - Approved: ${approvedPOs.length}
  - Received: ${receivedPOs.length}
- **Sales Orders:**
  - Draft: ${draftSOs.length}
  - Pending Approval: ${pendingSOs.length}
  - Approved: ${approvedSOs.length}
  - Shipped: ${shippedSOs.length}
  - Total Revenue: $${totalRevenue.toLocaleString()}
- **Inventory:**
  - Total Items: ${inventory.length}
  - Low Stock Alerts: ${lowStock.length} items (${lowStock.map((i: any) => i.productName).join(", ")})

**Instructions:**
1. Answer the user's question directly using the data provided above.
2. Be professional, concise, and executive-focused.
3. If the user asks about "next month", "assets", "debt", etc., use the calculated figures above.
4. If the user asks for advice, provide strategic recommendations based on the cash flow and stock status.
5. Use formatting (bolding, lists) to make the output readable.
6. If the data is good (positive cash flow, low debt), be encouraging. If bad, be cautionary.
`

    // Call Gemini via native client
    try {
      const { text } = await generateText({
        model: "google-vertex/gemini-1.5-pro",
        system: systemPrompt,
        prompt: message,
      })
      return NextResponse.json({ answer: text, content: text })
    } catch (geminiError) {
      console.warn("Gemini failed, falling back to GPT-4o:", geminiError)
      // Fallback to OpenAI if Gemini fails
      const { text } = await generateText({
        model: "openai/gpt-4o",
        system: systemPrompt + "\n(Note: Running on backup model due to primary model unavailability)",
        prompt: message,
      })
      return NextResponse.json({ answer: text, content: text })
    }
  } catch (error: any) {
    console.error("CEO Assistant error:", error)
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 })
  }
}
