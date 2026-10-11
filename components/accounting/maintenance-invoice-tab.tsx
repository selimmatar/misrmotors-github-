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
import { DollarSign, FileText, Eye, Wrench } from "lucide-react"
import { WorkflowStatusBadge, WorkflowTimeline } from "@/components/maintenance/workflow-status-manager"
import { Money } from "@/components/erp/money"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { useI18n } from "@/lib/i18n-context"
import { formatDate } from "@/lib/format"
import { fill } from "@/lib/i18n-format"

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

export function MaintenanceInvoiceTab({ showHeading = true }: { showHeading?: boolean }) {
  const { language, t } = useI18n()
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
        alert(t("mi.invoice-created"))
        setSelectedOrder(null)
        setInvoiceNotes("")
        setPaymentTerms("net_30")
        setCustomDays("30")
        setInvoiceAmount("")
        mutate()
      } else {
        const error = await response.json()
        alert(fill(t("mi.error-with-message"), { error: error.error }))
      }
    } catch (error) {
      console.error("Error creating invoice:", error)
      alert(t("mi.failed-to-create-invoice"))
    } finally {
      setLoading(false)
    }
  }

  const pendingInvoice = workOrders.filter(wo => !wo.has_invoice)
  const invoiced = workOrders.filter(wo => wo.has_invoice)

  return (
    <div className="space-y-6">
      {showHeading && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{t("module.maintenance-invoices")}</h2>
            <p className="text-muted-foreground">{t("mi.subtitle")}</p>
          </div>
        </div>
      )}

      <KpiGrid className="lg:grid-cols-2">
        <KpiTile
          label={t("wo-flow.ready-for-invoice")}
          value={pendingInvoice.length}
          sub={<>{t("common.total")} <Money value={pendingInvoice.reduce((sum, wo) => sum + wo.actual_cost, 0)} /> {t("common.egp-2")}</>}
        />
        <KpiTile
          label={t("wo-flow.invoiced")}
          value={invoiced.length}
          sub={<>{t("common.total")} <Money value={invoiced.reduce((sum, wo) => sum + (wo.invoice_amount || wo.actual_cost), 0)} /> {t("common.egp-2")}</>}
        />
      </KpiGrid>

      <Card>
        <CardHeader>
          <CardTitle>{t("mi.pending-invoice-creation")}</CardTitle>
          <CardDescription>{t("mi.approved-ready-for-billing")}</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingInvoice.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <DollarSign className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t("mi.no-work-orders-ready")}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {t("mi.appear-after-approval")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.work-order")}</TableHead>
                  <TableHead>{t("common.sales-order")}</TableHead>
                  <TableHead>{t("so.customer")}</TableHead>
                  <TableHead>{t("common.title")}</TableHead>
                  <TableHead>{t("common.amount-egp")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvoice.map((order) => (
                  <TableRow key={order.work_order_id}>
                    <TableCell className="font-mono">{order.work_order_number}</TableCell>
                    <TableCell className="font-mono">{order.sales_order_number || "N/A"}</TableCell>
                    <TableCell>{order.customer_name}</TableCell>
                    <TableCell>{order.title}</TableCell>
                    <TableCell className="font-semibold"><Money value={order.actual_cost} /></TableCell>
                    <TableCell>
                      <WorkflowStatusBadge currentStage="ready_for_invoice" />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <FileText className="w-4 h-4 me-2" />
                        {t("ar.create-invoice")}
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("mi.create-maintenance-invoice")}</DialogTitle>
            <DialogDescription>
              {selectedOrder?.work_order_number} - {selectedOrder?.customer_name}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-6">
              <WorkflowTimeline currentStage="ready_for_invoice" />

              <Card>
                <CardHeader>
                  <CardTitle>{t("mi.work-order-summary")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.work-order")}</p>
                      <p className="font-mono font-semibold">{selectedOrder.work_order_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.sales-order")}</p>
                      <p className="font-mono">{selectedOrder.sales_order_number || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("description")}</p>
                      <p className="font-semibold">{selectedOrder.description}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("mi.actual-hours")}</p>
                      <p className="font-semibold">{selectedOrder.actual_hours || 0} {t("mi.hrs")}</p>
                    </div>
                  </div>

                  {/* Cost Breakdown */}
                  <div className="grid grid-cols-3 gap-4 pt-3 border-t">
                    <div className="p-3 bg-muted rounded-md text-center">
                      <p className="text-xs text-muted-foreground">{t("common.labor-cost-egp")}</p>
                      <p className="text-lg font-bold"><Money value={selectedOrder.labor_cost || 0} /></p>
                    </div>
                    <div className="p-3 bg-muted rounded-md text-center">
                      <p className="text-xs text-muted-foreground">{t("mi.parts-cost-egp")}</p>
                      <p className="text-lg font-bold"><Money value={selectedOrder.parts_cost || 0} /></p>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-md text-center">
                      <p className="text-xs text-muted-foreground">{t("mi.total-cost-egp")}</p>
                      <p className="text-lg font-bold"><Money value={selectedOrder.actual_cost || 0} /></p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">{t("mi.report-summary")}</p>
                    <p className="text-sm">{selectedOrder.report_summary}</p>
                  </div>
                  
                  {selectedOrder.uploaded_pdf_url && (
                    <div className="pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(selectedOrder.uploaded_pdf_url, '_blank')}
                      >
                        <FileText className="w-4 h-4 me-2" />
                        {t("mi.view-completed-pdf")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="invoice-amount">{t("mi.invoice-amount-egp")}</Label>
                    <Input
                      id="invoice-amount"
                      type="number"
                      step="0.01"
                      placeholder={selectedOrder.actual_cost.toFixed(2)}
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("mi.suggested")} <Money value={selectedOrder.actual_cost} /> {t("common.egp-2")}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="payment-terms">{t("field.payment-terms")}</Label>
                    <select
                      id="payment-terms"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                    >
                      <option value="due_on_receipt">{t("mi.due-on-receipt")}</option>
                      <option value="net_15">{t("mi.net-15")}</option>
                      <option value="net_30">{t("mi.net-30")}</option>
                      <option value="net_45">{t("mi.net-45")}</option>
                      <option value="net_60">{t("mi.net-60")}</option>
                      <option value="net_90">{t("mi.net-90")}</option>
                      <option value="custom">{t("mi.custom")}</option>
                    </select>
                  </div>
                </div>

                {paymentTerms === "custom" && (
                  <div className="space-y-2">
                    <Label htmlFor="custom-days">{t("mi.custom-payment-days")}</Label>
                    <Input
                      id="custom-days"
                      type="number"
                      placeholder={t("mi.enter-number-of-days")}
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                    />
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="invoice-notes">{t("mi.invoice-notes-optional")}</Label>
                  <Textarea
                    id="invoice-notes"
                    placeholder={t("mi.add-notes-placeholder")}
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-blue-900 mb-1">{t("ar.invoice-will-be-created")}</h4>
                      <div className="space-y-1 text-sm text-blue-700">
                        <p>{t("common.customer")} <span className="font-semibold">{selectedOrder.customer_name}</span></p>
                        <p>{t("mi.amount-colon")} <span className="font-semibold"><Money value={parseFloat(invoiceAmount) || selectedOrder.actual_cost} /> {t("common.egp-2")}</span></p>
                        <p>{t("mi.payment-terms-colon")} <span className="font-semibold">
                          {paymentTerms === "custom" ? fill(t("mi.net-days"), { days: customDays }) : paymentTerms.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}
                        </span></p>
                        <p>{t("mi.due-date-colon")} <span className="font-semibold">
                          {formatDate(new Date(Date.now() + (paymentTerms === "custom" ? parseInt(customDays || "0") : parseInt(paymentTerms.split("_")[1] || "0")) * 24 * 60 * 60 * 1000), language)}
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
                  {t("cancel")}
                </Button>
                <Button
                  onClick={handleCreateInvoice}
                  disabled={loading}
                >
                  <FileText className="w-4 h-4 me-2" />
                  {t("ar.create-invoice")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
