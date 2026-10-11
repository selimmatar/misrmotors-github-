"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/erp/page-header"
import { Money } from "@/components/erp/money"
import { formatDate, formatMoney } from "@/lib/format"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import type { SalesOrder } from "@/lib/types"
import { Eye, CheckCircle, XCircle, Loader2 } from "lucide-react"

export function ApproveSalesOrdersModule() {
  const { salesOrders, updateSalesOrder, customers } = useAppContext()
  const { t, formatNumber, language } = useI18n()

  const [selectedSalesOrder, setSelectedSalesOrder] = useState<SalesOrder | null>(null)
  const [actionDialog, setActionDialog] = useState<{ order: SalesOrder; action: "approve" | "reject" } | null>(null)
  const [comment, setComment] = useState("")
  const [processing, setProcessing] = useState(false)

  const pendingSalesOrders = salesOrders.filter((so) => so.status === "pending_accountant")

  const getCustomerName = (customerId: string) => {
    return customers.find((c) => c.id === customerId)?.name || t("customer.unknown")
  }

  const handleAction = async () => {
    if (!actionDialog) return
    
    const { order, action } = actionDialog
    setProcessing(true)

    try {
      const finalId = (order as any).soId || order.id
      const newStatus = action === "approve" ? "accountant_approved" : "rejected"

      await updateSalesOrder({
        id: finalId,
        status: newStatus,
        notes: comment ? `[Accountant ${action === "approve" ? "Approved" : "Rejected"}] ${comment}` : order.notes,
      })

      alert(action === "approve" ? "Sales order approved successfully!" : "Sales order rejected.")
      setActionDialog(null)
      setComment("")
    } catch (error) {
      alert(`Failed to ${actionDialog.action} sales order: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.sales")} title={t("module.approve-sales-orders")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("approve.pending")}</CardTitle>
          <CardDescription>{t("approve.pending-desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingSalesOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t("approve.no-orders")}</p>
              <p className="text-sm mt-2">{t("approve.no-orders-note")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingSalesOrders.map((order) => (
                <div key={order.id} className="border rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("so.number")}</p>
                      <p className="font-semibold">{order.soNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                      <p className="font-semibold">{getCustomerName(order.customerId)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.amount")} (EGP)</p>
                      <p className="font-semibold"><Money value={order.total} /></p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("so.payment-terms")}</p>
                      <p className="font-semibold">{t(`payment.${order.paymentType || order.paymentTerms || "cash"}`)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => { setActionDialog({ order, action: "approve" }); setComment(""); }}
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-2"
                      onClick={() => { setActionDialog({ order, action: "reject" }); setComment(""); }}
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 bg-transparent"
                      onClick={() => setSelectedSalesOrder(order)}
                    >
                      <Eye className="w-4 h-4" />
                      {t("field.view-details")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve / Reject Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => { if (!open) { setActionDialog(null); setComment(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.action === "approve" ? "Approve Sales Order" : "Reject Sales Order"}
            </DialogTitle>
            <DialogDescription>
              {actionDialog?.action === "approve"
                ? `Approve ${actionDialog?.order.soNumber} for ${formatMoney(actionDialog?.order.total || 0, language)} EGP?`
                : `Reject ${actionDialog?.order.soNumber}? Please provide a reason.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="comment">
                Comment {actionDialog?.action === "reject" && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                id="comment"
                placeholder={actionDialog?.action === "approve" ? "Optional comment..." : "Reason for rejection..."}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setActionDialog(null); setComment(""); }} disabled={processing}>
              Cancel
            </Button>
            <Button
              variant={actionDialog?.action === "approve" ? "default" : "destructive"}
              onClick={handleAction}
              disabled={processing || (actionDialog?.action === "reject" && !comment.trim())}
              className="gap-2"
            >
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : actionDialog?.action === "approve" ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {processing ? "Processing..." : actionDialog?.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sales Order Details Dialog */}
      <Dialog open={!!selectedSalesOrder} onOpenChange={(open) => !open && setSelectedSalesOrder(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("approve.order-details")}</DialogTitle>
            <DialogDescription>{t("approve.order-details-desc")}</DialogDescription>
          </DialogHeader>
          {selectedSalesOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("so.number")}</p>
                  <p className="font-semibold">{selectedSalesOrder.soNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                  <p className="font-semibold">{getCustomerName(selectedSalesOrder.customerId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("so.order-date")}</p>
                  <p className="font-semibold">{formatDate(selectedSalesOrder.orderDate, language)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("so.payment-terms")}</p>
                  <p className="font-semibold">{t(`payment.${selectedSalesOrder.paymentTerms}`)}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">{t("field.items")}</p>
                <div className="border rounded-lg p-4 space-y-2">
                  {selectedSalesOrder.items.map((item) => (
                    <div key={item.productId} className="flex justify-between">
                      <span>
                        {item.productName} ({t("field.quantity")}: {formatNumber(item.quantity)})
                      </span>
                      <span className="font-semibold"><Money value={item.total} /> EGP</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between">
                  <span className="font-semibold">{t("field.total-amount")} (EGP)</span>
                  <span className="text-lg font-bold"><Money value={selectedSalesOrder.total} /></span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
