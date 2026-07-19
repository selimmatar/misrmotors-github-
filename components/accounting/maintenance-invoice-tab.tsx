"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DollarSign, FileText, Eye, CheckCircle, Wrench } from "lucide-react"
import { WorkflowStatusBadge, WorkflowTimeline } from "@/components/maintenance/workflow-status-manager"

interface ApprovedWorkOrder {
  work_order_id: number
  work_order_number: string
  sales_order_number?: string
  customer_id: number
  customer_name: string
  title: string
  description: string
  actual_cost: number
  labor_cost?: number
  parts_cost?: number
  invoice_amount?: number
  report_summary: string
  report_findings: string
  actual_hours: number
  submitted_at: string
  uploaded_pdf_url?: string | null
  status: string
  has_invoice: boolean
}

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(r))

export function MaintenanceInvoiceTab() {
  const { data: workOrders = [], mutate } = useSWR<ApprovedWorkOrder[]>(
    "/api/maintenance/work-orders/ready-for-invoice",
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  )
  const [selectedOrder, setSelectedOrder] = useState<ApprovedWorkOrder | null>(null)
  const [loading, setLoading] = useState(false)
  const [invoiceNotes, setInvoiceNotes] = useState("")
  const [paymentTerms, setPaymentTerms] = useState("net_30")
  const [customDays, setCustomDays] = useState("30")
  const [invoiceAmount, setInvoiceAmount] = useState("")

  const handleCreateInvoice = async () => {
    if (!selectedOrder) return
    
    const finalAmount = parseFloat(invoiceAmount) || selectedOrder.actual_cost
    const daysToAdd = paymentTerms === "custom" ? parseInt(customDays) : parseInt(paymentTerms.split("_")[1])
    
    setLoading(true)
    try {
      const response = await fetch("/api/maintenance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: selectedOrder.work_order_id,
          customer_id: selectedOrder.customer_id,
          amount: finalAmount,
          payment_terms: paymentTerms === "custom" ? `Net ${customDays} Days` : paymentTerms.replace("_", " ").toUpperCase(),
          due_days: daysToAdd,
          notes: invoiceNotes,
        }),
      })

      if (response.ok) {
        alert("Invoice created successfully!")
        setSelectedOrder(null)
        setInvoiceNotes("")
        setPaymentTerms("net_30")
        setCustomDays("30")
        setInvoiceAmount("")
        mutate()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error("Error creating invoice:", error)
      alert("Failed to create invoice")
    } finally {
      setLoading(false)
    }
  }

  const pendingInvoice = workOrders.filter(wo => !wo.has_invoice)
  const invoiced = workOrders.filter(wo => wo.has_invoice)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Maintenance Invoices</h2>
          <p className="text-muted-foreground">Create invoices for approved maintenance work orders</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ready for Invoice</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingInvoice.length}</div>
            <p className="text-xs text-muted-foreground">
              Total: EGP {pendingInvoice.reduce((sum, wo) => sum + wo.actual_cost, 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invoiced</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invoiced.length}</div>
            <p className="text-xs text-muted-foreground">
              Total: EGP {invoiced.reduce((sum, wo) => sum + (wo.invoice_amount || wo.actual_cost), 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Invoice Creation</CardTitle>
          <CardDescription>Approved maintenance work orders ready for billing</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingInvoice.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <DollarSign className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No work orders ready for invoice</p>
              <p className="text-sm text-muted-foreground mt-2">
                Work orders will appear here after sales approval
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Work Order</TableHead>
                  <TableHead>Sales Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvoice.map((order) => (
                  <TableRow key={order.work_order_id}>
                    <TableCell className="font-mono">{order.work_order_number}</TableCell>
                    <TableCell className="font-mono">{order.sales_order_number || "N/A"}</TableCell>
                    <TableCell>{order.customer_name}</TableCell>
                    <TableCell>{order.title}</TableCell>
                    <TableCell className="font-semibold">EGP {order.actual_cost.toFixed(2)}</TableCell>
                    <TableCell>
                      <WorkflowStatusBadge currentStage="ready_for_invoice" />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Create Invoice
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Invoice Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Maintenance Invoice</DialogTitle>
            <DialogDescription>
              {selectedOrder?.work_order_number} - {selectedOrder?.customer_name}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-6">
              <WorkflowTimeline currentStage="ready_for_invoice" />

              <Card>
                <CardHeader>
                  <CardTitle>Work Order Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Work Order</p>
                      <p className="font-mono font-semibold">{selectedOrder.work_order_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Sales Order</p>
                      <p className="font-mono">{selectedOrder.sales_order_number || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Description</p>
                      <p className="font-semibold">{selectedOrder.description}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Actual Hours</p>
                      <p className="font-semibold">{selectedOrder.actual_hours || 0} hrs</p>
                    </div>
                  </div>

                  {/* Cost Breakdown */}
                  <div className="grid grid-cols-3 gap-4 pt-3 border-t">
                    <div className="p-3 bg-muted rounded-md text-center">
                      <p className="text-xs text-muted-foreground">Labor Cost</p>
                      <p className="text-lg font-bold">EGP {(selectedOrder.labor_cost || 0).toLocaleString()}</p>
                    </div>
                    <div className="p-3 bg-muted rounded-md text-center">
                      <p className="text-xs text-muted-foreground">Parts Cost</p>
                      <p className="text-lg font-bold">EGP {(selectedOrder.parts_cost || 0).toLocaleString()}</p>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-md text-center">
                      <p className="text-xs text-muted-foreground">Total Cost</p>
                      <p className="text-lg font-bold">EGP {(selectedOrder.actual_cost || 0).toLocaleString()}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Report Summary</p>
                    <p className="text-sm">{selectedOrder.report_summary}</p>
                  </div>
                  
                  {selectedOrder.uploaded_pdf_url && (
                    <div className="pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(selectedOrder.uploaded_pdf_url, '_blank')}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        View Completed Work Order PDF
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="invoice-amount">Invoice Amount (EGP)</Label>
                    <Input
                      id="invoice-amount"
                      type="number"
                      step="0.01"
                      placeholder={selectedOrder.actual_cost.toFixed(2)}
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Suggested: EGP {selectedOrder.actual_cost.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="payment-terms">Payment Terms</Label>
                    <select
                      id="payment-terms"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                    >
                      <option value="due_on_receipt">Due on Receipt</option>
                      <option value="net_15">Net 15 Days</option>
                      <option value="net_30">Net 30 Days</option>
                      <option value="net_45">Net 45 Days</option>
                      <option value="net_60">Net 60 Days</option>
                      <option value="net_90">Net 90 Days</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>

                {paymentTerms === "custom" && (
                  <div className="space-y-2">
                    <Label htmlFor="custom-days">Custom Payment Days</Label>
                    <Input
                      id="custom-days"
                      type="number"
                      placeholder="Enter number of days"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                    />
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="invoice-notes">Invoice Notes (Optional)</Label>
                  <Textarea
                    id="invoice-notes"
                    placeholder="Add any additional notes for the invoice..."
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-blue-900 mb-1">Invoice Preview</h4>
                      <div className="space-y-1 text-sm text-blue-700">
                        <p>Customer: <span className="font-semibold">{selectedOrder.customer_name}</span></p>
                        <p>Amount: <span className="font-semibold">EGP {(parseFloat(invoiceAmount) || selectedOrder.actual_cost).toFixed(2)}</span></p>
                        <p>Payment Terms: <span className="font-semibold">
                          {paymentTerms === "custom" ? `Net ${customDays} Days` : paymentTerms.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}
                        </span></p>
                        <p>Due Date: <span className="font-semibold">
                          {new Date(Date.now() + (paymentTerms === "custom" ? parseInt(customDays || "0") : parseInt(paymentTerms.split("_")[1] || "0")) * 24 * 60 * 60 * 1000).toLocaleDateString()}
                        </span></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedOrder(null)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateInvoice}
                  disabled={loading}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Create Invoice
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
