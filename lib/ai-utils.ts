export async function analyzeInventory(inventory: any[], salesOrders: any[], products: any[]) {
  try {
    const response = await fetch("/api/ai/analyze-inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory, salesOrders, products }),
    })

    if (!response.ok) throw new Error("Analysis failed")

    const data = await response.json()
    return data.analysis
  } catch (error) {
    console.error("Inventory analysis error:", error)
    throw error
  }
}

export async function analyzeFinancials(financialData: {
  prepaidBalance: number
  accountsPayable: number
  accountsReceivable: number
  inventoryValue: number
  supplierInvoices: any[]
  customerInvoices: any[]
}) {
  try {
    const response = await fetch("/api/ai/financial-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(financialData),
    })

    if (!response.ok) throw new Error("Analysis failed")

    const data = await response.json()
    return data.analysis
  } catch (error) {
    console.error("Financial analysis error:", error)
    throw error
  }
}

export async function getSalesInsights(salesData: {
  salesOrders: any[]
  customers: any[]
  products: any[]
  inventory: any[]
}) {
  try {
    const response = await fetch("/api/ai/sales-insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(salesData),
    })

    if (!response.ok) throw new Error("Analysis failed")

    const data = await response.json()
    return data.insights
  } catch (error) {
    console.error("Sales insights error:", error)
    throw error
  }
}

export async function extractInvoiceData(fileData: string, mediaType: string) {
  try {
    const response = await fetch("/api/ai/extract-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileData, mediaType }),
    })

    if (!response.ok) throw new Error("Extraction failed")

    const data = await response.json()
    return data.extractedData
  } catch (error) {
    console.error("Invoice extraction error:", error)
    throw error
  }
}
