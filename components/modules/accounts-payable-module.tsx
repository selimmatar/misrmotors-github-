"use client"

import { useState } from "react"
import { useApp } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  DollarSign,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  Eye,
  XCircle,
  AlertTriangle,
  RefreshCw,
  CreditCard,
  Building2,
  Copy,
  Download,
  FileText,
} from "lucide-react"
import type { SupplierInvoice } from "@/lib/types"

interface PaymentScheduleEntry {
  id: string
  invoiceId?: string
  soId?: string
  poId?: string
  installmentNumber: number
  dueDate: string
  amount: number
  paidAmount: number
  paymentDate?: string
  status: string
  receiptUrl?: string
  notes?: string
  isDownPayment?: boolean
  invoiceFileUrl?: string
}

export function AccountsPayableModule() {
  const { supplierInvoices, suppliers, purchaseOrders, updateSupplierInvoice, user, loadData } = useApp()
  const { t, formatCurrency, formatDate } = useI18n()
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<SupplierInvoice | null>(null)
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [widgetDialogOpen, setWidgetDialogOpen] = useState(false)
  const [widgetType, setWidgetType] = useState<"overdue" | "due-soon" | "paid" | "pending">("overdue")
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [selectedInvoiceForSchedule, setSelectedInvoiceForSchedule] = useState<SupplierInvoice | null>(null)
  const [paymentSchedules, setPaymentSchedules] = useState<PaymentScheduleEntry[]>([])
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false)
  const [schedulePaymentDialogOpen, setSchedulePaymentDialogOpen] = useState(false)
  const [selectedScheduleForPayment, setSelectedScheduleForPayment] = useState<PaymentScheduleEntry | null>(null)
  const [schedulePaymentFile, setSchedulePaymentFile] = useState<File | null>(null)
  // Removed: const [invoiceUploadDialogOpen, setInvoiceUploadDialogOpen] = useState(false)
  // Removed: const [selectedScheduleForInvoice, setSelectedInvoiceForSchedule] = useState<PaymentScheduleEntry | null>(null)
  // Removed: const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  // Removed: const [isUploadingInvoice, setIsUploadingInvoice] = useState(false)

  const [paymentDetailsDialogOpen, setPaymentDetailsDialogOpen] = useState(false)
  const [selectedInvoiceForPaymentDetails, setSelectedInvoiceForPaymentDetails] = useState<SupplierInvoice | null>(null)

  const userRole = user?.role || "viewer"

  const getSupplierName = (supplierId: string) => {
    const supplier = suppliers.find((s) => s.id === supplierId)
    return supplier?.name || t("field.unknown")
  }

  const getPONumber = (poId: string) => {
    const po = purchaseOrders.find((p) => String(p.id) === String(poId))
    return po?.poNumber || t("field.unknown")
  }

  const getPOPaymentType = (poId: string) => {
    const po = purchaseOrders.find((p) => String(p.id) === String(poId))
    return po?.paymentType || po?.paymentTerms || "cash"
  }

  const getPO = (poId: string) => {
    return purchaseOrders.find((p) => String(p.id) === String(poId))
  }

  const handleDownloadInvoicePDF = (invoice: SupplierInvoice) => {
    const invoiceId = invoice.id || invoice.invoice_id
    if (!invoiceId) {
      alert(t("error.no-invoice-id"))
      return
    }

    const pdfUrl = `/api/invoices/ap/${invoiceId}/pdf`
    window.open(pdfUrl, "_blank")
  }

  const getInstallmentMonths = (invoice: SupplierInvoice) => {
    if (invoice.installmentMonths && invoice.installmentMonths > 0) {
      return invoice.installmentMonths
    }
    const po = purchaseOrders.find((p) => String(p.id) === String(invoice.poId))
    return po?.installments || 1
  }

  const getInvoiceStatus = (invoice: SupplierInvoice) => {
    const balance = (invoice.amount || 0) - (invoice.paidAmount || 0)
    if (balance <= 0) return "paid"
    const dueDate = new Date(invoice.dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (dueDate < today) return "overdue"
    const weekFromNow = new Date(today)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    if (dueDate <= weekFromNow) return "due-soon"
    return "pending"
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-700"
      case "overdue":
        return "bg-red-100 text-red-700"
      case "due-soon":
        return "bg-amber-100 text-amber-700"
      case "partial":
      case "partially_paid":
        return "bg-blue-100 text-blue-700"
      default:
        return "bg-gray-100 text-gray-700"
    }
  }

  const getScheduleStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case "overdue":
        return <XCircle className="w-4 h-4 text-red-600" />
      case "partial":
        return <Clock className="w-4 h-4 text-blue-600" />
      case "partially_paid": // Added for new status
        return <Clock className="w-4 h-4 text-blue-600" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }

  const fetchPaymentSchedule = async (invoice: SupplierInvoice) => {
    setIsLoadingSchedule(true)
    setPaymentSchedules([])

    const poId = invoice.poId ? String(invoice.poId) : null
    const invoiceId = String(invoice.id)

    try {
      let schedules: PaymentScheduleEntry[] = []

      // Try to fetch from database by PO ID first
      if (poId) {
        const response = await fetch(`/api/payment-schedules?poId=${poId}`)

        if (response.ok) {
          const data = await response.json()

          if (data && Array.isArray(data) && data.length > 0) {
            schedules = data
          }
        }
      }

      // If no schedules from PO, try invoice ID
      if (schedules.length === 0) {
        const response = await fetch(`/api/payment-schedules?invoiceId=${invoiceId}`)

        if (response.ok) {
          const data = await response.json()

          if (data && Array.isArray(data) && data.length > 0) {
            schedules = data
          }
        }
      }

      // If still no schedules, generate from PO/invoice data
      if (schedules.length === 0) {
        schedules = generateScheduleFromInvoice(invoice)
      }

      // Sort: down payment first (installment 0), then by installment number
      schedules.sort((a, b) => {
        if (a.isDownPayment || a.installmentNumber === 0) return -1
        if (b.isDownPayment || b.installmentNumber === 0) return 1
        return a.installmentNumber - b.installmentNumber
      })

      setPaymentSchedules(schedules)
    } catch (error) {
      console.error("Error fetching payment schedule:", error)
      // Generate fallback schedule
      const generatedSchedules = generateScheduleFromInvoice(invoice)
      setPaymentSchedules(generatedSchedules)
    } finally {
      setIsLoadingSchedule(false)
    }
  }

  const generateScheduleFromInvoice = (invoice: SupplierInvoice): PaymentScheduleEntry[] => {
    const schedules: PaymentScheduleEntry[] = []
    const po = getPO(invoice.poId)

    const effectivePaymentType =
      invoice.paymentType || po?.paymentType || po?.paymentTerms || invoice.paymentTerms || "installments"


    const totalAmount = invoice.totalAmount || invoice.amount || 0
    const paidAmount = invoice.paidAmount || 0

    if (effectivePaymentType === "hybrid") {
      const downPaymentAmount = invoice.downPaymentAmount ?? po?.downPaymentAmount ?? 0
      const downPaymentDueDate =
        invoice.downPaymentDueDate ||
        po?.downPaymentDueDate ||
        invoice.dueDate ||
        new Date().toISOString().split("T")[0]
      const remainingAmount = invoice.remainingAmount ?? po?.remainingAmount ?? totalAmount - downPaymentAmount
      const remainingMonths = invoice.remainingInstallmentMonths ?? po?.remainingInstallmentMonths ?? 6
      const monthlyAmount =
        invoice.monthlyAmount ?? po?.monthlyAmount ?? Math.round((remainingAmount / remainingMonths) * 100) / 100
      const paymentStartDate =
        invoice.paymentStartDate || po?.paymentStartDate || new Date().toISOString().split("T")[0]

      // Validation: Ensure amounts are sensible for hybrid payment
      if (downPaymentAmount === 0 && remainingAmount === 0) {
        console.error("[v0] AP Module - ERROR: Hybrid payment with 0 amounts detected! Invoice:", invoice.id)
        // Fallback: treat as regular installments
        const installmentMonths = invoice.remainingInstallmentMonths || po?.remainingInstallmentMonths || po?.installments || 6
        const monthlyAmt = Math.round((totalAmount / installmentMonths) * 100) / 100
        
        for (let i = 1; i <= installmentMonths; i++) {
          const dueDate = new Date(paymentStartDate)
          dueDate.setMonth(dueDate.getMonth() + (i - 1))
          schedules.push({
            id: `gen-${invoice.id}-${i}`,
            invoiceId: invoice.id,
            poId: invoice.poId,
            installmentNumber: i,
            dueDate: dueDate.toISOString().split("T")[0],
            amount: monthlyAmt,
            paidAmount: 0,
            status: "pending",
            isDownPayment: false,
          })
        }
        return schedules
      }

      // If schedule_entries exists, use custom schedule
      const savedScheduleEntries = invoice.scheduleEntries || po?.scheduleEntries
      if (savedScheduleEntries && Array.isArray(savedScheduleEntries) && savedScheduleEntries.length > 0) {
        return schedules
      }

      if (downPaymentAmount > 0) {
        const dpPaid = Math.min(paidAmount, downPaymentAmount)
        schedules.push({
          id: `gen-dp-${invoice.id}`,
          invoiceId: invoice.id,
          poId: invoice.poId,
          installmentNumber: 0,
          dueDate: downPaymentDueDate,
          amount: downPaymentAmount,
          paidAmount: dpPaid,
          status: dpPaid >= downPaymentAmount ? "paid" : "pending",
          isDownPayment: true,
        })
      }

      // Track remaining paid amount after down payment
      let remainingPaid = Math.max(0, paidAmount - downPaymentAmount)
      const startDate = new Date(paymentStartDate)

      // Add installment entries
      const actualMonths = remainingMonths > 0 ? remainingMonths : remainingAmount > 0 ? 1 : 0

      for (let i = 1; i <= actualMonths; i++) {
        const dueDate = new Date(startDate)
        dueDate.setMonth(startDate.getMonth() + (i - 1))

        const installmentPaid = Math.min(remainingPaid, monthlyAmount)
        remainingPaid -= installmentPaid

        schedules.push({
          id: `gen-${invoice.id}-${i}`,
          invoiceId: invoice.id,
          poId: invoice.poId,
          installmentNumber: i,
          dueDate: dueDate.toISOString().split("T")[0],
          amount: monthlyAmount,
          paidAmount: installmentPaid,
          status: installmentPaid >= monthlyAmount ? "paid" : installmentPaid > 0 ? "partial" : "pending",
          isDownPayment: false,
        })
      }

      return schedules
    }

    const installmentMonths =
      invoice.remainingInstallmentMonths ||
      po?.remainingInstallmentMonths ||
      po?.installments ||
      invoice.installmentMonths ||
      6
    const monthlyAmount =
      Math.round((installmentMonths > 0 ? totalAmount / installmentMonths : totalAmount) * 100) / 100
    const startDate = new Date(
      invoice.paymentStartDate || po?.paymentStartDate || invoice.dueDate || invoice.invoiceDate || new Date(),
    )
    let remainingPaid = paidAmount

    for (let i = 1; i <= installmentMonths; i++) {
      const dueDate = new Date(startDate)
      if (i > 1) {
        dueDate.setMonth(dueDate.getMonth() + (i - 1))
      }

      const installmentPaid = Math.min(remainingPaid, monthlyAmount)
      remainingPaid -= installmentPaid

      schedules.push({
        id: `gen-${invoice.id}-${i}`,
        invoiceId: invoice.id,
        poId: invoice.poId,
        installmentNumber: i,
        dueDate: dueDate.toISOString().split("T")[0],
        amount: monthlyAmount,
        paidAmount: installmentPaid,
        status: installmentPaid >= monthlyAmount ? "paid" : installmentPaid > 0 ? "partial" : "pending",
        isDownPayment: false,
      })
    }

    return schedules
  }

  const regenerateSchedulesForPO = async (invoice: SupplierInvoice) => {
    const po = getPO(invoice.poId)
    if (!po) {
      console.error("regenerateSchedules - PO not found")
      return
    }

    const paymentType = po.paymentType || po.paymentTerms || invoice.paymentTerms
    if (paymentType !== "hybrid" && paymentType !== "installments" && paymentType !== "installment") {
      return
    }

    // Generate schedules from current PO data
    const schedules = generateScheduleFromInvoice(invoice)

    if (schedules.length === 0) {
      console.error("regenerateSchedules - No schedules generated")
      return
    }

    // Save to database
    try {
      const schedulesToSave = schedules.map((s) => ({
        invoice_id: Number(invoice.id),
        po_id: Number(invoice.poId),
        installment_number: s.installmentNumber,
        due_date: s.dueDate,
        amount: s.amount,
        paid_amount: s.paidAmount || 0,
        status: s.status,
        is_down_payment: s.isDownPayment || false,
        schedule_type: "payable",
      }))

      const response = await fetch("/api/payment-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poId: Number(invoice.poId),
          invoiceId: Number(invoice.id),
          schedules: schedulesToSave,
          scheduleMode: "LEGACY_MONTHLY",
        }),
      })

      if (response.ok) {
        // Refresh the schedule view
        await fetchPaymentSchedule(invoice)
      } else {
        const error = await response.json()
        console.error("regenerateSchedules - Error saving schedules:", error)
      }
    } catch (error) {
      console.error("regenerateSchedules - Exception:", error)
    }
  }

  const handleViewSchedule = async (invoice: SupplierInvoice) => {
    setSelectedInvoiceForSchedule(invoice)
    setScheduleDialogOpen(true)
    await fetchPaymentSchedule(invoice)
  }

  const handleRecordSchedulePayment = async () => {
    if (!selectedScheduleForPayment || !schedulePaymentFile || !selectedInvoiceForSchedule) return

    const invoiceId = selectedInvoiceForSchedule.id || selectedScheduleForPayment.invoiceId
    if (!invoiceId) {
      console.error("No invoice ID found")
      alert(t("message.error"))
      return
    }

    setIsUploading(true)
    try {
      // Upload receipt
      const formData = new FormData()
      formData.append("file", schedulePaymentFile)
      formData.append("folder", "payment-receipts")

      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!uploadResponse.ok) throw new Error("Upload failed")
      const { url: receiptUrl } = await uploadResponse.json()

      const paymentAmount = selectedScheduleForPayment.amount
      const newPaidAmount = (selectedInvoiceForSchedule.paidAmount || 0) + paymentAmount
      const newMonthsPaid = (selectedInvoiceForSchedule.monthsPaid || 0) + 1
      const isFullyPaid = newPaidAmount >= (selectedInvoiceForSchedule.amount || 0)

      const newStatus = isFullyPaid ? "paid" : "partially_paid"

      // Check if this is a generated schedule (no real ID in database)
      if (selectedScheduleForPayment.id.startsWith("gen-")) {
        // For generated schedules, just update the invoice directly
        await updateSupplierInvoice(String(invoiceId), {
          paidAmount: newPaidAmount,
          monthsPaid: newMonthsPaid,
          status: newStatus,
        })
      } else {
        // Update payment schedule in database
        const response = await fetch("/api/payment-schedules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduleId: selectedScheduleForPayment.id,
            paidAmount: paymentAmount,
            paymentDate: new Date().toISOString().split("T")[0],
            receiptUrl,
            scheduleType: "payable",
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || "Failed to record payment")
        }

        // Update AP invoice directly
        await updateSupplierInvoice(String(invoiceId), {
          paidAmount: newPaidAmount,
          monthsPaid: newMonthsPaid,
          status: newStatus,
        })
      }

      // This ensures the progress bar updates immediately without waiting for state refresh
      const updatedInvoiceData: SupplierInvoice = {
        ...selectedInvoiceForSchedule,
        paidAmount: newPaidAmount,
        monthsPaid: newMonthsPaid,
        status: newStatus,
      }
      setSelectedInvoiceForSchedule(updatedInvoiceData)

      setPaymentSchedules((prev) =>
        prev.map((s) =>
          s.id === selectedScheduleForPayment.id
            ? {
                ...s,
                paidAmount: s.amount,
                status: "paid",
                paymentDate: new Date().toISOString().split("T")[0],
              }
            : s,
        ),
      )

      // Reload data in background - don't await
      loadData()

      setSchedulePaymentDialogOpen(false)
      setSelectedScheduleForPayment(null)
      setSchedulePaymentFile(null)
    } catch (error) {
      console.error("Error recording payment:", error)
      alert(t("message.error"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleRecordPayment = async () => {
    if (!selectedInvoiceForPayment || !paymentReceiptFile) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", paymentReceiptFile)
      formData.append("folder", "payment-receipts")

      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!uploadResponse.ok) throw new Error("Upload failed")
      const { url: receiptUrl } = await uploadResponse.json()

      const installmentMonths = getInstallmentMonths(selectedInvoiceForPayment)
      // Recalculate monthlyPayment based on the total amount and installment months for accuracy
      const monthlyPayment = (selectedInvoiceForPayment.amount || 0) / installmentMonths
      const newPaidAmount = (selectedInvoiceForPayment.paidAmount || 0) + monthlyPayment
      const newMonthsPaid = (selectedInvoiceForPayment.monthsPaid || 0) + 1
      const isPaid = newMonthsPaid >= installmentMonths

      await updateSupplierInvoice(selectedInvoiceForPayment.id, {
        paidAmount: newPaidAmount,
        monthsPaid: newMonthsPaid,
        status: isPaid ? "paid" : "partially_paid",
        receiptUrl, // Assign receipt URL to the invoice itself if it's a full payment
      })

      await loadData()
      setPaymentDialogOpen(false)
      setSelectedInvoiceForPayment(null)
      setPaymentReceiptFile(null)
    } catch (error) {
      console.error("Error recording payment:", error)
      alert(t("message.error"))
    } finally {
      setIsUploading(false)
    }
  }

  // Removed: const handleUploadInvoice = async () => { ... }

  // Calculate totals
  const totalPayable = supplierInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const totalPaid = supplierInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0)
  const totalBalance = totalPayable - totalPaid
  const overdueInvoices = supplierInvoices.filter((inv) => getInvoiceStatus(inv) === "overdue")
  const dueSoonInvoices = supplierInvoices.filter((inv) => getInvoiceStatus(inv) === "due-soon")
  const paidInvoices = supplierInvoices.filter((inv) => getInvoiceStatus(inv) === "paid")
  const pendingInvoices = supplierInvoices.filter(
    (inv) => getInvoiceStatus(inv) === "pending" || getInvoiceStatus(inv) === "due-soon",
  )

  const openWidgetDialog = (type: "overdue" | "due-soon" | "paid" | "pending") => {
    setWidgetType(type)
    setWidgetDialogOpen(true)
  }

  const getWidgetInvoices = () => {
    switch (widgetType) {
      case "overdue":
        return overdueInvoices
      case "due-soon":
        return dueSoonInvoices
      case "paid":
        return paidInvoices
      case "pending":
        return pendingInvoices
      default:
        return []
    }
  }

  const getWidgetDialogTitle = () => {
    switch (widgetType) {
      case "overdue":
        return t("ap.overdue-invoices")
      case "due-soon":
        return t("ap.due-soon-invoices")
      case "paid":
        return t("ap.paid-invoices")
      case "pending":
        return t("ap.pending-invoices")
      default:
        return ""
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleViewPaymentDetails = (invoice: SupplierInvoice) => {
    setSelectedInvoiceForPaymentDetails(invoice)
    setPaymentDetailsDialogOpen(true)
  }

  const getPOBankDetails = (poId: string) => {
    const po = purchaseOrders.find((p) => String(p.id) === String(poId))
    return {
      bankName: po?.bankName || "",
      bankAccountNumber: po?.bankAccountNumber || "",
      bankSwiftCode: po?.bankSwiftCode || "",
      bankIban: po?.bankIban || "",
      bankBranch: po?.bankBranch || "",
      bankHolderName: po?.bankHolderName || "",
      downPaymentAmount: po?.downPaymentAmount || 0,
      downPaymentDueDate: po?.downPaymentDueDate || "",
      downPaymentType: po?.downPaymentType || "",
      paymentType: po?.paymentType || po?.paymentTerms || "",
      poNumber: po?.poNumber || "",
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow border-red-200"
          onClick={() => openWidgetDialog("overdue")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("ap.overdue")}</p>
                <p className="text-2xl font-bold text-red-600">{overdueInvoices.length}</p>
                <p className="text-sm text-red-600">
                  {formatCurrency(
                    overdueInvoices.reduce((sum, inv) => sum + (inv.amount || 0) - (inv.paidAmount || 0), 0),
                  )}
                </p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow border-amber-200"
          onClick={() => openWidgetDialog("due-soon")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("ap.due-soon")}</p>
                <p className="text-2xl font-bold text-amber-600">{dueSoonInvoices.length}</p>
                <p className="text-sm text-amber-600">
                  {formatCurrency(
                    dueSoonInvoices.reduce((sum, inv) => sum + (inv.amount || 0) - (inv.paidAmount || 0), 0),
                  )}
                </p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow border-green-200"
          onClick={() => openWidgetDialog("paid")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("ap.paid")}</p>
                <p className="text-2xl font-bold text-green-600">{paidInvoices.length}</p>
                <p className="text-sm text-green-600">{formatCurrency(totalPaid)}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("ap.total-balance")}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalBalance)}</p>
                <p className="text-sm text-muted-foreground">
                  {supplierInvoices.length} {t("ap.invoices")}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("ap.invoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ap.invoice-number")}</TableHead>
                <TableHead>{t("field.supplier")}</TableHead>
                <TableHead>{t("field.po-number")}</TableHead>
                <TableHead>{t("field.payment-type")}</TableHead>
                <TableHead>{t("field.due-date")}</TableHead>
                <TableHead className="text-right">{t("field.amount")}</TableHead>
                <TableHead className="text-right">{t("field.paid")}</TableHead>
                <TableHead className="text-right">{t("field.balance")}</TableHead>
                <TableHead>{t("field.status")}</TableHead>
                <TableHead>{t("field.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierInvoices.map((invoice) => {
                const status = getInvoiceStatus(invoice)
                const balance = (invoice.amount || 0) - (invoice.paidAmount || 0)
                const paymentType = getPOPaymentType(invoice.poId)

                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                    <TableCell>{getSupplierName(invoice.supplierId)}</TableCell>
                    <TableCell>{getPONumber(invoice.poId)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {paymentType}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(invoice.amount || 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(invoice.paidAmount || 0)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(balance)}</TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(status)}>{t(`status.${status}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewPaymentDetails(invoice)}
                          title={t("ap.payment-details") || "Payment Details"}
                        >
                          <CreditCard className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleViewSchedule(invoice)}>
                          <Calendar className="w-4 h-4 mr-1" />
                          {t("ar.view-schedule")}
                        </Button>
                        {status !== "paid" && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedInvoiceForPayment(invoice)
                              setPaymentDialogOpen(true)
                            }}
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            {t("action.pay")}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleDownloadInvoicePDF(invoice)}>
                          <FileText className="w-4 h-4 mr-2" />
                          {t("action.print-invoice") || "Print Invoice"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {supplierInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    {t("message.no-invoices")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Payment Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                {t("ar.payment-schedule")}
              </DialogTitle>
              {selectedInvoiceForSchedule && (selectedInvoiceForSchedule.paymentType === "hybrid" || selectedInvoiceForSchedule.paymentType === "installments") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => regenerateSchedulesForPO(selectedInvoiceForSchedule)}
                  title="Recalculate payment schedule if amounts seem incorrect"
                >
                  <Calendar className="w-4 h-4 mr-1" />
                  Recalculate
                </Button>
              )}
            </div>
          </DialogHeader>

          {selectedInvoiceForSchedule && (
            <div className="space-y-6">
              {/* Invoice Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.supplier")}</p>
                  <p className="font-medium">{getSupplierName(selectedInvoiceForSchedule.supplierId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.po-number")}</p>
                  <p className="font-medium">{getPONumber(selectedInvoiceForSchedule.poId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.payment-type")}</p>
                  <p className="font-medium capitalize">{getPOPaymentType(selectedInvoiceForSchedule.poId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("field.total-amount")}</p>
                  <p className="font-medium">{formatCurrency(selectedInvoiceForSchedule.amount || 0)}</p>
                </div>
              </div>

              {/* Payment Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>
                    {t("field.paid")}: {formatCurrency(selectedInvoiceForSchedule.paidAmount || 0)}
                  </span>
                  <span>
                    {t("field.balance")}:{" "}
                    {formatCurrency(
                      (selectedInvoiceForSchedule.amount || 0) - (selectedInvoiceForSchedule.paidAmount || 0),
                    )}
                  </span>
                </div>
                <Progress
                  value={
                    ((selectedInvoiceForSchedule.paidAmount || 0) / (selectedInvoiceForSchedule.amount || 1)) * 100
                  }
                  className="h-3"
                />
                <p className="text-xs text-muted-foreground text-center">
                  {Math.round(
                    ((selectedInvoiceForSchedule.paidAmount || 0) / (selectedInvoiceForSchedule.amount || 1)) * 100,
                  )}
                  % {t("field.paid")}
                </p>
              </div>

              {/* Schedule Table */}
              {isLoadingSchedule ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : paymentSchedules.length > 0 ? (
                <>
                  {paymentSchedules[0]?.id?.startsWith("gen-") && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2 text-yellow-700">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm">
                          {t("ap.schedules-generated-warning") ||
                            "Payment schedule was generated from PO data. Click to save to database for accurate tracking."}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          selectedInvoiceForSchedule && regenerateSchedulesForPO(selectedInvoiceForSchedule)
                        }
                      >
                        <RefreshCw className="w-4 h-4 mr-1" />
                        {t("action.save-schedule") || "Save Schedule"}
                      </Button>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">#</TableHead>
                        <TableHead>{t("field.due-date")}</TableHead>
                        <TableHead className="text-right">{t("field.amount")}</TableHead>
                        <TableHead className="text-right">{t("field.paid")}</TableHead>
                        <TableHead>{t("field.payment-date")}</TableHead>
                        <TableHead>{t("field.status")}</TableHead>
                        <TableHead>{t("field.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentSchedules.map((schedule) => {
                        const isOverdue = schedule.status !== "paid" && new Date(schedule.dueDate) < new Date()
                        const isPaid = schedule.status === "paid" || (schedule.paidAmount || 0) >= schedule.amount

                        return (
                          <TableRow
                            key={schedule.id}
                            className={
                              isPaid
                                ? "bg-green-50"
                                : isOverdue
                                  ? "bg-red-50"
                                  : schedule.isDownPayment
                                    ? "bg-blue-50"
                                    : ""
                            }
                          >
                            <TableCell className="font-medium">
                              {schedule.isDownPayment || schedule.installmentNumber === 0 ? (
                                <Badge className="bg-blue-100 text-blue-700">{t("payment.down-payment")}</Badge>
                              ) : (
                                <span>
                                  {t("payment.installment")} {schedule.installmentNumber}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{formatDate(schedule.dueDate)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(schedule.amount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(schedule.paidAmount || 0)}</TableCell>
                            <TableCell>{schedule.paymentDate ? formatDate(schedule.paymentDate) : "-"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getScheduleStatusIcon(isPaid ? "paid" : isOverdue ? "overdue" : schedule.status)}
                                <Badge
                                  className={getStatusColor(isPaid ? "paid" : isOverdue ? "overdue" : schedule.status)}
                                >
                                  {t(`status.${isPaid ? "paid" : isOverdue ? "overdue" : schedule.status}`)}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                {!isPaid && (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setSelectedScheduleForPayment(schedule)
                                      setSchedulePaymentDialogOpen(true)
                                    }}
                                  >
                                    <DollarSign className="w-4 h-4 mr-1" />
                                    {t("action.pay")}
                                  </Button>
                                )}
                                {schedule.receiptUrl && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      if (schedule.receiptUrl) {
                                        window.open(schedule.receiptUrl, "_blank")
                                      }
                                    }}
                                    title="View uploaded receipt"
                                  >
                                    <Eye className="w-4 h-4 mr-1" />
                                    {t("action.view-receipt")}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">{t("message.no-payment-schedule")}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Schedule Payment Dialog */}
      <Dialog open={schedulePaymentDialogOpen} onOpenChange={setSchedulePaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ar.record-payment")}</DialogTitle>
          </DialogHeader>
          {selectedScheduleForPayment && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {selectedScheduleForPayment.isDownPayment
                      ? t("payment.down-payment")
                      : `${t("payment.installment")} ${selectedScheduleForPayment.installmentNumber}`}
                  </span>
                  <span className="font-medium">{formatCurrency(selectedScheduleForPayment.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("field.due-date")}</span>
                  <span>{formatDate(selectedScheduleForPayment.dueDate)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("field.payment-receipt")}</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setSchedulePaymentFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedulePaymentDialogOpen(false)}>
              {t("action.cancel")}
            </Button>
            <Button onClick={handleRecordSchedulePayment} disabled={!schedulePaymentFile || isUploading}>
              {isUploading ? t("action.uploading") : t("ar.record-payment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ar.record-payment")}</DialogTitle>
          </DialogHeader>
          {selectedInvoiceForPayment && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="font-medium">{selectedInvoiceForPayment.invoiceNumber}</p>
                <p className="text-sm text-muted-foreground">{getSupplierName(selectedInvoiceForPayment.supplierId)}</p>
                <div className="flex justify-between">
                  <span>{t("field.balance")}:</span>
                  <span className="font-medium">
                    {formatCurrency(
                      (selectedInvoiceForPayment.amount || 0) - (selectedInvoiceForPayment.paidAmount || 0),
                    )}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("field.payment-receipt")}</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPaymentReceiptFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              {t("action.cancel")}
            </Button>
            <Button onClick={handleRecordPayment} disabled={!paymentReceiptFile || isUploading}>
              {isUploading ? t("action.uploading") : t("ar.record-payment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Widget Dialog */}
      <Dialog open={widgetDialogOpen} onOpenChange={setWidgetDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{getWidgetDialogTitle()}</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ap.invoice-number")}</TableHead>
                <TableHead>{t("field.supplier")}</TableHead>
                <TableHead>{t("field.due-date")}</TableHead>
                <TableHead className="text-right">{t("field.balance")}</TableHead>
                <TableHead>{t("field.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {getWidgetInvoices().map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                  <TableCell>{getSupplierName(invoice.supplierId)}</TableCell>
                  <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency((invoice.amount || 0) - (invoice.paidAmount || 0))}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setWidgetDialogOpen(false)
                        handleViewSchedule(invoice)
                      }}
                    >
                      <Calendar className="w-4 h-4 mr-1" />
                      {t("ar.view-schedule")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDetailsDialogOpen} onOpenChange={setPaymentDetailsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              {t("ap.payment-details") || "Payment Details"}
            </DialogTitle>
          </DialogHeader>

          {selectedInvoiceForPaymentDetails && (
            <div className="space-y-6">
              {(() => {
                const bankDetails = getPOBankDetails(selectedInvoiceForPaymentDetails.poId)
                const hasBankDetails = bankDetails.bankName || bankDetails.bankAccountNumber || bankDetails.bankIban

                return (
                  <>
                    {/* PO Info */}
                    <div className="p-4 bg-muted rounded-lg">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.po-number")}</p>
                          <p className="font-medium">
                            {bankDetails.poNumber || getPONumber(selectedInvoiceForPaymentDetails.poId)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.payment-type")}</p>
                          <p className="font-medium capitalize">{bankDetails.paymentType}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.supplier")}</p>
                          <p className="font-medium">{getSupplierName(selectedInvoiceForPaymentDetails.supplierId)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.total-amount")}</p>
                          <p className="font-medium">{formatCurrency(selectedInvoiceForPaymentDetails.amount || 0)}</p>
                        </div>
                        {/* Added button to download PDF */}
                        <div>
                          <p className="text-sm text-muted-foreground">{t("action.download-pdf") || "Download PDF"}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownloadInvoicePDF(selectedInvoiceForPaymentDetails)}
                          >
                            <Download className="w-4 h-4 mr-1" />
                            {t("action.download")}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Bank Details */}
                    {hasBankDetails ? (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {t("po.bank-details") || "Bank Details"}
                        </h3>
                        <div className="border rounded-lg p-4 space-y-3">
                          {bankDetails.bankHolderName && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("po.account-holder") || "Account Holder"}
                                </p>
                                <p className="font-medium">{bankDetails.bankHolderName}</p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(bankDetails.bankHolderName)}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankName && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">{t("po.bank-name") || "Bank Name"}</p>
                                <p className="font-medium">{bankDetails.bankName}</p>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(bankDetails.bankName)}>
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankAccountNumber && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("po.account-number") || "Account Number"}
                                </p>
                                <p className="font-medium font-mono">{bankDetails.bankAccountNumber}</p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(bankDetails.bankAccountNumber)}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankIban && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">{t("po.iban") || "IBAN"}</p>
                                <p className="font-medium font-mono text-sm">{bankDetails.bankIban}</p>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(bankDetails.bankIban)}>
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankSwiftCode && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">{t("po.swift-code") || "SWIFT Code"}</p>
                                <p className="font-medium font-mono">{bankDetails.bankSwiftCode}</p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(bankDetails.bankSwiftCode)}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankBranch && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">{t("po.branch") || "Branch"}</p>
                                <p className="font-medium">{bankDetails.bankBranch}</p>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(bankDetails.bankBranch)}>
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 border border-dashed rounded-lg text-center text-muted-foreground">
                        <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>{t("ap.no-bank-details") || "No bank details available for this PO"}</p>
                      </div>
                    )}

                    {/* Down Payment Info for Hybrid */}
                    {bankDetails.paymentType === "hybrid" && bankDetails.downPaymentAmount > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          {t("payment.down-payment") || "Down Payment"}
                        </h3>
                        <div className="border rounded-lg p-4 space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("field.amount")}</span>
                            <span className="font-medium">{formatCurrency(bankDetails.downPaymentAmount)}</span>
                          </div>
                          {bankDetails.downPaymentDueDate && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("field.due-date")}</span>
                              <span className="font-medium">{formatDate(bankDetails.downPaymentDueDate)}</span>
                            </div>
                          )}
                          {bankDetails.downPaymentType && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("field.payment-method")}</span>
                              <span className="font-medium capitalize">{bankDetails.downPaymentType}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDetailsDialogOpen(false)}>
              {t("action.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
