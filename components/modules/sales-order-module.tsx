"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppContext } from "@/lib/app-context"
import { getSalesInsights } from "@/lib/ai-utils"
import { getCitiesForCountry } from "@/lib/countries-data"
import { ReportGenerator } from "@/components/report-generator"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import type {
  SalesOrder,
  UserRole,
  Customer,
  PaymentType,
  PaymentDetails,
  SOItem,
  SOType,
  ItemCategory,
  DeliveryPermit,
} from "@/lib/types"
import type { PaymentScheduleEntry } from "@/components/payment/payment-schedule-builder"
import {
  Eye,
  Plus,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Target,
  Search,
  Settings,
  Wrench,
  FileText,
  Printer,
  CheckCircle,
  PackageX,
  Pencil,
  ChevronDown,
} from "lucide-react"
import {
  PaymentTypeSelector,
  InstallmentFields,
  ChequeFields,
  HybridFields,
} from "@/components/payment"
import { DiscountFields, calculateDiscount, type DiscountType } from "@/components/discount"
import { OrderSummaryCard } from "@/components/order-summary-card"
import { Badge } from "@/components/ui/badge"
import { SOTypeSelector, SOTypeBadge } from "@/components/so-type"
import { Label } from "@/components/ui/label"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DeliveryPermitCard, PermitStatusBadge } from "@/components/delivery-permit"
import { QuotationRequestUploadWidget } from "@/components/sales-order/quotation-request-upload-widget"
import { SalesOrderMaintenanceTab } from "@/components/sales-order/maintenance-tab"
import { MaintenanceApprovalTab } from "@/components/sales/maintenance-approval-tab"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { EditApprovedOrderDialog } from "@/components/sales-order/edit-approved-order-dialog"
import { toSalesOrderPaymentTerms } from "@/lib/payment-type"
import { isPlannedPermit } from "@/lib/dp-planned"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { ErpTable, NumHead, NumCell, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { StatusBadge } from "@/components/erp/status-badge"
import { ApprovalSteps } from "@/components/erp/approval-steps"
import { Money } from "@/components/erp/money"
import { formatDate, formatMoney } from "@/lib/format"

// Declare SalesOrderModuleProps type
type SalesOrderModuleProps = {
  userRole: UserRole
  // Rendered inside another screen's page header: skip our own header and keep only the actions.
  embedded?: boolean
}

export function SalesOrderModule({ userRole, embedded = false }: SalesOrderModuleProps) {
  const { t, formatNumber, language } = useI18n()
  const {
    salesOrders,
    setSalesOrders,
    inventory,
    customerInvoices,
    setCustomerInvoices,
    updateInventoryQuantity,
    customers,
    products,
    warehouses,
    prepaidBalance,
    setPrepaidBalance,
    addSalesOrder,
    updateSalesOrder,
    addCustomerInvoice,
    addCustomer, // Added addCustomer from useAppContext
    addLostSale,
    loadData,
    refreshSalesOrders, // Use specific refresh function instead of refreshData
    refreshInventory,
  } = useAppContext()

  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null)
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [aiInsights, setAiInsights] = useState<any>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showAiInsights, setShowAiInsights] = useState(false)

  const [showPendingOrdersDialog, setShowPendingOrdersDialog] = useState(false)
  const [pendingReportsCount, setPendingReportsCount] = useState(0)

  // Fetch pending maintenance report count
  useEffect(() => {
    async function fetchPendingCount() {
      try {
        const res = await fetch("/api/maintenance/reports")
        if (res.ok) {
          const allReports = await res.json()
          const onHoldReports = allReports.filter((r: any) => {
            const woStatus = r.work_order?.status || r.status
            return woStatus === "on_hold"
          })
          setPendingReportsCount(onHoldReports.length)
        }
      } catch { /* silent */ }
    }
    fetchPendingCount()
  }, [selectedOrder])

  // Force fresh inventory fetch when form opens to get latest warehouse data
  useEffect(() => {
    if (selectedOrder) {
      refreshInventory()
    }
  }, [selectedOrder, refreshInventory])

  const [soTypeFilter, setSoTypeFilter] = useState<SOType | "ALL">("ALL")

  const [showCustomerForm, setShowCustomerForm] = useState(false) // Keep this state for inline form
  const [customerFormData, setCustomerFormData] = useState({
    name: "",
    email: "",
    countryCode: "+20",
    phone: "",
    address: "",
    country: "Egypt",
    city: "",
  })
  const [availableCities, setAvailableCities] = useState<string[]>(getCitiesForCountry("Egypt"))

  const handleCountryChange = (country: string) => {
    setCustomerFormData({ ...customerFormData, country, city: "" })
    setAvailableCities(getCitiesForCountry(country))
  }

  const handleCreateCustomer = async () => {
    if (!customerFormData.name || !customerFormData.email || !customerFormData.phone) {
      alert(t("common.please-fill-in-all-required"))
      return
    }

    const newCustomer: Customer = {
      id: Date.now().toString(),
      name: customerFormData.name,
      email: customerFormData.email,
      countryCode: customerFormData.countryCode,
      phone: customerFormData.phone,
      address: customerFormData.address,
      country: customerFormData.country,
      city: customerFormData.city,
      createdDate: new Date().toISOString().split("T")[0],
      status: "active",
    }

    try {
      await addCustomer(newCustomer)
      setCustomerFormData({
        name: "",
        email: "",
        countryCode: "+20",
        phone: "",
        address: "",
        country: "Egypt",
        city: "",
      })
      setShowCustomerForm(false)
      alert(t("so.customer-created-successfully"))
    } catch (error) {
      console.error("Error creating customer:", error)
      alert(t("so.failed-to-create-customer-please"))
    }
  }

  const [discountType, setDiscountType] = useState<DiscountType>("none")
  const [discountValue, setDiscountValue] = useState<number>(0)

  const [soType, setSoType] = useState<SOType>("EQUIPMENT")

  const [formData, setFormData] = useState({
    customerId: "",
    quotationRequestNumber: "", // Customer's quotation request reference number
    departmentName: "", // Department receiving the order
    receiverName: "", // Person who will receive the order
    deliveryDate: "",
    deliveryAddress: "",
    deliveryContactName: "",
    deliveryContactPhone: "",
    paymentTerms: "prepaid" as "prepaid" | "installments",
    installments: 6,
    notes: "",
  orderDate: new Date().toISOString().split("T")[0], // Added orderDate to formData
  })

  const handleCustomerChange = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId)
    setFormData((prev) => ({
      ...prev,
      customerId,
      deliveryAddress: customer?.address || "",
      deliveryContactName: customer?.name || "",
      deliveryContactPhone: customer?.phone || "",
    }))
  }

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
    paymentStartDate: new Date().toISOString().split("T")[0],
    downPaymentDueDate: new Date().toISOString().split("T")[0],
  })

  const handlePaymentDetailChange = (field: string, value: string | number) => {
    setPaymentDetails((prev) => {
      const updated = {
        ...prev,
        [field]: value,
      }
      return updated
    })
  }

  const [equipmentItems, setEquipmentItems] = useState<
    Array<{ productId: string; quantity: string; unitPrice: string }>
  >([])
  const [maintenanceItems, setMaintenanceItems] = useState<
    Array<{ productId: string; quantity: string; unitPrice: string }>
  >([])
  const [orderItems, setOrderItems] = useState<
    Array<{
      productId: string
      quantity: string
      unitPrice: string
      costPrice?: string
      markupPercent?: string
      warehouseId?: string
      item_type?: "stock" | "outsourced"
      outsourced_name?: string
      outsourced_description?: string
      outsourced_unit?: string
      supplier_name?: string
    }>
  >([])
  // const [monthsPaid, setMonthsPaid] = useState<number>(0) // No longer needed here, managed within payment logic

  // State for selected customer in customer tab
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null)

  // Find the state declarations section (around line 160-180)
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [linkingSoId, setLinkingSoId] = useState<number | null>(null)
  const [selectedDpId, setSelectedDpId] = useState<string>("")

  const [scheduleMode, setScheduleMode] = useState<"AUTO" | "MANUAL">("AUTO")
  const [scheduleEntries, setScheduleEntries] = useState<PaymentScheduleEntry[]>([])
  
  // VAT settings (14% is standard in Egypt)
  const [vatEnabled, setVatEnabled] = useState(true)
  const VAT_RATE = 0.14 // 14% VAT

  const [qrData, setQrData] = useState<{
    qrNumber: string
    fileUrl: string
  } | null>(null)

  // ADDED STATES FOR CREATE DP DIALOG
  const [existingDPsForSO, setExistingDPsForSO] = useState<any[]>([])
  const [createDPDialogOpen, setCreateDPDialogOpen] = useState(false)
  const [selectedSOForDP, setSelectedSOForDP] = useState<any>(null) // Use any for now, replace with SalesOrder type later if possible
  const [dpDeliveryInfo, setDpDeliveryInfo] = useState({
    recipientName: "",
    recipientPhone: "",
    deliveryAddress: "",
  })

  const handleQRUploadComplete = (data: { qrNumber: string; fileUrl: string }) => {
    setQrData(data)
  }

  const fetchAiInsights = async () => {
    if (salesOrders.length === 0) {
      alert(t("so.no-sales-data-to-analyze"))
      return
    }

    setIsAnalyzing(true)
    try {
      const insights = await getSalesInsights({
        salesOrders,
        customers,
        products,
        inventory,
      })
      setAiInsights(insights)
      setShowAiInsights(true)
    } catch (error) {
      console.error("Failed to fetch AI insights:", error)
      alert(t("so.failed-to-generate-ai-insights"))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "rising":
        return <TrendingUp className="w-4 h-4 text-green-700" />
      case "declining":
        return <TrendingDown className="w-4 h-4 text-red-700" />
      default:
        return <Target className="w-4 h-4 text-blue-600" />
    }
  }

  const getCustomerName = (customerId: string) => {
    return customers.find((c) => c.id === customerId)?.name || "Unknown"
  }

  // Overall delivery-fulfillment status for a Sales Order, always one of exactly
  // three states: no delivery permits created yet, some created but the order
  // isn't fully delivered, or every delivery permit has been fully processed.
  const getSODeliveryStatus = (order: any): "not_delivered" | "partially_delivered" | "delivered" => {
  const deliveryPermits = order.deliveryPermits || order.delivery_permits || []
  if (deliveryPermits.length === 0) return "not_delivered"
  if (order.status === "delivered") return "delivered"
  return "partially_delivered"
  }

  // Opens the Missing Items report (items not yet delivered to the customer). The route reads live data on each
  // request, so re-clicking always reflects the current state of the order.
  // `hideCost` is chosen from the Missing Items menu: it removes the Unit Cost column and the cost total.
  const handlePrintMissingItems = (order: any, hideUnitCost: boolean) => {
    const soIdValue = order.so_id || order.id
    const hideCost = hideUnitCost ? "&hideCost=1" : ""
    const url = `${window.location.origin}/api/sales-orders/missing-items-pdf?soId=${soIdValue}${hideCost}`
    window.open(url, "_blank")
  }

  // Opens the server-rendered sales order print. It reads the saved order from the database, so it is correct for
  // every status (draft included) and never depends on what this screen currently holds.
  const handlePrintSalesOrder = (order: any) => {
    const soIdValue = order.so_id || order.id
    window.open(`${window.location.origin}/api/sales-orders/print?soId=${soIdValue}`, "_blank")
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

  const getPaymentProgress = (order: SalesOrder) => {
    if (!order.installments) return { monthsPaid: 0, monthsRemaining: 0 }
    if (!order.orderDate) return { monthsPaid: 0, monthsRemaining: order.installments }
    const createdDate = new Date(order.orderDate)
    if (isNaN(createdDate.getTime())) return { monthsPaid: 0, monthsRemaining: order.installments }
    const today = new Date()

    const monthsElapsed =
      (today.getFullYear() - createdDate.getFullYear()) * 12 + (today.getMonth() - createdDate.getMonth())

    const monthsPaid = Math.max(0, Math.min(monthsElapsed, order.installments))
    const monthsRemaining = Math.max(0, order.installments - monthsPaid)
    return { monthsPaid, monthsRemaining }
  }

  const getRowBackgroundColor = (dueDate: string, status: string): string => {
    if (status === "approved") return ""
    const daysUntilDue = getDaysUntilDue(dueDate)
    if (daysUntilDue < 0) return "bg-red-50"
    if (daysUntilDue <= 10) return "bg-yellow-50"
    return ""
  }

  const createCustomerInvoice = async (order: SalesOrder) => {
    // NOTE: Invoice creation removed from here.
    // Accountant must manually create invoices through the Accounts Receivable module
    // after delivery permits are approved using "Create from DPs" button.
  }

  const handleApprove = async (id: string) => {
    const order = salesOrders.find((o) => o.id === id)
    if (order) {

      // This function should not be called anymore as CEO doesn't approve SOs in new workflow
      alert(t("so.sales-orders-are-now-approved"))
    }
  }

  const handleAddItem = () => {
    setOrderItems([...orderItems, { productId: "", quantity: "", unitPrice: "" }])
  }

  const handleAddEquipmentItem = () => {
    setEquipmentItems([...equipmentItems, { productId: "", quantity: "", unitPrice: "" }])
  }

  const handleAddMaintenanceItem = () => {
    setMaintenanceItems([...maintenanceItems, { productId: "", quantity: "", unitPrice: "" }])
  }

  const handleRemoveItem = (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index))
  }

  const handleRemoveEquipmentItem = (index: number) => {
    setEquipmentItems(equipmentItems.filter((_, i) => i !== index))
  }

  const handleRemoveMaintenanceItem = (index: number) => {
    setMaintenanceItems(maintenanceItems.filter((_, i) => i !== index))
  }

  const calculateSubtotal = () => {
    if (soType === "MIXED") {
      const equipmentTotal = equipmentItems.reduce((sum, item) => {
        const qty = Number.parseFloat(item.quantity) || 0
        const price = Number.parseFloat(item.unitPrice) || 0
        return sum + qty * price
      }, 0)
      const maintenanceTotal = maintenanceItems.reduce((sum, item) => {
        const qty = Number.parseFloat(item.quantity) || 0
        const price = Number.parseFloat(item.unitPrice) || 0
        return sum + qty * price
      }, 0)
      return equipmentTotal + maintenanceTotal
    }
    return orderItems.reduce((sum, item) => {
      const qty = Number.parseFloat(item.quantity) || 0
      const price = Number.parseFloat(item.unitPrice) || 0
      return sum + qty * price
    }, 0)
  }

  const subtotal = calculateSubtotal()

  const { discountAmount, netTotal } = calculateDiscount(subtotal, discountType, discountValue)

  // Keep legacy orderTotal for backward compatibility
  const orderTotal = netTotal

  const updatePaymentCalculations = (type: PaymentType, total: number) => {
    if (type === "installments") {
      const months = paymentDetails.installmentMonths || 6
      setPaymentDetails((prev) => ({
        ...prev,
        monthlyAmount: total / months,
      }))
    } else if (type === "cheque") {
      setPaymentDetails((prev) => ({
        ...prev,
        chequeAmount: prev.chequeAmount || total,
      }))
    } else if (type === "hybrid") {
      const currentDownAmount = paymentDetails.downPaymentAmount
      const hasManualAmount = currentDownAmount && currentDownAmount > 0

      // If user has manually set the amount, use it; otherwise calculate from percent
      const downAmount = hasManualAmount ? currentDownAmount : (paymentDetails.downPaymentPercent / 100) * total
      const remaining = total - downAmount
      const months = paymentDetails.remainingInstallmentMonths || 6
      setPaymentDetails((prev) => ({
        ...prev,
        // Only update downPaymentAmount if not manually set
        ...(hasManualAmount ? {} : { downPaymentAmount: downAmount }),
        remainingAmount: remaining,
        monthlyAmount: remaining / months,
      }))
    }
  }

  const handlePaymentTypeChange = (type: PaymentType) => {
    setPaymentType(type)
    updatePaymentCalculations(type, orderTotal)
  }

  // const handlePaymentDetailChange = (field: string, value: string | number) => {
  //   setPaymentDetails((prev) => ({
  //     ...prev,
  //     [field]: value,
  //   }))
  // }

  const resetForm = () => {
    setFormData({
      customerId: "",
      quotationRequestNumber: "",
      departmentName: "",
      receiverName: "",
      deliveryDate: "",
      deliveryAddress: "",
      deliveryContactName: "",
      deliveryContactPhone: "",
      paymentTerms: "prepaid",
      installments: 6,
      notes: "",
      orderDate: new Date().toISOString().split("T")[0], // Reset orderDate
    })
    setOrderItems([])
    setEquipmentItems([])
    setMaintenanceItems([])
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
      paymentStartDate: new Date().toISOString().split("T")[0],
      downPaymentDueDate: new Date().toISOString().split("T")[0],
    })
    setDiscountType("none")
    setDiscountValue(0)
    setSoType("EQUIPMENT")
    setScheduleMode("AUTO") // Reset schedule mode
    setScheduleEntries([]) // Reset schedule entries
    setQrData(null)
  }

  const [isSubmitting, setIsSubmitting] = useState(false) // State to manage submission status

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation() // Prevent event bubbling to avoid duplicate submissions

    if (isSubmitting) {
      return
    }
    setIsSubmitting(true)

    if (!formData.customerId) {
      alert(t("error.select-customer"))
      setIsSubmitting(false)
      return
    }

    // Combine all items based on SO type
    const currentOrderItems: SOItem[] = []
    if (soType === "MIXED") {
      const combinedItems = [...equipmentItems, ...maintenanceItems]
      for (const item of combinedItems) {
        if (!item.productId) {
          alert(t("so.please-select-a-product-for"))
          setIsSubmitting(false)
          return
        }

        const quantity = Number.parseInt(item.quantity)
        const unitPrice = Number.parseFloat(item.unitPrice)

        if (!item.quantity || isNaN(quantity) || quantity <= 0) {
          alert(t("so.quantity-must-be-a-positive"))
          setIsSubmitting(false)
          return
        }

        if (!item.unitPrice || isNaN(unitPrice) || unitPrice < 0) {
          alert(t("so.unit-price-cannot-be-negative"))
          setIsSubmitting(false)
          return
        }

        const availableStock = inventory.find((inv) => inv.productId === item.productId)?.quantity ?? null
        if (availableStock !== null && quantity > availableStock) {
          alert(fill(t("so.only-in-stock-for-this"), { availableStock }))
          setIsSubmitting(false)
          return
        }

        const product = products.find((p) => p.id === item.productId)
        const itemCategory: ItemCategory = equipmentItems.some((eqItem) => eqItem.productId === item.productId)
          ? "EQUIPMENT"
          : "MAINTENANCE_PARTS"

        currentOrderItems.push({
          productId: item.productId,
          productName: product?.productName || "Unknown",
          quantity,
          unitPrice,
          total: quantity * unitPrice,
          itemCategory, // Assign item category
        })
      }
    } else {
      for (const item of orderItems) {
        // Treat items without item_type as stock items (default behavior)
        if (!item.item_type || item.item_type === "stock") {
          if (!item.productId || item.productId.trim() === "") {
            alert(t("so.please-select-a-product-for-2"))
            setIsSubmitting(false)
            return
          }
          const quantity = Number.parseInt(item.quantity)
          const unitPrice = Number.parseFloat(item.unitPrice)

          if (!item.quantity || isNaN(quantity) || quantity <= 0) {
            alert(t("so.quantity-must-be-a-positive-2"))
            setIsSubmitting(false)
            return
          }

          if (!item.unitPrice || isNaN(unitPrice) || unitPrice < 0) {
            alert(t("so.unit-price-cannot-be-negative-2"))
            setIsSubmitting(false)
            return
          }

          const warehouseId = item.warehouseId ? Number.parseInt(item.warehouseId) : null
          const availableStock =
            inventory.find((inv) => inv.productId === item.productId && inv.warehouseId === warehouseId)
              ?.quantity ?? null
          if (availableStock !== null && quantity > availableStock) {
            alert(fill(t("so.only-in-stock-for-this"), { availableStock }))
            setIsSubmitting(false)
            return
          }

          const product = products.find((p) => p.id === item.productId)
          currentOrderItems.push({
            productId: item.productId,
            productName: product?.productName || "Unknown",
            quantity,
            unitPrice,
            total: quantity * unitPrice,
            itemCategory: soType, // Assuming SO type maps to category for non-MIXED
          })
        } else if (item.item_type === "outsourced") {
          if (!item.outsourced_name) {
            alert(t("so.please-provide-a-name-for"))
            setIsSubmitting(false)
            return
          }
          const quantity = Number.parseInt(item.quantity)
          const unitPrice = Number.parseFloat(item.unitPrice)

          if (!item.quantity || isNaN(quantity) || quantity <= 0) {
            alert(t("so.quantity-must-be-a-positive-3"))
            setIsSubmitting(false)
            return
          }

          if (!item.unitPrice || isNaN(unitPrice) || unitPrice < 0) {
            alert(t("so.unit-price-cannot-be-negative-3"))
            setIsSubmitting(false)
            return
          }

          currentOrderItems.push({
            productId: "", // No specific product ID for outsourced
            productName: item.outsourced_name,
            quantity,
            unitPrice,
            total: quantity * unitPrice,
            itemCategory: "OUTSOURCED", // Custom category for outsourced items
            outsourced_unit: item.outsourced_unit,
            outsourced_description: item.outsourced_description,
            supplier_name: item.supplier_name, // Internal-only supplier reference
          })
        }
      }
    }

    // This prevents race conditions where inventory is deducted before order is confirmed

    // Calculate pre-tax subtotal from items
    const itemsSubtotal = currentOrderItems.reduce((sum, item) => sum + item.total, 0)
    
    const { discountAmount: finalDiscountAmount, netTotal: subtotalAfterDiscount } = calculateDiscount(
      itemsSubtotal,
      discountType,
      discountValue,
    )
    
    // Calculate VAT
    const vatAmount = vatEnabled ? subtotalAfterDiscount * VAT_RATE : 0
    const finalNetTotal = subtotalAfterDiscount + vatAmount

    const finalPaymentDetails: PaymentDetails = {
      paymentType,
      ...(paymentType === "installments" && {
        installmentMonths: paymentDetails.installmentMonths,
        monthlyAmount: finalNetTotal / (paymentDetails.installmentMonths || 6),
        paymentStartDate: paymentDetails.paymentStartDate, // Pass paymentStartDate
      }),
      ...(paymentType === "cheque" && {
        chequeNumber: paymentDetails.chequeNumber,
        chequeBankName: paymentDetails.chequeBankName,
        chequeDueDate: paymentDetails.chequeDueDate,
        chequeAmount: paymentDetails.chequeAmount || finalNetTotal,
        chequeNotes: paymentDetails.chequeNotes,
      }),
      ...(paymentType === "hybrid" && {
        downPaymentType: paymentDetails.downPaymentType,
        downPaymentAmount: paymentDetails.downPaymentAmount,
        downPaymentPercent: paymentDetails.downPaymentPercent,
        remainingAmount: paymentDetails.remainingAmount,
        remainingInstallmentMonths: paymentDetails.remainingInstallmentMonths,
        monthlyAmount: paymentDetails.monthlyAmount,
        downPaymentDueDate: paymentDetails.downPaymentDueDate, // Include downPaymentDueDate
        paymentStartDate: paymentDetails.paymentStartDate, // Include paymentStartDate for hybrid
        ...(paymentDetails.downPaymentType === "cheque" && {
          downPaymentChequeNumber: paymentDetails.downPaymentChequeNumber,
          downPaymentChequeBank: paymentDetails.downPaymentChequeBank,
          downPaymentChequeDueDate: paymentDetails.downPaymentChequeDueDate,
        }),
      }),
    }

    // Look for the newOrder object creation (around line 620-680)

  const newOrder: SalesOrder = {
    id: Date.now().toString(),
    soNumber: `SO-2025-${String(salesOrders.length + 1).padStart(3, "0")}`,
    customerId: formData.customerId,
    warehouseId: null, // No longer using global warehouse
    quotationRequestNumber: formData.quotationRequestNumber || null,
    departmentName: formData.departmentName || null,
    receiverName: formData.receiverName || null,
    orderDate: formData.orderDate || new Date().toISOString().split("T")[0], // Use orderDate from formData
    deliveryDate: formData.deliveryDate || new Date().toISOString().split("T")[0],
    deliveryAddress: formData.deliveryAddress,
    deliveryContactName: formData.deliveryContactName,
    deliveryContactPhone: formData.deliveryContactPhone,
      items: currentOrderItems,
      status: "draft", // Create as quotation first - requires approval to become active
      subtotal: subtotalAfterDiscount, // Subtotal is AFTER discount but BEFORE VAT
      discountType,
      discountValue,
      discountAmount: finalDiscountAmount,
      total: finalNetTotal, // Total includes VAT
      netTotal: finalNetTotal, // Explicit net total field
      notes: formData.notes,
      paymentType,
      paymentTerms: toSalesOrderPaymentTerms(paymentType), // cheque is a single payment -> "prepaid" (same as quotation conversion)
      installments:
        paymentType === "installments"
          ? paymentDetails.installmentMonths
          : paymentType === "hybrid"
            ? paymentDetails.remainingInstallmentMonths
            : undefined,
      paymentDetails: finalPaymentDetails,
      soType: soType, // Add SO type to the order
      scheduleEntries: paymentType === "hybrid" && scheduleMode === "MANUAL" ? scheduleEntries : undefined,
      scheduleMode: paymentType === "hybrid" ? scheduleMode : "AUTO",
      downPaymentDueDate: paymentType === "hybrid" ? paymentDetails.downPaymentDueDate : undefined,
      quotation_request_number: qrData?.qrNumber || formData.quotationRequestNumber || null,
      quotation_request_file_path: qrData?.fileUrl || null,
      quotation_request_file_name: qrData?.qrNumber ? `QR-${qrData.qrNumber}.pdf` : null,
      department_name: formData.departmentName || null,
      receiver_name: formData.receiverName || null,
    }


    // We only update local state AFTER the API succeeds

    try {
      const createdOrder = await addSalesOrder(newOrder)
      if (createdOrder) {
        // The API has already deducted inventory in the database
        try {
          for (const item of newOrder.items) {
            // Skip inventory updates for outsourced items (no productId)
            if (!item.productId || item.productId === "") {
              continue
            }
            
            // Find the corresponding orderItem to get the warehouseId
            const orderItem = orderItems.find(oi => oi.productId === item.productId)
            await updateInventoryQuantity(item.productId, -item.quantity, orderItem?.warehouseId)
          }
        } catch (invError) {
          console.error("Error updating local inventory state:", invError)
          // Note: The API already deducted inventory, this is just for local state sync
        }

        resetForm()
        await refreshSalesOrders()
        await refreshInventory()
      }
    } catch (error: any) {
      console.error("Error creating sales order:", error)
      alert(error.message || t("error.create-failed"))
    } finally {
      setIsSubmitting(false) // Always reset submitting state
    }
  }

  const handlePrintInvoice = (order: SalesOrder) => {
    const invoice = customerInvoices.find((inv) => inv.soId === order.id)
    if (!invoice) {
      alert(t("so.no-invoice-found-for-this"))
      return
    }

    const invoiceId = invoice.id || invoice.invoice_id
    if (!invoiceId) {
      alert(t("so.invoice-id-not-found"))
      return
    }

    const pdfUrl = `/api/invoices/ar/${invoiceId}/pdf`
    window.open(pdfUrl, "_blank")
  }

  const canApproveSO = userRole === "ceo" || userRole === "admin"

  // Sales reps can correct an order right after accountant approval (e.g. the accountant
  // only approved some of the requested items). Once a delivery permit exists, downstream
  // fulfillment has already started against those items, so editing is blocked from here.
  const canEditRole = userRole === "sales-rep" || userRole === "admin"
  // After a return the order stays editable (Batch 2) so an item can be exchanged without a new sales order. The
  // server keeps delivered items as history and only accepts safe edits (lib/so-edit.ts).
  const hasReturns = (order: SalesOrder) => Number((order as any).returnedQuantity || 0) > 0
  const RETURN_EDITABLE_STATUSES = ["accountant_approved", "ready_for_delivery", "shipped", "delivered"]
  const showEditButton = (order: SalesOrder) =>
    canEditRole && (order.status === "accountant_approved" || (hasReturns(order) && RETURN_EDITABLE_STATUSES.includes(order.status)))
  const canEditApprovedOrder = (order: SalesOrder) =>
    canEditRole &&
    ((order.status === "accountant_approved" && !(order as any).deliveryPermits?.length) ||
      (hasReturns(order) && RETURN_EDITABLE_STATUSES.includes(order.status)))

  const pendingShipmentOrders = salesOrders.filter((order) => order.status === "ready_for_delivery")
  const shippedOrders = salesOrders.filter((order) => order.status === "shipped")
  const otherOrders = salesOrders.filter((order) => order.status !== "ready_for_delivery" && order.status !== "shipped")

  const getCustomerOrders = (customerId: string) => {
    return salesOrders.filter((so) => so.customerId === customerId)
  }

  const getCustomerTotalSpent = (customerId: string) => {
    return salesOrders.filter((so) => so.customerId === customerId).reduce((sum, so) => sum + so.total, 0)
  }

  const filteredOrders = salesOrders.filter((order) => {
    const matchesSearch =
      order.soNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customers
        .find((c) => c.id === order.customerId)
        ?.name.toLowerCase()
        .includes(searchQuery.toLowerCase())
    const matchesType = soTypeFilter === "ALL" || order.soType === soTypeFilter
    return matchesSearch && matchesType
  })

  // Added state for searchTerm and setShowReportGenerator
  const [searchTerm, setSearchTerm] = useState("")
  const [showReportGenerator, setShowReportGenerator] = useState(false)

  // Filtered orders based on search term - this redeclares filteredOrders, fix this linting issue.
  const filteredOrdersBySearch = salesOrders.filter(
    (order) =>
      order.soNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getCustomerName(order.customerId).toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Helper function to get filtered orders, used for tabs
  const getFilteredOrders = (orders: SalesOrder[]) => {
    return orders.filter(
      (order) =>
        order.soNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getCustomerName(order.customerId).toLowerCase().includes(searchTerm.toLowerCase()),
    )
  }

  const renderItemsSection = () => {
    if (soType === "MIXED") {
      return (
        <div className="space-y-6">
          {/* Equipment Section */}
          <div className="border rounded-lg p-4 bg-blue-50/50">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-blue-800">{t("so-type.equipment-items")}</h3>
              </div>
              <Button
                size="sm"
                onClick={handleAddEquipmentItem}
                variant="outline"
                className="border-blue-300 bg-transparent"
              >
                <Plus className="w-4 h-4 me-2" />
                {t("action.add")}
              </Button>
            </div>
            <div className="space-y-3">
              {equipmentItems.map((item, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 items-end">
                  <select
                    className="border rounded px-3 py-2"
                    value={item.productId}
                    onChange={(e) => {
                      const newItems = [...equipmentItems]
                      newItems[index].productId = e.target.value
                      const selectedProduct = products.find((p) => p.id === e.target.value)
                      if (selectedProduct) {
                        newItems[index].unitPrice = selectedProduct.unitPrice.toString()
                      }
                      setEquipmentItems(newItems)
                    }}
                  >
                    <option value="">{t("field.product")}</option>
                    {products
                      .filter((p) => {
                        const inventoryItem = inventory.find((inv) => inv.productId === p.id)
                        return inventoryItem && inventoryItem.quantity > 0
                      })
                      .map((p) => {
                        const inventoryItem = inventory.find((inv) => inv.productId === p.id)
                        const stock = inventoryItem?.quantity || 0
                        return (
                          <option key={p.id} value={p.id}>
                            {p.productName} ({t("field.stock")}: {stock})
                          </option>
                        )
                      })}
                  </select>
                  {(() => {
                    const equipmentStock = inventory.find((inv) => inv.productId === item.productId)?.quantity ?? null
                    return (
                      <div>
                        <Input
                          placeholder={t("field.quantity")}
                          type="number"
                          min="1"
                          max={equipmentStock ?? undefined}
                          value={item.quantity}
                          onChange={(e) => {
                            let nextValue = e.target.value
                            const parsed = Number.parseInt(nextValue, 10)
                            if (equipmentStock !== null && !isNaN(parsed) && parsed > equipmentStock) {
                              nextValue = String(equipmentStock)
                            }
                            const newItems = [...equipmentItems]
                            newItems[index].quantity = nextValue
                            setEquipmentItems(newItems)
                          }}
                        />
                        {equipmentStock !== null && (
                          <p className="text-xs text-muted-foreground mt-1">{equipmentStock} {t("common.in-stock")}</p>
                        )}
                      </div>
                    )
                  })()}
                  <Input
                    placeholder={t("field.unit-price")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => {
                      const newItems = [...equipmentItems]
                      newItems[index].unitPrice = e.target.value
                      setEquipmentItems(newItems)
                    }}
                  />
                  <Button size="sm" variant="destructive" onClick={() => handleRemoveEquipmentItem(index)}>
                    {t("action.remove-item")}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Maintenance Parts Section */}
          <div className="border rounded-lg p-4 bg-orange-50/50">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-orange-700" />
                <h3 className="font-semibold text-orange-800">{t("so-type.maintenance-items")}</h3>
              </div>
              <Button
                size="sm"
                onClick={handleAddMaintenanceItem}
                variant="outline"
                className="border-orange-300 bg-transparent"
              >
                <Plus className="w-4 h-4 me-2" />
                {t("action.add")}
              </Button>
            </div>
            <div className="space-y-3">
              {maintenanceItems.map((item, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 items-end">
                  <select
                    className="border rounded px-3 py-2"
                    value={item.productId}
                    onChange={(e) => {
                      const newItems = [...maintenanceItems]
                      newItems[index].productId = e.target.value
                      const selectedProduct = products.find((p) => p.id === e.target.value)
                      if (selectedProduct) {
                        newItems[index].unitPrice = selectedProduct.unitPrice.toString()
                      }
                      setMaintenanceItems(newItems)
                    }}
                  >
                    <option value="">{t("field.product")}</option>
                    {products
                      .filter((p) => {
                        const inventoryItem = inventory.find((inv) => inv.productId === p.id)
                        return inventoryItem && inventoryItem.quantity > 0
                      })
                      .map((p) => {
                        const inventoryItem = inventory.find((inv) => inv.productId === p.id)
                        const stock = inventoryItem?.quantity || 0
                        return (
                          <option key={p.id} value={p.id}>
                            {p.productName} ({t("field.stock")}: {stock})
                          </option>
                        )
                      })}
                  </select>
                  {(() => {
                    const maintenanceStock =
                      inventory.find((inv) => inv.productId === item.productId)?.quantity ?? null
                    return (
                      <div>
                        <Input
                          placeholder={t("field.quantity")}
                          type="number"
                          min="1"
                          max={maintenanceStock ?? undefined}
                          value={item.quantity}
                          onChange={(e) => {
                            let nextValue = e.target.value
                            const parsed = Number.parseInt(nextValue, 10)
                            if (maintenanceStock !== null && !isNaN(parsed) && parsed > maintenanceStock) {
                              nextValue = String(maintenanceStock)
                            }
                            const newItems = [...maintenanceItems]
                            newItems[index].quantity = nextValue
                            setMaintenanceItems(newItems)
                          }}
                        />
                        {maintenanceStock !== null && (
                          <p className="text-xs text-muted-foreground mt-1">{maintenanceStock} {t("common.in-stock")}</p>
                        )}
                      </div>
                    )
                  })()}
                  <Input
                    placeholder={t("field.unit-price")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => {
                      const newItems = [...maintenanceItems]
                      newItems[index].unitPrice = e.target.value
                      setMaintenanceItems(newItems)
                    }}
                  />
                  <Button size="sm" variant="destructive" onClick={() => handleRemoveMaintenanceItem(index)}>
                    {t("action.remove-item")}
                  </Button>
                </div>
              ))}
              {maintenanceItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">{t("message.no-items")}</p>
              )}
            </div>
          </div>
        </div>
      )
    }

    // Single item section for EQUIPMENT or MAINTENANCE_PARTS
    return (
      <div className="border rounded-lg p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">{t("field.items")}</h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setOrderItems([
                  ...orderItems,
                  {
                    productId: "",
                    quantity: "",
                    unitPrice: "",
                    item_type: "stock",
                  },
                ])
              }}
              variant="outline"
            >
              <Plus className="w-4 h-4 me-2" />
              {t("common.add-from-inventory")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOrderItems([
                  ...orderItems,
                  {
                    productId: "",
                    quantity: "",
                    unitPrice: "",
                    item_type: "outsourced",
                    outsourced_name: "",
                    outsourced_unit: "unit",
                  },
                ])
              }}
              variant="secondary"
            >
              <Plus className="w-4 h-4 me-2" />
              {t("common.add-outsourced-item")}
            </Button>
          </div>
        </div>

        {/* Render different UI based on item_type */}
        <div className="space-y-3">
          {orderItems.map((item, index) => {
            // Filter products based on selected warehouse for this item
            const selectedWarehouseId = item.warehouseId ? parseInt(item.warehouseId) : null
            
            const availableProducts = selectedWarehouseId
              ? products.filter(product => {
                  const inventoryItem = inventory.find(
                    inv => inv.productId === product.id && inv.warehouseId === selectedWarehouseId
                  )
                  return inventoryItem && inventoryItem.quantity > 0
                })
              : []
            
            return (
            <div key={index} className="border rounded-lg p-4 bg-gray-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{t("so.item-number")}{index + 1}</span>
                <Button size="sm" variant="destructive" onClick={() => handleRemoveItem(index)}>
                  {t("action.remove")}
                </Button>
              </div>
              
              {item.item_type === "outsourced" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-gray-600 mb-1">{t("common.item-name")}</Label>
                      <Input
                        placeholder={t("common.enter-item-name")}
                        value={item.outsourced_name || ""}
                        onChange={(e) => {
                          const newItems = [...orderItems]
                          newItems[index].outsourced_name = e.target.value
                          setOrderItems(newItems)
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1">{t("common.unit")}</Label>
                      <Input
                        placeholder={t("so.e-g-piece-kg")}
                        value={item.outsourced_unit || "unit"}
                        onChange={(e) => {
                          const newItems = [...orderItems]
                          newItems[index].outsourced_unit = e.target.value
                          setOrderItems(newItems)
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600 mb-1">{t("so.supplier-name-internal-only")}</Label>
                    <Input
                      placeholder={t("common.enter-supplier-name")}
                      value={item.supplier_name || ""}
                      onChange={(e) => {
                        const newItems = [...orderItems]
                        newItems[index].supplier_name = e.target.value
                        setOrderItems(newItems)
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-gray-600 mb-1">{t("so.warehouse-required")}</Label>
                      <select
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={item.warehouseId || ""}
                        onChange={(e) => {
                          const newItems = [...orderItems]
                          newItems[index].warehouseId = e.target.value
                          newItems[index].productId = "" // Reset product when warehouse changes
                          setOrderItems(newItems)
                        }}
                      >
                        <option value="">{t("warehouse.select-warehouse")}</option>
                        {(warehouses || []).map((wh: any) => (
                          <option key={wh.id} value={wh.id}>
                            {wh.name || fill(t("so.warehouse-number"), { id: wh.id })}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1">{t("common.product")}</Label>
                      <ProductSearchCombobox
                        products={products.map(p => ({
                          id: p.id,
                          productName: p.productName,
                          sku: p.sku
                        }))}
                        inventory={inventory.filter(inv => inv.warehouseId === selectedWarehouseId)}
                        warehouseId={item.warehouseId}
                        value={item.productId}
                        onSelect={(productId) => {
                          const newItems = [...orderItems]
                          newItems[index].productId = productId
                          const selectedProduct = products.find((p) => p.id === productId)
                          if (selectedProduct) {
                            newItems[index].costPrice = selectedProduct.unitPrice.toString()
                            newItems[index].unitPrice = selectedProduct.unitPrice.toString()
                            newItems[index].markupPercent = "0"
                          }
                          setOrderItems(newItems)
                        }}
                        disabled={!item.warehouseId}
                        placeholder={!item.warehouseId ? t("so.select-warehouse-first") : t("so.search-product-by-name-or")}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1">{t("quantity")}</Label>
                  {(() => {
                    const stockLimit =
                      item.item_type === "outsourced"
                        ? null
                        : inventory.find(
                            (inv) => inv.productId === item.productId && inv.warehouseId === selectedWarehouseId,
                          )?.quantity ?? null
                    return (
                      <>
                        <Input
                          type="number"
                          placeholder="0"
                          min="1"
                          max={stockLimit ?? undefined}
                          value={item.quantity}
                          onChange={(e) => {
                            let nextValue = e.target.value
                            const parsed = Number.parseInt(nextValue, 10)
                            if (stockLimit !== null && !isNaN(parsed) && parsed > stockLimit) {
                              nextValue = String(stockLimit)
                            }
                            const newItems = [...orderItems]
                            newItems[index].quantity = nextValue
                            setOrderItems(newItems)
                          }}
                        />
                        {stockLimit !== null && (
                          <p className="text-xs text-muted-foreground mt-1">{stockLimit} {t("common.in-stock")}</p>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div>
                  <Label className="text-xs text-gray-600 mb-1">{t("so.cost-price")}</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={item.costPrice || item.unitPrice}
                    className={item.item_type === "outsourced" ? "" : "bg-gray-100"}
                    readOnly={item.item_type !== "outsourced"}
                    onChange={(e) => {
                      if (item.item_type === "outsourced") {
                        const newItems = [...orderItems]
                        const costPrice = parseFloat(e.target.value) || 0
                        const markupPercent = parseFloat(newItems[index].markupPercent || "0") || 0
                        const sellingPrice = costPrice * (1 + markupPercent / 100)
                        newItems[index].costPrice = e.target.value
                        newItems[index].unitPrice = sellingPrice.toFixed(2)
                        setOrderItems(newItems)
                      }
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-600 mb-1">{t("so.markup")}</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={item.markupPercent || "0"}
                    onChange={(e) => {
                      const newItems = [...orderItems]
                      const markupPercent = parseFloat(e.target.value) || 0
                      const costPrice = parseFloat(newItems[index].costPrice || newItems[index].unitPrice) || 0
                      const sellingPrice = costPrice * (1 + markupPercent / 100)
                      newItems[index].markupPercent = e.target.value
                      newItems[index].unitPrice = sellingPrice.toFixed(2)
                      setOrderItems(newItems)
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-600 mb-1">{t("so.selling-price")}</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={item.unitPrice}
                    onChange={(e) => {
                      const newItems = [...orderItems]
                      const sellingPrice = parseFloat(e.target.value) || 0
                      const costPrice = parseFloat(newItems[index].costPrice || newItems[index].unitPrice) || 0
                      const markupPercent = costPrice > 0 ? ((sellingPrice - costPrice) / costPrice) * 100 : 0
                      newItems[index].unitPrice = e.target.value
                      newItems[index].markupPercent = markupPercent.toFixed(1)
                      setOrderItems(newItems)
                    }}
                  />
                </div>
              </div>
            </div>
            )
          })}
        </div>
      
        {/* Add Item Button */}
        <Button type="button" onClick={handleAddItem} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          {t("action.add-item")}
        </Button>
      </div>
    )
  }
  const pendingOrders = salesOrders.filter(
    (so) => so.status === "pending" || so.status === "pending_accountant" || so.status === "pending_ceo",
  )

  const [orderPermits, setOrderPermits] = useState<Record<string, DeliveryPermit>>({})
  const [isSubmittingDP, setIsSubmittingDP] = useState(false)

  useEffect(() => {
    const fetchPermits = async () => {
      try {
        const response = await fetch("/api/delivery-permits")
        if (response.ok) {
          const permits = await response.json()
          const permitsMap: Record<string, DeliveryPermit> = {}
          permits.forEach((permit: DeliveryPermit) => {
            if (permit.salesOrderId) {
              permitsMap[permit.salesOrderId] = permit
            }
          })
          setOrderPermits(permitsMap)
        }
      } catch (error) {
        console.error("Error fetching permits:", error)
      }
    }
    fetchPermits()
  }, [salesOrders])

  const getFulfillmentBadge = (order: SalesOrder) => {
    const permit = orderPermits[order.id]
    if (!permit) return null

    return <PermitStatusBadge status={permit.status} size="sm" />
  }

  // New states for Delivery Permit creation
  // const [showCreateDpDialog, setShowCreateDpDialog] = useState(false) // Replaced by createDPDialogOpen\
  // const [selectedSoForDp, setSelectedSoForDp] = useState<SalesOrder | null>(null) // Replaced by selectedSOForDP
  // const [dpItems, setDpItems] = useState<
  //   Array<{ productId: string; productName: string; quantity: number; unitPrice: number; maxQuantity: number }>
  // >([]) // Handled within the dialog

  const handleApproveQuotation = async (order: SalesOrder) => {
    if (order.status !== "draft") {
      alert(t("so.only-draft-quotations-can-be"))
      return
    }
    
    try {
      await updateSalesOrder({
        ...order,
        status: "pending_accountant",
      })
      alert(t("so.quotation-sent-to-accountant-for"))
      setSelectedOrder(null)
    } catch (error) {
      console.error("Error approving quotation:", error)
      alert(t("common.failed-to-approve-quotation"))
    }
  }

  const handleOpenCreateDpDialog = async (order: SalesOrder) => {

    // Prevent DP creation for draft orders (unapproved quotations)
    if (order.status === "draft") {
      alert(t("so.cannot-create-delivery-permit-for"))
      return
    }

    // Prevent DP creation if not approved by accountant
    if (order.status === "pending_accountant") {
      alert(t("so.cannot-create-delivery-permit-waiting"))
      return
    }

    // Allow DP creation for approved, delivered, or ready_for_delivery orders (for partial/multiple deliveries)
    const allowedStatuses = ["accountant_approved", "delivered", "ready_for_delivery", "out_for_delivery"]
    if (!allowedStatuses.includes(order.status)) {
      alert(t("so.order-must-be-approved-by"))
      return
    }

    // Separate outsourced items into received vs still-pending
    const outsourcedItems = (order.items || []).filter(
      (item: any) => item.itemType === "outsourced" || item.item_type === "outsourced"
    )
    const unreceivedOutsourced = outsourcedItems.filter((item: any) => !item.fulfilledAt)

    // If ALL items (including stock) are unreceived outsourced, nothing to ship yet
    const allItemsUnreceived =
      (order.items || []).length > 0 &&
      (order.items || []).every(
        (item: any) =>
          (item.itemType === "outsourced" || item.item_type === "outsourced") && !item.fulfilledAt
      )
    if (allItemsUnreceived) {
      alert(
        t("so.cannot-create-delivery-permit-none") + "\n\n" + t("so.please-create-a-purchase-order")
      )
      return
    }

    // Build order with only available items — exclude unreceived outsourced items
    const availableItems = (order.items || []).filter((item: any) => {
      const isOutsourced = item.itemType === "outsourced" || item.item_type === "outsourced"
      if (isOutsourced && !item.fulfilledAt) return false
      return true
    })

    const orderForDp = {
      ...order,
      items: availableItems,
      _excludedItems: unreceivedOutsourced,
    }

    // Initialize delivery info from SO
    setDpDeliveryInfo({
      recipientName: order.delivery_contact_name || order.deliveryContactName || "",
      recipientPhone: order.delivery_contact_phone || order.deliveryContactPhone || "",
      deliveryAddress: order.delivery_address || order.deliveryAddress || "",
    })

    try {
      const soIdValue = order.so_id || order.id
      const response = await fetch(`/api/delivery-permits?soId=${soIdValue}`)

      if (!response.ok) {
        console.error("DP fetch failed with status:", response.status)
        setExistingDPsForSO([])
        setSelectedSOForDP(orderForDp)
        setCreateDPDialogOpen(true)
        return
      }

      const existingDPs = await response.json()

      // Filter DPs to only include those for this SO
      const filteredDPs = Array.isArray(existingDPs)
        ? existingDPs.filter(
            (dp: any) =>
              (String(dp.sales_order_id) === String(soIdValue) || String(dp.salesOrderId) === String(soIdValue)) &&
              // a REJECTED permit never ships: its quantity can be planned again
              isPlannedPermit(dp),
          )
        : []

      setExistingDPsForSO(filteredDPs)
    } catch (error) {
      console.error("Error fetching existing DPs:", error)
      setExistingDPsForSO([])
    }

    setSelectedSOForDP(orderForDp)
    setCreateDPDialogOpen(true)
  }

  const handleCreateDpFromDialog = async () => {
    if (!selectedSOForDP) return

    // Gather the items to be included in the new DP
    const newDpItems = []
    let canSubmit = true

    // Iterate through the DOM elements to get the quantities entered by the user
    for (let index = 0; index < selectedSOForDP.items.length; index++) {
      const item = selectedSOForDP.items[index]
      
      // Get item identifiers
      const itemProductId = item.productId || item.product_id
      const itemName = item.productName || item.product_name || item.outsourcedName || item.outsourced_name || ""
      
      // Check if item is outsourced (no productId means it's outsourced or custom)
      const isOutsourcedItem = !itemProductId
      
      // Use index-based naming for consistency - this matches the form input names
      const inputName = `dp-quantity-${index}`
      
      const inputElement = document.querySelector(`input[name="${inputName}"]`) as HTMLInputElement
      
      if (inputElement) {
        const quantity = Number.parseInt(inputElement.value) || 0

        // Calculate delivered quantity using same logic as dialog display
        const deliveredQty = existingDPsForSO.reduce((total, dp) => {
          if (!dp.items || !Array.isArray(dp.items)) return total
          
          const dpItem = dp.items.find((dpI: any) => {
            if (itemProductId && dpI.productId) {
              return String(dpI.productId) === String(itemProductId)
            }
            const dpItemName = dpI.itemNameSnapshot || dpI.item_name_snapshot || ""
            return dpItemName === itemName && dpItemName !== ""
          })
          
          return total + (dpItem ? Number(dpItem.quantity) || 0 : 0)
        }, 0)

        // Calculate remaining
        const soQuantity = Number(item.quantity) || 0
        const remainingQty = Math.max(0, soQuantity - deliveredQty)

        if (quantity > 0) {
          // Only validate remaining quantity for non-outsourced items
          if (!isOutsourcedItem && quantity > remainingQty) {
            alert(fill(t("so.quantity-for-exceeds-remaining-amount"), { product: item.productName || item.product_name, remainingQty }))
            canSubmit = false
            break
          }
                  // Extract supplier name from outsourced_description if available
                  const supplierInfo = item.outsourced_description || item.outsourcedDescription || ""
                  const supplierMatch = supplierInfo.match(/Supplier:\s*([^|]+)/)
                  const extractedSupplierName = supplierMatch ? supplierMatch[1].trim() : null
                  
                  newDpItems.push({
                            productId: item.productId || item.product_id || null,
                            productName: item.productName || item.product_name || item.outsourced_name,
                            outsourcedName: item.outsourced_name || item.outsourcedName || null,
                            supplierName: extractedSupplierName || item.supplier_name || item.supplierName || null,
                            quantity: quantity,
                            unitPrice: item.unitPrice || item.unit_price,
                            total: quantity * (item.unitPrice || item.unit_price),
                          })
        }
      }
    }

    if (!canSubmit) {
      return
    }

    if (newDpItems.length === 0) {
      alert(t("so.please-select-at-least-one"))
      return
    }

    if (isSubmittingDP) return
    setIsSubmittingDP(true)

    try {
      const response = await fetch("/api/delivery-permits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderId: selectedSOForDP.so_id || selectedSOForDP.id,
          customerId: selectedSOForDP.customer_id || selectedSOForDP.customerId,
          recipientName: dpDeliveryInfo.recipientName,
          recipientPhone: dpDeliveryInfo.recipientPhone,
          deliveryAddress: dpDeliveryInfo.deliveryAddress,
          items: newDpItems,
          createdBy: "1", // Replace with actual user ID
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to create delivery permit")
      }

      const data = await response.json()
      alert(fill(t("so.delivery-permit-created-successfully"), { permitNo: data.permitNo }))
      setCreateDPDialogOpen(false)
      setSelectedSOForDP(null)
      setExistingDPsForSO([]) // Clear existing DPs as they will be re-fetched on next open

      // Refresh data
      await loadData()
    } catch (error: any) {
      console.error("Error creating DP:", error)
      alert(fill(t("so.failed-to-create-delivery-permit"), { message: error.message }))
    } finally {
      setIsSubmittingDP(false)
    }
  }

  const handleCreateDpFromDialog_alias = handleCreateDpFromDialog // Alias for clarity in DialogFooter

  const headerActions = (
    /* Changed button layout to use the new report generator state and translated button text */
    <Button variant="outline" onClick={() => setShowReportGenerator(true)}>
      {t("report.generate")}
    </Button>
  )

  // One action set shared by the table row and the phone card.
  const renderRowActions = (order: any) => (
    <>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handlePrintSalesOrder(order)
              }}
              title={t("so.print-sales-order")}
            >
              <Printer className="w-4 h-4" /> {t("so.print-so")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(order)} title={t("action.view-details")}>
              <Eye className="w-4 h-4" /> {t("view")}
            </Button>
      {getSODeliveryStatus(order) !== "delivered" && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => e.stopPropagation()}
                title={t("so.print-a-report-of-items")}
              >
                <PackageX className="w-4 h-4" /> {t("so.missing-items")} <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => handlePrintMissingItems(order, false)}>
                {t("so.print-with-unit-cost")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handlePrintMissingItems(order, true)}>
                {t("so.print-without-unit-cost-hide")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          handleOpenCreateDpDialog(order)
        }}
        title={
          order.status === "draft" 
            ? t("so.approve-quotation-first") 
            : order.status === "pending_accountant"
            ? t("so.waiting-for-accountant-approval")
            : t("so.create-delivery-permit")
        }
        disabled={order.status === "draft" || order.status === "pending_accountant" || order.status === "pending" || order.status === "pending_ceo"}
      >
        <FileText className="w-4 h-4" /> {t("so.create-dp")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          setSelectedOrder(order)
        }}
        title={t("so.manage-maintenance-for-this-order")}
      >
        <Wrench className="w-4 h-4" /> {t("common.maintenance")}
      </Button>
      {showEditButton(order) && (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            setEditingOrder(order)
          }}
          disabled={!canEditApprovedOrder(order)}
          title={
            canEditApprovedOrder(order)
              ? hasReturns(order)
                ? t("so.edit-this-order-after-a")
                : t("so.edit-this-approved-order-items")
              : t("so.cannot-edit-a-delivery-permit")
          }
        >
          <Pencil className="w-4 h-4" /> {t("edit")}
        </Button>
      )}
    </>
  )

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex flex-wrap justify-end gap-2">{headerActions}</div>
      ) : (
        <PageHeader group={t("group.sales")} title={t("so.title")} subtitle={t("so.description")} actions={headerActions} />
      )}

      <KpiGrid className="lg:grid-cols-3">
        <KpiTile label={t("so.total-orders")} value={formatNumber(salesOrders.length)} />
        <KpiTile
          label={t("so.pending-orders")}
          value={formatNumber(pendingOrders.length)}
          sub={t("click-to-view")}
          onClick={() => setShowPendingOrdersDialog(true)}
        />
        <KpiTile
          label={t("common.total-value-egp")}
          value={<Money value={salesOrders.reduce((sum, so) => sum + so.total, 0)} />}
        />
      </KpiGrid>

      <Dialog open={showPendingOrdersDialog} onOpenChange={setShowPendingOrdersDialog}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("so.pending-orders")} ({pendingOrders.length})
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("so.list-of-sales-orders-awaiting")}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            {pendingOrders.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t("no-pending-orders")}</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted">
                    <th className="border p-2 text-start">{t("so-number")}</th>
                    <th className="border p-2 text-start">{t("field.customer")}</th>
                    <th className="border p-2 text-start">{t("field.status")}</th>
                    <th className="border p-2 text-start">{t("field.date")}</th>
                    <th className="border p-2 text-end">{t("field.total")} {t("common.egp")}</th>
                    <th className="border p-2 text-center">{t("field.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-muted/50">
                      <td className="border p-2 font-medium">{order.soNumber}</td>
                      <td className="border p-2">{getCustomerName(order.customerId)}</td>
                      <td className="border p-2">
                        <StatusBadge status={order.status} label={t(`status.${order.status}`)} />
                      </td>
                      <td className="border p-2">{formatDate(order.orderDate, language)}</td>
                      <td className="border p-2 text-end"><Money value={order.total} /></td>
                      <td className="border p-2 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`${t("action.view")} ${order.soNumber}`}
                          onClick={() => {
                            setSelectedOrder(order)
                            setShowPendingOrdersDialog(false)
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Order Dialog removed - orders are created via Sales Quotations workflow */}

      <Card>
        <CardHeader>
          {/* Adjusted layout for search and title */}
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("so.list")}</CardTitle>
              <CardDescription>{t("so.list-description")}</CardDescription>
            </div>
            {/* Added search input and translated placeholder */}
            <div className="relative w-64">
              <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("action.search")}
                className="ps-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveList
            rows={filteredOrdersBySearch}
            table={
              <ErpTable>
                <TableHeader>
                  {/* Translated table headers */}
                  <TableRow>
                    <TableHead className="p-2">{t("so.number")}</TableHead>
                    <TableHead className="p-2">{t("so.customer")}</TableHead>
                    <TableHead className="p-2">{t("so.order-date")}</TableHead>
                    <TableHead className="p-2">{t("so.delivery-date")}</TableHead>
                    <NumHead className="p-2">{t("so.items")}</NumHead>
                    <NumHead className="p-2">{t("so.total-amount")} {t("common.egp")}</NumHead>
                    <TableHead className="p-2">{t("field.status")}</TableHead>
                    <ActionsHead className="p-2">{t("field.actions")}</ActionsHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrdersBySearch.map((order) => (
                    <TableRow key={order.id} className="border-b hover:bg-muted/50">
                      <IdCell className="p-2">{order.soNumber}</IdCell>
                      <TableCell className="p-2">{getCustomerName(order.customerId)}</TableCell>
                      <TableCell className="p-2">{formatDate(order.orderDate, language)}</TableCell>
                      <TableCell className="p-2">{formatDate(order.deliveryDate, language)}</TableCell>
                      <NumCell className="p-2">{formatNumber(order.items?.length || 0)}</NumCell>
                      <NumCell className="p-2">{formatMoney(order.total, language)}</NumCell>
                      <TableCell className="p-2">
                        <StatusBadge
                          status={getSODeliveryStatus(order)}
                          label={t(`so.status.${getSODeliveryStatus(order)}`)}
                        />
                      </TableCell>
                      <ActionsCell className="p-2">{renderRowActions(order)}</ActionsCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ErpTable>
            }
            card={(order) => (
              <ListCard
                id={order.soNumber}
                amount={formatMoney(order.total, language)}
                party={getCustomerName(order.customerId)}
                status={
                  <StatusBadge
                    status={getSODeliveryStatus(order)}
                    label={t(`so.status.${getSODeliveryStatus(order)}`)}
                  />
                }
                actions={renderRowActions(order)}
              />
            )}
          />
        </CardContent>
      </Card>

      {/* Order Details Dialog with Maintenance */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("sales-orders.details")}: {selectedOrder?.soNumber}</DialogTitle>
            {selectedOrder && <ApprovalSteps status={selectedOrder.status} />}
            <DialogDescription className="sr-only">
              {t("so.full-details-pricing-payment-and")}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <Tabs defaultValue="maintenance" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="h-auto w-full flex-wrap justify-start bg-muted p-1 mb-4">
                <TabsTrigger value="details" className="data-[state=active]:bg-background">
                  <FileText className="w-4 h-4 me-2" />
                  {t("sales-orders.details")}
                </TabsTrigger>
                <TabsTrigger value="maintenance" className="data-[state=active]:bg-background">
                  <Wrench className="w-4 h-4 me-2" />
                  {t("common.maintenance")}
                </TabsTrigger>
                <TabsTrigger value="approvals" className="data-[state=active]:bg-background relative">
                  <CheckCircle className="w-4 h-4 me-2" />
                  {t("so.approve-reports")}
                  {pendingReportsCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-5 h-5 flex items-center justify-center rounded-full bg-red-700 text-white text-xs font-bold px-1">
                      {pendingReportsCount}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="flex-1 overflow-y-auto space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("so-number")}</p>
                    <p className="font-semibold">{selectedOrder.soNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                    <p className="font-semibold">{customers.find((c) => c.id === selectedOrder.customerId)?.name}</p>
                  </div>
                  {selectedOrder.quotationRequestNumber && (
                    <div>
                      <p className="text-sm text-muted-foreground">{t("so.request-number")}</p>
                      <p className="font-semibold">{selectedOrder.quotationRequestNumber}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.date")}</p>
                    <p className="font-semibold">{formatDate(selectedOrder.orderDate, language)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.status")}</p>
                    <StatusBadge status={selectedOrder.status} label={t(`status.${selectedOrder.status}`)} />
                    
                    {/* Show delivery permit fulfillment status */}
                    {selectedOrder.deliveryPermits && selectedOrder.deliveryPermits.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-muted-foreground font-semibold">{t("common.delivery-status")}</p>
                        {selectedOrder.deliveryPermits.map((dp: any) => (
                          <div key={dp.permit_number || dp.permitNumber} className="text-xs flex items-center gap-1.5">
                            <span className="font-mono">{dp.permit_number || dp.permitNumber}</span>
                            <span className={`px-1.5 py-0.5 rounded font-medium ${
                              dp.status === "SUBMITTED_SIGNED" || dp.status === "APPROVED" || dp.status === "DELIVERED"
                                ? "bg-green-100 text-green-700"
                                : "bg-yellow-100 text-yellow-700"
                            }`}>
                              {dp.status === "SUBMITTED_SIGNED" || dp.status === "APPROVED" || dp.status === "DELIVERED" ? t("so.delivered") : t("so.pending")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedOrder.approvalDocumentUrl && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground mb-1">{t("so.approval-document")}</p>
                      <a 
                        href={selectedOrder.approvalDocumentUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                      >
                        <FileText className="w-4 h-4" />
                        {t("so.view-approval-document")}
                      </a>
                    </div>
                  )}
                </div>

                <OrderSummaryCard
                  subtotal={selectedOrder.subtotal || 0}
                  discountType={(selectedOrder.discountType as DiscountType) || "none"}
                  discountValue={selectedOrder.discountValue || 0}
                  discountAmount={selectedOrder.discountAmount || 0}
                  netTotal={selectedOrder.netTotal || selectedOrder.total}
                  vatEnabled={true}
                  vatRate={0.14}
                  paymentType={
                    selectedOrder.paymentType || (selectedOrder.paymentTerms === "prepaid" ? "cash" : "installments")
                  }
                  paymentDetails={
                    selectedOrder.paymentDetails || {
                      paymentType: selectedOrder.paymentTerms === "prepaid" ? "cash" : "installments",
                    }
                  }
                />

                <div>
                  <p className="text-sm text-muted-foreground mb-2">{t("so.items")}</p>
                  <div className="border rounded-lg p-4 space-y-3">
                    {selectedOrder.items.map((item, idx) => {
                      const isOutsourced = item.itemType === "outsourced" || item.item_type === "outsourced"
                      const supplierInfo = item.outsourced_description || item.outsourcedDescription || ""
                      const supplierMatch = supplierInfo.match(/Supplier:\s*([^|]+)/)
                      const supplierName = supplierMatch ? supplierMatch[1].trim() : null
                      
                      
                      return (
                        <div key={`${item.productId || "item"}-${idx}`} className="flex justify-between items-start gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{item.productName}</span>
                              {isOutsourced && (
                                <Badge variant="secondary" className="text-xs">
                                  {t("common.outsourced-2")}
                                </Badge>
                              )}
                              {supplierName && (
                                <Badge variant="outline" className="text-xs">
                                  {supplierName}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {t("common.qty-2")} {item.quantity} {item.outsourced_unit || item.outsourcedUnit || ""}
                            </div>
                          </div>
                          <span className="font-semibold whitespace-nowrap">
                            <Money value={item.total} /> {t("common.egp-2")}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="border-t pt-4">
                  <div className="flex justify-between">
                    <span className="font-semibold">{t("so.total-amount")}</span>
                    <span className="text-lg font-bold"><Money value={selectedOrder.total} /> {t("common.egp-2")}</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="maintenance" className="flex-1 overflow-y-auto mt-4">
                <SalesOrderMaintenanceTab 
                  salesOrder={selectedOrder} 
                  userRole={userRole}
                />
              </TabsContent>

              <TabsContent value="approvals" className="flex-1 overflow-y-auto mt-4">
                <MaintenanceApprovalTab userRole={userRole} />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Generator Dialog */}
      <Dialog open={showReportGenerator} onOpenChange={setShowReportGenerator}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("report.generate")}</DialogTitle>
          </DialogHeader>
          <ReportGenerator type="sales" userRole={userRole} onClose={() => setShowReportGenerator(false)} />
        </DialogContent>
      </Dialog>

      {/* Create DP Dialog */}
      <Dialog open={createDPDialogOpen} onOpenChange={setCreateDPDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("so.create-delivery-permit-for")} {selectedSOForDP?.soNumber || selectedSOForDP?.so_number}
            </DialogTitle>
            <DialogDescription>
              {t("so.select-quantities-for-delivery")}{" "}
              {existingDPsForSO.length > 0 && fill(t("so.dp-s-already-created-for"), { count: existingDPsForSO.length })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Warning banner for excluded unreceived outsourced items */}
            {(selectedSOForDP as any)?._excludedItems?.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold mb-1">{t("so.some-items-excluded-not-received")}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {(selectedSOForDP as any)._excludedItems.map((item: any, i: number) => (
                    <li key={i}>
                      {item.productName || item.outsourcedName || t("so.unnamed-item")}
                      {item.supplierName ? ` (${item.supplierName})` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">{t("so.create-a-purchase-order-and")}</p>
              </div>
            )}
            <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
              <h3 className="font-semibold text-sm">{t("so.delivery-information")}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="dp-recipient-name">{t("so.recipient-name")}</Label>
                  <Input
                    id="dp-recipient-name"
                    value={dpDeliveryInfo.recipientName}
                    onChange={(e) => setDpDeliveryInfo({ ...dpDeliveryInfo, recipientName: e.target.value })}
                    placeholder={t("so.enter-recipient-name")}
                  />
                </div>
                <div>
                  <Label htmlFor="dp-recipient-phone">{t("so.recipient-phone")}</Label>
                  <Input
                    id="dp-recipient-phone"
                    value={dpDeliveryInfo.recipientPhone}
                    onChange={(e) => setDpDeliveryInfo({ ...dpDeliveryInfo, recipientPhone: e.target.value })}
                    placeholder={t("so.enter-phone-number")}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="dp-delivery-address">{t("so.delivery-address")}</Label>
                <Input
                  id="dp-delivery-address"
                  value={dpDeliveryInfo.deliveryAddress}
                  onChange={(e) => setDpDeliveryInfo({ ...dpDeliveryInfo, deliveryAddress: e.target.value })}
                  placeholder={t("so.enter-delivery-address")}
                />
              </div>
            </div>
            {selectedSOForDP?.items?.map((item: any, index: number) => {
              // Get item identifiers - use so_item_id as unique key when available
              const soItemId = item.id || item.so_item_id
              const itemProductId = item.productId || item.product_id
              const itemName = item.productName || item.product_name || item.outsourcedName || item.outsourced_name || ""
              
              // Determine if item is outsourced (no productId)
              const isOutsourcedItem = !itemProductId
              
              // Calculate delivered quantity by matching this specific SO item across all existing DPs
              const deliveredQty = existingDPsForSO.reduce((total, dp) => {
                if (!dp.items || !Array.isArray(dp.items)) return total
                
                // Find matching DP item
                const dpItem = dp.items.find((dpI: any) => {
                  // First try to match by productId (most reliable for stock items)
                  if (itemProductId && dpI.productId) {
                    return String(dpI.productId) === String(itemProductId)
                  }
                  // For outsourced items or fallback, match by item name
                  const dpItemName = dpI.itemNameSnapshot || dpI.item_name_snapshot || ""
                  return dpItemName === itemName && dpItemName !== ""
                })
                
                // Parse quantity as number since it may come as string from DB
                return total + (dpItem ? Number(dpItem.quantity) || 0 : 0)
              }, 0)

              // Calculate remaining - for outsourced items, still track but allow flexible delivery
              const soQuantity = Number(item.quantity) || 0
              const remainingQty = Math.max(0, soQuantity - deliveredQty)
              const isFullyDelivered = remainingQty <= 0

              return (
                <div key={index} className={`border p-4 rounded ${isFullyDelivered ? "opacity-50 bg-gray-50" : ""}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium">{item.productName || item.product_name || item.outsourced_name || t("common.unknown-item")}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.sku ? `SKU: ${item.sku}` : item.outsourced_name ? t("common.outsourced") : ""}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-sm text-muted-foreground">{t("so.so-qty")} {item.quantity}</p>
                      {deliveredQty > 0 && <p className="text-sm text-orange-700">{t("so.delivered-2")} {deliveredQty}</p>}
                      <p className={`text-sm font-medium ${isFullyDelivered ? "text-green-700" : "text-blue-600"}`}>
                        {t("so.remaining")} {remainingQty}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">{t("so.quantity-for-this-dp")}</label>
                      <Input
                        key={`${selectedSOForDP?.so_id || selectedSOForDP?.id}-${index}-${deliveredQty}`}
                        type="number"
                        min="0"
                        max={isOutsourcedItem ? undefined : remainingQty}
                        name={`dp-quantity-${index}`}
                        defaultValue={isFullyDelivered ? "0" : remainingQty.toString()}
                        disabled={isFullyDelivered}
                        className={isFullyDelivered ? "bg-gray-100" : ""}
                      />
                      {isFullyDelivered && <p className="text-xs text-green-700 mt-1">{t("so.fully-delivered")}</p>}
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t("field.unit-price")}</label>
                      <Input type="number" value={item.unitPrice || item.unit_price} disabled className="bg-gray-50" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDPDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleCreateDpFromDialog_alias} disabled={isSubmittingDP}>{isSubmittingDP ? t("common.creating") : t("so.create-delivery-permit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingOrder && (
        <EditApprovedOrderDialog
          order={editingOrder}
          onOpenChange={(open) => !open && setEditingOrder(null)}
          onSaved={() => {
            refreshSalesOrders()
            setEditingOrder(null)
          }}
        />
      )}
    </div>
  )
}

export default SalesOrderModule
