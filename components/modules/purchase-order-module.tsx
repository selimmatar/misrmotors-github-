"use client"

import { DialogFooter } from "@/components/ui/dialog"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { InstallmentFields } from "@/components/payment/installment-fields"
import { HybridFields } from "@/components/payment/hybrid-fields"
import { ChequeFields } from "@/components/payment/cheque-fields"
import { PaymentTypeSelector, PaymentSummaryCard } from "@/components/payment"
import type { PaymentScheduleEntry } from "@/components/payment/payment-schedule-builder"
import {
  Plus,
  AlertTriangle,
  Eye,
  Upload,
  Loader2,
  Check,
  X,
  DollarSign,
  Building2,
  MapPin,
  Globe,
  AlertCircle,
  FileText,
  CheckCircle,
} from "lucide-react"
import type { PurchaseOrder, UserRole, PaymentDetails, PaymentType } from "@/lib/types"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"

interface PurchaseOrderModuleProps {
  userRole?: UserRole
}

export function PurchaseOrderModule({ userRole = "accountant" }: PurchaseOrderModuleProps) {
  const { t, formatNumber, formatCurrency, language } = useI18n()
  const {
    purchaseOrders,
    setPurchaseOrders,
    supplierInvoices,
    suppliers,
    products,
    prepaidBalance,
    setPrepaidBalance,
    inventory,
    addPurchaseOrder,
    updatePurchaseOrder,
    loadData,
    user,
    salesOrders,
  } = useAppContext()
  const [showForm, setShowForm] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [moqWarning, setMoqWarning] = useState<{
    productName: string
    enteredQty: number
    moq: number
    excess: number
  } | null>(null)
  const [orderItems, setOrderItems] = useState<
    Array<{
      productId: string
      quantity: string
      unitPrice: string
      itemType?: "stock" | "outsourced"
      outsourcedName?: string
      outsourcedDescription?: string
      outsourcedUnit?: string
      sourceSoId?: string
      sourceSoItemId?: string
    }>
  >([])
  // PO source: build manually or import outsourced items from a sales order
  const [poSource, setPoSource] = useState<"manual" | "sales_order">("manual")
  const [selectedSourceSoId, setSelectedSourceSoId] = useState<string>("")
  const [soSearchTerm, setSoSearchTerm] = useState<string>("")
  const [poInvoiceFile, setPoInvoiceFile] = useState<File | null>(null)
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [viewDetailsOrder, setViewDetailsOrder] = useState<any | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [formData, setFormData] = useState({
    supplierId: "",
    dueDate: new Date().toISOString().split("T")[0],
    expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    currency: "EGP" as "EGP" | "USD" | "EUR",
    bankName: "",
    bankAccountNumber: "",
    bankSwiftCode: "",
    bankIban: "",
    bankBranch: "",
    bankHolderName: "",
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [costFinalizeDialog, setCostFinalizeDialog] = useState(false)
  const [selectedPOForCost, setSelectedPOForCost] = useState<string | null>(null)
  const [taxAmount, setTaxAmount] = useState("")
  const [otherCosts, setOtherCosts] = useState("")
  const [finalizingCost, setFinalizingCost] = useState(false)

  const [perProductTaxMode, setPerProductTaxMode] = useState(false)
  const [productTaxes, setProductTaxes] = useState<Record<string, { tax: string; otherCosts: string }>>({})

  const [paymentType, setPaymentType] = useState<PaymentType>("cash")
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>({
    paymentType: "cash",
    installmentMonths: 6,
    monthlyAmount: 0,
    chequeNumber: "",
    chequeBankName: "",
    chequeDueDate: "",
    chequeAmount: 0,
    chequeNotes: "",
    downPaymentType: "cash",
    downPaymentAmount: 0,
    downPaymentPercent: 50,
    remainingAmount: 0,
    remainingInstallmentMonths: 6,
    downPaymentChequeNumber: "",
    downPaymentChequeBank: "",
    downPaymentChequeDueDate: "",
    paymentStartDate: new Date().toISOString().split("T")[0], // Added for hybrid payments
  })

  const [showReportGenerator, setShowReportGenerator] = useState(false)

  const [poType, setPoType] = useState<"local" | "international">("local")

  const [scheduleMode, setScheduleMode] = useState<"AUTO" | "MANUAL">("AUTO")
  const [scheduleEntries, setScheduleEntries] = useState<PaymentScheduleEntry[]>([])

  const [downPaymentInputMode, setDownPaymentInputMode] = useState<"amount" | "percent" | null>(null)

  const canCreatePO = userRole === "po-rep" || userRole === "accountant" || userRole === "admin"
  const canApprovePO = userRole === "ceo" || userRole === "admin"

  const getLowStockSuggestions = () => {
    const addedProductIds = new Set(orderItems.map((item) => item.productId).filter((id) => id !== ""))

    const productsInActivePOs = new Set(
      purchaseOrders
        .filter((po) => po.status === "pending" || po.status === "approved")
        .flatMap((po) => po.items?.map((item) => item.productId) || []),
    )

    const suggestions = inventory
      .map((invItem) => {
        const product = products.find((p) => p.id === invItem.productId)

        if (!product) {
          return null
        }

        if (!product.desiredExcess || product.desiredExcess === 0) {
          return null
        }

        if (addedProductIds.has(product.id)) {
          return null
        }

        if (productsInActivePOs.has(product.id)) {
          return null
        }

        const currentStock = invItem.quantity
        const desiredStockLevel = product.desiredExcess

        if (currentStock < desiredStockLevel) {
          const suggestedQty = desiredStockLevel - currentStock
          return {
            product,
            currentStock,
            desiredStock: desiredStockLevel,
            suggestedOrderQty: suggestedQty,
          }
        }

        return null
      })
      .filter((item) => item !== null)

    return suggestions
  }

  const lowStockSuggestions = getLowStockSuggestions()

  const handleAddSuggestedItem = (productId: string, quantity: number, unitPrice: number) => {
    setOrderItems([
      ...orderItems,
      {
        productId,
        quantity: quantity.toString(),
        unitPrice: unitPrice.toString(),
      },
    ])
  }

  const getSupplierName = (supplierId: string) => {
    return suppliers.find((s) => s.id === supplierId)?.name || "Unknown"
  }

  const getProductName = (productId: string) => {
    return products.find((p) => p.id === productId)?.productName || "Unknown"
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      draft: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" },
      pending: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
      approved: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
      received: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
      rejected: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    }
    return colors[status] || colors.draft
  }

  // Helper to get badge variant for status
  const getStatusVariant = (
    status: string,
  ): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | null | undefined => {
    switch (status) {
      case "pending":
        return "warning"
      case "approved":
        return "success"
      case "rejected":
        return "destructive"
      default:
        return "default"
    }
  }

  const getDaysUntilDue = (dueDate: string): number => {
    const today = new Date()
    const due = new Date(dueDate)
    const diffTime = due.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getNextMonthDueDate = (
    orderDate: string,
    currentDueDate: string,
    installmentMonths: number,
    monthsPaid: number,
  ): string => {
    if (!orderDate) return ""
    const orderCreatedDate = new Date(orderDate)
    if (isNaN(orderCreatedDate.getTime())) return ""

    const nextDueDate = new Date(orderCreatedDate)
    nextDueDate.setMonth(nextDueDate.getMonth() + monthsPaid + 1)
    return nextDueDate.toISOString().split("T")[0]
  }

  const getRowBackgroundColor = (dueDate: string, status: string): string => {
    if (status === "approved") return ""
    const daysUntilDue = getDaysUntilDue(dueDate)
    if (daysUntilDue < 0) return "bg-red-50" // Overdue
    if (daysUntilDue <= 10) return "bg-yellow-50" // Due within 10 days
    return ""
  }

  const createSupplierInvoice = async (order: PurchaseOrder) => {
    const poIdInt = Number.parseInt(order.id)
    const effectivePaymentType = order.paymentType || order.paymentTerms
    
    // Extract hybrid payment details with proper fallbacks
    let downPaymentAmount = order.downPaymentAmount ?? order.paymentDetails?.downPaymentAmount ?? 0
    const downPaymentPercent = order.downPaymentPercent ?? order.paymentDetails?.downPaymentPercent ?? null
    const downPaymentDueDate =
      order.downPaymentDueDate || order.paymentDetails?.downPaymentDueDate || new Date().toISOString().split("T")[0]
    const remainingInstallmentMonths =
      order.remainingInstallmentMonths ||
      order.paymentDetails?.remainingInstallmentMonths ||
      order.installments ||
      6
    const paymentStartDate =
      order.paymentStartDate || order.paymentDetails?.paymentStartDate || new Date().toISOString().split("T")[0]
    
    // For hybrid payments, calculate missing amounts if needed
    let remainingAmount = order.remainingAmount ?? order.paymentDetails?.remainingAmount ?? 0
    let monthlyAmount = order.monthlyAmount ?? order.paymentDetails?.monthlyAmount ?? 0
    
    if (effectivePaymentType === "hybrid") {
      // If downPaymentAmount is 0 but we have percentage, calculate it
      if (downPaymentAmount === 0 && downPaymentPercent && downPaymentPercent > 0) {
        downPaymentAmount = Math.round((order.total * downPaymentPercent / 100) * 100) / 100
      }
      
      // If remainingAmount is 0, calculate it
      if (remainingAmount === 0 && downPaymentAmount > 0) {
        remainingAmount = order.total - downPaymentAmount
      }
      
      // If monthlyAmount is 0, calculate it
      if (monthlyAmount === 0 && remainingAmount > 0 && remainingInstallmentMonths > 0) {
        monthlyAmount = Math.round((remainingAmount / remainingInstallmentMonths) * 100) / 100
      }
    }

    console.log(
      "[v0] PO Module - createSupplierInvoice called for PO",
      order.poNumber,
      "payment type:",
      effectivePaymentType,
      "amounts:",
      { downPaymentAmount, remainingAmount, monthlyAmount },
    )

    try {
      // Check if invoice already exists
      const response = await fetch(`/api/accounts-payable?poId=${poIdInt}`)
      const { data: existingInvoice } = await response.json()

      if (existingInvoice && existingInvoice.length > 0) {
        console.log("[v0] AP Invoice already exists for PO", order.poNumber, "- skipping creation")
        return
      }

      const apInvoiceData = {
        invoice_number: `APINV-${order.poNumber}`,
        supplier_id: order.supplierId,
        po_id: poIdInt,
        invoice_date: new Date().toISOString().split("T")[0],
        due_date: effectivePaymentType === "hybrid" ? downPaymentDueDate : paymentStartDate,
        amount: order.total,
        paid_amount: 0,
        payment_start_date: paymentStartDate,
        installment_months:
          effectivePaymentType === "hybrid"
            ? remainingInstallmentMonths
            : effectivePaymentType === "installments" || effectivePaymentType === "installment"
              ? order.installments || remainingInstallmentMonths
              : 1,
        months_paid: 0,
        status: effectivePaymentType === "prepaid" || effectivePaymentType === "cash" ? "paid" : "pending",
        payment_type:
          effectivePaymentType === "hybrid"
            ? "hybrid"
            : effectivePaymentType === "installments" || effectivePaymentType === "installment"
              ? "installments"
              : effectivePaymentType,
        payment_terms: effectivePaymentType,
        down_payment_amount: effectivePaymentType === "hybrid" ? downPaymentAmount : null,
        down_payment_percent: effectivePaymentType === "hybrid" ? order.downPaymentPercent || null : null,
        down_payment_type: effectivePaymentType === "hybrid" ? order.downPaymentType || "amount" : null,
        down_payment_due_date: effectivePaymentType === "hybrid" ? downPaymentDueDate : null,
        remaining_amount: effectivePaymentType === "hybrid" ? remainingAmount : null,
        remaining_installment_months: effectivePaymentType === "hybrid" ? remainingInstallmentMonths : null,
        monthly_amount: effectivePaymentType === "hybrid" ? monthlyAmount : null,
        schedule_entries: effectivePaymentType === "hybrid" ? JSON.stringify(order.scheduleEntries || []) : null,
        schedule_mode: effectivePaymentType === "hybrid" ? order.scheduleMode || "AUTO" : null,
      }

      console.log(
        "[v0] PO Module - Creating AP invoice with payment_type:",
        apInvoiceData.payment_type,
        "hybrid fields:",
        {
          down_payment_amount: apInvoiceData.down_payment_amount,
          remaining_amount: apInvoiceData.remaining_amount,
          remaining_installment_months: apInvoiceData.remaining_installment_months,
        },
      )

      const apInvoiceResponse = await fetch("/api/accounts-payable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-caller-context": "PO-approval",
        },
        body: JSON.stringify(apInvoiceData),
      })

      if (!apInvoiceResponse.ok) {
        const errorData = await apInvoiceResponse.json()
        console.error("[v0] Failed to create AP invoice:", errorData)
        throw new Error(errorData.error || "Failed to create supplier invoice")
      }

      const newInvoice = await apInvoiceResponse.json()

      const invoiceId = newInvoice.invoice_id || newInvoice.invoiceId

      if (!invoiceId) {
        console.error("[v0] AP Invoice created but invoice_id is missing:", newInvoice)
        throw new Error("Invoice created but invoice_id was not returned")
      }

      console.log("[v0] AP Invoice created for PO:", order.poNumber, "Invoice ID:", invoiceId)

      const savedScheduleEntries = order.scheduleEntries || []
      const savedScheduleMode = order.scheduleMode || "AUTO"

      // Create payment schedules based on payment type
      if (effectivePaymentType === "installments" || effectivePaymentType === "hybrid") {
        try {
          console.log("[v0] Creating payment schedules for AP invoice", invoiceId)

          const scheduleResponse = await fetch("/api/payment-schedules", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-caller-context": "PO-approval-schedule-generation",
            },
            body: JSON.stringify({
              invoiceId: invoiceId,
              amount: order.total,
              installmentMonths: remainingInstallmentMonths,
              startDate: paymentStartDate,
              downPaymentAmount: effectivePaymentType === "hybrid" ? downPaymentAmount : 0,
              scheduleMode: "LEGACY_MONTHLY",
              scheduleType: "payable",
              isActive: false,
            }),
          })

          if (scheduleResponse.ok) {
            const scheduleData = await scheduleResponse.json()
            if (scheduleData.alreadyExists) {
              console.log("[v0] Payment schedules already exist for invoice", invoiceId, "- skipping (idempotent)")
            } else {
              console.log("[v0] Created payment schedules for AP invoice:", scheduleData)
            }
          } else {
            const errorText = await scheduleResponse.text()
            console.error("[v0] Error creating payment schedules:", errorText)
          }
        } catch (scheduleError) {
          console.error("[v0] Exception creating payment schedules:", scheduleError)
        }
      } else if (savedScheduleMode === "MANUAL" && savedScheduleEntries.length > 0) {
        // Manual schedule handling remains unchanged
      }

      try {
        await fetch("/api/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "purchase_order",
            referenceType: "PO",
            referenceId: poIdInt,
            referenceNumber: order.poNumber,
            amount: order.total,
            description: `PO ${order.poNumber} - ${order.supplierName || "Supplier"}`,
            status: effectivePaymentType === "prepaid" || effectivePaymentType === "cash" ? "voided" : "active",
          }),
        })
      } catch (balanceError) {
        console.error("Error creating balance entry:", balanceError)
      }

      await loadData()
    } catch (error) {
      console.error("Error in createSupplierInvoice:", error)
      throw error
    }
  }

  const handleApprove = async (id: string) => {
    if (!canApprovePO) {
      alert("Only CEO or Admin can approve purchase orders")
      return
    }

    const order = purchaseOrders.find((o) => o.id === id)
    if (!order) {
      alert("Purchase order not found")
      return
    }

    console.log("[v0] CEO Approval - Order details:", {
      poNumber: order.poNumber,
      poType: order.poType,
      paymentType: order.paymentType,
      paymentTerms: order.paymentTerms,
      downPaymentAmount: order.downPaymentAmount,
      remainingAmount: order.remainingAmount,
    })

    try {
      await updatePurchaseOrder({
        ...order,
        status: "approved",
      })

      await createSupplierInvoice(order)

      setPurchaseOrders(purchaseOrders.map((o) => (o.id === id ? { ...o, status: "approved" as const } : o)))

      alert(`Purchase order ${order.poNumber} has been approved and added to Accounts Payable`)
    } catch (error) {
      console.error("[v0] Error approving PO:", error)
      alert("Failed to approve purchase order. Please try again.")
    }
  }

  const handleAddItem = () => {
  setOrderItems([...orderItems, { productId: "", quantity: "", unitPrice: "", itemType: "stock" }])
  }
  
  const handleRemoveItem = (index: number) => {
  setOrderItems(orderItems.filter((_, i) => i !== index))
  }

  // Supplier name embedded in outsourced_description as "Supplier: NAME"
  const extractSupplierFromDesc = (description: string): string => {
    if (!description) return ""
    const match = description.match(/^Supplier:\s*(.+)$/i)
    return match ? match[1].trim().toLowerCase() : ""
  }

  // Match item to supplier by id (new orders) OR by name in outsourced_description (legacy orders)
  const itemBelongsToSupplier = (item: any, supplierId: string): boolean => {
    const isOutsourced = item.itemType === "outsourced" || item.item_type === "outsourced"
    if (!isOutsourced) return false
    // New orders: supplier_id is set
    if (item.supplierId && item.supplierId.toString() === supplierId.toString()) return true
    // Legacy orders: supplier stored as "Supplier: NAME" in outsourced_description
    const supplier = (suppliers || []).find((s: any) => s.id?.toString() === supplierId.toString())
    if (!supplier) return false
    const descName = extractSupplierFromDesc(item.outsourcedDescription || "")
    const supplierName = (supplier.name || "").trim().toLowerCase()
    return descName !== "" && supplierName !== "" && (supplierName.includes(descName) || descName.includes(supplierName))
  }

  // Returns sales orders that contain outsourced items assigned to the selected supplier
  const getSalesOrdersForSupplier = (supplierId: string) => {
    if (!supplierId) return []
    return (salesOrders || []).filter((so: any) =>
      (so.items || []).some((item: any) => itemBelongsToSupplier(item, supplierId)),
    )
  }

  // Load the outsourced items of a sales order that belong to the selected supplier
  const loadOutsourcedItemsFromSO = (soId: string) => {
    const so = (salesOrders || []).find(
      (s: any) => s.id?.toString() === soId.toString() || s.soId?.toString() === soId.toString(),
    )
    if (!so) {
      setOrderItems([])
      return
    }

    const matchingItems = (so.items || []).filter((item: any) =>
      itemBelongsToSupplier(item, formData.supplierId),
    )

    const importedItems = matchingItems.map((item: any) => ({
      productId: "",
      quantity: (item.quantity ?? "").toString(),
      unitPrice: (item.unitPrice ?? "").toString(),
      itemType: "outsourced" as const,
      outsourcedName: item.outsourcedName || item.productName || "",
      outsourcedDescription: item.outsourcedDescription || "",
      outsourcedUnit: item.outsourcedUnit || "",
      sourceSoId: (so.id || so.soId)?.toString() || "",
      sourceSoItemId: item.id?.toString() || "",
    }))

    setOrderItems(importedItems)
  }

  const getTodayDate = () => {
    const today = new Date()
    return today.toISOString().split("T")[0]
  }

  const orderTotal = orderItems.reduce((sum, item) => {
    const qty = Number.parseInt(item.quantity) || 0
    const price = Number.parseFloat(item.unitPrice) || 0
    return sum + qty * price
  }, 0)

  const handlePaymentTypeChange = (type: PaymentType) => {
    setPaymentType(type)
    // Update payment details based on new type
    setPaymentDetails((prev) => ({
      ...prev,
      paymentType: type,
      // Reset relevant fields if changing away from a specific type
      chequeNumber: type === "cheque" ? prev.chequeNumber : "",
      chequeBankName: type === "cheque" ? prev.chequeBankName : "",
      chequeDueDate: type === "cheque" ? prev.chequeDueDate : "",
      chequeAmount: type === "cheque" ? prev.chequeAmount : 0,
      chequeNotes: type === "cheque" ? prev.chequeNotes : "",
      downPaymentType: type === "hybrid" ? prev.downPaymentType : "cash",
      downPaymentAmount: type === "hybrid" ? prev.downPaymentAmount : 0,
      downPaymentPercent: type === "hybrid" ? prev.downPaymentPercent : 50,
      remainingAmount: type === "hybrid" ? prev.remainingAmount : 0,
      remainingInstallmentMonths: type === "hybrid" ? prev.remainingInstallmentMonths : 6,
      monthlyAmount: type === "hybrid" ? prev.monthlyAmount : 0,
      downPaymentChequeNumber: type === "hybrid" ? prev.downPaymentChequeNumber : "",
      downPaymentChequeBank: type === "hybrid" ? prev.downPaymentChequeBank : "",
      downPaymentChequeDueDate: type === "hybrid" ? prev.downPaymentChequeDueDate : "",
    }))
    // Reset input mode when payment type changes
    setDownPaymentInputMode(type === "hybrid" ? "amount" : null)
  }

  const handlePaymentDetailChange = (field: string, value: string | number) => {
    setPaymentDetails((prev) => {
      const updated = { ...prev, [field]: value }

      // Auto-calculate for hybrid payments
      if (field === "downPaymentAmount" && paymentType === "hybrid") {
        setDownPaymentInputMode("amount")
        const amount = Number(value) || 0
        updated.downPaymentPercent = orderTotal > 0 ? Math.round((amount / orderTotal) * 10000) / 100 : 0
        updated.remainingAmount = orderTotal - amount
        updated.monthlyAmount = updated.remainingAmount / (updated.remainingInstallmentMonths || 6)
      }
      if (field === "downPaymentPercent" && paymentType === "hybrid") {
        setDownPaymentInputMode("percent")
        const percent = Number(value) || 0
        updated.downPaymentAmount = Math.round(((orderTotal * percent) / 100) * 100) / 100
        updated.remainingAmount = orderTotal - updated.downPaymentAmount
        updated.monthlyAmount = updated.remainingAmount / (updated.remainingInstallmentMonths || 6)
      }
      if (field === "remainingInstallmentMonths" && paymentType === "hybrid") {
        const months = Number(value) || 6
        updated.monthlyAmount = updated.remainingAmount / months
      }
      if (field === "installmentMonths" && paymentType === "installments") {
        const months = Number(value) || 6
        updated.monthlyAmount = orderTotal / months
      }
      // Ensure paymentStartDate is updated correctly
      if (field === "paymentStartDate" && paymentType === "hybrid") {
        updated.paymentStartDate = value as string
      }

      return updated
    })
  }

  const handleCreatePO = async () => {
    if (!formData.supplierId) {
      alert(t("validation.select-supplier"))
      return
    }

    if (orderItems.length === 0) {
      alert(t("validation.add-items"))
      return
    }

    // Validate items
    for (const item of orderItems) {
      const hasName = item.itemType === "outsourced" ? !!item.outsourcedName : !!item.productId
      if (!hasName || !item.quantity || !item.unitPrice) {
        alert(t("validation.complete-items"))
        return
      }
    }

    setUploadingInvoice(true)

    try {
      let poInvoiceUrl = ""
      if (poInvoiceFile) {
        // Upload invoice file
        const uploadFormData = new FormData()
        uploadFormData.append("file", poInvoiceFile)
        uploadFormData.append("prefix", "po-invoices")

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: uploadFormData,
        })

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json()
          poInvoiceUrl = uploadData.url
        }
      }

      const items = orderItems.map((item) => {
        const product = products.find((p) => p.id === item.productId)
        const isOutsourced = item.itemType === "outsourced"
        return {
          productId: isOutsourced ? "" : item.productId,
          productName: isOutsourced ? item.outsourcedName || "Outsourced Item" : product?.productName || "Unknown",
          quantity: Number.parseInt(item.quantity) || 0,
          unitPrice: Number.parseFloat(item.unitPrice) || 0,
          total: (Number.parseInt(item.quantity) || 0) * (Number.parseFloat(item.unitPrice) || 0),
          itemType: item.itemType || "stock",
          outsourcedName: item.outsourcedName || null,
          outsourcedDescription: item.outsourcedDescription || null,
          outsourcedUnit: item.outsourcedUnit || null,
          sourceSoId: item.sourceSoId || null,
          sourceSoItemId: item.sourceSoItemId || null,
        }
      })

      const totalAmount = items.reduce((sum, item) => sum + item.total, 0)

      const finalPaymentDetails: PaymentDetails = {
        paymentType,
        ...(paymentType === "installments" && {
          installmentMonths: paymentDetails.installmentMonths,
          monthlyAmount: totalAmount / (paymentDetails.installmentMonths || 6),
        }),
        ...(paymentType === "cheque" && {
          chequeNumber: paymentDetails.chequeNumber,
          chequeBankName: paymentDetails.chequeBankName,
          chequeDueDate: paymentDetails.chequeDueDate,
          chequeAmount: paymentDetails.chequeAmount || totalAmount,
          chequeNotes: paymentDetails.chequeNotes,
        }),
        ...(paymentType === "hybrid" && {
          downPaymentType: paymentDetails.downPaymentType,
          downPaymentAmount: paymentDetails.downPaymentAmount,
          downPaymentPercent: paymentDetails.downPaymentPercent,
          remainingAmount: paymentDetails.remainingAmount,
          remainingInstallmentMonths: paymentDetails.remainingInstallmentMonths,
          monthlyAmount: paymentDetails.monthlyAmount,
          paymentStartDate: paymentDetails.paymentStartDate,
          downPaymentDueDate: paymentDetails.downPaymentDueDate || new Date().toISOString().split("T")[0],
          ...(paymentDetails.downPaymentType === "cheque" && {
            downPaymentChequeNumber: paymentDetails.downPaymentChequeNumber,
            downPaymentChequeBank: paymentDetails.downPaymentChequeBank,
            downPaymentChequeDueDate: paymentDetails.downPaymentChequeDueDate,
          }),
        }),
      }

      const newOrder: PurchaseOrder = {
        id: Date.now().toString(),
        poNumber: `PO-2025-${String(purchaseOrders.length + 1).padStart(3, "0")}`,
        supplierId: formData.supplierId,
        orderDate: new Date().toISOString().split("T")[0],
        deliveryDate: formData.dueDate,
        expiryDate: formData.expiryDate,
        items,
        status: "pending",
        total: totalAmount,
        notes: "",
        paymentType,
        paymentTerms:
          paymentType === "cash"
            ? "prepaid"
            : paymentType === "hybrid"
              ? "hybrid"
              : paymentType === "cheque"
                ? "cheque"
                : "installment",
        installments:
          paymentType === "installments"
            ? paymentDetails.installmentMonths
            : paymentType === "hybrid"
              ? paymentDetails.remainingInstallmentMonths
              : undefined,
        paymentDetails: finalPaymentDetails,
        currency: formData.currency,
        poInvoiceUrl,
        bankName: formData.bankName,
        bankAccountNumber: formData.bankAccountNumber,
        bankSwiftCode: formData.bankSwiftCode,
        bankIban: formData.bankIban,
        bankBranch: formData.bankBranch,
        bankHolderName: formData.bankHolderName,
        poType,
        scheduleEntries: paymentType === "hybrid" || paymentType === "installments" ? scheduleEntries : undefined,
        scheduleMode: scheduleMode,
        ...(paymentType === "hybrid" && {
          downPaymentAmount: paymentDetails.downPaymentAmount,
          downPaymentPercent: paymentDetails.downPaymentPercent,
          downPaymentDueDate: paymentDetails.downPaymentDueDate || new Date().toISOString().split("T")[0],
          downPaymentType: paymentDetails.downPaymentType,
          remainingAmount: paymentDetails.remainingAmount,
          remainingInstallmentMonths: paymentDetails.remainingInstallmentMonths,
          monthlyAmount: paymentDetails.monthlyAmount,
          paymentStartDate: paymentDetails.paymentStartDate,
          ...(paymentDetails.downPaymentType === "cheque" && {
            downPaymentChequeNumber: paymentDetails.downPaymentChequeNumber,
            downPaymentChequeBank: paymentDetails.downPaymentChequeBank,
            downPaymentChequeDueDate: paymentDetails.downPaymentChequeDueDate,
          }),
        }),
        ...(paymentType === "installments" && {
          remainingInstallmentMonths: paymentDetails.installmentMonths,
          monthlyAmount: paymentDetails.monthlyAmount,
          paymentStartDate: paymentDetails.paymentStartDate,
        }),
      }

      await addPurchaseOrder(newOrder)

      // Reset form
      resetForm()
      setOrderItems([])
      setPoInvoiceFile(null)
      setPaymentType("cash")
      setPoType("local")
      setPaymentDetails({
        paymentType: "cash",
        installmentMonths: 6,
        monthlyAmount: 0,
        chequeNumber: "",
        chequeBankName: "",
        chequeDueDate: "",
        chequeAmount: 0,
        chequeNotes: "",
        downPaymentType: "cash",
        downPaymentAmount: 0,
        downPaymentPercent: 50,
        remainingAmount: 0,
        remainingInstallmentMonths: 6,
        downPaymentChequeNumber: "",
        downPaymentChequeBank: "",
        downPaymentChequeDueDate: "",
        paymentStartDate: new Date().toISOString().split("T")[0], // Reset paymentStartDate
      })
      setShowForm(false)
    } catch (error) {
      console.error("Error creating PO:", error)
      alert(t("error.create-po"))
    } finally {
      setUploadingInvoice(false)
    }
  }

  const handleAdjustToMOQ = () => {
    if (!moqWarning) return

    const itemIndex = orderItems.findIndex((item) => {
      const product = products.find((p) => p.id === item.productId)
      return product?.productName === moqWarning.productName
    })

    if (itemIndex !== -1) {
      const newItems = [...orderItems]
      // FIX: Use itemIndex instead of index
      newItems[itemIndex].quantity = moqWarning.moq.toString()
      setOrderItems(newItems)
    }

    setMoqWarning(null)
  }

  const handlePrintInvoice = (order: PurchaseOrder) => {
    const invoice = supplierInvoices.find((inv) => inv.poId === order.id)
    if (!invoice) {
      alert("No invoice found for this purchase order")
      return
    }

    const supplier = suppliers.find((s) => s.id === order.supplierId)
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      alert("Please allow popups to print invoices")
      return
    }

    const invoiceHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${invoice.invoiceNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .company-name { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
            .invoice-title { font-size: 20px; color: #666; }
            .info-section { display: flex; justify-content: space-between; margin-bottom: 30px; }
            .info-block { flex: 1; }
            .info-label { font-weight: bold; color: #666; font-size: 12px; text-transform: uppercase; }
            .info-value { margin-top: 5px; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; margin: 30px 0; }
            th { background: #f5f5f5; padding: 12px; text-align: left; border-bottom: 2px solid #333; }
            td { padding: 12px; border-bottom: 1px solid #ddd; }
            .total-section { text-align: right; margin-top: 30px; }
            .total-row { display: flex; justify-content: flex-end; margin: 10px 0; }
            .total-label { width: 150px; font-weight: bold; }
            .total-value { width: 150px; text-align: right; }
            .grand-total { font-size: 18px; border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; }
            .footer { margin-top: 50px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
            @media print {
              body { padding: 20px; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-name">Misr Motors</div>
            <div class="invoice-title">SUPPLIER INVOICE</div>
          </div>
          
          <div class="info-section">
            <div class="info-block">
              <div class="info-label">From:</div>
              <div class="info-value">
                <strong>${supplier?.name || "Unknown Supplier"}</strong><br>
                ${supplier?.address || ""}<br>
                ${supplier?.city || ""}, ${supplier?.country || ""}<br>
                ${supplier?.email || ""}<br>
                ${supplier?.phone || ""}
              </div>
            </div>
            <div class="info-block" style="text-align: right;">
              <div class="info-label">Invoice Details:</div>
              <div class="info-value">
                <strong>Invoice #:</strong> ${invoice.invoiceNumber}<br>
                <strong>PO #:</strong> ${order.poNumber}<br>
                <strong>Date:</strong> ${invoice.date}<br>
                <strong>Due Date:</strong> ${invoice.deliveryDate}<br>
                ${order.installments ? `<strong>Payment:</strong> ${order.installments} Month Installment<br>` : "<strong>Payment:</strong> Prepaid<br>"}
                <strong>Currency:</strong> ${order.currency || "EGP"}<br>
              </div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th style="text-align: center;">Quantity</th>
                <th style="text-align: right;">Unit Price</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice.items
                .map(
                  (item) => `
                <tr>
                  <td>${item.productName}</td>
                  <td style="text-align: center;">${item.quantity}</td>
                  <td style="text-align: right;">${order.currency || "EGP"} ${item.unitPrice.toLocaleString()}</td>
                  <td style="text-align: right;">${order.currency || "EGP"} ${item.total.toLocaleString()}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>

          <div class="total-section">
            <div class="total-row">
              <div class="total-label">Subtotal:</div>
              <div class="total-value">${order.currency || "EGP"} ${invoice.total.toLocaleString()}</div>
            </div>
            ${
              order.installments
                ? `
              <div class="total-row">
                <div class="total-label">Monthly Payment:</div>
                <div class="total-value">${order.currency || "EGP"} ${(invoice.total / order.installments).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
            `
                : ""
            }
            <div class="total-row grand-total">
              <div class="total-label">Total Amount:</div>
              <div class="total-value">${order.currency || "EGP"} ${invoice.total.toLocaleString()}</div>
            </div>
          </div>

          <div class="footer">
            <p>Payment Terms: ${supplier?.paymentTerms || "Net 30"}</p>
            <p>Please remit payment to the address above</p>
          </div>

          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `

    printWindow.document.write(invoiceHTML)
    printWindow.document.close()
  }

  const handleReject = async () => {
    if (!rejectingOrderId || !rejectionReason.trim()) {
      alert("Please provide a rejection reason")
      return
    }

    const order = purchaseOrders.find((o) => o.id === rejectingOrderId)
    if (!order) {
      alert("Purchase order not found")
      return
    }

    try {
      await updatePurchaseOrder({
        ...order,
        status: "rejected",
        rejectionReason: rejectionReason.trim(),
      })

      setPurchaseOrders(
        purchaseOrders.map((o) =>
          o.id === rejectingOrderId
            ? { ...o, status: "rejected" as const, rejectionReason: rejectionReason.trim() }
            : o,
        ),
      )

      setShowRejectModal(false)
      setRejectingOrderId(null)
      setRejectionReason("")

      alert(`Purchase order ${order.poNumber} has been rejected`)
    } catch (error) {
      console.error("[v0] Error rejecting PO:", error)
      alert("Failed to reject purchase order. Please try again.")
    }
  }

  const handleFinalizeCost = async () => {
    if (!selectedPOForCost) return

    setFinalizingCost(true)
    try {
      const response = await fetch("/api/purchase-orders/finalize-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poId: selectedPOForCost,
          taxAmount: perProductTaxMode ? 0 : Number(taxAmount) || 0,
          otherCosts: perProductTaxMode ? 0 : Number(otherCosts) || 0,
          userId: user?.id || null,
          perProductTaxes: perProductTaxMode ? productTaxes : undefined,
          isPerProduct: perProductTaxMode,
        }),
      })

      if (response.ok) {
        alert("Cost finalized successfully! Products are now ready for pricing review.")
        setCostFinalizeDialog(false)
        setSelectedPOForCost(null)
        setTaxAmount("")
        setOtherCosts("")
        setPerProductTaxMode(false)
        setProductTaxes({})
        await loadData()
      } else {
        const error = await response.json()
        alert(`Failed to finalize cost: ${error.error}`)
      }
    } catch (error) {
      console.error("[v0] Error finalizing cost:", error)
      alert("Failed to finalize cost. Please try again.")
    } finally {
      setFinalizingCost(false)
    }
  }

  const filteredOrders = purchaseOrders.filter((order) => {
    if (!searchQuery) return true
    const lowerQuery = searchQuery.toLowerCase()
    return (
      order.poNumber.toLowerCase().includes(lowerQuery) ||
      getSupplierName(order.supplierId).toLowerCase().includes(lowerQuery)
    )
  })
  
  const selectedPOObject = selectedPOForCost ? purchaseOrders.find((po) => po.id === selectedPOForCost) : null
  
  const handlePendingCardClick = () => {
    setStatusFilter(statusFilter === "pending" ? null : "pending")
  }

  // Helper to reset the form
  const resetForm = () => {
    setFormData({
      supplierId: "",
      dueDate: new Date().toISOString().split("T")[0],
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // Reset expiry date
      currency: "EGP",
      bankName: "",
      bankAccountNumber: "",
      bankSwiftCode: "",
      bankIban: "",
      bankBranch: "",
      bankHolderName: "",
    })
    setOrderItems([])
    setPoSource("manual")
    setSelectedSourceSoId("")
    setSoSearchTerm("")
    setPoInvoiceFile(null)
    setPaymentType("cash")
    setPaymentDetails({
      paymentType: "cash",
      installmentMonths: 6,
      monthlyAmount: 0,
      chequeNumber: "",
      chequeBankName: "",
      chequeDueDate: "",
      chequeAmount: 0,
      chequeNotes: "",
      downPaymentType: "cash",
      downPaymentAmount: 0,
      downPaymentPercent: 50,
      remainingAmount: 0,
      remainingInstallmentMonths: 6,
      downPaymentChequeNumber: "",
      downPaymentChequeBank: "",
      downPaymentChequeDueDate: "",
      paymentStartDate: new Date().toISOString().split("T")[0], // Reset paymentStartDate
    })
    setDownPaymentInputMode(null) // Reset input mode on form reset
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("po.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("po.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowReportGenerator(true)}>
            {t("report.generate")}
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("po.add")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("po.list")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-start p-2">{t("po.number")}</th>
                  <th className="text-start p-2">{t("po.supplier")}</th>
                  <th className="text-start p-2">{t("po.order-date")}</th>
                  <th className="text-start p-2">{t("po.delivery-date")}</th>
                  <th className="text-start p-2">Payment Terms</th>
                  <th className="text-start p-2">{t("po.items")}</th>
                  <th className="text-start p-2">{t("po.total-amount")}</th>
                  <th className="text-start p-2">{t("field.status")}</th>
                  <th className="text-start p-2">{t("field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((order) => (
                  <>
                    <tr key={order.id} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-medium">{order.poNumber}</td>
                      <td className="p-2">{getSupplierName(order.supplierId)}</td>
                      <td className="p-2">{order.orderDate}</td>
                      <td className="p-2">{order.deliveryDate || "-"}</td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">
                          {order.paymentType || order.paymentTerms || "Cash"}
                        </Badge>
                      </td>
                      <td className="p-2">{formatNumber(order.items?.length || 0)}</td>
                      <td className="p-2">{formatCurrency(order.total)}</td>
                      <td className="p-2">
                        <Badge variant={getStatusVariant(order.status)}>{t(`po.status.${order.status}`)}</Badge>
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {canApprovePO && order.status === "pending" && (
                            <>
                              <Button 
                                variant="default" 
                                size="sm" 
                                onClick={() => handleApprove(order.id)}
                                title="Approve PO"
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                onClick={() => {
                                  setRejectingOrderId(order.id)
                                  setShowRejectModal(true)
                                }}
                                title="Reject PO"
                              >
                                <X className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => {
                              setViewDetailsOrder(order)
                              setShowDetailsModal(true)
                            }}
                            title="View Order Details"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => {
                              const printUrl = `${window.location.origin}/api/purchase-orders/pdf?poId=${order.id}`
                              window.open(printUrl, "_blank")
                            }}
                            title="Print PO"
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {order.status === "rejected" && order.rejectionReason && (
                      <tr key={`${order.id}-rejection`} className="bg-red-50">
                        <td colSpan={9} className="p-3">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="font-semibold text-red-900">Rejection Reason: </span>
                              <span className="text-red-800">{order.rejectionReason}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>{t("po.create-new")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* PO Type Selection */}
            <div>
              <label className="text-sm font-medium">{t("po.type")} *</label>
              <div className="flex gap-4 mt-2">
                <label
                  className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${poType === "local" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <input
                    type="radio"
                    name="poType"
                    value="local"
                    checked={poType === "local"}
                    onChange={() => setPoType("local")}
                    className="w-4 h-4"
                  />
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <div>
                      <span className="font-medium">{t("po.type-local")}</span>
                      <p className="text-xs text-muted-foreground">{t("po.type-local-desc")}</p>
                    </div>
                  </div>
                </label>
                <label
                  className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${poType === "international" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <input
                    type="radio"
                    name="poType"
                    value="international"
                    checked={poType === "international"}
                    onChange={() => setPoType("international")}
                    className="w-4 h-4"
                  />
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    <div>
                      <span className="font-medium">{t("po.type-international")}</span>
                      <p className="text-xs text-muted-foreground">{t("po.type-international-desc")}</p>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">{t("field.supplier")}</label>
                <select
                  className="w-full border rounded px-3 py-2 mt-1"
                  value={formData.supplierId}
                  onChange={(e) => {
                    setFormData({ ...formData, supplierId: e.target.value })
                    // Reset SO import when supplier changes
                    setSelectedSourceSoId("")
                    if (poSource === "sales_order") {
                      setOrderItems([])
                    }
                  }}
                >
                  <option value="">{t("action.select-supplier")}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">{t("field.due-date")}</label>
                <Input
                  placeholder={t("field.due-date")}
                  type="date"
                  value={formData.dueDate}
                  readOnly
                  className="bg-gray-50 cursor-not-allowed mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("field.expiry-date")} *</label>
                <Input
                  placeholder={t("field.expiry-date")}
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  min={new Date().toISOString().split("T")[0]}
                  className="mt-1"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">{t("po.expiry-date-hint")}</p>
              </div>
              <div>
                <label className="text-sm font-medium">{t("field.currency")}</label>
                <select
                  className="w-full border rounded px-3 py-2 mt-1"
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value as "EGP" | "USD" | "EUR" })}
                >
                  <option value="EGP">EGP ({t("currency.egp")})</option>
                  <option value="USD">USD ({t("currency.usd")})</option>
                  <option value="EUR">EUR ({t("currency.eur")})</option>
                </select>
              </div>
            </div>

            {/* PO Source: manual or from a sales order */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Purchase Order Source
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <label
                  className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${poSource === "manual" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <input
                    type="radio"
                    name="poSource"
                    value="manual"
                    checked={poSource === "manual"}
                    onChange={() => {
                      setPoSource("manual")
                      setSelectedSourceSoId("")
                      setOrderItems([])
                    }}
                    className="w-4 h-4"
                  />
                  <div>
                    <span className="font-medium">Manual</span>
                    <p className="text-xs text-muted-foreground">Add products manually</p>
                  </div>
                </label>
                <label
                  className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${poSource === "sales_order" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <input
                    type="radio"
                    name="poSource"
                    value="sales_order"
                    checked={poSource === "sales_order"}
                    onChange={() => {
                      setPoSource("sales_order")
                      setSelectedSourceSoId("")
                      setOrderItems([])
                    }}
                    className="w-4 h-4"
                  />
                  <div>
                    <span className="font-medium">From Sales Order</span>
                    <p className="text-xs text-muted-foreground">Import outsourced items for this supplier</p>
                  </div>
                </label>
              </div>

              {poSource === "sales_order" && (
                <div className="mt-3">
                  {!formData.supplierId ? (
                    <p className="text-sm text-amber-600 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Please select a supplier first to see their sales orders.
                    </p>
                  ) : (
                    <>
                      <label className="text-sm font-medium">Sales Order Number</label>
                      {(() => {
                        const allSupplierSOs = getSalesOrdersForSupplier(formData.supplierId)
                        if (allSupplierSOs.length === 0) {
                          return (
                            <p className="text-sm text-muted-foreground mt-1">
                              No sales orders with outsourced items for this supplier.
                            </p>
                          )
                        }
                        const term = soSearchTerm.trim().toLowerCase()
                        const availableSOs = term
                          ? allSupplierSOs.filter((so: any) =>
                              (so.soNumber || `SO-${so.id}`).toLowerCase().includes(term) ||
                              (so.customerName || "").toLowerCase().includes(term),
                            )
                          : allSupplierSOs
                        return (
                          <>
                            {/* Type the sales order number to find it */}
                            <Input
                              className="mt-1"
                              placeholder="Type the sales order number (e.g. SO-1024)"
                              value={soSearchTerm}
                              onChange={(e) => setSoSearchTerm(e.target.value)}
                            />
                            <select
                              className="w-full border rounded px-3 py-2 mt-2"
                              value={selectedSourceSoId}
                              onChange={(e) => {
                                setSelectedSourceSoId(e.target.value)
                                if (e.target.value) {
                                  loadOutsourcedItemsFromSO(e.target.value)
                                } else {
                                  setOrderItems([])
                                }
                              }}
                            >
                              <option value="">
                                {availableSOs.length === 0 ? "No matching sales orders" : "Select a sales order"}
                              </option>
                              {availableSOs.map((so: any) => (
                                <option key={so.id} value={so.id}>
                                  {so.soNumber || `SO-${so.id}`}
                                  {so.customerName ? ` - ${so.customerName}` : ""}
                                </option>
                              ))}
                            </select>
                          </>
                        )
                      })()}
                      {selectedSourceSoId && orderItems.length > 0 && (
                        <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          {orderItems.length} outsourced item(s) imported from the sales order.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Bank Details */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t("po.bank-details")}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">{t("field.bank-name")}</label>
                  <Input
                    placeholder={t("field.bank-name")}
                    value={formData.bankName}
                    onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("field.bank-holder-name")}</label>
                  <Input
                    placeholder={t("field.bank-holder-name")}
                    value={formData.bankHolderName}
                    onChange={(e) => setFormData({ ...formData, bankHolderName: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("field.bank-account-number")}</label>
                  <Input
                    placeholder={t("field.bank-account-number")}
                    value={formData.bankAccountNumber}
                    onChange={(e) => setFormData({ ...formData, bankAccountNumber: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("field.bank-iban")}</label>
                  <Input
                    placeholder="EG00 0000 0000 0000 0000 0000 0000"
                    value={formData.bankIban}
                    onChange={(e) => setFormData({ ...formData, bankIban: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("field.bank-swift-code")}</label>
                  <Input
                    placeholder="XXXXEGCX"
                    value={formData.bankSwiftCode}
                    onChange={(e) => setFormData({ ...formData, bankSwiftCode: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("field.bank-branch")}</label>
                  <Input
                    placeholder={t("field.bank-branch")}
                    value={formData.bankBranch}
                    onChange={(e) => setFormData({ ...formData, bankBranch: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Payment Type */}
            <PaymentTypeSelector value={paymentType} onChange={handlePaymentTypeChange} />

            {paymentType === "installments" && (
              <InstallmentFields
                months={paymentDetails.installmentMonths || 6}
                monthlyAmount={orderTotal / (paymentDetails.installmentMonths || 6)}
                totalAmount={orderTotal}
                onMonthsChange={(months) => {
                  setPaymentDetails((prev) => ({
                    ...prev,
                    installmentMonths: months,
                    monthlyAmount: orderTotal / months,
                  }))
                }}
                showScheduleBuilder={true}
                scheduleMode={scheduleMode}
                onScheduleModeChange={setScheduleMode}
                scheduleEntries={scheduleEntries}
                onScheduleEntriesChange={setScheduleEntries}
              />
            )}

            {paymentType === "cheque" && (
              <ChequeFields
                chequeNumber={paymentDetails.chequeNumber || ""}
                bankName={paymentDetails.chequeBankName || ""}
                dueDate={paymentDetails.chequeDueDate || ""}
                amount={paymentDetails.chequeAmount || orderTotal}
                notes={paymentDetails.chequeNotes}
                totalAmount={orderTotal}
                onChange={handlePaymentDetailChange}
              />
            )}

            {paymentType === "hybrid" && (
              <HybridFields
                totalAmount={orderTotal}
                downPaymentType={paymentDetails.downPaymentType || "cash"}
                downPaymentAmount={paymentDetails.downPaymentAmount || 0}
                downPaymentPercent={paymentDetails.downPaymentPercent || 50}
                remainingAmount={paymentDetails.remainingAmount || orderTotal / 2}
                remainingInstallmentMonths={paymentDetails.remainingInstallmentMonths || 6}
                monthlyAmount={paymentDetails.monthlyAmount || 0}
                downPaymentChequeNumber={paymentDetails.downPaymentChequeNumber}
                downPaymentChequeBank={paymentDetails.downPaymentChequeBank}
                downPaymentChequeDueDate={paymentDetails.downPaymentChequeDueDate}
                paymentStartDate={paymentDetails.paymentStartDate || new Date().toISOString().split("T")[0]} // Pass paymentStartDate
                downPaymentDueDate={paymentDetails.downPaymentDueDate || new Date().toISOString().split("T")[0]} // Pass downPaymentDueDate
                onChange={handlePaymentDetailChange}
                showScheduleBuilder={true}
                scheduleMode={scheduleMode}
                onScheduleModeChange={setScheduleMode}
                scheduleEntries={scheduleEntries}
                onScheduleEntriesChange={setScheduleEntries}
                // Pass downPaymentInputMode and setDownPaymentInputMode to HybridFields
                downPaymentInputMode={downPaymentInputMode}
                setDownPaymentInputMode={setDownPaymentInputMode}
              />
            )}

            {/* Invoice Upload */}
            <div className="p-4 border rounded-lg bg-gray-50">
              <label className="text-sm font-medium block mb-2">{t("po.invoice-optional")}</label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setPoInvoiceFile(e.target.files?.[0] || null)}
                  className="flex-1"
                />
                {poInvoiceFile && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Upload className="w-4 h-4" />
                    <span>{poInvoiceFile.name}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t("po.invoice-description")}</p>
            </div>

            {/* Items Section */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">{t("field.items")}</h3>
                <Button size="sm" onClick={handleAddItem} variant="outline">
                  <Plus className="w-4 h-4 me-2" />
                  {t("action.add-item")}
                </Button>
              </div>

              <div className="space-y-3">
                {orderItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-4 gap-2 items-end">
                    {item.itemType === "outsourced" ? (
                      <div className="w-full border rounded px-3 py-2 bg-muted/50">
                        <div className="flex items-center gap-1 text-sm font-medium truncate">
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">
                            Outsourced
                          </Badge>
                          <span className="truncate">{item.outsourcedName}</span>
                        </div>
                        {item.outsourcedUnit && (
                          <p className="text-xs text-muted-foreground">Unit: {item.outsourcedUnit}</p>
                        )}
                      </div>
                    ) : (
                      <select
                        className="w-full border rounded px-3 py-2"
                        value={item.productId}
                        onChange={(e) => {
                          const newItems = [...orderItems]
                          newItems[index].productId = e.target.value
                          setOrderItems(newItems)
                        }}
                      >
                        <option value="">{t("action.select-product")}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.productName}
                          </option>
                        ))}
                      </select>
                    )}
                    <Input
                      placeholder={t("field.quantity")}
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const newItems = [...orderItems]
                        newItems[index].quantity = e.target.value
                        setOrderItems(newItems)
                      }}
                    />
                    <Input
                      placeholder={t("field.unit-price")}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => {
                        const newItems = [...orderItems]
                        newItems[index].unitPrice = e.target.value
                        setOrderItems(newItems)
                      }}
                    />
                    <Button size="sm" variant="destructive" onClick={() => handleRemoveItem(index)}>
                      {t("action.remove")}
                    </Button>
                  </div>
                ))}
              </div>

              {orderItems.length > 0 && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <div className="flex justify-between items-center font-semibold">
                    <span>{t("field.total")}</span>
                    <span>{formatCurrency(orderTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                {t("action.cancel")}
              </Button>
              <Button onClick={handleCreatePO} disabled={uploadingInvoice}>
                {uploadingInvoice ? (
                  <>
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    {t("status.uploading")}
                  </>
                ) : (
                  t("action.save")
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>



      {/* Order Details Modal */}
      {showDetailsModal && viewDetailsOrder && (
        <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">Purchase Order Details - {viewDetailsOrder.poNumber}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6">
              {/* Order Information */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold mb-3 text-lg border-b pb-2">Order Information</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PO Number:</span>
                      <span className="font-medium">{viewDetailsOrder.poNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant={getStatusVariant(viewDetailsOrder.status)}>
                        {t(`po.status.${viewDetailsOrder.status}`)}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order Date:</span>
                      <span className="font-medium">{viewDetailsOrder.orderDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delivery Date:</span>
                      <span className="font-medium">{viewDetailsOrder.deliveryDate || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Supplier:</span>
                      <span className="font-medium">{getSupplierName(viewDetailsOrder.supplierId)}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Information */}
                <div>
                  <h3 className="font-semibold mb-3 text-lg border-b pb-2">Payment Information</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Type:</span>
                      <Badge variant="outline">
                        {viewDetailsOrder.paymentType === "hybrid" && "Hybrid Payment"}
                        {viewDetailsOrder.paymentType === "installments" && "Installments"}
                        {viewDetailsOrder.paymentType === "cash" && "Cash"}
                        {viewDetailsOrder.paymentType === "cheque" && "Cheque"}
                        {!viewDetailsOrder.paymentType && (viewDetailsOrder.paymentTerms || "Cash")}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Amount:</span>
                      <span className="font-bold text-lg">{formatCurrency(viewDetailsOrder.total)}</span>
                    </div>
                    {viewDetailsOrder.paymentType === "hybrid" && viewDetailsOrder.downPaymentAmount && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Down Payment:</span>
                          <span className="font-medium">{formatCurrency(Number(viewDetailsOrder.downPaymentAmount))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Remaining:</span>
                          <span className="font-medium">
                            {formatCurrency(viewDetailsOrder.total - Number(viewDetailsOrder.downPaymentAmount))}
                          </span>
                        </div>
                      </>
                    )}
                    {viewDetailsOrder.paymentType === "installments" && viewDetailsOrder.installments && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Installments:</span>
                        <span className="font-medium">{viewDetailsOrder.installments} payments</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div>
                <h3 className="font-semibold mb-3 text-lg border-b pb-2">Order Items</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-start p-3 font-semibold">Product</th>
                        <th className="text-start p-3 font-semibold">Quantity</th>
                        <th className="text-start p-3 font-semibold">Unit Price</th>
                        <th className="text-start p-3 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewDetailsOrder.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-t">
                          <td className="p-3">{item.productName || item.product_name || "-"}</td>
                          <td className="p-3">{formatNumber(item.quantity)}</td>
                          <td className="p-3">{formatCurrency(item.unitPrice || item.unit_price)}</td>
                          <td className="p-3 font-medium">{formatCurrency((item.quantity || 0) * (item.unitPrice || item.unit_price || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Schedule (if installments or hybrid) */}
              {(viewDetailsOrder.paymentType === "installments" || viewDetailsOrder.paymentType === "hybrid") && (
                <div>
                  <h3 className="font-semibold mb-3 text-lg border-b pb-2">Payment Schedule</h3>
                  <div className="space-y-2 text-sm">
                    {viewDetailsOrder.paymentType === "hybrid" && viewDetailsOrder.downPaymentAmount && (
                      <div className="flex justify-between p-3 bg-green-50 border border-green-200 rounded">
                        <span className="font-semibold">Down Payment (Immediate)</span>
                        <span className="font-bold text-green-700">{formatCurrency(Number(viewDetailsOrder.downPaymentAmount))}</span>
                      </div>
                    )}
                    {(viewDetailsOrder.installments || viewDetailsOrder.paymentType === "hybrid") && (() => {
                      const remainingAmount = viewDetailsOrder.paymentType === "hybrid" 
                        ? viewDetailsOrder.total - Number(viewDetailsOrder.downPaymentAmount || 0)
                        : viewDetailsOrder.total;
                      const installmentCount = viewDetailsOrder.installments || 3; // Default to 3 if not specified for hybrid
                      const installmentAmount = remainingAmount / installmentCount;
                      return Array.from({ length: installmentCount }).map((_, i) => (
                        <div key={i} className="flex justify-between p-3 bg-blue-50 border border-blue-200 rounded">
                          <span>Installment {i + 1}</span>
                          <span className="font-medium text-blue-700">{formatCurrency(installmentAmount)}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetailsModal(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Reject Purchase Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Rejection Reason</label>
                <textarea
                  className="w-full border rounded px-3 py-2 mt-1 min-h-[100px]"
                  placeholder="Please provide a reason for rejecting this purchase order..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleReject} variant="destructive">
                  Reject PO
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRejectModal(false)
                    setRejectingOrderId(null)
                    setRejectionReason("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {costFinalizeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Finalize Purchase Order Cost</CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                Choose how to allocate tax and costs to items. Global allocation distributes proportionally; Per-Product
                lets you set specific amounts.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedPOObject && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="font-semibold text-sm">PO: {selectedPOObject.poNumber}</h4>
                    <span className="text-sm text-muted-foreground">
                      Supplier: {suppliers.find((s) => s.id === selectedPOObject.supplierId)?.name || "Unknown"}
                    </span>
                  </div>

                  <div className="flex gap-4 p-3 bg-muted rounded-lg">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={!perProductTaxMode}
                        onChange={() => {
                          setPerProductTaxMode(false)
                          setProductTaxes({})
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium">Global Allocation (Proportional)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={perProductTaxMode}
                        onChange={() => setPerProductTaxMode(true)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium">Per-Product Allocation</span>
                    </label>
                  </div>

                  {/* Global Allocation Mode */}
                  {!perProductTaxMode && (
                    <>
                      <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                        {selectedPOObject.items?.map((item: any, index: number) => (
                          <div
                            key={item.id || index}
                            className="flex justify-between items-center p-3 hover:bg-muted/50"
                          >
                            <div>
                              <p className="font-medium text-sm">{item.productName}</p>
                              <p className="text-xs text-muted-foreground">
                                Qty: {item.quantity} × {selectedPOObject.currency || "EGP"}{" "}
                                {Number(item.unitPrice).toLocaleString()}
                              </p>
                            </div>
                            <p className="font-semibold text-sm">
                              {selectedPOObject.currency || "EGP"} {Number(item.total).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t">
                        <span className="font-medium">Subtotal (before tax)</span>
                        <span className="font-bold">
                          {selectedPOObject.currency || "EGP"} {Number(selectedPOObject.total).toLocaleString()}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">
                            Tax Amount ({selectedPOObject?.currency || "EGP"})
                          </label>
                          <Input
                            type="number"
                            value={taxAmount}
                            onChange={(e) => setTaxAmount(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">
                            Other Costs ({selectedPOObject?.currency || "EGP"})
                          </label>
                          <Input
                            type="number"
                            value={otherCosts}
                            onChange={(e) => setOtherCosts(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            className="mt-1"
                          />
                          <p className="text-xs text-muted-foreground mt-1">Shipping, customs, etc.</p>
                        </div>
                      </div>

                      <div className="bg-muted p-3 rounded-lg space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Additional Costs</span>
                          <span>
                            {selectedPOObject?.currency || "EGP"}{" "}
                            {((Number(taxAmount) || 0) + (Number(otherCosts) || 0)).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-lg pt-2 border-t">
                          <span>Total Landed Cost</span>
                          <span>
                            {selectedPOObject?.currency || "EGP"}{" "}
                            {(
                              (selectedPOObject?.total || 0) +
                              (Number(taxAmount) || 0) +
                              (Number(otherCosts) || 0)
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  {perProductTaxMode && (
                    <>
                      <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-4 gap-2 bg-muted p-2 font-semibold text-sm sticky top-0">
                          <div>Product</div>
                          <div className="text-right">Subtotal</div>
                          <div className="text-right">Tax</div>
                          <div className="text-right">Other Costs</div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {selectedPOObject.items?.map((item: any, index: number) => (
                            <div
                              key={item.id || index}
                              className="grid grid-cols-4 gap-2 p-2 border-b hover:bg-muted/50 items-center"
                            >
                              <div className="text-sm font-medium truncate">{item.productName}</div>
                              <div className="text-right text-sm">
                                {Number(item.total).toLocaleString()} {selectedPOObject?.currency || "EGP"}
                              </div>
                              <div>
                                <Input
                                  type="number"
                                  placeholder="Tax"
                                  value={productTaxes[item.id]?.tax || ""}
                                  onChange={(e) =>
                                    setProductTaxes({
                                      ...productTaxes,
                                      [item.id]: {
                                        ...productTaxes[item.id],
                                        tax: e.target.value,
                                      },
                                    })
                                  }
                                  step="0.01"
                                  className="text-sm h-8"
                                />
                              </div>
                              <div>
                                <Input
                                  type="number"
                                  placeholder="Costs"
                                  value={productTaxes[item.id]?.otherCosts || ""}
                                  onChange={(e) =>
                                    setProductTaxes({
                                      ...productTaxes,
                                      [item.id]: {
                                        ...productTaxes[item.id],
                                        otherCosts: e.target.value,
                                      },
                                    })
                                  }
                                  step="0.01"
                                  className="text-sm h-8"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-muted p-3 rounded-lg space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Total Tax Allocated</span>
                          <span>
                            {selectedPOObject?.currency || "EGP"}{" "}
                            {Object.values(productTaxes)
                              .reduce((sum, item) => sum + (Number(item.tax) || 0), 0)
                              .toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Total Other Costs</span>
                          <span>
                            {selectedPOObject?.currency || "EGP"}{" "}
                            {Object.values(productTaxes)
                              .reduce((sum, item) => sum + (Number(item.otherCosts) || 0), 0)
                              .toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-lg pt-2 border-t">
                          <span>Grand Total</span>
                          <span>
                            {selectedPOObject?.currency || "EGP"}{" "}
                            {(
                              (selectedPOObject?.total || 0) +
                              Object.values(productTaxes).reduce((sum, item) => sum + (Number(item.tax) || 0), 0) +
                              Object.values(productTaxes).reduce((sum, item) => sum + (Number(item.otherCosts) || 0), 0)
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleFinalizeCost} disabled={finalizingCost} className="flex-1">
                  {finalizingCost ? "Finalizing..." : "Finalize Cost"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCostFinalizeDialog(false)
                    setSelectedPOForCost(null)
                    setTaxAmount("")
                    setOtherCosts("")
                    setPerProductTaxMode(false)
                    setProductTaxes({})
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
