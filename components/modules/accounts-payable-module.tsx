"use client"

import { useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { Money } from "@/components/erp/money"
import { StatusBadge } from "@/components/erp/status-badge"
import { ErpTable, NumHead, NumCell, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { formatDate, formatMoney } from "@/lib/format"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DollarSign,
  CheckCircle,
  Clock,
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
  const { supplierInvoices, suppliers, purchaseOrders, user, loadData } = useApp()
  const { t, language } = useI18n()
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
  // Payment form (shared by both payment dialogs). The idempotency key is generated once per dialog open.
  const [payAmount, setPayAmount] = useState("")
  const [payMethod, setPayMethod] = useState<"cash" | "cheque" | "bank_transfer">("bank_transfer")
  const [payAllowOverpayment, setPayAllowOverpayment] = useState(false)
  const payKeyRef = useRef<string>("")
  const submittingRef = useRef(false)
  // Removed: const [invoiceUploadDialogOpen, setInvoiceUploadDialogOpen] = useState(false)
  // Removed: const [selectedScheduleForInvoice, setSelectedInvoiceForSchedule] = useState<PaymentScheduleEntry | null>(null)
  // Removed: const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  // Removed: const [isUploadingInvoice, setIsUploadingInvoice] = useState(false)

  const [paymentDetailsDialogOpen, setPaymentDetailsDialogOpen] = useState(false)
  const [selectedInvoiceForPaymentDetails, setSelectedInvoiceForPaymentDetails] = useState<SupplierInvoice | null>(null)
  const [paymentDetailsReceipts, setPaymentDetailsReceipts] = useState<
    { receiptUrl: string; paymentDate?: string; installmentNumber: number }[]
  >([])

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

  const getScheduleStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className="w-4 h-4 text-green-700" />
      case "overdue":
        return <XCircle className="w-4 h-4 text-red-700" />
      case "partial":
        return <Clock className="w-4 h-4 text-blue-600" />
      case "partially_paid": // Added for new status
        return <Clock className="w-4 h-4 text-blue-600" />
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />
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
        console.error("AP Module - ERROR: Hybrid payment with 0 amounts detected! Invoice:", invoice.id)
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

  const openPaymentForm = (defaultAmount: number) => {
    setPayAmount(String(Math.max(Math.round(defaultAmount * 100) / 100, 0)))
    setPayMethod("bank_transfer")
    setPayAllowOverpayment(false)
    payKeyRef.current = `apui_${crypto.randomUUID()}`
  }

  // Both dialogs pay through the server endpoint, which validates the amount, applies it to the invoice
  // and writes the ledger rows. The browser never computes paid amounts or statuses.
  const submitPayment = async (invoiceId: string, file: File, scheduleId?: string): Promise<any | null> => {
    if (submittingRef.current) return null
    const amount = Number(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      alert(t("ap.enter-payment-amount"))
      return null
    }
    submittingRef.current = true
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "payment-receipts")
      const uploadResponse = await fetch("/api/upload", { method: "POST", body: formData })
      if (!uploadResponse.ok) throw new Error("Receipt upload failed")
      const { url: receiptUrl } = await uploadResponse.json()

      const response = await fetch("/api/accounts-payable/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: Number(invoiceId),
          amount,
          paymentMethod: payMethod,
          receiptUrl,
          allowOverpayment: payAllowOverpayment,
          // only saved (numeric-id) schedule rows are sent; generated "gen-" rows have no database row
          ...(scheduleId && /^\d+$/.test(scheduleId) ? { scheduleId: Number(scheduleId) } : {}),
          idempotencyKey: payKeyRef.current,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(result.error || t("message.error"))
        if (result.partialFailure) await loadData()
        return null
      }
      return result
    } catch (error) {
      console.error("Error recording payment:", error)
      alert(t("message.error"))
      return null
    } finally {
      submittingRef.current = false
      setIsUploading(false)
    }
  }

  const handleRecordSchedulePayment = async () => {
    if (!selectedScheduleForPayment || !schedulePaymentFile || !selectedInvoiceForSchedule) return
    const invoiceId = selectedInvoiceForSchedule.id || selectedScheduleForPayment.invoiceId
    if (!invoiceId) {
      alert(t("message.error"))
      return
    }

    const result = await submitPayment(String(invoiceId), schedulePaymentFile, selectedScheduleForPayment.id)
    if (!result) return

    const inv = result.invoice
    if (inv) {
      setSelectedInvoiceForSchedule({
        ...selectedInvoiceForSchedule,
        paidAmount: inv.paidAmount,
        monthsPaid: inv.monthsPaid,
        status: inv.status,
      })
    }
    setPaymentSchedules((prev) =>
      prev.map((s) =>
        s.id === selectedScheduleForPayment.id
          ? { ...s, paidAmount: Number(payAmount), status: "paid", paymentDate: new Date().toISOString().split("T")[0] }
          : s,
      ),
    )
    loadData()
    setSchedulePaymentDialogOpen(false)
    setSelectedScheduleForPayment(null)
    setSchedulePaymentFile(null)
  }

  const handleRecordPayment = async () => {
    if (!selectedInvoiceForPayment || !paymentReceiptFile) return
    const result = await submitPayment(selectedInvoiceForPayment.id, paymentReceiptFile)
    if (!result) return
    await loadData()
    setPaymentDialogOpen(false)
    setSelectedInvoiceForPayment(null)
    setPaymentReceiptFile(null)
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

  const handleViewPaymentDetails = async (invoice: SupplierInvoice) => {
    setSelectedInvoiceForPaymentDetails(invoice)
    setPaymentDetailsDialogOpen(true)
    setPaymentDetailsReceipts([])

    // Collect receipt PDFs uploaded when schedule payments were marked as done
    try {
      const poId = invoice.poId ? String(invoice.poId) : null
      const invoiceId = String(invoice.id)

      let schedules: PaymentScheduleEntry[] = []
      if (poId) {
        const response = await fetch(`/api/payment-schedules?poId=${poId}`)
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data)) schedules = data
        }
      }
      if (schedules.length === 0) {
        const response = await fetch(`/api/payment-schedules?invoiceId=${invoiceId}`)
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data)) schedules = data
        }
      }

      const receipts = schedules
        .filter((s) => s.receiptUrl)
        .map((s) => ({
          receiptUrl: s.receiptUrl as string,
          paymentDate: s.paymentDate,
          installmentNumber: s.installmentNumber,
        }))
        .sort((a, b) => a.installmentNumber - b.installmentNumber)

      // Also collect receipts stored on individual supplier payment records
      // (covers generated schedules, where each payment's receipt is saved there)
      try {
        const paymentsResponse = await fetch("/api/supplier-payments")
        if (paymentsResponse.ok) {
          const payments = await paymentsResponse.json()
          if (Array.isArray(payments)) {
            const existingUrls = new Set(receipts.map((r) => r.receiptUrl))
            payments
              .filter((p: any) => String(p.invoice_id) === invoiceId && p.receipt_url)
              .forEach((p: any) => {
                if (!existingUrls.has(p.receipt_url)) {
                  receipts.push({
                    receiptUrl: p.receipt_url,
                    paymentDate: p.payment_date,
                    installmentNumber: receipts.length + 1,
                  })
                  existingUrls.add(p.receipt_url)
                }
              })
          }
        }
      } catch (error) {
        console.error("Error fetching supplier payment receipts:", error)
      }

      // Fall back to the invoice-level receipt (full payments recorded outside the schedule)
      if (receipts.length === 0 && invoice.paymentReceiptUrl) {
        receipts.push({
          receiptUrl: invoice.paymentReceiptUrl,
          paymentDate: invoice.lastPaymentDate,
          installmentNumber: 0,
        })
      }

      setPaymentDetailsReceipts(receipts)
    } catch (error) {
      console.error("Error fetching payment receipts:", error)
    }
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
  chequeNumber: po?.chequeNumber || "",
  chequeBankName: po?.chequeBankName || "",
  chequeDueDate: po?.chequeDueDate || "",
  chequeAmount: po?.chequeAmount || 0,
  chequeNotes: po?.chequeNotes || "",
  downPaymentChequeNumber: po?.downPaymentChequeNumber || "",
  downPaymentChequeBank: po?.downPaymentChequeBank || "",
  downPaymentChequeDueDate: po?.downPaymentChequeDueDate || "",
  }
  }

  const renderRowActions = (invoice: SupplierInvoice) => {
    const status = getInvoiceStatus(invoice)
    return (
      <>
        <Button
          aria-label={`${t("action.view-details")} ${invoice.invoiceNumber}`}
          size="sm"
          variant="outline"
          onClick={() => handleViewPaymentDetails(invoice)}
          title={t("ap.payment-details")}
        >
          <CreditCard className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleViewSchedule(invoice)}>
          <Calendar className="w-4 h-4 me-1" />
          {t("ar.view-schedule")}
        </Button>
        {status !== "paid" && (
          <Button
            size="sm"
            onClick={() => {
              setSelectedInvoiceForPayment(invoice)
              openPaymentForm((invoice.amount || 0) - (invoice.paidAmount || 0))
              setPaymentDialogOpen(true)
            }}
          >
            <DollarSign className="w-4 h-4 me-1" />
            {t("action.pay")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => handleDownloadInvoicePDF(invoice)}>
          <FileText className="w-4 h-4 me-2" />
          {t("action.print-invoice")}
        </Button>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.finance")} title={t("ap.title")} />

      {/* Summary tiles */}
      <KpiGrid>
        <KpiTile
          label={t("ap.overdue")}
          value={overdueInvoices.length}
          sub={
            <>
              <Money
                value={overdueInvoices.reduce((sum, inv) => sum + (inv.amount || 0) - (inv.paidAmount || 0), 0)}
              />{" "}
              {t("common.egp-2")}
            </>
          }
          onClick={() => openWidgetDialog("overdue")}
        />
        <KpiTile
          label={t("ap.due-soon")}
          value={dueSoonInvoices.length}
          sub={
            <>
              <Money
                value={dueSoonInvoices.reduce((sum, inv) => sum + (inv.amount || 0) - (inv.paidAmount || 0), 0)}
              />{" "}
              {t("common.egp-2")}
            </>
          }
          onClick={() => openWidgetDialog("due-soon")}
        />
        <KpiTile
          label={t("ap.paid")}
          value={paidInvoices.length}
          sub={
            <>
              <Money value={totalPaid} /> {t("common.egp-2")}
            </>
          }
          onClick={() => openWidgetDialog("paid")}
        />
        <KpiTile
          label={t("ap.total-balance") + " (EGP)"}
          value={<Money value={totalBalance} />}
          sub={`${supplierInvoices.length} ${t("ap.invoices")}`}
        />
      </KpiGrid>

      {/* Invoices Table */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("ap.invoices")}</h2>
        <ResponsiveList
          rows={supplierInvoices}
          empty={<div className="py-8 text-center text-muted-foreground">{t("message.no-invoices")}</div>}
          table={
            <ErpTable>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ap.invoice-number")}</TableHead>
                  <TableHead>{t("field.supplier")}</TableHead>
                  <TableHead>{t("field.po-number")}</TableHead>
                  <TableHead>{t("field.payment-type")}</TableHead>
                  <TableHead>{t("field.due-date")}</TableHead>
                  <NumHead>{t("field.amount")} {t("common.egp")}</NumHead>
                  <NumHead>{t("field.paid")} {t("common.egp")}</NumHead>
                  <NumHead>{t("field.balance")} {t("common.egp")}</NumHead>
                  <TableHead>{t("field.status")}</TableHead>
                  <ActionsHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierInvoices.map((invoice) => {
                  const status = getInvoiceStatus(invoice)
                  const balance = (invoice.amount || 0) - (invoice.paidAmount || 0)
                  const paymentType = getPOPaymentType(invoice.poId)

                  return (
                    <TableRow key={invoice.id}>
                      <IdCell>{invoice.invoiceNumber}</IdCell>
                      <TableCell>{getSupplierName(invoice.supplierId)}</TableCell>
                      <TableCell>{getPONumber(invoice.poId)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {t(`payment.${paymentType}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(invoice.dueDate, language)}</TableCell>
                      <NumCell>{formatMoney(invoice.amount || 0, language)}</NumCell>
                      <NumCell>{formatMoney(invoice.paidAmount || 0, language)}</NumCell>
                      <NumCell className="font-medium">{formatMoney(balance, language)}</NumCell>
                      <TableCell>
                        <StatusBadge status={status} label={t(`status.${status}`)} />
                      </TableCell>
                      <ActionsCell>{renderRowActions(invoice)}</ActionsCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </ErpTable>
          }
          card={(invoice) => {
            const status = getInvoiceStatus(invoice)
            return (
              <ListCard
                id={invoice.invoiceNumber}
                amount={formatMoney(invoice.amount || 0, language)}
                party={getSupplierName(invoice.supplierId)}
                status={<StatusBadge status={status} label={t(`status.${status}`)} />}
                actions={renderRowActions(invoice)}
              />
            )
          }}
        />
      </section>

      {/* Payment Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
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
                  title={t("ap.recalculate-title")}
                >
                  <Calendar className="w-4 h-4 me-1" />
                  {t("ap.recalculate")}
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
                  <p className="font-medium"><Money value={selectedInvoiceForSchedule.amount || 0} /> {t("common.egp-2")}</p>
                </div>
              </div>

              {/* Payment Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>
                    {t("field.paid")}: <Money value={selectedInvoiceForSchedule.paidAmount || 0} /> {t("common.egp-2")}
                  </span>
                  <span>
                    {t("field.balance")}:{" "}
                    <Money
                      value={(selectedInvoiceForSchedule.amount || 0) - (selectedInvoiceForSchedule.paidAmount || 0)}
                    />{" "}
                    {t("common.egp-2")}
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
                          {t("ap.schedules-generated-warning")}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          selectedInvoiceForSchedule && regenerateSchedulesForPO(selectedInvoiceForSchedule)
                        }
                      >
                        <RefreshCw className="w-4 h-4 me-1" />
                        {t("action.save-schedule")}
                      </Button>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">#</TableHead>
                        <TableHead>{t("field.due-date")}</TableHead>
                        <TableHead className="text-end">{t("field.amount")} {t("common.egp")}</TableHead>
                        <TableHead className="text-end">{t("field.paid")} {t("common.egp")}</TableHead>
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
                            <TableCell>{formatDate(schedule.dueDate, language)}</TableCell>
                            <TableCell className="text-end font-medium"><Money value={schedule.amount} /></TableCell>
                            <TableCell className="text-end"><Money value={schedule.paidAmount || 0} /></TableCell>
                            <TableCell>{schedule.paymentDate ? formatDate(schedule.paymentDate, language) : "-"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getScheduleStatusIcon(isPaid ? "paid" : isOverdue ? "overdue" : schedule.status)}
                                <StatusBadge
                                  status={isPaid ? "paid" : isOverdue ? "overdue" : schedule.status}
                                  label={t(`status.${isPaid ? "paid" : isOverdue ? "overdue" : schedule.status}`)}
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                {!isPaid && (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setSelectedScheduleForPayment(schedule)
                                      openPaymentForm(
                                        Math.min(
                                          schedule.amount,
                                          Math.max(
                                            (selectedInvoiceForSchedule?.amount || 0) - (selectedInvoiceForSchedule?.paidAmount || 0),
                                            0,
                                          ),
                                        ),
                                      )
                                      setSchedulePaymentDialogOpen(true)
                                    }}
                                  >
                                    <DollarSign className="w-4 h-4 me-1" />
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
                                    title={t("ap.view-uploaded-receipt")}
                                  >
                                    <Eye className="w-4 h-4 me-1" />
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
                  <span className="font-medium"><Money value={selectedScheduleForPayment.amount} /> {t("common.egp-2")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("field.due-date")}</span>
                  <span>{formatDate(selectedScheduleForPayment.dueDate, language)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("amount")}</Label>
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("ap.payment-method")}</Label>
                <Select value={payMethod} onValueChange={(v) => setPayMethod(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("payment.cash")}</SelectItem>
                    <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
                    <SelectItem value="bank_transfer">{t("ap.bank-transfer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ap-allow-overpayment"
                  checked={payAllowOverpayment}
                  onCheckedChange={(v) => setPayAllowOverpayment(v === true)}
                />
                <Label htmlFor="ap-allow-overpayment">{t("ap.advance-overpayment")}</Label>
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
            <Button onClick={handleRecordSchedulePayment} disabled={!schedulePaymentFile || isUploading || !(Number(payAmount) > 0)}>
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
                    <Money
                      value={(selectedInvoiceForPayment.amount || 0) - (selectedInvoiceForPayment.paidAmount || 0)}
                    />{" "}
                    {t("common.egp-2")}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("amount")}</Label>
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("ap.payment-method")}</Label>
                <Select value={payMethod} onValueChange={(v) => setPayMethod(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("payment.cash")}</SelectItem>
                    <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
                    <SelectItem value="bank_transfer">{t("ap.bank-transfer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ap-allow-overpayment"
                  checked={payAllowOverpayment}
                  onCheckedChange={(v) => setPayAllowOverpayment(v === true)}
                />
                <Label htmlFor="ap-allow-overpayment">{t("ap.advance-overpayment")}</Label>
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
            <Button onClick={handleRecordPayment} disabled={!paymentReceiptFile || isUploading || !(Number(payAmount) > 0)}>
              {isUploading ? t("action.uploading") : t("ar.record-payment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Widget Dialog */}
      <Dialog open={widgetDialogOpen} onOpenChange={setWidgetDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{getWidgetDialogTitle()}</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ap.invoice-number")}</TableHead>
                <TableHead>{t("field.supplier")}</TableHead>
                <TableHead>{t("field.due-date")}</TableHead>
                <TableHead className="text-end">{t("field.balance")} {t("common.egp")}</TableHead>
                <TableHead>{t("field.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {getWidgetInvoices().map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                  <TableCell>{getSupplierName(invoice.supplierId)}</TableCell>
                  <TableCell>{formatDate(invoice.dueDate, language)}</TableCell>
                  <TableCell className="text-end font-medium">
                    <Money value={(invoice.amount || 0) - (invoice.paidAmount || 0)} />
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
                      <Calendar className="w-4 h-4 me-1" />
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              {t("ap.payment-details")}
            </DialogTitle>
          </DialogHeader>

          {selectedInvoiceForPaymentDetails && (
            <div className="space-y-6">
              {(() => {
                const bankDetails = getPOBankDetails(selectedInvoiceForPaymentDetails.poId)
                const hasBankDetails = bankDetails.bankName || bankDetails.bankAccountNumber || bankDetails.bankIban
                const isChequePayment = bankDetails.paymentType === "cheque"
                const isHybridCheque =
                  bankDetails.paymentType === "hybrid" && bankDetails.downPaymentType === "cheque"
                const hasChequeDetails =
                  (isChequePayment && (bankDetails.chequeNumber || bankDetails.chequeBankName)) ||
                  (isHybridCheque && (bankDetails.downPaymentChequeNumber || bankDetails.downPaymentChequeBank))

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
                          <p className="font-medium capitalize">{bankDetails.paymentType ? t(`payment.${bankDetails.paymentType}`) : t("label.na")}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.supplier")}</p>
                          <p className="font-medium">{getSupplierName(selectedInvoiceForPaymentDetails.supplierId)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("field.total-amount")}</p>
                          <p className="font-medium"><Money value={selectedInvoiceForPaymentDetails.amount || 0} /> {t("common.egp-2")}</p>
                        </div>
                        {/* Download PDF: uploaded payment receipt if available, otherwise generated invoice */}
                        <div>
                          <p className="text-sm text-muted-foreground">{t("action.download-pdf")}</p>
                          {paymentDetailsReceipts.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {paymentDetailsReceipts.map((receipt, index) => (
                                <Button
                                  key={receipt.receiptUrl}
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(receipt.receiptUrl, "_blank")}
                                >
                                  <FileText className="w-4 h-4 me-1" />
                                  {paymentDetailsReceipts.length > 1
                                    ? `${t("action.view-receipt")} ${index + 1}`
                                    : t("action.view-receipt")}
                                  {receipt.paymentDate ? ` (${formatDate(receipt.paymentDate, language)})` : ""}
                                </Button>
                              ))}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadInvoicePDF(selectedInvoiceForPaymentDetails)}
                            >
                              <Download className="w-4 h-4 me-1" />
                              {t("action.download")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Cheque Details */}
                    {hasChequeDetails && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          {t("payment.cheque-details")}
                        </h3>
                        <div className="border rounded-lg p-4 space-y-3 bg-amber-50/50 border-amber-200">
                          {isChequePayment ? (
                            <>
                              {bankDetails.chequeNumber && (
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="text-xs text-muted-foreground">
                                      {t("payment.cheque-number")}
                                    </p>
                                    <p className="font-medium font-mono">{bankDetails.chequeNumber}</p>
                                  </div>
                                  <Button
                                    aria-label={`${t("a11y.finance.copy-value")} ${t("payment.cheque-number")}`}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => copyToClipboard(bankDetails.chequeNumber)}
                                  >
                                    <Copy className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                              {bankDetails.chequeBankName && (
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="text-xs text-muted-foreground">
                                      {t("payment.bank-name")}
                                    </p>
                                    <p className="font-medium">{bankDetails.chequeBankName}</p>
                                  </div>
                                  <Button
                                    aria-label={`${t("a11y.finance.copy-value")} ${t("payment.bank-name")}`}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => copyToClipboard(bankDetails.chequeBankName)}
                                  >
                                    <Copy className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                              {bankDetails.chequeDueDate && (
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("payment.cheque-due-date")}
                                  </p>
                                  <p className="font-medium">{formatDate(bankDetails.chequeDueDate, language)}</p>
                                </div>
                              )}
                              {bankDetails.chequeAmount > 0 && (
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("payment.cheque-amount")}
                                  </p>
                                  <p className="font-medium"><Money value={bankDetails.chequeAmount} /> {t("common.egp-2")}</p>
                                </div>
                              )}
                              {bankDetails.chequeNotes && (
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("payment.cheque-notes")}
                                  </p>
                                  <p className="font-medium">{bankDetails.chequeNotes}</p>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-muted-foreground">
                                {t("payment.down-payment-cheque")}
                              </p>
                              {bankDetails.downPaymentChequeNumber && (
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="text-xs text-muted-foreground">
                                      {t("payment.cheque-number")}
                                    </p>
                                    <p className="font-medium font-mono">{bankDetails.downPaymentChequeNumber}</p>
                                  </div>
                                  <Button
                                    aria-label={`${t("a11y.finance.copy-value")} ${t("payment.cheque-number")}`}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => copyToClipboard(bankDetails.downPaymentChequeNumber)}
                                  >
                                    <Copy className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                              {bankDetails.downPaymentChequeBank && (
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("payment.bank-name")}
                                  </p>
                                  <p className="font-medium">{bankDetails.downPaymentChequeBank}</p>
                                </div>
                              )}
                              {bankDetails.downPaymentChequeDueDate && (
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("payment.cheque-due-date")}
                                  </p>
                                  <p className="font-medium">{formatDate(bankDetails.downPaymentChequeDueDate, language)}</p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Bank Details */}
                    {hasBankDetails ? (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {t("po.bank-details")}
                        </h3>
                        <div className="border rounded-lg p-4 space-y-3">
                          {bankDetails.bankHolderName && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("po.account-holder")}
                                </p>
                                <p className="font-medium">{bankDetails.bankHolderName}</p>
                              </div>
                              <Button
                                aria-label={`${t("a11y.finance.copy-value")} ${t("po.account-holder")}`}
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
                                <p className="text-xs text-muted-foreground">{t("po.bank-name")}</p>
                                <p className="font-medium">{bankDetails.bankName}</p>
                              </div>
                              <Button aria-label={`${t("a11y.finance.copy-value")} ${t("po.bank-name")}`} size="sm" variant="ghost" onClick={() => copyToClipboard(bankDetails.bankName)}>
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankAccountNumber && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("po.account-number")}
                                </p>
                                <p className="font-medium font-mono">{bankDetails.bankAccountNumber}</p>
                              </div>
                              <Button
                                aria-label={`${t("a11y.finance.copy-value")} ${t("po.account-number")}`}
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
                                <p className="text-xs text-muted-foreground">{t("po.iban")}</p>
                                <p className="font-medium font-mono text-sm">{bankDetails.bankIban}</p>
                              </div>
                              <Button aria-label={`${t("a11y.finance.copy-value")} ${t("po.iban")}`} size="sm" variant="ghost" onClick={() => copyToClipboard(bankDetails.bankIban)}>
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {bankDetails.bankSwiftCode && (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs text-muted-foreground">{t("po.swift-code")}</p>
                                <p className="font-medium font-mono">{bankDetails.bankSwiftCode}</p>
                              </div>
                              <Button
                                aria-label={`${t("a11y.finance.copy-value")} ${t("po.swift-code")}`}
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
                                <p className="text-xs text-muted-foreground">{t("po.branch")}</p>
                                <p className="font-medium">{bankDetails.bankBranch}</p>
                              </div>
                              <Button aria-label={`${t("a11y.finance.copy-value")} ${t("po.branch")}`} size="sm" variant="ghost" onClick={() => copyToClipboard(bankDetails.bankBranch)}>
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 border border-dashed rounded-lg text-center text-muted-foreground">
                        <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>{t("ap.no-bank-details")}</p>
                      </div>
                    )}

                    {/* Down Payment Info for Hybrid */}
                    {bankDetails.paymentType === "hybrid" && bankDetails.downPaymentAmount > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          {t("payment.down-payment")}
                        </h3>
                        <div className="border rounded-lg p-4 space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("field.amount")}</span>
                            <span className="font-medium"><Money value={bankDetails.downPaymentAmount} /> {t("common.egp-2")}</span>
                          </div>
                          {bankDetails.downPaymentDueDate && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("field.due-date")}</span>
                              <span className="font-medium">{formatDate(bankDetails.downPaymentDueDate, language)}</span>
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
