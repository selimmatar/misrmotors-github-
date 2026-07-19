"use client"

import React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import type { CustomerInvoice } from "@/lib/types"
import { Eye, FileText, Calendar, DollarSign, CheckCircle, Clock, AlertCircle, Plus, ChevronDown, Upload } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"

interface PaymentScheduleEntry {
  id: string
  invoiceId: string
  soId?: string
  installmentNumber: number
  dueDate: string
  amount: number
  paidAmount: number
  paymentDate: string | null
  status: "pending" | "paid" | "overdue" | "partial"
  receiptUrl: string | null
  notes: string | null
  isDownPayment?: boolean
}

interface AccountsReceivableModuleProps {
  userRole?: string
}

export function AccountsReceivableModule({ userRole }: AccountsReceivableModuleProps) {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const { customerInvoices, customers, salesOrders, updateCustomerInvoice, loadData } = useAppContext()
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<CustomerInvoice | null>(null)
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [listFilter, setListFilter] = useState<"all" | "pending" | "partially_paid" | "paid" | "overdue">("all")
  const [widgetDialogOpen, setWidgetDialogOpen] = useState(false)
  const [widgetDialogType, setWidgetDialogType] = useState<"receivable" | "collected" | "outstanding" | "overdue">(
    "receivable",
  )
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [selectedInvoiceForSchedule, setSelectedInvoiceForSchedule] = useState<CustomerInvoice | null>(null)
  const [paymentSchedules, setPaymentSchedules] = useState<PaymentScheduleEntry[]>([])
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false)
  const [selectedScheduleForPayment, setSelectedScheduleForPayment] = useState<PaymentScheduleEntry | null>(null)
  const [schedulePaymentDialogOpen, setSchedulePaymentDialogOpen] = useState(false)
  const [schedulePaymentFile, setSchedulePaymentFile] = useState<File | null>(null)
  const [schedulesFromDB, setSchedulesFromDB] = useState(false)

  const [soSelectDialogOpen, setSoSelectDialogOpen] = useState(false)
  const [availableSOs, setAvailableSOs] = useState<any[]>([])
  const [selectedSO, setSelectedSO] = useState<string | null>(null)
  const [selectedSODetails, setSelectedSODetails] = useState<any | null>(null)
  const [soDeliveryPermits, setSODeliveryPermits] = useState<any[]>([])
  const [isLoadingSODetails, setIsLoadingSODetails] = useState(false)

  const [dpSelectDialogOpen, setDpSelectDialogOpen] = useState(false)
  const [availableDPs, setAvailableDPs] = useState<any[]>([])
  const [selectedDPs, setSelectedDPs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [dpReturnHandling, setDpReturnHandling] = useState<Record<string, "exclude" | "credit">>({})
  const [showCreditMemoForm, setShowCreditMemoForm] = useState(false)
  const [creditMemoDP, setCreditMemoDP] = useState<string | null>(null)

  useEffect(() => {
    if (soSelectDialogOpen && availableSOs.length > 0) {
    }
    if (dpSelectDialogOpen && availableDPs.length > 0) {
    }
  }, [soSelectDialogOpen, dpSelectDialogOpen, availableSOs, availableDPs])

  const allInvoices = customerInvoices

  const fetchAvailableSOs = async () => {
    try {
      const response = await fetch("/api/sales-orders")
      if (response.ok) {
        const data = await response.json()
        
        // Filter out SOs that already have invoices
        const soIdsWithInvoices = new Set(allInvoices.map((invoice) => String(invoice.soId)))
        const filteredSOs = data.filter((so: any) => {
          const soId = String(so.soId || so.so_id || so.id)
          return !soIdsWithInvoices.has(soId)
        })
        
        setAvailableSOs(filteredSOs)
      }
    } catch (error) {
      console.error("[v0] AR - Error fetching SOs:", error)
    }
  }

  const fetchSODetails = async (soId: string) => {
    setIsLoadingSODetails(true)
    try {
      // Get full SO details first
      const soDetails = availableSOs.find((so) => String(so.soId) === soId || String(so.so_id) === soId)
      setSelectedSODetails(soDetails)
      
      // Fetch delivery permits for this SO
      const dpResponse = await fetch(`/api/delivery-permits?so_id=${soId}`)
      if (dpResponse.ok) {
        const dpData = await dpResponse.json()
        setSODeliveryPermits(dpData || [])
      } else {
        console.error("[v0] AR - Failed to fetch DPs:", await dpResponse.text())
        setSODeliveryPermits([])
      }
    } catch (error) {
      console.error("[v0] AR - Error fetching SO details:", error)
      setSODeliveryPermits([])
    } finally {
      setIsLoadingSODetails(false)
    }
  }

  const fetchAvailableDPs = async () => {
    try {
      const response = await fetch("/api/delivery-permits")
      if (response.ok) {
        const data = await response.json()
        setAvailableDPs(data)
      }
    } catch (error) {
      console.error("[v0] AR - Error fetching DPs:", error)
    }
  }

  // Use a generic fetch function and rename it to avoid confusion with loadData
  const fetchInvoices = async () => {
    try {
      const response = await fetch("/api/accounts-receivable")
      if (response.ok) {
        const data = await response.json()
        // Assuming useAppContext has a way to update customerInvoices, or we pass it back
        // For now, let's assume loadData does this
        await loadData()
      } else {
        console.error("[v0] AR - Error fetching invoices:", response.statusText)
      }
    } catch (error) {
      console.error("[v0] AR - Error fetching invoices:", error)
    }
  }

  const handleCreateFromSO = async () => {
    if (!selectedSO) return

    try {
      const response = await fetch("/api/accounts-receivable/create-from-so", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ so_id: Number(selectedSO) }),
      })

      if (response.ok) {
        alert(t("message.success"))
        setSoSelectDialogOpen(false)
        setSelectedSO(null)
        await loadData() // Assuming loadData also reloads invoices
      } else {
        const error = await response.json()
        alert(error.error || "Failed to create invoice")
      }
    } catch (error) {
      console.error("[v0] AR - Error creating invoice from SO:", error)
      alert(t("message.error"))
    }
  }

  const validatePaymentTerms = (dpIds: string[]) => {
    const selectedDPObjects = availableDPs.filter((dp) => dpIds.includes(dp.permit_id))

    // Get payment terms from each DP's linked SO
    const paymentTerms = selectedDPObjects.map((dp) => {
      const so = salesOrders.find((s: any) => s.so_id === dp.sales_order_id || s.id === dp.sales_order_id)
      return so?.payment_type || so?.paymentType || so?.payment_terms || "cash"
    })


    // Check if all payment terms are the same
    const uniqueTerms = [...new Set(paymentTerms)]
    if (uniqueTerms.length > 1) {
      return {
        valid: false,
        message: `Cannot consolidate DPs with different payment terms: ${uniqueTerms.join(", ")}. Please select DPs with the same payment method.`,
      }
    }

    return { valid: true, paymentTerm: uniqueTerms[0] }
  }

  const handleCreateFromDPs = async () => {
    if (selectedDPs.length === 0) return

    const validation = validatePaymentTerms(selectedDPs)
    if (!validation.valid) {
      alert(validation.message)
      return
    }

    try {
      const response = await fetch("/api/accounts-receivable/create-from-dps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permit_ids: selectedDPs, // Changed from delivery_permit_ids
          payment_terms: validation.paymentTerm,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[v0] Invoice creation failed. Status:", response.status, "Response:", errorText)

        let errorMessage = "Failed to create invoice"
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.error || errorMessage
        } catch (e) {
          errorMessage = errorText || errorMessage
        }

        alert(errorMessage)
        return
      }

      const result = await response.json()
      alert(`Invoice created from ${selectedDPs.length} delivery permits`)
      setDpSelectDialogOpen(false)
      setSelectedDPs([])
      await loadData()
    } catch (error) {
      console.error("[v0] Error creating invoice from DPs:", error)
      alert("Failed to create invoice. Please try again.")
    }
  }

  const getCustomerName = (customerId: number | string | undefined) => {
    const customer = customers?.find((c: any) => c.customer_id === customerId || c.id === customerId)
    return (
      customer?.customer_name ||
      customer?.name ||
      (customerInvoices.find((i) => i.customerId === customerId) as any)?.customerName || // Fallback for older data
      "Unknown"
    )
  }

  const getSONumber = (soId: string | number | undefined, invoice?: CustomerInvoice) => {
    // Maintenance invoices don't have an SO
    if (invoice?.isMaintenance || invoice?.invoiceNumber?.startsWith("INV-MNT-")) {
      return invoice?.invoiceNumber?.replace("INV-MNT-", "WO-") || t("field.maintenance")
    }
    if (!soId) return t("field.unknown")
    const so = salesOrders?.find((s: any) => s.so_id === soId || s.id === soId)
    return so?.so_number || so?.soNumber || t("field.unknown")
  }

  const getSOPaymentType = (soId: string | number | undefined, invoice?: CustomerInvoice) => {
    // For maintenance invoices, use the invoice's own payment terms, NOT the SO's
    if (invoice?.isMaintenance || invoice?.invoiceNumber?.startsWith("INV-MNT-")) {
      return invoice?.paymentTerms || "cash"
    }
    if (!soId) return "cash"
    const so = salesOrders?.find((s) => s.so_id === soId || s.id === soId)
    return so?.payment_type || so?.paymentType || so?.payment_terms || "cash"
  }

  const getSO = (soId: string | undefined) => {
    if (!soId) return null
    return salesOrders.find((s) => s.id === soId || s.soNumber === soId)
  }

  const handleDownloadInvoicePDF = (invoice: CustomerInvoice) => {
    // The AR GET endpoint transforms invoice_id to id, so use that
    const invoiceId = invoice.id
    if (!invoiceId) {
      console.error("[v0] AR PDF Error: No invoice ID found", invoice)
      alert(t("error.no-invoice-id"))
      return
    }
    
    const pdfUrl = `/api/invoices/ar/${invoiceId}/pdf`
    window.open(pdfUrl, "_blank")
  }

  const getInstallmentMonths = (invoice: CustomerInvoice) => {
    // For maintenance invoices, use the invoice's own installment months (default 1)
    // Do NOT look up the SO for maintenance invoices
    if (invoice.isMaintenance || invoice.invoiceNumber?.startsWith("INV-MNT-")) {
      return invoice.installmentMonths && invoice.installmentMonths > 0 ? invoice.installmentMonths : 1
    }
    if (invoice.installmentMonths && invoice.installmentMonths > 0) {
      return invoice.installmentMonths
    }
    const so = salesOrders.find((s) => s.id === invoice.soId)
    return so?.installments || 1
  }

  const isPaymentDue = (invoice: CustomerInvoice): boolean => {
    if (!invoice.date) return false
    if (invoice.status === "paid") return false

    const invoiceDate = new Date(invoice.date)
    if (isNaN(invoiceDate.getTime())) return false

    const installmentMonths = getInstallmentMonths(invoice)
    const monthsPaid = invoice.monthsPaid || 0

    if (monthsPaid >= installmentMonths) return false

    const today = new Date()
    const nextPaymentDueDate = new Date(invoiceDate)
    nextPaymentDueDate.setMonth(nextPaymentDueDate.getMonth() + monthsPaid + 1)

    return today >= nextPaymentDueDate
  }

  const getInvoiceStatus = (invoice: CustomerInvoice): "pending" | "partially_paid" | "paid" | "overdue" => {
    // Calculate actual balance first - this is the source of truth
    const balance = (invoice.amount || 0) - (invoice.collectedAmount || 0)
    
    // If balance is zero or negative, invoice is fully paid
    if (balance <= 0.01) return "paid" // Allow for small rounding errors
    
    // Check if overdue
    if (isPaymentDue(invoice)) return "overdue"
    
    // If some payment has been made but balance remains, it's partially paid
    const collectedAmount = invoice.collectedAmount || 0
    if (collectedAmount > 0) return "partially_paid"
    
    // No payment made yet
    return "pending"
  }

  const totalReceivable = allInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  const totalCollected = allInvoices.reduce((sum, inv) => sum + (inv.collectedAmount || 0), 0)
  const totalOutstanding = totalReceivable - totalCollected
  const overdueInvoices = allInvoices.filter((inv) => getInvoiceStatus(inv) === "overdue")
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + ((inv.amount || 0) - (inv.collectedAmount || 0)), 0)

  const fetchPaymentSchedule = async (invoice: CustomerInvoice) => {
    setIsLoadingSchedule(true)
    setPaymentSchedules([])
    setSchedulesFromDB(false)

    const soId = invoice.soId ? String(invoice.soId) : null
    const invoiceId = String(invoice.id)

    try {
      let schedules: PaymentScheduleEntry[] = []

      // Try to fetch from database by SO ID first (schedules may be created with SO ID)
      if (soId) {
        const response = await fetch(`/api/payment-schedules?soId=${soId}`)

        if (response.ok) {
          const data = await response.json()

          if (data && Array.isArray(data) && data.length > 0) {
            schedules = data
            setSchedulesFromDB(true)
          }
        }
      }

      // If no schedules from SO, try invoice ID
      if (schedules.length === 0) {
        const response = await fetch(`/api/payment-schedules?invoiceId=${invoiceId}`)

        if (response.ok) {
          const data = await response.json()

          if (data && Array.isArray(data) && data.length > 0) {
            schedules = data
            setSchedulesFromDB(true)
          }
        }
      }

      // If still no schedules, generate from SO/invoice data
      if (schedules.length === 0) {
        schedules = generateScheduleFromInvoice(invoice)
        setSchedulesFromDB(false)
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
      setSchedulesFromDB(false)
    } finally {
      setIsLoadingSchedule(false)
    }
  }

  const generateScheduleFromInvoice = (invoice: CustomerInvoice): PaymentScheduleEntry[] => {
    const schedules: PaymentScheduleEntry[] = []
    const so = getSO(invoice.soId)
    const paymentType = getSOPaymentType(invoice.soId, invoice) // Use helper for consistent lookup
    const totalAmount = invoice.amount || 0
    const paidAmount = invoice.collectedAmount || 0

    // Get payment details from SO
    const paymentDetails = so?.paymentDetails

    if (
      so?.scheduleMode === "MANUAL" &&
      so?.scheduleEntries &&
      Array.isArray(so.scheduleEntries) &&
      so.scheduleEntries.length > 0
    ) {
      // Track how much has been paid for status calculation
      let remainingPaid = paidAmount

      // For hybrid payments, add down payment first if not in entries
      if (paymentType === "hybrid") {
        const downPaymentAmount = paymentDetails?.downPaymentAmount || 0
        const downPaymentDueDate =
          so?.downPaymentDueDate ||
          paymentDetails?.downPaymentDueDate ||
          so?.orderDate ||
          new Date().toISOString().split("T")[0]

        const hasDownPaymentEntry = so.scheduleEntries.some((e: any) => e.isDownPayment || e.installmentNumber === 0)

        if (downPaymentAmount > 0 && !hasDownPaymentEntry) {
          const dpPaid = Math.min(remainingPaid, downPaymentAmount)
          remainingPaid -= dpPaid

          schedules.push({
            id: `gen-dp-${invoice.id}`,
            invoiceId: invoice.id,
            soId: invoice.soId,
            installmentNumber: 0,
            dueDate: downPaymentDueDate,
            amount: downPaymentAmount,
            paidAmount: dpPaid,
            status:
              dpPaid >= downPaymentAmount ? "paid" : new Date(downPaymentDueDate) < new Date() ? "overdue" : "pending",
            receiptUrl: null,
            notes: null,
            isDownPayment: true,
            paymentDate: null,
          })
        }
      }

      // Add each manual schedule entry
      so.scheduleEntries.forEach((entry: any, index: number) => {
        const entryAmount = entry.amount || 0
        const entryPaid = Math.min(remainingPaid, entryAmount)
        remainingPaid -= Math.max(0, entryPaid)
        const dueDateStr = entry.dueDate || new Date().toISOString().split("T")[0]

        schedules.push({
          id: `gen-manual-${invoice.id}-${index}`,
          invoiceId: invoice.id,
          soId: invoice.soId,
          installmentNumber: entry.installmentNumber ?? index + 1,
          dueDate: dueDateStr,
          amount: entryAmount,
          paidAmount: entryPaid > 0 ? entryPaid : 0,
          status: entryPaid >= entryAmount ? "paid" : new Date(dueDateStr) < new Date() ? "overdue" : "pending",
          receiptUrl: null,
          notes: entry.notes || null,
          isDownPayment: entry.isDownPayment || false,
          paymentDate: null,
        })
      })

      return schedules
    }

    // For cash/prepaid, just show one entry
    if (paymentType === "cash" || paymentType === "prepaid") {
      schedules.push({
        id: `gen-${invoice.id}-1`,
        invoiceId: invoice.id,
        soId: invoice.soId,
        installmentNumber: 1,
        dueDate: invoice.dueDate || new Date().toISOString().split("T")[0],
        amount: totalAmount,
        paidAmount: paidAmount,
        status: paidAmount >= totalAmount ? "paid" : "pending",
        receiptUrl: null,
        notes: null,
        isDownPayment: false,
        paymentDate: null,
      })
      return schedules
    }

    if (paymentType === "hybrid") {
      const downPaymentAmount = paymentDetails?.downPaymentAmount || 0
      const downPaymentDueDate =
        so?.downPaymentDueDate ||
        paymentDetails?.downPaymentDueDate ||
        so?.orderDate ||
        invoice.date ||
        new Date().toISOString().split("T")[0]

      // Calculate remaining amount
      const remainingAmount = paymentDetails?.remainingAmount || totalAmount - downPaymentAmount

      // Get installment months
      const remainingMonths =
        paymentDetails?.remainingInstallmentMonths || so?.installments || invoice.installmentMonths || 6

      // Calculate monthly amount
      const monthlyAmount =
        paymentDetails?.monthlyAmount || (remainingMonths > 0 ? remainingAmount / remainingMonths : remainingAmount)

      // Get payment start date
      let paymentStartDate = paymentDetails?.paymentStartDate
      if (!paymentStartDate) {
        const startDate = new Date(downPaymentDueDate)
        startDate.setMonth(startDate.getMonth() + 1)
        paymentStartDate = startDate.toISOString().split("T")[0]
      }

      // Track how much has been paid for status calculation
      let remainingPaid = paidAmount

      // Add down payment entry (installment 0)
      if (downPaymentAmount > 0) {
        const dpPaid = Math.min(remainingPaid, downPaymentAmount)
        remainingPaid -= dpPaid

        schedules.push({
          id: `gen-dp-${invoice.id}`,
          invoiceId: invoice.id,
          soId: invoice.soId,
          installmentNumber: 0,
          dueDate: downPaymentDueDate,
          amount: downPaymentAmount,
          paidAmount: dpPaid,
          status:
            dpPaid >= downPaymentAmount ? "paid" : new Date(downPaymentDueDate) < new Date() ? "overdue" : "pending",
          receiptUrl: null,
          notes: null,
          isDownPayment: true,
          paymentDate: null,
        })
      }

      // Add installment entries
      for (let i = 1; i <= remainingMonths; i++) {
        const dueDate = new Date(paymentStartDate)
        dueDate.setMonth(dueDate.getMonth() + (i - 1))
        const dueDateStr = dueDate.toISOString().split("T")[0]

        const instPaid = Math.min(remainingPaid, monthlyAmount)
        remainingPaid -= Math.max(0, instPaid)

        schedules.push({
          id: `gen-${invoice.id}-${i}`,
          invoiceId: invoice.id,
          soId: invoice.soId,
          installmentNumber: i,
          dueDate: dueDateStr,
          amount: monthlyAmount,
          paidAmount: instPaid > 0 ? instPaid : 0,
          status: instPaid >= monthlyAmount ? "paid" : new Date(dueDateStr) < new Date() ? "overdue" : "pending",
          receiptUrl: null,
          notes: null,
          isDownPayment: false,
          paymentDate: null,
        })
      }

      return schedules
    }

    // For regular installments
    if (paymentType === "installments") {
      const installmentMonths = so?.installments || invoice.installmentMonths || 6
      const monthlyAmount = totalAmount / installmentMonths
      const startDate = paymentDetails?.paymentStartDate || invoice.dueDate || new Date().toISOString().split("T")[0]

      let remainingPaid = paidAmount

      for (let i = 1; i <= installmentMonths; i++) {
        const dueDate = new Date(startDate)
        dueDate.setMonth(dueDate.getMonth() + (i - 1))
        const dueDateStr = dueDate.toISOString().split("T")[0]

        const instPaid = Math.min(remainingPaid, monthlyAmount)
        remainingPaid -= Math.max(0, instPaid)

        schedules.push({
          id: `gen-${invoice.id}-${i}`,
          invoiceId: invoice.id,
          soId: invoice.soId,
          installmentNumber: i,
          dueDate: dueDateStr,
          amount: monthlyAmount,
          paidAmount: instPaid > 0 ? instPaid : 0,
          status: instPaid >= monthlyAmount ? "paid" : new Date(dueDateStr) < new Date() ? "overdue" : "pending",
          receiptUrl: null,
          notes: null,
          isDownPayment: false,
          paymentDate: null,
        })
      }

      return schedules
    }

    // For cheque - single payment
    if (paymentType === "cheque") {
      const chequeDueDate = paymentDetails?.chequeDueDate || invoice.dueDate || new Date().toISOString().split("T")[0]

      schedules.push({
        id: `gen-${invoice.id}-cheque`,
        invoiceId: invoice.id,
        soId: invoice.soId,
        installmentNumber: 1,
        dueDate: chequeDueDate,
        amount: totalAmount,
        paidAmount: paidAmount,
        status: paidAmount >= totalAmount ? "paid" : new Date(chequeDueDate) < new Date() ? "overdue" : "pending",
        receiptUrl: null,
        notes: null,
        isDownPayment: false,
        paymentDate: null,
      })

      return schedules
    }

    // Fallback: single payment
    schedules.push({
      id: `gen-${invoice.id}-1`,
      invoiceId: invoice.id,
      soId: invoice.soId,
      installmentNumber: 1,
      dueDate: invoice.dueDate || new Date().toISOString().split("T")[0],
      amount: totalAmount,
      paidAmount: paidAmount,
      status: paidAmount >= totalAmount ? "paid" : "pending",
      receiptUrl: null,
      notes: null,
      isDownPayment: false,
      paymentDate: null,
    })

    return schedules
  }

  const handleViewSchedule = async (invoice: CustomerInvoice) => {
    setSelectedInvoiceForSchedule(invoice)
    setScheduleDialogOpen(true)
    await fetchPaymentSchedule(invoice)
  }

  const handleVATInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>, invoice: CustomerInvoice) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Capture invoice ID immediately to avoid closure issues
    const invoiceId = invoice.id

    try {
      // Upload to Vercel Blob
      const formData = new FormData()
      formData.append('file', file)

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })


      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json()
        console.error("[v0] Upload failed:", errorData)
        throw new Error(errorData.error || 'Failed to upload file')
      }

      const { url } = await uploadResponse.json()

      // Update invoice with VAT invoice URL
      const response = await fetch('/api/accounts-receivable', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoiceId,
          vatInvoiceUrl: url,
        }),
      })


      if (!response.ok) {
        const errorData = await response.json()
        console.error("[v0] Invoice update failed:", errorData)
        throw new Error(errorData.error || 'Failed to update invoice')
      }

      alert(t("success.vat-invoice-uploaded") || "VAT Invoice Uploaded Successfully!")

      // Refresh invoices
      fetchInvoices()
    } catch (error: any) {
      console.error("[v0] Error uploading VAT invoice:", error)
      alert(t("error.upload-failed") || `Failed to upload VAT invoice: ${error.message}`)
    }
  }

  const handleRecordSchedulePayment = async () => {
    if (!selectedScheduleForPayment || !schedulePaymentFile || !selectedInvoiceForSchedule) {
      alert(t("ar.upload-receipt-required"))
      return
    }

    const invoiceId = selectedInvoiceForSchedule.id
    if (!invoiceId) {
      console.error("[v0] AR - No invoice ID found")
      alert(t("message.error"))
      return
    }

    setIsUploading(true)
    try {
      // Upload receipt file
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
      const newCollectedAmount = (selectedInvoiceForSchedule.collectedAmount || 0) + paymentAmount
      const newMonthsPaid = (selectedInvoiceForSchedule.monthsPaid || 0) + 1
      const isFullyPaid = newCollectedAmount >= (selectedInvoiceForSchedule.amount || 0)

      // Check if this is a generated schedule (no real ID in database)
      if (selectedScheduleForPayment.id.startsWith("gen-")) {
        // For generated schedules, just update the invoice directly
        await updateCustomerInvoice(invoiceId, {
          collectedAmount: newCollectedAmount,
          monthsPaid: newMonthsPaid,
          status: isFullyPaid ? "paid" : "partially_paid",
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
            receiptUrl: receiptUrl,
            scheduleType: "receivable", // Added scheduleType to identify this is AR
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || "Failed to record payment")
        }

        // Update AR invoice with correct function signature
        await updateCustomerInvoice(invoiceId, {
          collectedAmount: newCollectedAmount,
          monthsPaid: newMonthsPaid,
          status: isFullyPaid ? "paid" : "partially_paid",
        })
      }

      // Record in balance
      await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ar_payment",
          referenceId: Number.parseInt(invoiceId) || 0,
          referenceNumber: `${selectedInvoiceForSchedule?.invoiceNumber}-Inst-${selectedScheduleForPayment.installmentNumber}`,
          amount: paymentAmount,
          description: `AR Payment - ${selectedInvoiceForSchedule?.invoiceNumber} (${selectedScheduleForPayment.isDownPayment || selectedScheduleForPayment.installmentNumber === 0 ? "Down Payment" : `Installment ${selectedScheduleForPayment.installmentNumber}`})`,
        }),
      })

      await loadData()

      // Update local state for immediate UI feedback
      const updatedInvoice = {
        ...selectedInvoiceForSchedule,
        collectedAmount: newCollectedAmount,
        balance: (selectedInvoiceForSchedule.amount || 0) - newCollectedAmount, // UI only
        monthsPaid: newMonthsPaid,
        status: isFullyPaid ? "paid" : "partially_paid",
      }
      setSelectedInvoiceForSchedule(updatedInvoice)
      await fetchPaymentSchedule(updatedInvoice)

      setSchedulePaymentDialogOpen(false)
      setSelectedScheduleForPayment(null)
      setSchedulePaymentFile(null)
      alert(t("message.success"))
    } catch (error) {
      console.error("[v0] AR - Error recording schedule payment:", error)
      alert(t("message.error"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleRecordPayment = async () => {
    if (!selectedInvoiceForPayment || !paymentReceiptFile) {
      alert(t("ar.upload-receipt-required"))
      return
    }

    setIsUploading(true)
    try {
      // Upload receipt file
      const formData = new FormData()
      formData.append("file", paymentReceiptFile)
      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })
      if (!uploadResponse.ok) throw new Error("Upload failed")
      const { url: receiptUrl } = await uploadResponse.json()

      const installmentMonths = getInstallmentMonths(selectedInvoiceForPayment)
      const monthlyPayment = (selectedInvoiceForPayment.amount || 0) / installmentMonths
      const currentCollectedAmount = selectedInvoiceForPayment.collectedAmount || 0
      const newCollectedAmount = currentCollectedAmount + monthlyPayment
      const newMonthsPaid = (selectedInvoiceForPayment.monthsPaid || 0) + 1
      const isFullyPaid = newMonthsPaid >= installmentMonths

      // Record in balance
      await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ar_payment",
          referenceId: Number.parseInt(selectedInvoiceForPayment.id) || 0,
          referenceNumber: `${selectedInvoiceForPayment.invoiceNumber}-Month-${newMonthsPaid}`,
          amount: monthlyPayment,
          description: `AR Payment from ${getCustomerName(selectedInvoiceForPayment.customerId)} - ${selectedInvoiceForPayment.invoiceNumber} (Month ${newMonthsPaid}/${installmentMonths})`,
        }),
      })

      // Record customer payment
      await fetch("/api/customer-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: selectedInvoiceForPayment.id,
          customerId: selectedInvoiceForPayment.customerId,
          amount: monthlyPayment,
          paymentDate: new Date().toISOString().split("T")[0],
          paymentMethod: "installment_payment",
          referenceNumber: `${selectedInvoiceForPayment.invoiceNumber}-Month-${newMonthsPaid}`,
          receiptUrl: receiptUrl,
        }),
      })

      // Update invoice
      const updatedInvoice: Partial<CustomerInvoice> = {
        collectedAmount: newCollectedAmount,
        balance: (selectedInvoiceForPayment.amount || 0) - newCollectedAmount,
        monthsPaid: newMonthsPaid,
        status: isFullyPaid ? "paid" : "partially_paid",
      }

      await updateCustomerInvoice(selectedInvoiceForPayment.id, updatedInvoice)

      setPaymentDialogOpen(false)
      setSelectedInvoiceForPayment(null)
      setPaymentReceiptFile(null)
      alert(t("message.success"))
    } catch (error) {
      console.error("[v0] AR - Error recording payment:", error)
      alert(t("message.error"))
    } finally {
      setIsUploading(false)
    }
  }

  const getDisplayedInvoices = () => {
    switch (listFilter) {
      case "pending":
        return allInvoices.filter((inv) => getInvoiceStatus(inv) === "pending")
      case "partially_paid":
        return allInvoices.filter((inv) => getInvoiceStatus(inv) === "partially_paid")
      case "paid":
        return allInvoices.filter((inv) => getInvoiceStatus(inv) === "paid")
      case "overdue":
        return overdueInvoices
      default:
        return allInvoices
    }
  }

  const handleWidgetClick = (type: "receivable" | "collected" | "outstanding" | "overdue") => {
    setWidgetDialogType(type)
    setWidgetDialogOpen(true)
  }

  const getWidgetInvoices = () => {
    switch (widgetDialogType) {
      case "receivable":
        return allInvoices
      case "collected":
        return allInvoices.filter((inv) => (inv.collectedAmount || 0) > 0)
      case "outstanding":
        return allInvoices.filter((inv) => (inv.amount || 0) - (inv.collectedAmount || 0) > 0)
      case "overdue":
        return overdueInvoices
      default:
        return allInvoices
    }
  }

  const getWidgetDialogTitle = () => {
    switch (widgetDialogType) {
      case "receivable":
        return t("ar.total-receivable")
      case "collected":
        return t("ar.collected")
      case "outstanding":
        return t("ar.outstanding")
      case "overdue":
        return t("ar.overdue")
      default:
        return t("ar.invoice-list")
    }
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-"
    try {
      return new Date(dateString).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US")
    } catch (e) {
      console.error("Error formatting date:", dateString, e)
      return dateString
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      partially_paid: "bg-blue-100 text-blue-800",
      paid: "bg-green-100 text-green-800",
      overdue: "bg-red-100 text-red-800",
      partial: "bg-blue-100 text-blue-800",
    }
    return colors[status] || "bg-gray-100 text-gray-800"
  }

  const getScheduleStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case "overdue":
        return <AlertCircle className="w-4 h-4 text-red-600" />
      case "partial":
        return <Clock className="w-4 h-4 text-blue-600" />
      default:
        return <Clock className="w-4 h-4 text-yellow-600" />
    }
  }

  const getScheduleProgress = () => {
    if (!selectedInvoiceForSchedule) return 0
    const totalPaid = paymentSchedules.reduce((sum, s) => sum + (s.paidAmount || 0), 0)
    const totalAmount = selectedInvoiceForSchedule.amount || 1
    return Math.round((totalPaid / totalAmount) * 100)
  }

  const getTotalSchedulePaid = () => {
    return paymentSchedules.reduce((sum, s) => sum + (s.paidAmount || 0), 0)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("ar.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("ar.description")}</p>
        </div>

        {/* Show +Add button only for CEO and Accountant */}
        {(userRole === "ceo" || userRole === "accountant") && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="lg"
                  className="shadow-lg hover:shadow-xl transition-all"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  {t("ar.create-invoice")}
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    fetchAvailableSOs()
                    setSoSelectDialogOpen(true)
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  From Sales Order
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    fetchAvailableDPs()
                    setDpSelectDialogOpen(true)
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  From Delivery Items
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card
          className="cursor-pointer hover:shadow-lg hover:border-primary transition-all"
          onClick={() => handleWidgetClick("receivable")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("ar.total-receivable")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalReceivable)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {allInvoices.length} {t("ar.invoices")}
            </p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-lg hover:border-primary transition-all"
          onClick={() => handleWidgetClick("collected")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("ar.collected")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalCollected)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {allInvoices.filter((i) => (i.collectedAmount || 0) > 0).length} {t("ar.invoices")}
            </p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-lg hover:border-primary transition-all"
          onClick={() => handleWidgetClick("outstanding")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("ar.outstanding")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{formatCurrency(totalOutstanding)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {allInvoices.filter((i) => (i.amount || 0) - (i.collectedAmount || 0) > 0).length} {t("ar.invoices")}
            </p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-lg hover:border-primary transition-all"
          onClick={() => handleWidgetClick("overdue")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("ar.overdue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(overdueAmount)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {overdueInvoices.length} {t("ar.invoices")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button variant={listFilter === "all" ? "default" : "outline"} onClick={() => setListFilter("all")}>
          {t("ar.all-invoices")} ({formatNumber(allInvoices.length)})
        </Button>
        <Button variant={listFilter === "pending" ? "default" : "outline"} onClick={() => setListFilter("pending")}>
          {t("status.pending")} ({formatNumber(allInvoices.filter((i) => getInvoiceStatus(i) === "pending").length)})
        </Button>
        <Button
          variant={listFilter === "partially_paid" ? "default" : "outline"}
          onClick={() => setListFilter("partially_paid")}
        >
          {t("ar.partially-paid")} (
          {formatNumber(allInvoices.filter((i) => getInvoiceStatus(i) === "partially_paid").length)})
        </Button>
        <Button variant={listFilter === "paid" ? "default" : "outline"} onClick={() => setListFilter("paid")}>
          {t("ar.paid")} ({formatNumber(allInvoices.filter((i) => getInvoiceStatus(i) === "paid").length)})
        </Button>
        <Button variant={listFilter === "overdue" ? "default" : "outline"} onClick={() => setListFilter("overdue")}>
          {t("ar.overdue")} ({formatNumber(overdueInvoices.length)})
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("ar.invoice-list")}</CardTitle>
          <CardDescription>{t("ar.invoice-description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {getDisplayedInvoices().length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t("ar.no-invoices")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-start p-2">{t("ar.invoice-number")}</th>
                    <th className="text-start p-2">{t("ar.customer")}</th>
                    <th className="text-start p-2">{t("ar.so-number")}</th>
                    <th className="text-start p-2">{t("payment.type")}</th>
                    <th className="text-start p-2">{t("ar.invoice-date")}</th>
                    <th className="text-start p-2">{t("ar.due-date")}</th>
                    <th className="text-start p-2">{t("ar.total-amount")}</th>
                    <th className="text-start p-2">{t("ar.paid-amount")}</th>
                    <th className="text-start p-2">{t("ar.balance")}</th>
                    <th className="text-start p-2">{t("ar.progress")}</th>
                    <th className="text-start p-2">{t("field.status")}</th>
                    <th className="text-start p-2">{t("field.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {getDisplayedInvoices().map((invoice) => {
                    const installmentMonths = getInstallmentMonths(invoice)
                    const monthsPaid = invoice.monthsPaid || 0
                    const progress = installmentMonths > 0 ? (monthsPaid / installmentMonths) * 100 : 0
                    const status = getInvoiceStatus(invoice)
                    const balance = (invoice.amount || 0) - (invoice.collectedAmount || 0)
                    const paymentType = getSOPaymentType(invoice.soId, invoice)

                    return (
                      <tr
                        key={invoice.id}
                        className={`border-b hover:bg-muted/50 cursor-pointer ${status === "overdue" ? "bg-red-50" : ""}`}
                        onClick={() => handleViewSchedule(invoice)}
                      >
                        <td className="p-2 font-medium">{invoice.invoiceNumber}</td>
                        <td className="p-2">{getCustomerName(invoice.customerId)}</td>
                        <td className="p-2">{getSONumber(invoice.soId, invoice)}</td>
                        <td className="p-2">
                          <span className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary capitalize">
                            {paymentType}
                          </span>
                        </td>
                        <td className="p-2">{formatDate(invoice.date)}</td>
                        <td className="p-2">{formatDate(invoice.dueDate)}</td>
                        <td className="p-2">{formatCurrency(invoice.amount || 0)}</td>
                        <td className="p-2 text-green-600">{formatCurrency(invoice.collectedAmount || 0)}</td>
                        <td className="p-2 text-amber-600">{formatCurrency(balance)}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <Progress value={progress} className="w-16 h-2" />
                            <span className="text-xs">{Math.round(progress)}%</span>
                          </div>
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(status)}`}>
                            {t(`status.${status}`)}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleViewSchedule(invoice)
                              }}
                            >
                              <Calendar className="w-4 h-4" />
                            </Button>
                            {status !== "paid" && (userRole === "accountant" || userRole === "ceo") && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedInvoiceForPayment(invoice)
                                  setPaymentReceiptFile(null)
                                  setPaymentDialogOpen(true)
                                }}
                              >
                                <DollarSign className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownloadInvoicePDF(invoice)
                              }}
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              {t("action.print-invoice") || "Print Invoice"}
                            </Button>
                            {invoice.vatInvoiceUrl ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  window.open(invoice.vatInvoiceUrl, "_blank")
                                }}
                                title="View VAT Invoice"
                                className="bg-purple-50 hover:bg-purple-100"
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                VAT
                              </Button>
                            ) : (
                              (userRole === "accountant" || userRole === "ceo") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    document.getElementById(`vat-invoice-upload-${invoice.id}`)?.click()
                                  }}
                                  title="Upload VAT Invoice"
                                  className="bg-purple-50 hover:bg-purple-100"
                                >
                                  <Upload className="w-4 h-4 mr-1" />
                                  VAT
                                  <input
                                    id={`vat-invoice-upload-${invoice.id}`}
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={(e) => handleVATInvoiceUpload(e, invoice)}
                                  />
                                </Button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Schedule Dialog - CHANGE: Updated to match AP pattern */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {t("ar.payment-schedule")} - {selectedInvoiceForSchedule?.invoiceNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoiceForSchedule && (
            <div className="space-y-6">
              {/* Invoice Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">{t("ar.customer")}</p>
                  <p className="font-medium">{getCustomerName(selectedInvoiceForSchedule.customerId)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("ar.total-amount")}</p>
                  <p className="font-medium">{formatCurrency(selectedInvoiceForSchedule.amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("ar.paid-amount")}</p>
                  <p className="font-medium text-green-600">{formatCurrency(getTotalSchedulePaid())}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("ar.balance")}</p>
                  <p className="font-medium text-amber-600">
                    {formatCurrency((selectedInvoiceForSchedule.amount || 0) - getTotalSchedulePaid())}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>
                    {t("field.paid")}: {formatCurrency(getTotalSchedulePaid())}
                  </span>
                  <span>
                    {t("field.balance")}:{" "}
                    {formatCurrency((selectedInvoiceForSchedule.amount || 0) - getTotalSchedulePaid())}
                  </span>
                </div>
                <Progress value={getScheduleProgress()} className="h-3" />
                <p className="text-xs text-muted-foreground text-center">
                  {getScheduleProgress()}% {t("field.paid")}
                </p>
              </div>

              {!schedulesFromDB && paymentSchedules.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <p className="text-sm text-yellow-700">
                    {t("ar.schedules-generated") ||
                      "Payment schedule generated from order data. Actual schedule may vary."}
                  </p>
                </div>
              )}

              {/* Payment Schedule Table */}
              {isLoadingSchedule ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  <p>{t("message.loading")}</p>
                </div>
              ) : paymentSchedules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{t("ar.no-schedule")}</p>
                  <p className="text-sm mt-2">{t("ar.no-schedule-description")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-start p-3">{t("ar.installment")}</th>
                        <th className="text-start p-3">{t("ar.due-date")}</th>
                        <th className="text-start p-3">{t("ar.amount")}</th>
                        <th className="text-start p-3">{t("ar.paid-amount")}</th>
                        <th className="text-start p-3">{t("ar.payment-date")}</th>
                        <th className="text-start p-3">{t("field.status")}</th>
                        <th className="text-start p-3">{t("field.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentSchedules.map((schedule) => {
                        const isOverdue = schedule.status === "pending" && new Date(schedule.dueDate) < new Date()
                        const effectiveStatus = isOverdue ? "overdue" : schedule.status
                        const isDownPayment = schedule.isDownPayment || schedule.installmentNumber === 0

                        return (
                          <tr
                            key={schedule.id}
                            className={`border-b hover:bg-muted/50 ${isOverdue ? "bg-red-50" : schedule.status === "paid" ? "bg-green-50" : ""} ${isDownPayment ? "bg-green-50/50" : ""}`}
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {getScheduleStatusIcon(effectiveStatus)}
                                <span className="font-medium">
                                  {isDownPayment
                                    ? t("payment.down-payment")
                                    : `${t("ar.installment")} ${schedule.installmentNumber}`}
                                </span>
                              </div>
                            </td>
                            <td className="p-3">{formatDate(schedule.dueDate)}</td>
                            <td className="p-3 font-medium">{formatCurrency(schedule.amount)}</td>
                            <td className="p-3 text-green-600">{formatCurrency(schedule.paidAmount)}</td>
                            <td className="p-3">{schedule.paymentDate ? formatDate(schedule.paymentDate) : "-"}</td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(effectiveStatus)}`}>
                                {t(`status.${effectiveStatus}`)}
                              </span>
                            </td>
                            <td className="p-3">
                              {schedule.status !== "paid" && (userRole === "accountant" || userRole === "ceo") && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedScheduleForPayment(schedule)
                                    setSchedulePaymentFile(null)
                                    setSchedulePaymentDialogOpen(true)
                                  }}
                                >
                                  <DollarSign className="w-4 h-4 mr-1" />
                                  {t("ar.record-payment")}
                                </Button>
                              )}
                              {schedule.receiptUrl && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="ml-2 bg-transparent"
                                  onClick={() => window.open(schedule.receiptUrl!, "_blank")}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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
              <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("ar.installment")}:</span>
                  <span className="font-medium">
                    {selectedScheduleForPayment.isDownPayment || selectedScheduleForPayment.installmentNumber === 0
                      ? t("payment.down-payment")
                      : `${t("ar.installment")} ${selectedScheduleForPayment.installmentNumber}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("ar.due-date")}:</span>
                  <span className="font-medium">{formatDate(selectedScheduleForPayment.dueDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("ar.amount")}:</span>
                  <span className="font-bold text-lg">{formatCurrency(selectedScheduleForPayment.amount)}</span>
                </div>
              </div>

              <div>
                <Label>{t("ar.upload-receipt")}</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setSchedulePaymentFile(e.target.files?.[0] || null)}
                  className="mt-1"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setSchedulePaymentDialogOpen(false)}>
                  {t("action.cancel")}
                </Button>
                <Button onClick={handleRecordSchedulePayment} disabled={isUploading || !schedulePaymentFile}>
                  {isUploading ? t("message.uploading") : t("ar.confirm-payment")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Widget Dialog */}
      <Dialog open={widgetDialogOpen} onOpenChange={setWidgetDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{getWidgetDialogTitle()}</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-start p-2">{t("ar.invoice-number")}</th>
                  <th className="text-start p-2">{t("ar.customer")}</th>
                  <th className="text-start p-2">{t("ar.due-date")}</th>
                  <th className="text-start p-2">{t("ar.total-amount")}</th>
                  <th className="text-start p-2">{t("ar.paid-amount")}</th>
                  <th className="text-start p-2">{t("ar.balance")}</th>
                  <th className="text-start p-2">{t("field.status")}</th>
                  <th className="text-start p-2">{t("field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {getWidgetInvoices().length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      {t("ar.no-invoices")}
                    </td>
                  </tr>
                ) : (
                  getWidgetInvoices().map((invoice) => {
                    const status = getInvoiceStatus(invoice)
                    const balance = (invoice.amount || 0) - (invoice.collectedAmount || 0)

                    return (
                      <tr
                        key={invoice.id}
                        className={`border-b hover:bg-muted/50 cursor-pointer ${status === "overdue" ? "bg-red-50" : ""}`}
                        onClick={() => {
                          setWidgetDialogOpen(false)
                          handleViewSchedule(invoice)
                        }}
                      >
                        <td className="p-2 font-medium">{invoice.invoiceNumber}</td>
                        <td className="p-2">{getCustomerName(invoice.customerId)}</td>
                        <td className="p-2">{formatDate(invoice.dueDate)}</td>
                        <td className="p-2">{formatCurrency(invoice.amount || 0)}</td>
                        <td className="p-2 text-green-600">{formatCurrency(invoice.collectedAmount || 0)}</td>
                        <td className="p-2 text-amber-600">{formatCurrency(balance)}</td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(status)}`}>
                            {t(`status.${status}`)}
                          </span>
                        </td>
                        <td className="p-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation()
                              setWidgetDialogOpen(false)
                              handleViewSchedule(invoice)
                            }}
                          >
                            <Calendar className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ar.record-payment")}</DialogTitle>
          </DialogHeader>
          {selectedInvoiceForPayment && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p>
                  <strong>{t("ar.invoice-number")}:</strong> {selectedInvoiceForPayment.invoiceNumber}
                </p>
                <p>
                  <strong>{t("ar.customer")}:</strong> {getCustomerName(selectedInvoiceForPayment.customerId)}
                </p>
                <p>
                  <strong>{t("ar.total-amount")}:</strong> {formatCurrency(selectedInvoiceForPayment.amount || 0)}
                </p>
                <p>
                  <strong>{t("ar.paid-amount")}:</strong>{" "}
                  {formatCurrency(selectedInvoiceForPayment.collectedAmount || 0)}
                </p>
                <p>
                  <strong>{t("ar.monthly-payment")}:</strong>{" "}
                  {formatCurrency(
                    (selectedInvoiceForPayment.amount || 0) / getInstallmentMonths(selectedInvoiceForPayment),
                  )}
                </p>
                <p>
                  <strong>{t("ar.progress")}:</strong> {selectedInvoiceForPayment.monthsPaid || 0}/
                  {getInstallmentMonths(selectedInvoiceForPayment)} {t("ar.months")}
                </p>
              </div>
              <div>
                <Label>{t("ar.upload-receipt")}</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPaymentReceiptFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                  {t("action.cancel")}
                </Button>
                <Button onClick={handleRecordPayment} disabled={isUploading || !paymentReceiptFile}>
                  {isUploading ? t("message.uploading") : t("ar.confirm-payment")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Enhanced SO Selection Dialog for Invoice Creation */}
      <Dialog 
        open={soSelectDialogOpen} 
        onOpenChange={(open) => {
          setSoSelectDialogOpen(open)
          if (!open) {
            setSelectedSO(null)
            setSelectedSODetails(null)
            setSODeliveryPermits([])
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="border-b pb-4">
            <DialogTitle className="text-2xl">{t("ar.create-invoice")}</DialogTitle>
            <DialogDescription className="text-base mt-2">
              Select a sales order to generate an invoice. Delivery permits associated with this order will be included automatically.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-4">
            {!selectedSO ? (
              /* Step 1: Select Sales Order */
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold">
                    1
                  </div>
                  <h3 className="text-lg font-semibold">{t("ar.select-sales-order")}</h3>
                </div>
                
                {availableSOs.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground text-lg">{t("ar.no-sales-orders")}</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {availableSOs.map((so) => (
                      <div
                        key={so.soId || so.so_id}
                        className="group p-5 border-2 rounded-xl cursor-pointer transition-all hover:border-primary hover:shadow-lg hover:scale-[1.01]"
                        onClick={() => {
                          const soId = String(so.soId || so.so_id)
                          setSelectedSO(soId)
                          fetchSODetails(soId)
                        }}
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-3">
                              <FileText className="w-5 h-5 text-primary" />
                              <p className="font-bold text-lg">{so.so_number || so.soNumber || `SO-${so.so_id}`}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm ml-8">
                              <div>
                                <span className="text-muted-foreground">{t("field.customer")}:</span>
                                <span className="ml-2 font-medium">{so.customerName || "Unknown"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">{t("field.payment")}:</span>
                                <span className="ml-2 font-medium capitalize">{so.paymentType || "Cash"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">{t("field.date")}:</span>
                                <span className="ml-2 font-medium">
                                  {so.orderDate ? formatDate(so.orderDate) : so.createdAt ? formatDate(so.createdAt) : "-"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">{t("field.status")}:</span>
                                <span className="ml-2 font-medium capitalize">{so.status?.replace(/_/g, " ")}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-primary">{formatCurrency(so.total || so.total_amount || 0)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{t("field.total")}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Step 2: Review & Confirm */
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold">
                    2
                  </div>
                  <h3 className="text-lg font-semibold">{t("ar.review-confirm")}</h3>
                </div>

                {isLoadingSODetails ? (
                  <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
                    <p className="mt-4 text-muted-foreground">{t("message.loading")}</p>
                  </div>
                ) : (
                  <>
                    {/* Sales Order Summary */}
                    <Card>
                      <CardHeader className="bg-muted/30">
                        <CardTitle className="text-lg">{t("ar.sales-order-details")}</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.so-number")}</p>
                            <p className="font-semibold">{selectedSODetails?.soNumber || `SO-${selectedSO}`}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                            <p className="font-semibold">{selectedSODetails?.customerName || "Unknown"}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.payment-terms")}</p>
                            <p className="font-semibold capitalize">{selectedSODetails?.paymentType || "Cash"}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("field.total-amount")}</p>
                            <p className="font-bold text-lg text-primary">{formatCurrency(selectedSODetails?.total || 0)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Delivery Permits */}
                    <Card>
                      <CardHeader className="bg-muted/30">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="w-5 h-5" />
                          {t("ar.delivery-permits")} 
                          <span className="text-sm font-normal text-muted-foreground">
                            ({soDeliveryPermits.length} {soDeliveryPermits.length === 1 ? t("ar.permit") : t("ar.permits")})
                          </span>
                        </CardTitle>
                        <CardDescription>
                          {soDeliveryPermits.length > 0 
                            ? t("ar.permits-will-be-linked") 
                            : t("ar.no-permits-yet")}
                        </CardDescription>
                      </CardHeader>
                      {soDeliveryPermits.length > 0 && (
                        <CardContent className="pt-6">
                          <div className="space-y-3">
                            {soDeliveryPermits.map((dp) => (
                              <div key={dp.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border">
                                <div className="flex items-center gap-3">
                                  <CheckCircle className="w-4 h-4 text-green-600" />
                                  <div>
                                    <p className="font-medium">{dp.permitNo || `DP-${dp.id}`}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {dp.printedAt ? formatDate(dp.printedAt) : dp.createdAt ? formatDate(dp.createdAt) : "N/A"}
                                    </p>
                                  </div>
                                </div>
                                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium capitalize">
                                  {dp.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>

                    {/* Invoice Preview */}
                    <Card className="border-primary/50 bg-primary/5">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <DollarSign className="w-5 h-5" />
                          {t("ar.invoice-will-be-created")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("field.customer")}:</span>
                            <span className="font-semibold">{selectedSODetails?.customerName || "Unknown"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("field.amount")}:</span>
                            <span className="font-bold text-lg">{formatCurrency(selectedSODetails?.total || 0)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("field.delivery-permits")}:</span>
                            <span className="font-semibold">{soDeliveryPermits.length}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            {selectedSO ? (
              <>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setSelectedSO(null)
                    setSelectedSODetails(null)
                    setSODeliveryPermits([])
                  }}
                  disabled={isLoadingSODetails}
                >
                  {t("button.back")}
                </Button>
                <Button 
                  onClick={handleCreateFromSO} 
                  disabled={isLoadingSODetails}
                  size="lg"
                  className="min-w-[150px]"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {t("ar.create-invoice")}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setSoSelectDialogOpen(false)}>
                {t("button.cancel")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DP Selection Dialog */}
      <Dialog open={dpSelectDialogOpen} onOpenChange={setDpSelectDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("ar.select-delivery-permits")}</DialogTitle>
            <DialogDescription>
              Select one or more delivery permits to consolidate into an invoice
              <br />
              <span className="text-xs text-yellow-600">⚠️ All selected DPs must have the same payment terms</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {availableDPs.map((dp) => {
              const permitId = dp.permit_id || dp.id
              const permitNo = dp.permitNo || dp.permit_no || dp.permit_number || `DP-${permitId}`
              const customerId = dp.customerId || dp.customer_id
              const salesOrderId = dp.salesOrderId || dp.sales_order_id
              const deliveryDate =
                dp.deliveryDate || dp.delivery_date || dp.createdAt || dp.created_at || dp.printedAt || dp.printed_at

              // Get customer and SO info
              const customerName = dp.customerName || getCustomerName(customerId) || "Unknown Customer"
              const soNumber = dp.soNumber || getSONumber(salesOrderId) || "N/A"
              const paymentType = getSOPaymentType(salesOrderId) || "Unknown"

              return (
                <div
                  key={permitId}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors select-none ${
                    selectedDPs.includes(permitId) ? "border-primary bg-primary/10" : "hover:border-gray-400"
                  }`}
                  onClick={() => {
                    if (selectedDPs.includes(permitId)) {
                      setSelectedDPs(selectedDPs.filter((id) => id !== permitId))
                    } else {
                      setSelectedDPs([...selectedDPs, permitId])
                    }
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-1 flex-1">
                      <p className="font-semibold">{permitNo}</p>
                      <p className="text-sm text-muted-foreground">Customer: {customerName}</p>
                      <p className="text-sm text-muted-foreground">SO: {soNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        Date: {deliveryDate ? formatDate(deliveryDate) : "N/A"}
                      </p>
                      <p className="text-xs text-muted-foreground">Payment: {paymentType}</p>
                      {/* Show returned items warning if any */}
                      {dp.returnedQuantity && Number(dp.returnedQuantity) > 0 && (
                        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                          <p className="text-amber-800 font-medium">
                            ⚠️ {dp.returnedQuantity} item(s) returned from this delivery
                          </p>
                          <p className="text-amber-700 text-xs mt-1">
                            You can exclude returned items or create a credit memo
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <Checkbox
                        checked={selectedDPs.includes(permitId)}
                        onCheckedChange={() => {}} // Handled by parent div
                      />
                    </div>
                  </div>
                </div>
              )
            })}
            {availableDPs.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No delivery permits available for invoicing</p>
            )}
          </div>

          {/* Returned Items Handling Section */}
          {availableDPs.some((dp) => dp.returnedQuantity && Number(dp.returnedQuantity) > 0) && (
            <div className="border-t pt-4 mt-4">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                Items Returned from Selected Deliveries
              </h4>
              <div className="space-y-3 bg-amber-50 p-4 rounded-lg border border-amber-200">
                {availableDPs
                  .filter((dp) => dp.returnedQuantity && Number(dp.returnedQuantity) > 0)
                  .map((dp) => (
                    <div key={dp.id} className="flex justify-between items-center">
                      <div className="text-sm">
                        <p className="font-medium">{dp.permitNo || `DP-${dp.id}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {dp.returnedQuantity} item(s) returned
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={dpReturnHandling[dp.id] === "exclude" ? "default" : "outline"}
                          onClick={() =>
                            setDpReturnHandling({
                              ...dpReturnHandling,
                              [dp.id]: "exclude",
                            })
                          }
                        >
                          Exclude from Invoice
                        </Button>
                        <Button
                          size="sm"
                          variant={dpReturnHandling[dp.id] === "credit" ? "default" : "outline"}
                          onClick={() => {
                            setCreditMemoDP(dp.id)
                            setShowCreditMemoForm(true)
                          }}
                        >
                          Create Credit Memo
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDpSelectDialogOpen(false)}>
              {t("button.cancel")}
            </Button>
            <Button onClick={handleCreateFromDPs} disabled={selectedDPs.length === 0}>
              {t("button.create")} ({selectedDPs.length} selected)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
