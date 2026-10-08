"use client"

import { Calendar } from "@/components/ui/calendar"

import { Badge } from "@/components/ui/badge"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import type { SupplierInvoice, CustomerInvoice, SalesOrder } from "@/lib/types"
import { Eye, Upload, CheckCircle, Loader2, Wrench } from "lucide-react"
import { ReportGenerator } from "@/components/report-generator"
import { MaintenanceInvoiceTab } from "@/components/accounting/maintenance-invoice-tab"

export function AccountantModule({ defaultTab }: { defaultTab?: string }) {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const {
    supplierInvoices,
    updateSupplierInvoice,
    customerInvoices,
    loadData,
    salesOrders,
    updateSalesOrder,
    suppliers,
    customers,
    purchaseOrders,
    addCustomerInvoice,
  } = useAppContext()

  const markReceivedAttemptRef = useRef<{ scope: string; key: string } | null>(null)
  const markReceivedInFlightRef = useRef(false)

  const [selectedSupplierInvoice, setSelectedSupplierInvoice] = useState<SupplierInvoice | null>(null)
  const [selectedCustomerInvoice, setSelectedCustomerInvoice] = useState<CustomerInvoice | null>(null)
  const [selectedSalesOrder, setSelectedSalesOrder] = useState<SalesOrder | null>(null)
  const [uploadingOrderId, setUploadingOrderId] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null)

  const [customerPaymentsByCustomer, setCustomerPaymentsByCustomer] = useState<Record<string, number>>({})

  useEffect(() => {
    const fetchCustomerPayments = async () => {
      try {
        const response = await fetch("/api/customer-payments")
        
        if (!response.ok) {
          console.error("Customer payments fetch failed:", response.status, response.statusText)
          return
        }
        
        const data = await response.json()

        const paymentsByCustomer: Record<string, number> = {}
        data.forEach((payment: any) => {
          const customerId = payment.customer_id?.toString() || payment.customerId
          if (customerId) {
            paymentsByCustomer[customerId] = (paymentsByCustomer[customerId] || 0) + Number(payment.amount)
          }
        })

        setCustomerPaymentsByCustomer(paymentsByCustomer)
      } catch (error) {
        console.error("Error fetching customer payments:", error)
      }
    }

    fetchCustomerPayments()
    const interval = selectedCustomer ? setInterval(fetchCustomerPayments, 5000) : undefined
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [selectedCustomer])

  // Filter sales orders pending accountant approval
  const pendingSalesOrders = salesOrders.filter((so) => so.status === "pending_accountant")

  const { data: maintenanceWorkOrders } = useSWR(
    "/api/maintenance/work-orders/ready-for-invoice",
    (url: string) => fetch(url).then(r => r.ok ? r.json() : []),
    { refreshInterval: 30000, revalidateOnFocus: true }
  )
  const pendingMaintenanceInvoices = (maintenanceWorkOrders || []).filter((wo: any) => !wo.has_invoice).length

  const getSupplierName = (supplierId: string) => {
    return suppliers.find((s) => s.id === supplierId)?.name || "Unknown"
  }

  const getPONumber = (poId: string) => {
    return purchaseOrders.find((po) => po.id === poId)?.poNumber || "N/A"
  }

  const getInstallmentMonths = (poId: string) => {
    return purchaseOrders.find((po) => po.id === poId)?.installments || 0
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      pending_accountant: "bg-orange-100 text-orange-800",
      accountant_approved: "bg-blue-100 text-blue-800",
      approved: "bg-blue-100 text-blue-800",
      paid: "bg-green-100 text-green-800",
      ready_for_delivery: "bg-purple-100 text-purple-800", // Changed from 'out_for_delivery' to 'ready_for_delivery'
      shipped: "bg-sky-100 text-sky-800",
    }
    return colors[status] || "bg-gray-100 text-gray-800"
  }

  const installmentSupplierInvoices = supplierInvoices.filter((inv) => {
    const po = purchaseOrders.find((p) => p.id === inv.poId)
    return po?.paymentTerms === "installment"
  })

  const installmentCustomerInvoices = customerInvoices.filter((inv) => {
    const so = salesOrders.find((s) => s.id === inv.soId)
    return so?.paymentTerms === "installment"
  })

  const addBalanceEntry = async (entry: {
    type: string
    referenceId: string
    referenceNumber: string
    amount: number
    description: string
  }) => {
    try {
      const response = await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entry.type,
          reference_id: entry.referenceId,
          reference_number: entry.referenceNumber,
          amount: entry.amount,
          description: entry.description,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Failed to add balance entry:", errorText)
      } else {
      }
    } catch (error) {
      console.error("Error adding balance entry:", error)
    }
  }

  const handleMarkSupplierPaid = (id: string) => {
    const invoice = supplierInvoices.find((i) => i.id === id)
    if (!invoice) return

    const installmentMonths = getInstallmentMonths(invoice.poId)
    const currentMonthsPaid = invoice.monthsPaid || 0
    const newMonthsPaid = currentMonthsPaid + 1

    const updatedInvoice = {
      ...invoice,
      monthsPaid: newMonthsPaid,
      status: (newMonthsPaid >= installmentMonths ? "paid" : invoice.status) as const,
    }
    updateSupplierInvoice(updatedInvoice)

    const monthlyAmount = installmentMonths ? invoice.amount / installmentMonths : 0
    const po = purchaseOrders.find((p) => p.id === invoice.poId)
    if (po) {
      addBalanceEntry({
        type: "ap_payment",
        referenceId: invoice.id,
        referenceNumber: invoice.invoiceNumber,
        amount: -monthlyAmount, // Negative for expense
        description: `AP installment payment for ${po.poNumber} (${newMonthsPaid}/${installmentMonths})`,
      })
    }
  }

  // "Mark payment received" records one installment (invoice amount / the SO's installment count, as
  // before) through the authoritative AR payment endpoint. The server validates the amount, updates the
  // invoice with a guarded update and writes customer_payments + balance_entries; nothing else is written
  // from here.
  const handleMarkCustomerReceived = async (id: string) => {
    const invoice = customerInvoices.find((i) => i.id === id)
    if (!invoice) return
    if (markReceivedInFlightRef.current) return

    const so = salesOrders.find((s) => s.id === invoice.soId)
    const installmentMonths = so?.installments || 0
    if (installmentMonths <= 0) {
      alert("This invoice has no installment plan on its sales order, so the instalment amount cannot be determined. Use the Accounts Receivable screen to record the payment.")
      return
    }

    const invoiceAmount = invoice.amount || 0
    const collectedSoFar = invoice.collectedAmount || 0
    const monthsPaidSoFar = invoice.monthsPaid || 0
    const remaining = Math.round((invoiceAmount - collectedSoFar) * 100) / 100
    const installmentAmount = Math.round((invoiceAmount / installmentMonths) * 100) / 100
    const isFinalInstallment = monthsPaidSoFar + 1 >= installmentMonths
    // Final installment settles the exact remaining balance (avoids a rounding overshoot); otherwise never
    // more than the remaining balance. The server still rejects anything above the remaining balance.
    const paymentAmount =
      remaining > 0.005 ? (isFinalInstallment ? remaining : Math.min(installmentAmount, remaining)) : installmentAmount

    const scope = `accountant|${invoice.id}|${paymentAmount}|${collectedSoFar}|${monthsPaidSoFar}`
    if (!markReceivedAttemptRef.current || markReceivedAttemptRef.current.scope !== scope) {
      const unique =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      markReceivedAttemptRef.current = { scope, key: `ui-${unique}` }
    }

    markReceivedInFlightRef.current = true
    try {
      const response = await fetch("/api/accounts-receivable/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount: paymentAmount,
          paymentMethod: "installment_payment",
          label: `Month ${monthsPaidSoFar + 1}/${installmentMonths}`,
          idempotencyKey: markReceivedAttemptRef.current.key,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        if (response.status === 409 || data?.partialFailure) await loadData()
        alert(`${t("message.error")}: ${data?.error || `Payment failed (HTTP ${response.status})`}`)
        return
      }
      markReceivedAttemptRef.current = null
      await loadData()
    } catch (error: any) {
      console.error("Error recording customer payment:", error)
      alert(`${t("message.error")}: ${error?.message || ""}`)
    } finally {
      markReceivedInFlightRef.current = false
    }
  }

  const isPaymentDue = (invoiceDate: string, monthsPaid: number, installmentMonths: number): boolean => {
    if (!invoiceDate) return false

    const invoiceCreatedDate = new Date(invoiceDate)
    if (isNaN(invoiceCreatedDate.getTime())) return false

    // First payment shows immediately
    if (monthsPaid === 0) return true

    const today = new Date()
    const monthsElapsed =
      (today.getFullYear() - invoiceCreatedDate.getFullYear()) * 12 + (today.getMonth() - invoiceCreatedDate.getMonth())

    return monthsElapsed >= monthsPaid + 1 && monthsPaid < installmentMonths
  }

  const handleFileUpload = async (orderId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadingOrderId(orderId)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error("Upload failed with status:", response.status, "Error:", errorData)
        throw new Error(errorData.error || `Failed to upload file (${response.status})`)
      }

      const { url } = await response.json()

      // Update sales order with invoice file URL
      const order = salesOrders.find((so) => so.id === orderId || so.soId === orderId)
      if (!order) {
        throw new Error("Order not found in local state")
      }
      
      const finalId = order.soId || order.id
      
      // Only send the ID and invoice URL - don't spread the entire order object
      await updateSalesOrder({
        id: finalId,
        invoiceFileUrl: url,
        status: order.status, // Keep existing status
      })
      
      alert("Invoice uploaded successfully!")
      
      // Force a page refresh to ensure UI shows updated data
      window.location.reload()
    } catch (error: any) {
      console.error("Error uploading file:", error)
      const errorMessage = error?.message || "Failed to upload invoice. Please try again."
      alert(`Upload failed: ${errorMessage}`)
    } finally {
      setUploadingOrderId(null)
    }
  }

  const handleApproveSalesOrder = async (orderId: string) => {
    const order = salesOrders.find((so) => so.id === orderId)
    if (!order) return

    if (!order.invoiceFileUrl) {
      alert("Please upload an invoice before approving")
      return
    }

    const approvalDate = new Date()
    const approvalDateString = approvalDate.toISOString().split("T")[0]

    
    // Update status to accountant_approved
    const finalId = order.soId || order.id
    await updateSalesOrder({
      id: finalId,
      status: "accountant_approved",
    })

    
    // NOTE: Invoice creation removed from here.
    // Accountant must manually create invoices through the Accounts Receivable module
    // after delivery permits are approved using "Create from DPs" button.

    alert("Sales order approved!")
  }

  const getCustomerName = (customerId: string) => {
    return customers.find((c) => c.id === customerId)?.name || "Unknown"
  }

  const getCustomerOrders = (customerId: string) => {
    return salesOrders.filter((so) => so.customerId === customerId)
  }

  const getCustomerTotalSpent = (customerId: string) => {
    return salesOrders.filter((so) => so.customerId === customerId).reduce((sum, so) => sum + so.total, 0)
  }

  const getSupplierPOs = (supplierId: string) => {
    return purchaseOrders.filter((po) => po.supplierId === supplierId)
  }

  const getSupplierTotalSpent = (supplierId: string) => {
    return purchaseOrders.filter((po) => po.supplierId === supplierId).reduce((sum, po) => sum + po.total, 0)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Accountant Module</h1>
          <p className="text-muted-foreground mt-2">Manage invoices and approve sales orders</p>
        </div>
        <ReportGenerator type="financial" userRole="accountant" />
      </div>

      <Tabs defaultValue={defaultTab || "approve-so"} className="space-y-4">
        <TabsList className="grid w-full grid-cols-9">
          <TabsTrigger value="approve-so" className="relative">
            {t("tabs.approve_so")}
            {pendingSalesOrders.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {pendingSalesOrders.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="payment-schedule">Payment Schedule</TabsTrigger>
          <TabsTrigger value="pending-shipment">{t("tabs.pending_shipment")}</TabsTrigger>
          <TabsTrigger value="shipped">{t("tabs.shipped")}</TabsTrigger>
          <TabsTrigger value="ap">{t("tabs.ap")}</TabsTrigger>
          <TabsTrigger value="ar">{t("tabs.ar")}</TabsTrigger>
          <TabsTrigger value="customers">{t("tabs.customers")}</TabsTrigger>
          <TabsTrigger value="suppliers">{t("tabs.suppliers")}</TabsTrigger>
          <TabsTrigger value="maintenance-invoices" className="relative">
                  <Wrench className="w-4 h-4 mr-2" />
                  Maintenance
                  {pendingMaintenanceInvoices > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-1">
                      {pendingMaintenanceInvoices}
                    </span>
                  )}
                </TabsTrigger>
        </TabsList>

        {/* Payment Schedule Tab */}
        <TabsContent value="payment-schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Payment Schedules</CardTitle>
              <CardDescription>Manage installment payment plans for customers</CardDescription>
            </CardHeader>
            <CardContent>
              {customerInvoices.filter(inv => inv.installmentMonths > 0).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No active payment schedules</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customerInvoices.filter(inv => inv.installmentMonths > 0).map((invoice) => {
                    const so = salesOrders.find(s => s.id === invoice.soId)
                    const customer = customers.find(c => c.id === invoice.customerId)
                    const monthlyPayment = invoice.amount / (invoice.installmentMonths || 1)
                    const remaining = invoice.amount - (invoice.collectedAmount || 0)
                    const monthsRemaining = (invoice.installmentMonths || 0) - (invoice.monthsPaid || 0)
                    
                    return (
                      <div key={invoice.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-lg">{customer?.name || "Unknown Customer"}</p>
                            <p className="text-sm text-muted-foreground">SO: {so?.soNumber || invoice.soNumber}</p>
                            <p className="text-sm text-muted-foreground">Invoice: {invoice.invoiceNumber}</p>
                          </div>
                          <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                            {invoice.status}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Total Amount</p>
                            <p className="font-semibold">{formatCurrency(invoice.amount)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Monthly Payment</p>
                            <p className="font-semibold">{formatCurrency(monthlyPayment)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Progress</p>
                            <p className="font-semibold">{invoice.monthsPaid || 0} / {invoice.installmentMonths} months</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Remaining</p>
                            <p className="font-semibold text-orange-600">{formatCurrency(remaining)}</p>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const newMonths = prompt(`Current plan: ${invoice.installmentMonths} months\nEnter new number of months:`, invoice.installmentMonths.toString())
                              if (newMonths && Number.parseInt(newMonths) > 0) {
                                const reason = prompt("Please provide a reason for the reschedule request:")
                                if (reason) {
                                  try {
                                    const response = await fetch("/api/reschedule-requests", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        invoiceId: invoice.id,
                                        invoiceNumber: invoice.invoiceNumber,
                                        customerId: invoice.customerId,
                                        currentMonths: invoice.installmentMonths,
                                        requestedMonths: Number.parseInt(newMonths),
                                        reason: reason,
                                        requestedBy: "accountant",
                                      }),
                                    })
                                    if (response.ok) {
                                      alert("Reschedule request sent to CEO for approval. You will be notified once approved.")
                                    } else {
                                      const error = await response.json()
                                      alert(`Failed to submit request: ${error.error || "Unknown error"}`)
                                    }
                                  } catch (error) {
                                    alert("Failed to submit reschedule request")
                                  }
                                }
                              }
                            }}
                            disabled={invoice.status === "paid"}
                          >
                            <Calendar className="w-4 h-4 mr-2" />
                            Reschedule Payment Plan
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleMarkCustomerReceived(invoice.id)}
                            disabled={invoice.status === "paid" || monthsRemaining <= 0}
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Mark Payment Received
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approve Sales Orders Tab */}
        <TabsContent value="approve-so" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("title.pending_sales_orders")}</CardTitle>
              <CardDescription>{t("description.approve_sales_orders")}</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingSalesOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t("message.no_pending_sales_orders")}</p>
                  <p className="text-sm mt-2">{t("message.sales_orders_appear_here")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingSalesOrders.map((order) => (
                    <div key={order.id} className="border rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.so_number")}</p>
                          <p className="font-semibold">{order.soNumber}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                          <p className="font-semibold">{getCustomerName(order.customerId)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.amount")}</p>
                          <p className="font-semibold">{formatCurrency(order.total)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.payment")}</p>
                          <p className="font-semibold capitalize">{order.paymentTerms}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.invoice_status")}</p>
                          {order.invoiceFileUrl ? (
                            <span className="text-green-600 text-sm font-semibold">✓ {t("label.uploaded")}</span>
                          ) : (
                            <span className="text-orange-600 text-sm font-semibold">{t("label.pending_upload")}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <div className="relative">
                          <input
                            type="file"
                            id={`file-${order.id}`}
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => handleFileUpload(order.id, e)}
                            disabled={!!uploadingOrderId}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 bg-transparent"
                            onClick={() => document.getElementById(`file-${order.id}`)?.click()}
                            disabled={uploadingOrderId === order.id}
                          >
                            {uploadingOrderId === order.id ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t("button.uploading")}...
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4" />
                                {order.invoiceFileUrl ? t("button.replace_invoice") : t("button.upload_invoice")}
                              </>
                            )}
                          </Button>
                        </div>
                        {order.invoiceFileUrl && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-2 bg-transparent"
                              onClick={() => window.open(order.invoiceFileUrl, "_blank")}
                            >
                              <Eye className="w-4 h-4" />
                              {t("button.view_invoice")}
                            </Button>
                            <Button size="sm" className="gap-2" onClick={() => handleApproveSalesOrder(order.id)}>
                              <CheckCircle className="w-4 h-4" />
                              {t("button.approve_so")}
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2 bg-transparent"
                          onClick={() => setSelectedSalesOrder(order)}
                        >
                          <Eye className="w-4 h-4" />
                          {t("button.view_details")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pending Shipment Tab */}
        <TabsContent value="pending-shipment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("title.pending_shipment")}</CardTitle>
              <CardDescription>{t("description.orders_ready_for_delivery")}</CardDescription>
            </CardHeader>
            <CardContent>
              {salesOrders.filter((so) => so.status === "ready_for_delivery").length === 0 ? ( // Changed from 'out_for_delivery' to 'ready_for_delivery'
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t("message.no_orders_pending_shipment")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {salesOrders
                    .filter((so) => so.status === "ready_for_delivery") // Changed from 'out_for_delivery' to 'ready_for_delivery'
                    .map((order) => (
                      <div key={order.id} className="border rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.so_number")}</p>
                            <p className="font-semibold">{order.soNumber}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                            <p className="font-semibold">{getCustomerName(order.customerId)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount")}</p>
                            <p className="font-semibold">{formatCurrency(order.total)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.payment")}</p>
                            <p className="font-semibold capitalize">{order.paymentTerms}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.status")}</p>
                            <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-purple-100 text-purple-800">
                              {" "}
                              {/* Updated text and color */}
                              {t("status.ready_for_delivery")}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 bg-transparent"
                            onClick={() => setSelectedSalesOrder(order)}
                          >
                            <Eye className="w-4 h-4" />
                            {t("button.view_details")}
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Shipped Tab */}
        <TabsContent value="shipped" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("title.shipped_orders")}</CardTitle>
              <CardDescription>{t("description.orders_shipped_delivery_invoice")}</CardDescription>
            </CardHeader>
            <CardContent>
              {salesOrders.filter((so) => so.status === "shipped").length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t("message.no_shipped_orders")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {salesOrders
                    .filter((so) => so.status === "shipped")
                    .map((order) => (
                      <div key={order.id} className="border rounded-lg p-4 bg-green-50">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.so_number")}</p>
                            <p className="font-semibold">{order.soNumber}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                            <p className="font-semibold">{getCustomerName(order.customerId)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount")}</p>
                            <p className="font-semibold">{formatCurrency(order.total)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.payment")}</p>
                            <p className="font-semibold capitalize">{order.paymentTerms}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.shipping_invoice")}</p>
                            {order.shippingInvoiceUrl ? (
                              <Button
                                size="sm"
                                variant="link"
                                className="h-auto p-0 text-blue-600"
                                onClick={() => window.open(order.shippingInvoiceUrl, "_blank")}
                              >
                                {t("button.view_invoice")}
                              </Button>
                            ) : (
                              <span className="text-sm text-muted-foreground">{t("label.na")}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 bg-transparent"
                            onClick={() => setSelectedSalesOrder(order)}
                          >
                            <Eye className="w-4 h-4" />
                            {t("button.view_details")}
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accounts Payable Tab */}
        <TabsContent value="ap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("title.supplier_invoices")}</CardTitle>
              <CardDescription>{t("description.manage_installment_payments_suppliers")}</CardDescription>
            </CardHeader>
            <CardContent>
              {installmentSupplierInvoices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t("message.no_installment_invoices")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {installmentSupplierInvoices.map((invoice) => {
                    const installmentMonths = getInstallmentMonths(invoice.poId)
                    const monthlyAmount = installmentMonths ? invoice.amount / installmentMonths : 0
                    const progressPercentage = installmentMonths
                      ? ((invoice.monthsPaid || 0) / installmentMonths) * 100
                      : 0
                    const paymentDue = isPaymentDue(invoice.date, invoice.monthsPaid || 0, installmentMonths)

                    return (
                      <div key={invoice.id} className="border rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.invoice_number")}</p>
                            <p className="font-semibold">{invoice.invoiceNumber}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.supplier")}</p>
                            <p className="font-semibold">{getSupplierName(invoice.supplierId)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount")}</p>
                            <p className="font-semibold">{formatCurrency(invoice.amount)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.monthly")}</p>
                            <p className="font-semibold">{formatCurrency(monthlyAmount)}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-sm text-muted-foreground mb-1">{t("field.progress")}</p>
                            <div className="space-y-1">
                              <Progress value={progressPercentage} className="h-2" />
                              <p className="font-semibold text-sm">
                                {invoice.monthsPaid}/{installmentMonths} {t("label.months")}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          {invoice.status === "pending" && paymentDue && (
                            <Button size="sm" onClick={() => handleMarkSupplierPaid(invoice.id)}>
                              {t("button.mark_as_paid")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 bg-transparent"
                            onClick={() => setSelectedSupplierInvoice(invoice)}
                          >
                            <Eye className="w-4 h-4" />
                            {t("button.view")}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accounts Receivable Tab */}
        <TabsContent value="ar" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("title.customer_invoices")}</CardTitle>
              <CardDescription>{t("description.manage_installment_payments_customers")}</CardDescription>
            </CardHeader>
            <CardContent>
              {installmentCustomerInvoices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t("message.no_installment_invoices")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {installmentCustomerInvoices.map((invoice) => {
                    const so = salesOrders.find((s) => s.id === invoice.soId)
                    const installmentMonths = so?.installments || 0
                    const monthlyAmount = installmentMonths ? invoice.amount / installmentMonths : 0
                    const progressPercentage = installmentMonths
                      ? ((invoice.monthsPaid || 0) / installmentMonths) * 100
                      : 0
                    const paymentDue = isPaymentDue(invoice.date, invoice.monthsPaid || 0, installmentMonths)

                    return (
                      <div key={invoice.id} className="border rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.invoice_number")}</p>
                            <p className="font-semibold">{invoice.invoiceNumber}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                            <p className="font-semibold">{getCustomerName(invoice.customerId)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.amount")}</p>
                            <p className="font-semibold">{formatCurrency(invoice.amount)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.monthly")}</p>
                            <p className="font-semibold">{formatCurrency(monthlyAmount)}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-sm text-muted-foreground mb-1">{t("field.progress")}</p>
                            <div className="space-y-1">
                              <Progress value={progressPercentage} className="h-2" />
                              <p className="font-semibold text-sm">
                                {invoice.monthsPaid}/{installmentMonths} {t("label.months")}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          {invoice.status === "pending" && paymentDue && (
                            <Button size="sm" onClick={() => handleMarkCustomerReceived(invoice.id)}>
                              {t("button.mark_as_received")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 bg-transparent"
                            onClick={() => setSelectedCustomerInvoice(invoice)}
                          >
                            <Eye className="w-4 h-4" />
                            {t("button.view")}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="space-y-4">
          {selectedCustomer ? (
            // Customer detail view
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{customers.find((c) => c.id === selectedCustomer)?.name}</CardTitle>
                    <CardDescription>{t("description.customer_purchase_history")}</CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setSelectedCustomer(null)}>
                    {t("button.back_to_customers")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border-b pb-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                      <p className="font-semibold">
                        {customers.find((c) => c.id === selectedCustomer)?.email || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
                      <p className="font-semibold">
                        {customers.find((c) => c.id === selectedCustomer)?.phone || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.city")}</p>
                      <p className="font-semibold">
                        {customers.find((c) => c.id === selectedCustomer)?.city || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.country")}</p>
                      <p className="font-semibold">
                        {customers.find((c) => c.id === selectedCustomer)?.country || t("label.na")}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">{t("field.address")}</p>
                      <p className="font-semibold">
                        {customers.find((c) => c.id === selectedCustomer)?.address || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.total_orders")}</p>
                      <p className="font-semibold text-lg">{getCustomerOrders(selectedCustomer).length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.total_spent")}</p>
                      <p className="font-semibold text-lg">{formatCurrency(getCustomerTotalSpent(selectedCustomer))}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.amount_paid")}</p>
                      <p className="font-semibold text-lg text-green-600">
                        {formatCurrency(customerPaymentsByCustomer[selectedCustomer] || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.balance_due")}</p>
                      <p className="font-semibold text-lg text-orange-600">
                        {formatCurrency(
                          getCustomerTotalSpent(selectedCustomer) - (customerPaymentsByCustomer[selectedCustomer] || 0),
                        )}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-4">{t("title.purchase_history")}</h3>
                    {getCustomerOrders(selectedCustomer).length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">{t("message.no_purchases_yet")}</p>
                    ) : (
                      <div className="space-y-3">
                        {getCustomerOrders(selectedCustomer).map((order) => {
                          const invoice = customerInvoices.find((inv) => inv.soId === order.id)
                          const amountPaid = invoice?.collectedAmount || 0
                          const amountDue = order.total - amountPaid
                          const paymentStatus =
                            amountPaid === 0
                              ? t("status.not_paid")
                              : amountPaid >= order.total
                                ? t("status.fully_paid")
                                : t("status.partially_paid")

                          return (
                            <div key={order.id} className="border rounded-lg p-4">
                              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                                <div>
                                  <p className="text-sm text-muted-foreground">{t("field.so_number")}</p>
                                  <p className="font-semibold">{order.soNumber}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground">{t("field.order_date")}</p>
                                  <p className="font-semibold">{order.orderDate}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground">{t("field.total_amount")}</p>
                                  <p className="font-semibold">{formatCurrency(order.total)}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground">{t("field.amount_paid")}</p>
                                  <p className="font-semibold text-green-600">{formatCurrency(amountPaid)}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground">{t("field.amount_due")}</p>
                                  <p className="font-semibold text-orange-600">{formatCurrency(amountDue)}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground">{t("field.payment_status")}</p>
                                  <span
                                    className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                                      paymentStatus === t("status.fully_paid")
                                        ? "bg-green-100 text-green-800"
                                        : paymentStatus === t("status.partially_paid")
                                          ? "bg-yellow-100 text-yellow-800"
                                          : "bg-red-100 text-red-800"
                                    }`}
                                  >
                                    {paymentStatus}
                                  </span>
                                  {order.paymentTerms === "installment" && invoice && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {invoice.monthsPaid}/{order.installments} {t("label.months")}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="mt-3">
                                <p className="text-sm text-muted-foreground mb-2">{t("field.items")}:</p>
                                <div className="space-y-1">
                                  {order.items.map((item) => (
                                    <div key={item.productId} className="text-sm flex justify-between">
                                      <span>
                                        {item.productName} × {item.quantity}
                                      </span>
                                      <span>{formatCurrency(item.total)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex gap-2 mt-4">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-2 bg-transparent"
                                  onClick={() => setSelectedSalesOrder(order)}
                                >
                                  <Eye className="w-4 h-4" />
                                  {t("button.view_details")}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            // Customer list view
            <Card>
              <CardHeader>
                <CardTitle>{t("title.all_customers")}</CardTitle>
                <CardDescription>{t("description.view_customer_details")}</CardDescription>
              </CardHeader>
              <CardContent>
                {customers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>{t("message.no_customers_yet")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customers.map((customer) => {
                      const totalSpent = getCustomerTotalSpent(customer.id)
                      const orderCount = getCustomerOrders(customer.id).length

                      return (
                        <div
                          key={customer.id}
                          className="border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedCustomer(customer.id)}
                        >
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.name")}</p>
                              <p className="font-semibold">{customer.name}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                              <p className="font-semibold">{customer.email || t("label.na")}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
                              <p className="font-semibold">{customer.phone || t("label.na")}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.location")}</p>
                              <p className="font-semibold">
                                {customer.city && customer.country
                                  ? `${customer.city}, ${customer.country}`
                                  : t("label.na")}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.orders")}</p>
                              <p className="font-semibold">{orderCount}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.total_spent")}</p>
                              <p className="font-semibold text-lg">{formatCurrency(totalSpent)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          {selectedSupplier ? (
            // Supplier detail view
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{suppliers.find((s) => s.id === selectedSupplier)?.name}</CardTitle>
                    <CardDescription>{t("description.supplier_purchase_order_history")}</CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setSelectedSupplier(null)}>
                    {t("button.back_to_suppliers")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border-b pb-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                      <p className="font-semibold">
                        {suppliers.find((s) => s.id === selectedSupplier)?.email || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
                      <p className="font-semibold">
                        {suppliers.find((s) => s.id === selectedSupplier)?.phone || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.city")}</p>
                      <p className="font-semibold">
                        {suppliers.find((s) => s.id === selectedSupplier)?.city || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.country")}</p>
                      <p className="font-semibold">
                        {suppliers.find((s) => s.id === selectedSupplier)?.country || t("label.na")}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">{t("field.address")}</p>
                      <p className="font-semibold">
                        {suppliers.find((s) => s.id === selectedSupplier)?.address || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.payment_terms")}</p>
                      <p className="font-semibold capitalize">
                        {suppliers.find((s) => s.id === selectedSupplier)?.paymentTerms || t("label.na")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.total_purchase_orders")}</p>
                      <p className="font-semibold text-lg">{getSupplierPOs(selectedSupplier).length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("field.total_purchased")}</p>
                      <p className="font-semibold text-lg">{formatCurrency(getSupplierTotalSpent(selectedSupplier))}</p>
                    </div>
                  </div>

                  {/* Purchase Order History */}
                  <div>
                    <h3 className="font-semibold mb-4">{t("title.purchase_order_history")}</h3>
                    {getSupplierPOs(selectedSupplier).length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">{t("message.no_purchase_orders_yet")}</p>
                    ) : (
                      <div className="space-y-3">
                        {getSupplierPOs(selectedSupplier).map((po) => (
                          <div key={po.id} className="border rounded-lg p-4">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                              <div>
                                <p className="text-sm text-muted-foreground">{t("field.po_number")}</p>
                                <p className="font-semibold">{po.poNumber}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">{t("field.order_date")}</p>
                                <p className="font-semibold">{po.orderDate}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">{t("field.amount")}</p>
                                <p className="font-semibold">{formatCurrency(po.total)}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">{t("field.payment")}</p>
                                <p className="font-semibold capitalize">{po.paymentTerms}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">{t("field.status")}</p>
                                <span
                                  className={`inline-block px-2 py-1 rounded text-xs font-semibold ${getStatusColor(po.status)}`}
                                >
                                  {t(`status.${po.status}`)}
                                </span>
                              </div>
                            </div>
                            <div className="mt-3">
                              <p className="text-sm text-muted-foreground mb-2">{t("field.items")}:</p>
                              <div className="space-y-1">
                                {po.items.map((item) => (
                                  <div key={item.productId} className="text-sm flex justify-between">
                                    <span>
                                      {item.productName} × {item.quantity}
                                    </span>
                                    <span>{formatCurrency(item.total)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            // Supplier list view
            <Card>
              <CardHeader>
                <CardTitle>{t("title.all_suppliers")}</CardTitle>
                <CardDescription>{t("description.view_supplier_details")}</CardDescription>
              </CardHeader>
              <CardContent>
                {suppliers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>{t("message.no_suppliers_yet")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {suppliers.map((supplier) => {
                      const totalSpent = getSupplierTotalSpent(supplier.id)
                      const poCount = getSupplierPOs(supplier.id).length

                      return (
                        <div
                          key={supplier.id}
                          className="border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedSupplier(supplier.id)}
                        >
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.name")}</p>
                              <p className="font-semibold">{supplier.name}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.email")}</p>
                              <p className="font-semibold">{supplier.email || t("label.na")}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
                              <p className="font-semibold">{supplier.phone || t("label.na")}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.location")}</p>
                              <p className="font-semibold">
                                {supplier.city && supplier.country
                                  ? `${supplier.city}, ${supplier.country}`
                                  : t("label.na")}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.purchase_orders")}</p>
                              <p className="font-semibold">{poCount}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t("field.total_purchased")}</p>
                              <p className="font-semibold text-lg">{formatCurrency(totalSpent)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="maintenance-invoices" className="space-y-4">
          <MaintenanceInvoiceTab />
        </TabsContent>
      </Tabs>

      {/* Sales Order Details Dialog */}
      <Dialog open={!!selectedSalesOrder} onOpenChange={(open) => !open && setSelectedSalesOrder(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title.sales_order_details")}</DialogTitle>
            <DialogDescription>{t("description.view_detailed_sales_order")}</DialogDescription>
          </DialogHeader>
          {selectedSalesOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.so_number")}</p>
                  <p className="font-semibold">{selectedSalesOrder.soNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                  <p className="font-semibold">{getCustomerName(selectedSalesOrder.customerId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.order_date")}</p>
                  <p className="font-semibold">{selectedSalesOrder.orderDate}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.payment")}</p>
                  <p className="font-semibold capitalize">{selectedSalesOrder.paymentTerms}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">{t("field.items")}</p>
                <div className="border rounded-lg p-4 space-y-2">
                  {selectedSalesOrder.items.map((item) => (
                    <div key={item.productId} className="flex justify-between">
                      <span>
                        {item.productName} (Qty: {item.quantity})
                      </span>
                      <span className="font-semibold">{formatCurrency(item.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between">
                  <span className="font-semibold">{t("field.total_amount")}</span>
                  <span className="text-lg font-bold">{formatCurrency(selectedSalesOrder.total)}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
