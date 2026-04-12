"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Mail,
  Clock,
  Send,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Calendar,
  DollarSign,
  Users,
  Bot,
  Zap,
  Settings,
} from "lucide-react"

interface UpcomingInvoice {
  invoice_id: number
  invoice_number: string
  customer_id: number
  customer_name: string
  customer_email: string
  amount: number
  collected_amount: number
  balance: number
  due_date: string
  installment_months: number
  months_paid: number
  status: string
  daysUntilDue: number
  amountDue: number
}

interface EmailResult {
  success: boolean
  customerId: number
  customerName: string
  customerEmail: string
  invoiceNumber: string
  amount: number
  dueDate: string
  error?: string
}

interface AgentExecutionResult {
  success: boolean
  dryRun: boolean
  summary: {
    totalProcessed: number
    emailsSent: number
    failed: number
    daysAhead: number
  }
  results: EmailResult[]
}

export function PaymentReminderModule() {
  const [loading, setLoading] = useState(false)
  const [upcomingInvoices, setUpcomingInvoices] = useState<UpcomingInvoice[]>([])
  const [executionResult, setExecutionResult] = useState<AgentExecutionResult | null>(null)
  const [daysAhead, setDaysAhead] = useState(5)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [activeTab, setActiveTab] = useState("preview")

  // Fetch upcoming invoices for preview
  const fetchUpcomingInvoices = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/ai/payment-reminder-agent?days=${daysAhead}`)
      const data = await response.json()

      if (data.success) {
        setUpcomingInvoices(data.invoices || [])
      }
    } catch (error) {
      console.error("Error fetching upcoming invoices:", error)
    } finally {
      setLoading(false)
    }
  }

  // Execute the agent (send emails)
  const executeAgent = async (dryRun = false) => {
    setLoading(true)
    setExecutionResult(null)

    try {
      const response = await fetch("/api/ai/payment-reminder-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daysAhead,
          webhookUrl: webhookUrl || undefined,
          dryRun,
        }),
      })

      const data = await response.json()
      setExecutionResult(data)
      setActiveTab("results")
    } catch (error) {
      console.error("Error executing agent:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUpcomingInvoices()
  }, [daysAhead])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-EG", {
      style: "currency",
      currency: "EGP",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-7 w-7 text-primary" />
            Payment Reminder Agent
          </h2>
          <p className="text-muted-foreground mt-1">
            Automatically send payment reminders to customers before their due dates
          </p>
        </div>
        <Button onClick={() => fetchUpcomingInvoices()} variant="outline" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Upcoming Payments</p>
                <p className="text-3xl font-bold text-blue-600">{upcomingInvoices.length}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Amount Due</p>
                <p className="text-3xl font-bold text-green-600">
                  {formatCurrency(upcomingInvoices.reduce((sum, inv) => sum + inv.amountDue, 0))}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Customers to Contact</p>
                <p className="text-3xl font-bold text-purple-600">
                  {new Set(upcomingInvoices.map((inv) => inv.customer_id)).size}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Reminder Window</p>
                <p className="text-3xl font-bold text-orange-600">{daysAhead} days</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                <Clock className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Agent Configuration
          </CardTitle>
          <CardDescription>Configure the payment reminder agent settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="daysAhead">Days Before Due Date</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="daysAhead"
                  type="number"
                  min={1}
                  max={30}
                  value={daysAhead}
                  onChange={(e) => setDaysAhead(Number.parseInt(e.target.value) || 5)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  Send reminders to customers with payments due within this window
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL (Optional)</Label>
              <Input
                id="webhookUrl"
                type="url"
                placeholder="https://your-n8n-instance.com/webhook/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Connect to n8n, Zapier, or other automation tools to handle email delivery
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Preview ({upcomingInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="results" className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Execution Results
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Upcoming Payment Reminders</CardTitle>
                  <CardDescription>Invoices with payments due within {daysAhead} days</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => executeAgent(true)}
                    disabled={loading || upcomingInvoices.length === 0}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Dry Run
                  </Button>
                  <Button
                    onClick={() => executeAgent(false)}
                    disabled={loading || upcomingInvoices.length === 0}
                    className="bg-gradient-to-r from-blue-600 to-blue-700"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Reminders
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {upcomingInvoices.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <p className="text-lg font-medium">No payments due within {daysAhead} days</p>
                  <p className="text-muted-foreground">All customers are up to date!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingInvoices.map((invoice) => (
                    <div
                      key={invoice.invoice_id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Mail className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{invoice.customer_name}</span>
                            <Badge variant="outline" className="text-xs">
                              {invoice.invoice_number}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{invoice.customer_email || "No email"}</span>
                            {invoice.installment_months > 1 && (
                              <Badge variant="secondary" className="text-xs">
                                {invoice.months_paid}/{invoice.installment_months} paid
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-lg">{formatCurrency(invoice.amountDue)}</div>
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-3 w-3" />
                          <span
                            className={invoice.daysUntilDue <= 2 ? "text-red-500 font-medium" : "text-muted-foreground"}
                          >
                            Due in {invoice.daysUntilDue} day{invoice.daysUntilDue !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution Results</CardTitle>
              <CardDescription>Results from the last agent execution</CardDescription>
            </CardHeader>
            <CardContent>
              {!executionResult ? (
                <div className="text-center py-12">
                  <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">No execution yet</p>
                  <p className="text-muted-foreground">Run the agent to see results here</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <div className="text-sm text-blue-600 font-medium">Total Processed</div>
                      <div className="text-2xl font-bold">{executionResult.summary.totalProcessed}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="text-sm text-green-600 font-medium">Emails Sent</div>
                      <div className="text-2xl font-bold">{executionResult.summary.emailsSent}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                      <div className="text-sm text-red-600 font-medium">Failed</div>
                      <div className="text-2xl font-bold">{executionResult.summary.failed}</div>
                    </div>
                  </div>

                  {executionResult.dryRun && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <AlertCircle className="h-5 w-5 text-yellow-600" />
                      <span className="text-yellow-600 font-medium">
                        This was a dry run - no emails were actually sent
                      </span>
                    </div>
                  )}

                  {/* Individual Results */}
                  <div className="space-y-2">
                    {executionResult.results.map((result, index) => (
                      <div
                        key={index}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          result.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {result.success ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <div className="font-medium">{result.customerName}</div>
                            <div className="text-sm text-muted-foreground">
                              {result.customerEmail} • {result.invoiceNumber}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{formatCurrency(result.amount)}</div>
                          {result.error && <div className="text-xs text-muted-foreground">{result.error}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
