"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"
import type { UserRole } from "@/lib/types"
import { Send, Loader2, Bot, UserIcon } from "lucide-react"

interface AIAssistantModuleProps {
  userRole: UserRole
}

interface Message {
  role: "user" | "assistant"
  content: string
  action?: any
}

export function AIAssistantModule({ userRole }: AIAssistantModuleProps) {
  const { t } = useI18n()
  const {
    suppliers,
    products,
    setPurchaseOrders,
    purchaseOrders,
    salesOrders,
    inventory,
    supplierInvoices,
    customerInvoices,
    prepaidBalance,
    customers,
  } = useAppContext()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const isCEO = userRole === "ceo"
  const apiEndpoint = isCEO ? "/api/ai/ceo-assistant" : "/api/ai/po-assistant"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      role: "user",
      content: inputValue,
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)

    try {
      const requestBody = isCEO
        ? {
            message: inputValue,
            businessData: {
              purchaseOrders,
              salesOrders,
              inventory,
              supplierInvoices,
              customerInvoices,
              suppliers,
              customers,
              products,
              prepaidBalance,
            },
          }
        : {
            messages: [...messages, userMessage],
            suppliers,
            products,
          }

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.content || data.answer,
        action: data.action,
      }

      setMessages((prev) => [...prev, assistantMessage])

      // Handle action if present (for PO creation)
      if (!isCEO && data.action?.type === "createPurchaseOrder") {
        const { supplierName, items, paymentMethod, installmentMonths, totalAmount } = data.action.data

        const supplier = suppliers.find((s) => s.name === supplierName)

        if (supplier) {
          const newPO = {
            id: Date.now().toString(),
            poNumber: `PO-${Date.now()}`,
            supplierId: supplier.id,
            supplierName: supplier.name,
            date: new Date().toISOString().split("T")[0],
            items: items.map((item: any) => ({
              id: Date.now().toString() + Math.random(),
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitCost,
              total: item.quantity * item.unitCost,
            })),
            totalAmount,
            status: "pending" as const,
            paymentMethod: paymentMethod === "installments" ? ("installment" as const) : ("prepaid" as const),
            installmentMonths: installmentMonths || undefined,
          }

          setPurchaseOrders([...purchaseOrders, newPO])

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `✅ Purchase order ${newPO.poNumber} has been created and added to the system! It's now pending CEO approval.`,
            },
          ])
        }
      }
    } catch (error: any) {
      console.error("AI assistant error:", error)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <PageHeader
        group={t("group.overview")}
        title={t("module.ai-assistant")}
        subtitle={
          isCEO
            ? "Ask me anything about your business - assets, debt, orders, receivables, and more!"
            : "Create purchase orders using natural language. Just tell me what you need!"
        }
      />

      <Card className="flex-1 flex flex-col">
        <CardHeader>
          <CardTitle>Chat with AI Assistant</CardTitle>
          <CardDescription>
            {isCEO
              ? 'Try: "How much debt do we have?" or "What POs are in progress?" or "Show me late receivables"'
              : 'Try: "Order 50 water pumps from ABC Supplier" or "Show me available suppliers"'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-[400px] max-h-[600px]">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">Start a conversation</p>
                <p className="text-sm mt-2">
                  {isCEO
                    ? "Ask me about your business metrics, financial health, or operational status!"
                    : "Ask me to create purchase orders and I'll help you!"}
                </p>
                <div className="mt-6 space-y-2 text-sm text-start max-w-md mx-auto">
                  <p className="font-medium">Example requests:</p>
                  {isCEO ? (
                    <ul className="space-y-1 ms-4">
                      <li>• "How much total assets do we have?"</li>
                      <li>• "What's our current debt situation?"</li>
                      <li>• "Show me all purchase orders in progress"</li>
                      <li>• "Which accounts receivable are late?"</li>
                      <li>• "What's our inventory value?"</li>
                      <li>• "Give me a business overview"</li>
                    </ul>
                  ) : (
                    <ul className="space-y-1 ms-4">
                      <li>• "Show me available suppliers"</li>
                      <li>• "Show me available products"</li>
                      <li>• "Order 50 water pumps from [supplier name]"</li>
                      <li>• "Purchase 100 units with 6 month installments"</li>
                    </ul>
                  )}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                )}

                <div
                  className={`rounded-lg px-4 py-3 max-w-[80%] ${
                    message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>

                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <UserIcon className="w-5 h-5 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="rounded-lg px-4 py-3 bg-muted">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button type="submit" disabled={isLoading || !inputValue.trim()} size="icon" aria-label={t("action.send")}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </CardContent>
      </Card>

      {!isCEO && (
        <Card>
          <CardHeader>
            <CardTitle>Available Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium mb-2">Suppliers ({suppliers.length})</p>
                <ul className="space-y-1 text-muted-foreground">
                  {suppliers.slice(0, 5).map((s) => (
                    <li key={s.id}>• {s.name}</li>
                  ))}
                  {suppliers.length > 5 && <li>• ... and {suppliers.length - 5} more</li>}
                </ul>
              </div>
              <div>
                <p className="font-medium mb-2">Products ({products.length})</p>
                <ul className="space-y-1 text-muted-foreground">
                  {products.slice(0, 5).map((p) => (
                    <li key={p.id}>• {p.name}</li>
                  ))}
                  {products.length > 5 && <li>• ... and {products.length - 5} more</li>}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
