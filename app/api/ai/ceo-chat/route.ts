import { getAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60

async function getBusinessContext() {
  const supabase = getAdminClient()

  const [
    { data: inventory },
    { data: apInvoices },
    { data: arInvoices },
    { data: balance },
    { data: purchaseOrders },
    { data: salesOrders },
    { data: customers },
    { data: suppliers },
  ] = await Promise.all([
    supabase.from("inventory").select("*, products(product_name)"),
    supabase.from("accounts_payable").select("*, suppliers(supplier_name)"),
    supabase.from("accounts_receivable").select("*, customers(customer_name)"),
    supabase.from("balance_entries").select("*").order("created_at", { ascending: false }).limit(1),
    supabase.from("purchase_orders").select("*"),
    supabase.from("sales_orders").select("*, customers(customer_name)"),
    supabase.from("customers").select("*"),
    supabase.from("suppliers").select("*"),
  ])

  const today = new Date().toISOString().split("T")[0]

  const inventoryValue = inventory?.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0) || 0
  const totalAP = apInvoices?.filter((i) => i.status !== "paid").reduce((sum, i) => sum + i.amount, 0) || 0
  const totalAR = arInvoices?.filter((i) => i.status !== "paid").reduce((sum, i) => sum + i.amount, 0) || 0
  const currentBalance = balance?.[0]?.amount || 0

  const poStatus = {
    total: purchaseOrders?.length || 0,
    draft: purchaseOrders?.filter((p) => p.status === "draft").length || 0,
    pending: purchaseOrders?.filter((p) => p.status === "pending").length || 0,
    approved: purchaseOrders?.filter((p) => p.status === "approved").length || 0,
    received: purchaseOrders?.filter((p) => p.status === "received").length || 0,
  }

  const soStatus = {
    total: salesOrders?.length || 0,
    draft: salesOrders?.filter((s) => s.status === "draft").length || 0,
    pending: salesOrders?.filter((s) => s.status === "pending").length || 0,
    approved: salesOrders?.filter((s) => s.status === "accountant_approved").length || 0,
    shipped: salesOrders?.filter((s) => s.status === "shipped").length || 0,
  }

  const lowStock = inventory?.filter((item) => item.quantity <= item.reorder_point) || []
  const overdueAR = arInvoices?.filter((inv) => inv.due_date < today && inv.status !== "paid") || []
  const overdueAP = apInvoices?.filter((inv) => inv.due_date < today && inv.status !== "paid") || []

  const customerRevenue = new Map<string, { name: string; revenue: number; orders: number }>()
  salesOrders?.forEach((so) => {
    const name = so.customers?.customer_name || "Unknown"
    const existing = customerRevenue.get(name) || { name, revenue: 0, orders: 0 }
    existing.revenue += so.total || 0
    existing.orders += 1
    customerRevenue.set(name, existing)
  })
  const topCustomers = Array.from(customerRevenue.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  return `
=== CURRENT BUSINESS DATA (Real-time) ===

FINANCIAL SUMMARY:
- Current Cash Balance: EGP ${currentBalance.toLocaleString()}
- Inventory Value: EGP ${inventoryValue.toLocaleString()}
- Accounts Receivable (Outstanding): EGP ${totalAR.toLocaleString()}
- Accounts Payable (Outstanding): EGP ${totalAP.toLocaleString()}
- Total Assets: EGP ${(currentBalance + inventoryValue + totalAR).toLocaleString()}
- Net Worth: EGP ${(currentBalance + inventoryValue + totalAR - totalAP).toLocaleString()}

PURCHASE ORDERS:
- Total: ${poStatus.total} | Draft: ${poStatus.draft} | Pending: ${poStatus.pending} | Approved: ${poStatus.approved} | Received: ${poStatus.received}

SALES ORDERS:
- Total: ${soStatus.total} | Draft: ${soStatus.draft} | Pending: ${soStatus.pending} | Approved: ${soStatus.approved} | Shipped: ${soStatus.shipped}

INVENTORY STATUS:
- Total Items: ${inventory?.length || 0}
- Total Value: EGP ${inventoryValue.toLocaleString()}
- Low Stock Alerts: ${lowStock.length} items
${lowStock.length > 0 ? `- Low Stock Items: ${lowStock.map((i) => `${i.products?.product_name} (${i.quantity}/${i.reorder_point})`).join(", ")}` : ""}

OVERDUE PAYMENTS:
- Overdue Receivables: ${overdueAR.length} invoices totaling EGP ${overdueAR.reduce((s, i) => s + i.amount, 0).toLocaleString()}
${overdueAR
  .slice(0, 3)
  .map((inv) => `  - ${inv.customers?.customer_name}: EGP ${inv.amount.toLocaleString()} (due: ${inv.due_date})`)
  .join("\n")}
- Overdue Payables: ${overdueAP.length} invoices totaling EGP ${overdueAP.reduce((s, i) => s + i.amount, 0).toLocaleString()}
${overdueAP
  .slice(0, 3)
  .map((inv) => `  - ${inv.suppliers?.supplier_name}: EGP ${inv.amount.toLocaleString()} (due: ${inv.due_date})`)
  .join("\n")}

TOP CUSTOMERS BY REVENUE:
${topCustomers.map((c, i) => `${i + 1}. ${c.name}: EGP ${c.revenue.toLocaleString()} (${c.orders} orders)`).join("\n")}

ENTITY COUNTS:
- Customers: ${customers?.length || 0}
- Suppliers: ${suppliers?.length || 0}
`
}

const tools = [
  {
    type: "function",
    function: {
      name: "generate_sales_quotation",
      description:
        "Generate a professional PDF sales quotation based on inventory products. Use this when the user asks to create a quote, quotation, or price proposal for products.",
      parameters: {
        type: "object",
        properties: {
          customer_name: {
            type: "string",
            description: "Name of the customer or company requesting the quotation",
          },
          customer_email: {
            type: "string",
            description: "Customer email address (optional)",
          },
          customer_phone: {
            type: "string",
            description: "Customer phone number (optional)",
          },
          items: {
            type: "array",
            description: "List of products to include in the quotation",
            items: {
              type: "object",
              properties: {
                product_id: {
                  type: "number",
                  description: "ID of the product from inventory",
                },
                product_name: {
                  type: "string",
                  description: "Name of the product",
                },
                quantity: {
                  type: "number",
                  description: "Quantity of the product",
                },
                unit_price: {
                  type: "number",
                  description: "Unit price (optional, will be fetched from inventory if not provided)",
                },
              },
              required: ["product_id", "product_name", "quantity"],
            },
          },
          validity_days: {
            type: "number",
            description: "Number of days the quotation is valid (default: 30)",
          },
          notes: {
            type: "string",
            description: "Additional notes or terms for the quotation (optional)",
          },
        },
        required: ["customer_name", "items"],
      },
    },
  },
]

export async function POST(req: Request) {
  try {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

    if (!geminiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Gemini API key not configured. Please add GEMINI_API_KEY or GOOGLE_API_KEY in the Vars section. Get a free key at https://aistudio.google.com/app/apikey",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      )
    }

    const { messages } = await req.json()
    const businessContext = await getBusinessContext()

    const systemPrompt = `You are the AI CEO Assistant for Misr Motors, a water pump distribution company in Egypt.

You have access to the following real-time business data:
${businessContext}

Your role:
- Provide executive-level insights and strategic analysis based on the data above
- Answer questions about finances, operations, inventory, customers, and suppliers
- Identify business risks and opportunities
- Offer data-driven recommendations
- **Generate professional sales quotations** when requested using the generate_sales_quotation function

**When generating quotations:**
- Extract product IDs and names from the inventory data above
- Use reasonable quantities if not specified
- Include current unit prices from inventory
- Add professional notes about payment terms and delivery

Communication style:
- Professional and executive-focused
- Use the actual data provided to back up insights
- Be concise but thorough
- Highlight both opportunities and risks
- Format numbers with proper currency (EGP) and use tables when helpful
- Always reference specific numbers from the data when answering questions`

    const geminiMessages = messages
      .filter((m: { role?: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
        const hasContent = m.content && typeof m.content === "string" && m.content.trim() !== ""
        const hasTextPart = m.parts?.some((p) => p.type === "text" && p.text)
        return hasContent || hasTextPart
      })
      .map((m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
        let content = m.content
        if (!content && m.parts) {
          const textPart = m.parts.find((p) => p.type === "text" && p.text)
          content = textPart?.text || ""
        }
        return {
          role: m.role === "user" ? "user" : "model",
          content: content || "",
        }
      })
      .filter((m: { content: string }) => m.content.trim() !== "")

    if (geminiMessages.length === 0) {
      return new Response(JSON.stringify({ error: "Please enter a message to continue." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      {
        role: "model",
        parts: [{ text: "I understand. I'm ready to assist you as the CEO Assistant for Misr Motors." }],
      },
      ...geminiMessages.map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    ]

    const requestBody: any = {
      contents,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
      tools: [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })),
        },
      ],
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:streamGenerateContent?key=${geminiKey}&alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    )

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || ""
      let errorMessage = "Gemini API error. Please try again."

      if (response.status >= 500) {
        errorMessage = "Gemini service is temporarily unavailable. Please try again in a few minutes."
      } else if (contentType.includes("application/json")) {
        try {
          const errorData = await response.json()
          errorMessage = errorData.error?.message || errorMessage
        } catch {
          // Couldn't parse JSON
        }
      } else if (response.status === 401 || response.status === 403) {
        errorMessage =
          "Invalid Gemini API key. Get a free key at https://aistudio.google.com/app/apikey and add it to Vars section."
      } else if (response.status === 429) {
        errorMessage = "Rate limit exceeded. Please wait a moment and try again."
      }

      console.error("[v0] Gemini API error:", response.status, errorMessage)
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader()
        if (!reader) {
          controller.close()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ""

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim()
                if (!data || data === "[DONE]") continue

                try {
                  const json = JSON.parse(data)
                  const candidate = json.candidates?.[0]

                  if (!candidate) continue

                  // Check for function call
                  const functionCall = candidate.content?.parts?.find((part: any) => part.functionCall)
                  if (functionCall) {
                    try {
                      const args = functionCall.functionCall.args
                      console.log("[v0] CEO Chat - Generating quotation:", args)

                      // Generate quotation number
                      const quotationNumber = `QT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
                      const quotationUrl = `/api/quotations/generate?data=${encodeURIComponent(JSON.stringify(args))}&qn=${quotationNumber}`

                      // Send quotation link to client
                      const message = `\n\n📄 **Sales Quotation Generated**\n\nQuotation Number: ${quotationNumber}\nCustomer: ${args.customer_name}\nItems: ${args.items.length} product(s)\n\n[View/Download Quotation](${quotationUrl})\n\nThe quotation includes all product details, pricing, and terms.`
                      controller.enqueue(encoder.encode(`0:${JSON.stringify(message)}\n`))
                    } catch (error) {
                      console.error("[v0] CEO Chat - Tool call error:", error)
                      controller.enqueue(
                        encoder.encode(`0:${JSON.stringify("\n\nError generating quotation. Please try again.")}\n`),
                      )
                    }
                    continue
                  }

                  // Regular text streaming
                  const text = candidate.content?.parts?.map((part: any) => part.text).join("") || ""
                  if (text) {
                    controller.enqueue(encoder.encode(`0:${JSON.stringify(text)}\n`))
                  }
                } catch (e) {
                  // Skip invalid JSON
                  console.warn("[v0] Failed to parse Gemini response line:", e)
                }
              }
            }
          }
        } catch (error) {
          console.error("[v0] Stream error:", error)
        } finally {
          controller.enqueue(encoder.encode("0:\n"))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error: unknown) {
    console.error("[v0] CEO Chat error:", error)
    return new Response(
      JSON.stringify({
        error: "AI service error. Please try again.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )
  }
}
