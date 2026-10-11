"use client"

import { DialogFooter } from "@/components/ui/dialog"

import { Fragment, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { Money } from "@/components/erp/money"
import { ErpTable, NumHead, NumCell, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { formatDate, formatMoney } from "@/lib/format"
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
import { fill } from "@/lib/i18n-format"

interface PurchaseOrderModuleProps {
  userRole?: UserRole
}

export function PurchaseOrderModule({ userRole = "accountant" }: PurchaseOrderModuleProps) {
  const { t, formatNumber, language } = useI18n()
  // PO currency code for display: EGP shows as the translated Egyptian-pound symbol, other codes stay as they are.
  const currencyLabel = (code?: string | null) => (!code || /^egp$/i.test(code) ? t("common.egp-2") : code)
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
      productName: string
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

  // VAT on PO creation (14%, same as sales quotations)
  const VAT_RATE = 0.14
  const [vatEnabled, setVatEnabled] = useState(true)

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
    const product = products.find((p) => p.id === productId)
    setOrderItems([
      ...orderItems,
      {
        productId,
        productName: product?.productName || "",
        quantity: quantity.toString(),
        unitPrice: unitPrice.toString(),
        itemType: "stock",
      },
    ])
  }

  const getSupplierName = (supplierId: string) => {
    return suppliers.find((s) => s.id === supplierId)?.name || "Unknown"
  }

  const getProductName = (productId: string) => {
    return products.find((p) => p.id === productId)?.productName || "Unknown"
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



    try {
      // Check if invoice already exists (GET returns a plain array)
      const response = await fetch(`/api/accounts-payable?poId=${poIdInt}`)
      const existingInvoice = await response.json()

      if (Array.isArray(existingInvoice) && existingInvoice.length > 0) {
        return
      }

      const apInvoiceData = {
        invoice_number: `APINV-${order.poNumber}`,
        supplier_id: order.supplierId,
        po_id: poIdInt,
        invoice_date: new Date().toISOString().split("T")[0],
        due_date: effectivePaymentType === "hybrid" ? downPaymentDueDate : paymentStartDate,
        amount: order.total,
        paid_amount:
          effectivePaymentType === "prepaid" ||
          effectivePaymentType === "cash" ||
          effectivePaymentType === "bank_transfer"
            ? order.total
            : 0,
        payment_start_date: paymentStartDate,
        installment_months:
          effectivePaymentType === "hybrid"
            ? remainingInstallmentMonths
            : effectivePaymentType === "installments" || effectivePaymentType === "installment"
              ? order.installments || remainingInstallmentMonths
              : 1,
        months_paid: 0,
        status:
          effectivePaymentType === "prepaid" ||
          effectivePaymentType === "cash" ||
          effectivePaymentType === "bank_transfer"
            ? "paid"
            : "pending",
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
        console.error("Failed to create AP invoice:", errorData)
        throw new Error(errorData.error || "Failed to create supplier invoice")
      }

      const newInvoice = await apInvoiceResponse.json()

      const invoiceId = newInvoice.invoice_id || newInvoice.invoiceId

      if (!invoiceId) {
        console.error("AP Invoice created but invoice_id is missing:", newInvoice)
        throw new Error("Invoice created but invoice_id was not returned")
      }


      const savedScheduleEntries = order.scheduleEntries || []
      const savedScheduleMode = order.scheduleMode || "AUTO"

      // Create payment schedules based on payment type
      if (effectivePaymentType === "installments" || effectivePaymentType === "hybrid") {
        try {

          const scheduleResponse = await fetch("/api/payment-schedules", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-caller-context": "PO-approval-schedule-generation",
            },
            body: JSON.stringify({
              invoiceId: invoiceId,
              // For hybrid: only schedule the remaining amount (not the full total)
              amount: effectivePaymentType === "hybrid" ? remainingAmount : order.total,
              installmentMonths: remainingInstallmentMonths,
              startDate: paymentStartDate,
              downPaymentAmount: effectivePaymentType === "hybrid" ? downPaymentAmount : 0,
              downPaymentDueDate: effectivePaymentType === "hybrid" ? downPaymentDueDate : null,
              monthlyAmount: effectivePaymentType === "hybrid" ? monthlyAmount : null,
              scheduleMode: "LEGACY_MONTHLY",
              scheduleType: "payable",
              isActive: false,
            }),
          })

          if (scheduleResponse.ok) {
            const scheduleData = await scheduleResponse.json()
            if (scheduleData.alreadyExists) {
            } else {
            }
          } else {
            const errorText = await scheduleResponse.text()
            console.error("Error creating payment schedules:", errorText)
          }
        } catch (scheduleError) {
          console.error("Exception creating payment schedules:", scheduleError)
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
            status:
              effectivePaymentType === "prepaid" ||
              effectivePaymentType === "cash" ||
              effectivePaymentType === "bank_transfer"
                ? "voided"
                : "active",
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
      alert(t("po.only-ceo-admin-approve"))
      return
    }

    const order = purchaseOrders.find((o) => o.id === id)
    if (!order) {
      alert(t("po.not-found"))
      return
    }

    try {
      await updatePurchaseOrder({
        ...order,
        status: "approved",
      })

      setPurchaseOrders(purchaseOrders.map((o) => (o.id === id ? { ...o, status: "approved" as const } : o)))

      alert(fill(t("po.approved-added-ap"), { number: order.poNumber }))
    } catch (error) {
      console.error("Error approving PO:", error)
      alert(fill(t("po.approve-failed"), { message: error instanceof Error ? error.message : t("po.please-try-again") }))
    }
  }

  const handleAddItem = () => {
    setOrderItems([...orderItems, { productId: "", productName: "", quantity: "", unitPrice: "", itemType: "stock" }])
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
      productName: "",
      quantity: (item.quantity ?? "").toString(),
      unitPrice: "",
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

  const vatAmount = vatEnabled ? orderTotal * VAT_RATE : 0
  const grandTotal = orderTotal + vatAmount

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
      updated.downPaymentPercent = grandTotal > 0 ? Math.round((amount / grandTotal) * 10000) / 100 : 0
      updated.remainingAmount = grandTotal - amount
        updated.monthlyAmount = updated.remainingAmount / (updated.remainingInstallmentMonths || 6)
      }
      if (field === "downPaymentPercent" && paymentType === "hybrid") {
        setDownPaymentInputMode("percent")
        const percent = Number(value) || 0
      updated.downPaymentAmount = Math.round(((grandTotal * percent) / 100) * 100) / 100
      updated.remainingAmount = grandTotal - updated.downPaymentAmount
        updated.monthlyAmount = updated.remainingAmount / (updated.remainingInstallmentMonths || 6)
      }
      if (field === "remainingInstallmentMonths" && paymentType === "hybrid") {
        const months = Number(value) || 6
        updated.monthlyAmount = updated.remainingAmount / months
      }
      if (field === "installmentMonths" && paymentType === "installments") {
        const months = Number(value) || 6
        updated.monthlyAmount = grandTotal / months
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
      const hasName = item.itemType === "outsourced" ? !!item.outsourcedName : !!item.productName
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
        const isOutsourced = item.itemType === "outsourced"
        const qty = Number.parseInt(item.quantity) || 0
        // unit_price is NOT NULL in DB — default to 0 if blank (user can update later)
        const unitPrice = Number.parseFloat(item.unitPrice) || 0
        return {
          productId: isOutsourced ? "" : (item.productId || ""),
          productName: isOutsourced ? item.outsourcedName || "Outsourced Item" : item.productName || "Unknown",
          quantity: qty,
          unitPrice,
          total: qty * unitPrice,
          itemType: item.itemType || "stock",
          outsourcedName: item.outsourcedName || null,
          outsourcedDescription: item.outsourcedDescription || null,
          outsourcedUnit: item.outsourcedUnit || null,
          sourceSoId: item.sourceSoId || null,
          sourceSoItemId: item.sourceSoItemId || null,
        }
      })

      const itemsSubtotal = items.reduce((sum, item) => sum + item.total, 0)
      const totalAmount = itemsSubtotal + vatAmount

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
        taxAmount: vatAmount,
        notes: "",
        paymentType,
        paymentTerms:
          paymentType === "cash" || paymentType === "bank_transfer"
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
      setVatEnabled(true)
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
      alert(error instanceof Error && error.message ? `${t("error.create-po")}: ${error.message}` : t("error.create-po"))
    } finally {
      setUploadingInvoice(false)
    }
  }

  const handleAdjustToMOQ = () => {
    if (!moqWarning) return

    const itemIndex = orderItems.findIndex((item) => {
      const resolvedName = item.productName || products.find((p) => p.id === item.productId)?.productName
      return resolvedName === moqWarning.productName
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
      alert(t("po.no-invoice-found"))
      return
    }

    const supplier = suppliers.find((s) => s.id === order.supplierId)
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      alert(t("po.allow-popups"))
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
              <div class="total-value">${order.currency || "EGP"} ${(invoice.total - (order.taxAmount || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
            ${
              order.taxAmount
                ? `
              <div class="total-row">
                <div class="total-label">VAT (14%):</div>
                <div class="total-value">${order.currency || "EGP"} ${order.taxAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
            `
                : ""
            }
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
      alert(t("permit.rejection-reason-required"))
      return
    }

    const order = purchaseOrders.find((o) => o.id === rejectingOrderId)
    if (!order) {
      alert(t("po.not-found"))
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

      alert(fill(t("po.rejected-message"), { number: order.poNumber }))
    } catch (error) {
      console.error("Error rejecting PO:", error)
      alert(fill(t("po.reject-failed"), { message: error instanceof Error ? error.message : t("po.please-try-again") }))
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
        alert(t("po.cost-finalized"))
        setCostFinalizeDialog(false)
        setSelectedPOForCost(null)
        setTaxAmount("")
        setOtherCosts("")
        setPerProductTaxMode(false)
        setProductTaxes({})
        await loadData()
      } else {
        const error = await response.json()
        alert(fill(t("po.finalize-cost-failed-message"), { message: error.error }))
      }
    } catch (error) {
      console.error("Error finalizing cost:", error)
      alert(t("po.finalize-cost-failed"))
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

  // Row actions, shared by the table's actions cell and the phone card.
  const renderRowActions = (order: PurchaseOrder) => (
    <div className="flex items-center gap-2">
      {canApprovePO && order.status === "pending" && (
        <>
          <Button
            variant="default"
            size="sm"
            onClick={() => handleApprove(order.id)}
            title={t("po.approve-po")}
            className="bg-green-700 hover:bg-green-800 text-white"
          >
            <CheckCircle className="w-4 h-4 me-1" />
            {t("action.approve")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setRejectingOrderId(order.id)
              setShowRejectModal(true)
            }}
            title={t("po.reject-po")}
          >
            <X className="w-4 h-4 me-1" />
            {t("action.reject")}
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
        title={t("po.view-order-details")}
        aria-label={t("action.view")}
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
        title={t("po.print-po")}
        aria-label={t("action.print")}
      >
        <FileText className="w-4 h-4" />
      </Button>
    </div>
  )

  // The rejection reason: its own full-width row in the table, the note line on a phone card.
  const renderRejectionReason = (order: PurchaseOrder) => (
    <div className="flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-semibold text-red-900">{t("po.rejection-reason-label")}{" "}</span>
        <span className="text-red-800">{order.rejectionReason}</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.purchasing")}
        title={t("po.title")}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowReportGenerator(true)}>
              {t("report.generate")}
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 me-2" />
              {t("po.add")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("po.list")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveList
            rows={purchaseOrders}
            table={
              <ErpTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("po.number")}</TableHead>
                    <TableHead>{t("po.supplier")}</TableHead>
                    <TableHead>{t("po.order-date")}</TableHead>
                    <TableHead>{t("po.delivery-date")}</TableHead>
                    <TableHead>{t("field.payment-terms")}</TableHead>
                    <NumHead>{t("po.items")}</NumHead>
                    <NumHead>{t("po.total-amount")} {t("common.egp")}</NumHead>
                    <TableHead>{t("field.status")}</TableHead>
                    <ActionsHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders.map((order) => (
                    <Fragment key={order.id}>
                      <TableRow>
                        <IdCell>{order.poNumber}</IdCell>
                        <TableCell>{getSupplierName(order.supplierId)}</TableCell>
                        <TableCell>{formatDate(order.orderDate, language)}</TableCell>
                        <TableCell>{formatDate(order.deliveryDate, language)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {order.paymentType || order.paymentTerms || t("payment.cash")}
                          </Badge>
                        </TableCell>
                        <NumCell>{formatNumber(order.items?.length || 0)}</NumCell>
                        <NumCell>{formatMoney(order.total, language)}</NumCell>
                        <TableCell>
                          <StatusBadge status={order.status} label={t(`po.status.${order.status}`)} />
                        </TableCell>
                        <ActionsCell>{renderRowActions(order)}</ActionsCell>
                      </TableRow>
                      {order.status === "rejected" && order.rejectionReason && (
                        <TableRow className="bg-red-50">
                          <TableCell colSpan={9} className="p-3">
                            {renderRejectionReason(order)}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </ErpTable>
            }
            card={(order) => (
              <ListCard
                id={order.poNumber}
                party={getSupplierName(order.supplierId)}
                amount={formatMoney(order.total, language)}
                status={<StatusBadge status={order.status} label={t(`po.status.${order.status}`)} />}
                note={order.status === "rejected" && order.rejectionReason ? renderRejectionReason(order) : undefined}
                actions={renderRowActions(order)}
              />
            )}
          />
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
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
                  <option value="EGP">{t("currency.egp")}</option>
                  <option value="USD">{t("currency.usd")}</option>
                  <option value="EUR">{t("currency.eur")}</option>
                </select>
              </div>
            </div>

            {/* PO Source: manual or from a sales order */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t("po.source")}
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
                    <span className="font-medium">{t("po.source-manual")}</span>
                    <p className="text-xs text-muted-foreground">{t("po.source-manual-desc")}</p>
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
                    <span className="font-medium">{t("ar.from-sales-order")}</span>
                    <p className="text-xs text-muted-foreground">{t("po.source-so-desc")}</p>
                  </div>
                </label>
              </div>

              {poSource === "sales_order" && (
                <div className="mt-3">
                  {!formData.supplierId ? (
                    <p className="text-sm text-amber-700 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {t("po.select-supplier-first")}
                    </p>
                  ) : (
                    <>
                      <label className="text-sm font-medium">{t("po.sales-order-number")}</label>
                      {(() => {
                        const allSupplierSOs = getSalesOrdersForSupplier(formData.supplierId)
                        if (allSupplierSOs.length === 0) {
                          return (
                            <p className="text-sm text-muted-foreground mt-1">
                              {t("po.no-outsourced-sos")}
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
                              placeholder={t("po.type-so-number")}
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
                                {availableSOs.length === 0 ? t("po.no-matching-sos") : t("po.select-so")}
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
                        <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          {fill(t("po.outsourced-imported"), { count: orderItems.length })}
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
                monthlyAmount={grandTotal / (paymentDetails.installmentMonths || 6)}
                totalAmount={grandTotal}
                onMonthsChange={(months) => {
                  setPaymentDetails((prev) => ({
                    ...prev,
                    installmentMonths: months,
                    monthlyAmount: grandTotal / months,
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
                amount={paymentDetails.chequeAmount || grandTotal}
                notes={paymentDetails.chequeNotes}
                totalAmount={grandTotal}
                onChange={handlePaymentDetailChange}
              />
            )}

            {paymentType === "hybrid" && (
              <HybridFields
                totalAmount={grandTotal}
                downPaymentType={paymentDetails.downPaymentType || "cash"}
                downPaymentAmount={paymentDetails.downPaymentAmount || 0}
                downPaymentPercent={paymentDetails.downPaymentPercent || 50}
                remainingAmount={paymentDetails.remainingAmount || grandTotal / 2}
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
                  <div className="flex items-center gap-2 text-sm text-green-700">
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
                  <div key={index} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
                    {item.itemType === "outsourced" ? (
                      <div className="w-full border rounded px-3 py-2 bg-muted/50 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                            {t("common.outsourced-2")}
                          </Badge>
                          <span className="truncate">{item.outsourcedName}</span>
                        </div>
                        {item.outsourcedUnit && (
                          <p className="text-xs text-muted-foreground mt-0.5">{fill(t("po.unit-label"), { unit: item.outsourcedUnit })}</p>
                        )}
                      </div>
                    ) : (
                      <Input
                        placeholder={t("po.product-name-placeholder")}
                        value={item.productName}
                        onChange={(e) => {
                          const newItems = [...orderItems]
                          newItems[index].productName = e.target.value
                          setOrderItems(newItems)
                        }}
                      />
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
                <div className="mt-4 p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center space-x-2 pb-2 border-b">
                    <input
                      type="checkbox"
                      id="poVatEnabled"
                      checked={vatEnabled}
                      onChange={(e) => setVatEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor="poVatEnabled" className="text-sm font-medium">
                      {t("po.add-vat")}
                    </label>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{t("po.subtotal-egp")}</span>
                    <span><Money value={orderTotal} /></span>
                  </div>
                  {vatEnabled && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{t("po.vat-egp")}</span>
                      <span><Money value={vatAmount} /></span>
                    </div>
                  )}
                  <div className="flex justify-between items-center font-semibold pt-2 border-t">
                    <span>{t("field.total")} {t("common.egp")}</span>
                    <span><Money value={grandTotal} /></span>
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
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">{fill(t("po.details-title"), { number: viewDetailsOrder.poNumber })}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6">
              {/* Order Information */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold mb-3 text-lg border-b pb-2">{t("po.order-information")}</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("po.number-label")}</span>
                      <span className="font-medium">{viewDetailsOrder.poNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("po.status-label")}</span>
                      <StatusBadge status={viewDetailsOrder.status} label={t(`po.status.${viewDetailsOrder.status}`)} />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("po.order-date-label")}</span>
                      <span className="font-medium">{formatDate(viewDetailsOrder.orderDate, language)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("po.delivery-date-label")}</span>
                      <span className="font-medium">{formatDate(viewDetailsOrder.deliveryDate, language)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("common.supplier")}</span>
                      <span className="font-medium">{getSupplierName(viewDetailsOrder.supplierId)}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Information */}
                <div>
                  <h3 className="font-semibold mb-3 text-lg border-b pb-2">{t("po.payment-information")}</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("po.payment-type-label")}</span>
                      <Badge variant="outline">
                        {viewDetailsOrder.paymentType === "hybrid" && t("payment.hybrid-payment")}
                        {viewDetailsOrder.paymentType === "installments" && t("payment.installments")}
                        {viewDetailsOrder.paymentType === "cash" && t("payment.cash")}
                        {viewDetailsOrder.paymentType === "bank_transfer" && t("payment.bank_transfer")}
                        {viewDetailsOrder.paymentType === "cheque" && t("payment.cheque")}
                        {!viewDetailsOrder.paymentType && (viewDetailsOrder.paymentTerms || t("payment.cash"))}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("po.total-amount-egp-label")}</span>
                      <span className="font-bold text-lg"><Money value={viewDetailsOrder.total} /></span>
                    </div>
                    {viewDetailsOrder.paymentType === "hybrid" && viewDetailsOrder.downPaymentAmount && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("po.down-payment-egp-label")}</span>
                          <span className="font-medium"><Money value={Number(viewDetailsOrder.downPaymentAmount)} /></span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("po.remaining-egp-label")}</span>
                          <span className="font-medium">
                            <Money value={viewDetailsOrder.total - Number(viewDetailsOrder.downPaymentAmount)} />
                          </span>
                        </div>
                      </>
                    )}
                    {viewDetailsOrder.paymentType === "installments" && viewDetailsOrder.installments && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("po.installments-label")}</span>
                        <span className="font-medium">{viewDetailsOrder.installments} {t("common.payments")}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div>
              <h3 className="font-semibold mb-3 text-lg border-b pb-2">{t("po.order-items")}</h3>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-start p-3 font-semibold">{t("field.product")}</th>
                        <th className="text-start p-3 font-semibold">{t("quantity")}</th>
                        <th className="text-start p-3 font-semibold">{t("common.unit-price-egp")}</th>
                        <th className="text-start p-3 font-semibold">{t("common.total-egp")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewDetailsOrder.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-t">
                          <td className="p-3">{item.productName || item.product_name || "-"}</td>
                          <td className="p-3">{formatNumber(item.quantity)}</td>
                          <td className="p-3"><Money value={item.unitPrice || item.unit_price} /></td>
                          <td className="p-3 font-medium"><Money value={(item.quantity || 0) * (item.unitPrice || item.unit_price || 0)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Schedule (if installments or hybrid) */}
              {(viewDetailsOrder.paymentType === "installments" || viewDetailsOrder.paymentType === "hybrid") && (
                <div>
                  <h3 className="font-semibold mb-3 text-lg border-b pb-2">{t("module.payment-schedule")}</h3>
                  <div className="space-y-2 text-sm">
                    {/* Down payment row for hybrid */}
                    {viewDetailsOrder.paymentType === "hybrid" && Number(viewDetailsOrder.downPaymentAmount) > 0 && (
                      <div className="flex justify-between p-3 bg-green-50 border border-green-200 rounded">
                        <div>
                          <span className="font-semibold">{t("payment.down-payment")}</span>
                          {viewDetailsOrder.downPaymentDueDate && (
                            <p className="text-xs text-muted-foreground">{fill(t("po.due-date"), { date: formatDate(viewDetailsOrder.downPaymentDueDate, language) })}</p>
                          )}
                        </div>
                        <span className="font-bold text-green-700"><Money value={Number(viewDetailsOrder.downPaymentAmount)} /> {t("common.egp-2")}</span>
                      </div>
                    )}

                    {/* MANUAL mode: render each saved schedule entry as-is */}
                    {viewDetailsOrder.scheduleMode === "MANUAL" && Array.isArray(viewDetailsOrder.scheduleEntries) && viewDetailsOrder.scheduleEntries.length > 0 ? (
                      viewDetailsOrder.scheduleEntries.map((entry: any, i: number) => (
                        <div key={entry.id || i} className="flex justify-between p-3 bg-blue-50 border border-blue-200 rounded">
                          <div>
                            <span>{entry.note || fill(t("po.installment-n"), { n: i + 1 })}</span>
                            {entry.dueDate && (
                              <p className="text-xs text-muted-foreground">
                                {fill(t("po.due-date"), { date: formatDate(entry.dueDate, language) })}
                              </p>
                            )}
                          </div>
                          <span className="font-medium text-blue-700"><Money value={Number(entry.amount)} /> {t("common.egp-2")}</span>
                        </div>
                      ))
                    ) : (
                      /* AUTO mode: compute evenly from stored monthlyAmount / installment count */
                      (() => {
                        const isHybrid = viewDetailsOrder.paymentType === "hybrid"
                        const installmentCount = isHybrid
                          ? (viewDetailsOrder.remainingInstallmentMonths || viewDetailsOrder.installments || 3)
                          : (viewDetailsOrder.installments || 3)
                        const scheduleAmount = isHybrid
                          ? (viewDetailsOrder.remainingAmount || viewDetailsOrder.total - Number(viewDetailsOrder.downPaymentAmount || 0))
                          : viewDetailsOrder.total
                        const monthlyAmt = viewDetailsOrder.monthlyAmount > 0
                          ? viewDetailsOrder.monthlyAmount
                          : scheduleAmount / installmentCount
                        const startDate = viewDetailsOrder.paymentStartDate
                        return Array.from({ length: installmentCount }).map((_, i) => {
                          const dueDate = startDate
                            ? formatDate(new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + i)), language)
                            : null
                          return (
                            <div key={i} className="flex justify-between p-3 bg-blue-50 border border-blue-200 rounded">
                              <div>
                                <span>{fill(t("po.installment-of"), { n: i + 1, count: installmentCount })}</span>
                                {dueDate && <p className="text-xs text-muted-foreground">{fill(t("po.due-date"), { date: dueDate })}</p>}
                              </div>
                              <span className="font-medium text-blue-700"><Money value={monthlyAmt} /> {t("common.egp-2")}</span>
                            </div>
                          )
                        })
                      })()
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetailsModal(false)}>
                {t("close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>{t("po.reject-title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">{t("permit.rejection-reason")}</label>
                <textarea
                  className="w-full border rounded px-3 py-2 mt-1 min-h-[100px]"
                  placeholder={t("po.rejection-placeholder")}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleReject} variant="destructive">
                  {t("po.reject-po")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRejectModal(false)
                    setRejectingOrderId(null)
                    setRejectionReason("")
                  }}
                >
                  {t("cancel")}
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
              <CardTitle>{t("po.finalize-title")}</CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                {t("po.finalize-description")}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedPOObject && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="font-semibold text-sm">{fill(t("po.po-colon"), { number: selectedPOObject.poNumber })}</h4>
                    <span className="text-sm text-muted-foreground">
                      {t("common.supplier")} {suppliers.find((s) => s.id === selectedPOObject.supplierId)?.name || t("common.unknown")}
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
                      <span className="text-sm font-medium">{t("po.global-allocation")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={perProductTaxMode}
                        onChange={() => setPerProductTaxMode(true)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium">{t("po.per-product-allocation")}</span>
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
                                {t("common.qty-2")} {item.quantity} × {currencyLabel(selectedPOObject.currency)}{" "}
                                <Money value={Number(item.unitPrice)} />
                              </p>
                            </div>
                            <p className="font-semibold text-sm">
                              {currencyLabel(selectedPOObject.currency)} <Money value={Number(item.total)} />
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t">
                        <span className="font-medium">{t("po.subtotal-before-tax")}</span>
                        <span className="font-bold">
                          {currencyLabel(selectedPOObject.currency)} <Money value={Number(selectedPOObject.total)} />
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">
                            {fill(t("po.tax-amount-currency"), { currency: currencyLabel(selectedPOObject?.currency) })}
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
                            {fill(t("po.other-costs-currency"), { currency: currencyLabel(selectedPOObject?.currency) })}
                          </label>
                          <Input
                            type="number"
                            value={otherCosts}
                            onChange={(e) => setOtherCosts(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            className="mt-1"
                          />
                          <p className="text-xs text-muted-foreground mt-1">{t("po.shipping-customs")}</p>
                        </div>
                      </div>

                      <div className="bg-muted p-3 rounded-lg space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("po.additional-costs")}</span>
                          <span>
                            {currencyLabel(selectedPOObject?.currency)}{" "}
                            <Money value={(Number(taxAmount) || 0) + (Number(otherCosts) || 0)} />
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-lg pt-2 border-t">
                          <span>{t("po.total-landed-cost")}</span>
                          <span>
                            {currencyLabel(selectedPOObject?.currency)}{" "}
                            <Money
                              value={(selectedPOObject?.total || 0) + (Number(taxAmount) || 0) + (Number(otherCosts) || 0)}
                            />
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  {perProductTaxMode && (
                    <>
                      <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-4 gap-2 bg-muted p-2 font-semibold text-sm sticky top-0">
                          <div>{t("field.product")}</div>
                          <div className="text-end">{t("field.subtotal")}</div>
                          <div className="text-end">{t("po.tax")}</div>
                          <div className="text-end">{t("po.other-costs")}</div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {selectedPOObject.items?.map((item: any, index: number) => (
                            <div
                              key={item.id || index}
                              className="grid grid-cols-4 gap-2 p-2 border-b hover:bg-muted/50 items-center"
                            >
                              <div className="text-sm font-medium truncate">{item.productName}</div>
                              <div className="text-end text-sm">
                                <Money value={Number(item.total)} /> {currencyLabel(selectedPOObject?.currency)}
                              </div>
                              <div>
                                <Input
                                  type="number"
                                  placeholder={t("po.tax")}
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
                                  placeholder={t("po.costs")}
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
                          <span className="text-muted-foreground">{t("po.total-tax-allocated")}</span>
                          <span>
                            {currencyLabel(selectedPOObject?.currency)}{" "}
                            <Money
                              value={Object.values(productTaxes).reduce((sum, item) => sum + (Number(item.tax) || 0), 0)}
                            />
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("po.total-other-costs")}</span>
                          <span>
                            {currencyLabel(selectedPOObject?.currency)}{" "}
                            <Money
                              value={Object.values(productTaxes).reduce((sum, item) => sum + (Number(item.otherCosts) || 0), 0)}
                            />
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-lg pt-2 border-t">
                          <span>{t("po.grand-total")}</span>
                          <span>
                            {currencyLabel(selectedPOObject?.currency)}{" "}
                            <Money
                              value={
                                (selectedPOObject?.total || 0) +
                                Object.values(productTaxes).reduce((sum, item) => sum + (Number(item.tax) || 0), 0) +
                                Object.values(productTaxes).reduce((sum, item) => sum + (Number(item.otherCosts) || 0), 0)
                              }
                            />
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleFinalizeCost} disabled={finalizingCost} className="flex-1">
                  {finalizingCost ? t("po.finalizing") : t("po.finalize-cost")}
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
                  {t("cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
