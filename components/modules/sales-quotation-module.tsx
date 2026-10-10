"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Trash2, FileText, Printer, Package, Upload, UserPlus, FileClock, Plus } from "lucide-react"
import { useAppContext } from "@/lib/app-context"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { UserRole, Customer, PaymentType, PaymentDetails } from "@/lib/types"
import { SupplierQuoteComparison } from "@/components/sales-quotation/supplier-quote-comparison"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { getCitiesForCountry } from "@/lib/countries-data"
import {
  PaymentTypeSelector,
  InstallmentFields,
  ChequeFields,
  HybridFields,
  PaymentScheduleEditor,
  type PaymentScheduleEntry,
} from "@/components/payment"
import { DiscountFields, calculateDiscount, type DiscountType } from "@/components/discount"
import { OrderSummaryCard } from "@/components/order-summary-card"
import { getOrCreateClientId } from "@/lib/client-id"
import * as XLSX from "xlsx"
import { normalizeQuotationPaymentDetails } from "@/lib/payment-type"
import { useI18n } from "@/lib/i18n-context"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { Money } from "@/components/erp/money"

interface QuotationItem {
  id: string
  item_type: "inventory" | "outsourced"
  product_id?: number
  product_name: string
  quantity: number
  unit_price: number
  markup: number
  supplier_name?: string
}

interface SalesQuotationModuleProps {
  userRole: UserRole
  embedded?: boolean
}

export function SalesQuotationModule({ userRole, embedded = false }: SalesQuotationModuleProps) {
  const { t, language } = useI18n()
  const { products, customers, addCustomer, suppliers, inventory } = useAppContext()

  // Aggregate available (non-returned) stock per product across all warehouses
  const aggregatedInventory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const inv of inventory) {
      if ((inv as any).isReturned) continue
      totals.set(inv.productId, (totals.get(inv.productId) || 0) + (inv.quantity || 0))
    }
    return Array.from(totals.entries()).map(([productId, quantity]) => ({ productId, quantity }))
  }, [inventory])

  const getAvailableStock = (productId?: number | null): number | null => {
    if (productId === undefined || productId === null) return null
    const entry = aggregatedInventory.find((inv) => inv.productId === productId.toString())
    return entry ? entry.quantity : 0
  }

  // Draft persistence: lets the user save multiple in-progress quotations and pick which one to
  // resume, e.g. when juggling several quotes at once or logging out mid-creation.
  // There are no real accounts here (see login-page.tsx), so drafts are keyed by a stable
  // per-browser id rather than the per-login User.id, which is regenerated on every login and
  // would never match across a logout/login cycle.
  const [draftOwnerKey, setDraftOwnerKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<{ id: string; form_data: any; updated_at: string }[]>([])
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [isDraftsLoaded, setIsDraftsLoaded] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [showDraftsPanel, setShowDraftsPanel] = useState(false)
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState("")

  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [validityDays, setValidityDays] = useState(30)
  const [savedQuotation, setSavedQuotation] = useState<any>(null)
  const [isCreatingQuotation, setIsCreatingQuotation] = useState(false)
  const [items, setItems] = useState<QuotationItem[]>([])
  const [notes, setNotes] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Additional fields from sales order form
  const [quotationRequestNumber, setQuotationRequestNumber] = useState("")
  const [departmentName, setDepartmentName] = useState("")
  const [receiverName, setReceiverName] = useState("")
  const [deliveryDate, setDeliveryDate] = useState("")
  const [deliveryAddress, setDeliveryAddress] = useState("")
  const [deliveryContactName, setDeliveryContactName] = useState("")
  const [deliveryContactPhone, setDeliveryContactPhone] = useState("")
  const [soType, setSoType] = useState("EQUIPMENT")
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0])

  // Payment fields
  const [paymentType, setPaymentType] = useState<PaymentType>("cash")
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>({
    paymentType: "cash",
    installmentMonths: 6,
    monthlyAmount: 0,
    installmentMonthlyAmount: 0,
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

  // Discount fields
  const [discountType, setDiscountType] = useState<DiscountType>("none")
  const [discountValue, setDiscountValue] = useState<number>(0)

  // VAT settings (always 14%)
  const VAT_RATE = 0.14

  // Selling price per unit = cost + markup%
  const getItemFinalPrice = (item: QuotationItem) => item.unit_price * (1 + (item.markup || 0) / 100)

  // Payment schedule
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleEntry[]>([])

  // Snapshot of every field that should survive a logout / accidental navigation mid-creation
  const buildDraftSnapshot = () => ({
    selectedCustomerId,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    validityDays,
    items,
    notes,
    quotationRequestNumber,
    departmentName,
    receiverName,
    deliveryDate,
    deliveryAddress,
    deliveryContactName,
    deliveryContactPhone,
    soType,
    orderDate,
    paymentType,
    paymentDetails,
    discountType,
    discountValue,
    paymentSchedule,
  })

  const applyDraftSnapshot = (draft: ReturnType<typeof buildDraftSnapshot>) => {
    setSelectedCustomerId(draft.selectedCustomerId ?? "")
    setCustomerName(draft.customerName ?? "")
    setCustomerPhone(draft.customerPhone ?? "")
    setCustomerEmail(draft.customerEmail ?? "")
    setCustomerAddress(draft.customerAddress ?? "")
    setValidityDays(draft.validityDays ?? 30)
    setItems(draft.items ?? [])
    setNotes(draft.notes ?? "")
    setQuotationRequestNumber(draft.quotationRequestNumber ?? "")
    setDepartmentName(draft.departmentName ?? "")
    setReceiverName(draft.receiverName ?? "")
    setDeliveryDate(draft.deliveryDate ?? "")
    setDeliveryAddress(draft.deliveryAddress ?? "")
    setDeliveryContactName(draft.deliveryContactName ?? "")
    setDeliveryContactPhone(draft.deliveryContactPhone ?? "")
    setSoType(draft.soType ?? "EQUIPMENT")
    setOrderDate(draft.orderDate ?? new Date().toISOString().split("T")[0])
    setPaymentType(draft.paymentType ?? "cash")
    if (draft.paymentDetails) setPaymentDetails(draft.paymentDetails)
    setDiscountType(draft.discountType ?? "none")
    setDiscountValue(draft.discountValue ?? 0)
    setPaymentSchedule(draft.paymentSchedule ?? [])
  }

  const isDraftWorthKeeping = (draft: ReturnType<typeof buildDraftSnapshot>) =>
    Boolean(draft.customerName?.trim()) || draft.items.length > 0

  const resetFormFields = () => {
    setSelectedCustomerId("")
    setCustomerName("")
    setCustomerPhone("")
    setCustomerEmail("")
    setCustomerAddress("")
    setValidityDays(30)
    setItems([])
    setNotes("")
    setQuotationRequestNumber("")
    setDepartmentName("")
    setReceiverName("")
    setDeliveryDate("")
    setDeliveryAddress("")
    setDeliveryContactName("")
    setDeliveryContactPhone("")
    setSoType("EQUIPMENT")
    setOrderDate(new Date().toISOString().split("T")[0])
    setPaymentType("cash")
    setDiscountType("none")
    setDiscountValue(0)
    setPaymentSchedule([])
  }

  // Derive the stable per-browser draft key, then load the list of saved drafts so the user
  // can pick which one (if any) to resume
  useEffect(() => {
    const clientId = getOrCreateClientId()
    if (!clientId) {
      setIsDraftsLoaded(true)
      return
    }

    const key = `${userRole}:${clientId}`
    setDraftOwnerKey(key)

    let isMounted = true

    fetch(`/api/quotation-drafts?owner_key=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        if (!isMounted) return
        setDrafts(result?.drafts ?? [])
      })
      .catch((error) => {
        console.error("Failed to load quotation drafts:", error)
      })
      .finally(() => {
        if (isMounted) setIsDraftsLoaded(true)
      })

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole])

  // Create-or-update the currently active draft with the given snapshot
  const persistDraftSnapshot = async (snapshot: ReturnType<typeof buildDraftSnapshot>) => {
    if (!draftOwnerKey) return
    setIsSavingDraft(true)
    try {
      const res = await fetch("/api/quotation-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeDraftId, owner_key: draftOwnerKey, form_data: snapshot }),
      })
      if (!res.ok) return
      const result = await res.json()
      const savedId: string | undefined = result?.id ?? activeDraftId ?? undefined
      if (!savedId) return
      if (savedId !== activeDraftId) setActiveDraftId(savedId)
      const updatedAt = new Date().toISOString()
      setDrafts((prev) => [
        { id: savedId, form_data: snapshot, updated_at: updatedAt },
        ...prev.filter((d) => d.id !== savedId),
      ])
    } catch (error) {
      console.error("Failed to save quotation draft:", error)
    } finally {
      setIsSavingDraft(false)
    }
  }

  // Autosave the currently active in-progress quotation so it can be resumed later
  useEffect(() => {
    if (!draftOwnerKey || !isDraftsLoaded) return

    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current)
    }

    const snapshot = buildDraftSnapshot()

    draftSaveTimeoutRef.current = setTimeout(() => {
      if (!isDraftWorthKeeping(snapshot)) return
      persistDraftSnapshot(snapshot)
    }, 1000)

    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isDraftsLoaded,
    draftOwnerKey,
    activeDraftId,
    selectedCustomerId,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    validityDays,
    items,
    notes,
    quotationRequestNumber,
    departmentName,
    receiverName,
    deliveryDate,
    deliveryAddress,
    deliveryContactName,
    deliveryContactPhone,
    soType,
    orderDate,
    paymentType,
    paymentDetails,
    discountType,
    discountValue,
    paymentSchedule,
  ])

  // Flush any pending autosave for whatever draft is currently open, before switching away from it
  const flushActiveDraftSave = async () => {
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current)
      draftSaveTimeoutRef.current = null
    }
    const snapshot = buildDraftSnapshot()
    if (isDraftWorthKeeping(snapshot)) {
      await persistDraftSnapshot(snapshot)
    }
  }

  const resumeDraft = async (draft: { id: string; form_data: any }) => {
    if (draft.id !== activeDraftId) {
      await flushActiveDraftSave()
    }
    applyDraftSnapshot(draft.form_data)
    setActiveDraftId(draft.id)
    setShowDraftsPanel(false)
  }

  const startNewDraft = async () => {
    await flushActiveDraftSave()
    resetFormFields()
    setActiveDraftId(null)
    setShowDraftsPanel(false)
  }

  const deleteDraft = async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
    if (id === activeDraftId) {
      resetFormFields()
      setActiveDraftId(null)
    }
    try {
      await fetch(`/api/quotation-drafts?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    } catch (error) {
      console.error("Failed to delete quotation draft:", error)
    }
  }

  const formatDraftLabel = (formData: any) => {
    const name = formData?.customerName?.trim()
    const itemCount = Array.isArray(formData?.items) ? formData.items.length : 0
    const itemsLabel = itemCount === 1 ? "1 item" : `${itemCount} items`
    return name ? `${name} — ${itemsLabel}` : `Untitled quotation — ${itemsLabel}`
  }

  const formatDraftTimestamp = (isoString: string) => {
    const date = new Date(isoString)
    const diffMs = Date.now() - date.getTime()
    const diffMinutes = Math.round(diffMs / 60000)
    if (diffMinutes < 1) return "Just now"
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.round(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return formatDate(isoString, language)
  }

  const handlePaymentDetailChange = (field: string, value: string | number) => {
    setPaymentDetails((prev) => {
      const updated = { ...prev, [field]: value }
      
      // Recalculate dependent values when key fields change
      const currentSubtotal = items.reduce((sum, item) => sum + item.quantity * getItemFinalPrice(item), 0)
      // Calculate total with 14% tax
      const totalWithTax = currentSubtotal * 1.14
      
      if (field === 'downPaymentAmount' || field === 'downPaymentPercent' || field === 'remainingInstallmentMonths') {
        // Recalculate for hybrid payment
        if (field === 'downPaymentAmount') {
          // When amount changes, recalculate the percent
          const newAmount = value as number
          const newPercent = totalWithTax > 0 ? (newAmount / totalWithTax) * 100 : 0
          updated.downPaymentAmount = newAmount
          updated.downPaymentPercent = Math.round(newPercent * 100) / 100 // Round to 2 decimals
          updated.remainingAmount = totalWithTax - newAmount
          updated.monthlyAmount = updated.remainingAmount / (prev.remainingInstallmentMonths || 6)
        } else if (field === 'downPaymentPercent') {
          // When percent changes, recalculate the amount
          const newPercent = value as number
          const newAmount = (totalWithTax * newPercent) / 100
          updated.downPaymentPercent = newPercent
          updated.downPaymentAmount = Math.round(newAmount * 100) / 100 // Round to 2 decimals
          updated.remainingAmount = totalWithTax - newAmount
          updated.monthlyAmount = updated.remainingAmount / (prev.remainingInstallmentMonths || 6)
        } else if (field === 'remainingInstallmentMonths') {
          updated.monthlyAmount = (prev.remainingAmount || totalWithTax - (prev.downPaymentAmount || 0)) / (value as number)
        }
      } else if (field === 'installmentMonths') {
        // Recalculate for regular installments with tax included
        updated.monthlyAmount = totalWithTax / (value as number)
      }
      
      return updated
    })
  }

  // Recalculate payment amounts when items change (not payment details to avoid loops)
  useEffect(() => {
    const currentSubtotal = items.reduce((sum, item) => sum + item.quantity * getItemFinalPrice(item), 0)
    // Calculate total with 14% tax
    const totalWithTax = currentSubtotal * 1.14
    
    setPaymentDetails((prev) => {
      // For installments and hybrid
      const installmentMonths = prev.installmentMonths || 6
      
      // For hybrid - calculate down payment and remaining (using total with tax)
      const downPaymentPercent = prev.downPaymentPercent || 50
      let downPaymentAmount = prev.downPaymentAmount || 0
      let remainingAmount = totalWithTax
      
      // If no downPaymentAmount set, calculate from percent
      if (downPaymentAmount === 0 && downPaymentPercent > 0) {
        downPaymentAmount = (totalWithTax * downPaymentPercent) / 100
      }
      
      remainingAmount = totalWithTax - downPaymentAmount
      
      const remainingInstallmentMonths = prev.remainingInstallmentMonths || 6
      const monthlyAmount = remainingAmount > 0 ? remainingAmount / remainingInstallmentMonths : 0
      
      return {
        ...prev,
        installmentMonthlyAmount: totalWithTax / installmentMonths,
        monthlyAmount: monthlyAmount,
        downPaymentAmount: downPaymentAmount,
        remainingAmount: remainingAmount,
        chequeAmount: totalWithTax,
      }
    })
  }, [items])

  // New customer form states
  const [showCustomerForm, setShowCustomerForm] = useState(false)
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
      alert("Please fill in all required fields")
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
      alert("Customer created successfully!")
    } catch (error) {
      console.error("Error creating customer:", error)
      alert("Failed to create customer. Please try again.")
    }
  }

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId)
    const customer = customers.find((c) => c.id === customerId)
    if (customer) {
      setCustomerName(customer.name || "")
      setCustomerPhone(customer.phone || "")
      setCustomerEmail(customer.email || "")
      setCustomerAddress(customer.address || "")
      setDeliveryAddress(customer.address || "")
      setDeliveryContactName(customer.name || "")
      setDeliveryContactPhone(customer.phone || "")
    }
  }

  const handleExcelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array" })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[]

        // Log the column names from Excel to help debug
        if (jsonData.length > 0) {
        }

        // Map Excel rows to quotation items
        // Expected columns: Product Name, Quantity, Unit Price, Outsourced (yes/no), Supplier Name
        const newItems: QuotationItem[] = jsonData.map((row, index) => {
          // Get all keys from the row and find matching columns (case-insensitive)
          const keys = Object.keys(row)
          
          const findValue = (possibleNames: string[]) => {
            for (const name of possibleNames) {
              const key = keys.find(k => k.toLowerCase().replace(/[_\s]/g, '') === name.toLowerCase().replace(/[_\s]/g, ''))
              if (key && row[key] !== undefined && row[key] !== null && row[key] !== '') {
                return row[key]
              }
            }
            return null
          }
          
          const productName = findValue(['Product Name', 'ProductName', 'product_name', 'Name', 'Item', 'item_name', 'ItemName']) || ""
          const quantity = Number(findValue(['Quantity', 'Qty', 'quantity', 'qty', 'QTY', 'Amount', 'amount']) || 1)
          const unitPriceRaw = findValue(['Unit Price', 'UnitPrice', 'unit_price', 'Price', 'price', 'Unit price', 'unit price', 'PRICE', 'Rate', 'rate', 'Cost', 'cost'])
          const unitPrice = unitPriceRaw !== null ? Number(unitPriceRaw) : 0
          const supplierName = findValue(['Supplier Name', 'SupplierName', 'supplier_name', 'Supplier', 'supplier']) || ""
          
          // Check if outsourced - if supplier name is provided, it's outsourced
          const outsourcedValue = findValue(['Outsourced', 'outsourced', 'Is Outsourced', 'is_outsourced'])
          const hasSupplier = supplierName && String(supplierName).trim() !== ""
          const isOutsourced = hasSupplier || 
            String(outsourcedValue).toLowerCase() === "yes" || 
            String(outsourcedValue).toLowerCase() === "true" || 
            outsourcedValue === 1

          if (isOutsourced) {
            // Outsourced item - use supplier name
            return {
              id: `excel-${Date.now()}-${index}`,
              item_type: "outsourced" as const,
              product_id: undefined,
              product_name: String(productName),
              quantity: isNaN(quantity) ? 1 : quantity,
              unit_price: isNaN(unitPrice) ? 0 : unitPrice,
              markup: 0,
              supplier_name: String(supplierName) || undefined,
            }
          } else {
            // Inventory item - try to find matching product
            const matchedProduct = products.find(p => 
              p.name?.toLowerCase() === String(productName).toLowerCase() ||
              p.productName?.toLowerCase() === String(productName).toLowerCase() ||
              p.sku?.toLowerCase() === String(productName).toLowerCase()
            )
            
            if (matchedProduct) {
              return {
                id: `excel-${Date.now()}-${index}`,
                item_type: "inventory" as const,
                product_id: matchedProduct.id,
                product_name: matchedProduct.name || matchedProduct.productName || "",
                quantity: isNaN(quantity) ? 1 : quantity,
                unit_price: isNaN(unitPrice) ? (matchedProduct.price || 0) : unitPrice,
                markup: 0,
              }
            } else {
              // Product not found in inventory - mark as outsourced without supplier
              return {
                id: `excel-${Date.now()}-${index}`,
                item_type: "outsourced" as const,
                product_id: undefined,
                product_name: String(productName),
                quantity: isNaN(quantity) ? 1 : quantity,
                unit_price: isNaN(unitPrice) ? 0 : unitPrice,
                markup: 0,
                supplier_name: undefined,
              }
            }
          }
        }).filter(item => item.product_name && item.product_name.trim() !== "") // Filter out empty rows

        if (newItems.length === 0) {
          alert("No valid items found in Excel file. Please ensure your file has columns like 'Product Name', 'Quantity', 'Unit Price', and optionally 'Supplier Name'.")
          return
        }

        // Count matched vs unmatched items
        const inventoryItems = newItems.filter(i => i.item_type === "inventory").length
        const outsourcedItems = newItems.filter(i => i.item_type === "outsourced").length

        // Add the imported items to existing items
        setItems(prev => [...prev, ...newItems])
        alert(`Successfully imported ${newItems.length} items:\n- ${inventoryItems} matched from inventory\n- ${outsourcedItems} outsourced items`)
      } catch (error) {
        console.error("Excel parse error:", error)
        alert("Failed to parse Excel file. Please ensure it's a valid .xlsx or .xls file.")
      }
    }
    reader.readAsArrayBuffer(file)
    
    // Reset file input so the same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const addItem = (itemType: "inventory" | "outsourced") => {
    setItems([
      ...items,
      {
        id: `item-${Date.now()}`,
        item_type: itemType,
        product_id: undefined,
        product_name: "",
        quantity: 1,
        unit_price: 0,
        markup: 0,
        supplier_name: itemType === "outsourced" ? "" : undefined,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof QuotationItem, value: any) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }

  const handleInventorySelection = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id?.toString() === productId)
    if (product) {
      setItems((prevItems) =>
        prevItems.map((item) =>
          item.id === itemId
            ? {
                ...item,
                product_id: Number(productId),
                product_name: product.productName || product.product_name || "",
                unit_price: product.unitPrice || product.unit_price || 0,
              }
            : item,
        ),
      )
    }
  }

  const calculateTotal = () => {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * getItemFinalPrice(item), 0)
    const tax = subtotal * 0.14
    return { subtotal, tax, total: subtotal + tax }
  }

  const handleSaveAndGeneratePDF = async () => {
    if (!customerName.trim()) {
      alert("Please enter customer name")
      return
    }
    if (items.length === 0) {
      alert("Please add at least one item")
      return
    }

    const invalidItems = items.filter((item) => {
      if (item.item_type === "inventory") {
        return !item.product_id || item.quantity <= 0 || item.unit_price < 0
      }
      if (item.item_type === "outsourced") {
        return !item.product_name || !item.product_name.trim() || item.quantity <= 0 || item.unit_price < 0
      }
      return false
    })

    if (invalidItems.length > 0) {
      alert("Please fill all item details (name, quantity, and price)")
      return
    }

    const outOfStockItem = items.find((item) => {
      if (item.item_type !== "inventory") return false
      const stock = getAvailableStock(item.product_id)
      return stock !== null && item.quantity > stock
    })

    if (outOfStockItem) {
      const stock = getAvailableStock(outOfStockItem.product_id)
      alert(`"${outOfStockItem.product_name}" only has ${stock} in stock. Please reduce the quantity.`)
      return
    }

    setIsCreatingQuotation(true)

    try {
      // Save quotation to database first (VAT always applied at 14%)
      const discountResult = calculateDiscount(subtotal, discountType, discountValue)
      const discountAmount = discountResult.discountAmount
      const taxAmount = (subtotal - discountAmount) * VAT_RATE
      const totalAmount = subtotal - discountAmount + taxAmount

      const response = await fetch("/api/sales-quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          quotation_request_number: quotationRequestNumber,
          department_name: departmentName,
          receiver_name: receiverName,
          delivery_date: deliveryDate || null,
          delivery_address: deliveryAddress,
          delivery_contact_name: deliveryContactName,
          delivery_contact_phone: deliveryContactPhone,
          so_type: soType,
          order_date: orderDate,
          validity_days: validityDays,
          notes: notes,
          // Payment fields
          payment_type: paymentType,
          // Stored with the real payment type; single-payment types drop the installment defaults.
          payment_details: normalizeQuotationPaymentDetails(paymentType, paymentDetails),
          // Discount fields
          discount_type: discountType,
          discount_value: discountValue,
          discount_amount: discountAmount,
          // VAT (always applied at 14%)
          vat_enabled: true,
          tax: taxAmount,
          subtotal: subtotal,
          net_total: totalAmount,
          items: items.map((item) => ({
            item_type: item.item_type,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: Number(getItemFinalPrice(item).toFixed(2)),
            supplier_name: item.supplier_name || null,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to save quotation")
      }

      const { quotation } = await response.json()
      setSavedQuotation(quotation)

      // Quotation was successfully created, so the in-progress draft is no longer needed
      if (activeDraftId) {
        const draftIdToClear = activeDraftId
        setDrafts((prev) => prev.filter((d) => d.id !== draftIdToClear))
        setActiveDraftId(null)
        fetch(`/api/quotation-drafts?id=${encodeURIComponent(draftIdToClear)}`, { method: "DELETE" }).catch(
          (error) => {
            console.error("Failed to clear quotation draft:", error)
          },
        )
      }

      // Generate PDF
      const quotationData = {
        quotation_number: quotation.quotation_number,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        items: items.map((item) => ({
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: Number(getItemFinalPrice(item).toFixed(2)),
        })),
        validity_days: validityDays,
        notes: notes,
      }

      const queryString = `data=${encodeURIComponent(JSON.stringify(quotationData))}&qn=${quotation.quotation_number}`
      window.open(`/api/quotations/generate?${queryString}`, "_blank")
    } catch (error) {
      console.error("Save quotation error:", error)
      alert("Failed to save quotation. Please try again.")
    } finally {
      setIsCreatingQuotation(false)
    }
  }

  const { subtotal, tax, total } = calculateTotal()

  const headerActions = (
    <>
      {activeDraftId && (
        <Badge variant="secondary" className="font-normal">
          Editing saved draft
        </Badge>
      )}
      {isSavingDraft && <span className="text-xs text-muted-foreground">Saving draft…</span>}
      <Button type="button" variant="outline" size="sm" onClick={() => setShowDraftsPanel((v) => !v)}>
        <FileClock className="h-4 w-4 me-1" />
        Drafts{drafts.length > 0 ? ` (${drafts.length})` : ""}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={startNewDraft}>
        <Plus className="h-4 w-4 me-1" />
        New Quotation
      </Button>
    </>
  )

  return (
  <div className="space-y-6">
      {embedded ? (
        <div className="flex flex-wrap justify-end gap-2">{headerActions}</div>
      ) : (
        <PageHeader
          group={t("group.sales")}
          title={t("module.sales-quotations")}
          subtitle="Create and print sales quotations for customers with inventory items or custom products"
          actions={headerActions}
        />
      )}
        {showDraftsPanel && (
          <Card>
            <CardContent>
            {drafts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved drafts yet. Quotations you leave in progress are saved here automatically.
              </p>
            ) : (
              <div className="space-y-2">
                {drafts.map((draft) => {
                  const isActive = draft.id === activeDraftId
                  return (
                    <div
                      key={draft.id}
                      className={cn(
                        "flex items-center justify-between gap-4 rounded-lg border p-3",
                        isActive ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{formatDraftLabel(draft.form_data)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDraftTimestamp(draft.updated_at)}
                          {isActive ? " · Currently open" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isActive && (
                          <Button type="button" variant="secondary" size="sm" onClick={() => resumeDraft(draft)}>
                            Resume
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteDraft(draft.id)}
                          aria-label="Delete draft"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            </CardContent>
          </Card>
        )}

      <Card>
        <CardHeader>
          <CardTitle>Customer & Delivery Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer">Select Customer</Label>
              <div className="flex gap-2">
                <Select value={selectedCustomerId} onValueChange={handleCustomerChange}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a customer or enter manually" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} - {customer.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => setShowCustomerForm(!showCustomerForm)}>
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerName">Customer Name *</Label>
              <Input
                id="customerName"
                placeholder="Enter customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerPhone">Phone Number</Label>
              <Input
                id="customerPhone"
                placeholder="Enter phone number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerEmail">Email Address</Label>
              <Input
                id="customerEmail"
                type="email"
                placeholder="Enter email address"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerAddress">Customer Address</Label>
              <Input
                id="customerAddress"
                placeholder="Enter delivery address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="validityDays">Validity (Days)</Label>
              <Input
                id="validityDays"
                type="number"
                min="1"
                value={validityDays}
                onChange={(e) => setValidityDays(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quotationRequestNumber">Quotation Request Number</Label>
              <Input
                id="quotationRequestNumber"
                placeholder="Customer's quotation request reference"
                value={quotationRequestNumber}
                onChange={(e) => setQuotationRequestNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="departmentName">Department Name</Label>
              <Input
                id="departmentName"
                placeholder="Department receiving the order"
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="receiverName">Receiver Name</Label>
              <Input
                id="receiverName"
                placeholder="Person who will receive the order"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="soType">Quotation Type</Label>
              <Select value={soType} onValueChange={setSoType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EQUIPMENT">Equipment</SelectItem>
                  <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                  <SelectItem value="SPARE_PARTS">Spare Parts</SelectItem>
                  <SelectItem value="SERVICE">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderDate">Order Date</Label>
              <Input
                id="orderDate"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-2 border-t">
            <h4 className="text-sm font-medium text-muted-foreground mb-3 mt-3">Delivery Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="deliveryDate">Delivery Date</Label>
                <Input
                  id="deliveryDate"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deliveryAddress">Delivery Address</Label>
                <Input
                  id="deliveryAddress"
                  placeholder="Enter delivery address"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deliveryContactName">Contact Name</Label>
                <Input
                  id="deliveryContactName"
                  placeholder="Delivery contact person"
                  value={deliveryContactName}
                  onChange={(e) => setDeliveryContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deliveryContactPhone">Contact Phone</Label>
                <Input
                  id="deliveryContactPhone"
                  placeholder="Delivery contact phone"
                  value={deliveryContactPhone}
                  onChange={(e) => setDeliveryContactPhone(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quotation Items Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Quotation Items</CardTitle>
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx,.xls"
                onChange={handleExcelUpload}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline">
                <Upload className="h-4 w-4 me-2" />
                Import Excel
              </Button>
              <Button onClick={() => addItem("inventory")} size="sm" variant="outline">
                <Package className="h-4 w-4 me-2" />
                Add from Inventory
              </Button>
              <Button onClick={() => addItem("outsourced")} size="sm" variant="outline">
                <UserPlus className="h-4 w-4 me-2" />
                Add Outsourced Item
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs mt-2">
            Excel columns: Product Name, Quantity, Unit Price, Outsourced (yes/no), Supplier Name
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No items added yet. Add items from inventory or create custom items.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={item.id} className="grid grid-cols-12 gap-4 items-end p-4 border rounded-lg">
                  <div className="col-span-1 text-center">
                    <div className="font-semibold">{index + 1}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {item.item_type === "inventory" ? "Inventory" : "Outsourced"}
                    </div>
                  </div>
                  {item.item_type === "inventory" ? (
                    <>
                      <div className="col-span-4 space-y-2">
                        <Label htmlFor={`product-${item.id}`}>Select Product from Inventory</Label>
                        <ProductSearchCombobox
                          products={products
                            .filter((product) => product.id != null)
                            .map((product) => ({
                              id: product.id!.toString(),
                              productName: product.productName,
                              sku: product.sku
                            }))}
                          inventory={aggregatedInventory}
                          warehouseId="all"
                          value={item.product_id ? item.product_id.toString() : undefined}
                          onSelect={(value) => handleInventorySelection(item.id, value)}
                          placeholder="Search product by name or SKU..."
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor={`product-${item.id}`}>Outsourced Product Name</Label>
                        <Input
                          id={`product-${item.id}`}
                          placeholder="Enter product name"
                          value={item.product_name}
                          onChange={(e) => updateItem(item.id, "product_name", e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor={`supplier-${item.id}`}>Supplier</Label>
                        <Select
                          value={item.supplier_name || ""}
                          onValueChange={(value) => updateItem(item.id, "supplier_name", value)}
                        >
                          <SelectTrigger id={`supplier-${item.id}`}>
                            <SelectValue placeholder="Select supplier" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((s) => (
                              <SelectItem key={s.id} value={s.name}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor={`quantity-${item.id}`}>Quantity</Label>
                    {(() => {
                      const stockLimit = item.item_type === "inventory" ? getAvailableStock(item.product_id) : null
                      return (
                        <>
                          <Input
                            id={`quantity-${item.id}`}
                            type="number"
                            min="1"
                            max={stockLimit ?? undefined}
                            value={item.quantity}
                            onChange={(e) => {
                              let next = Number(e.target.value)
                              if (stockLimit !== null && !isNaN(next) && next > stockLimit) {
                                next = stockLimit
                              }
                              updateItem(item.id, "quantity", next)
                            }}
                          />
                          {stockLimit !== null && (
                            <p className="text-xs text-muted-foreground">{stockLimit} in stock</p>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor={`price-${item.id}`}>Unit Cost (EGP)</Label>
                    <Input
                      id={`price-${item.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-1 space-y-2">
                    <Label htmlFor={`markup-${item.id}`}>Markup %</Label>
                    <Input
                      id={`markup-${item.id}`}
                      type="number"
                      min="0"
                      step="0.1"
                      value={item.markup}
                      onChange={(e) => updateItem(item.id, "markup", Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-1 space-y-2">
                    <Label>Total</Label>
                    <div className="text-sm font-medium pt-2"><Money value={item.quantity * getItemFinalPrice(item)} /> EGP</div>
                    {(item.markup || 0) > 0 && (
                      <div className="text-xs text-muted-foreground">@ {getItemFinalPrice(item).toFixed(2)}</div>
                    )}
                  </div>
                  <div className="col-span-1">
                    <Button variant="destructive" size="icon" onClick={() => removeItem(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discount & Pricing Card - Apply discount to subtotal BEFORE payment calculations */}
      <Card>
        <CardHeader>
          <CardTitle>Discount & Pricing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DiscountFields
            discountType={discountType}
            discountValue={discountValue}
            subtotal={subtotal}
            onDiscountTypeChange={setDiscountType}
            onDiscountValueChange={setDiscountValue}
          />
        </CardContent>
      </Card>

      {/* Payment Terms Card */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PaymentTypeSelector value={paymentType} onChange={setPaymentType} />

          {paymentType === "installments" && (
            <InstallmentFields
              totalAmount={subtotal}
              installmentMonths={paymentDetails.installmentMonths || 6}
              paymentStartDate={paymentDetails.paymentStartDate || ""}
              onInstallmentMonthsChange={(months) => handlePaymentDetailChange("installmentMonths", months)}
              onPaymentStartDateChange={(date) => handlePaymentDetailChange("paymentStartDate", date)}
            />
          )}

          {paymentType === "cheque" && (
            <ChequeFields
              chequeNumber={paymentDetails.chequeNumber || ""}
              bankName={paymentDetails.chequeBankName || ""}
              dueDate={paymentDetails.chequeDueDate || ""}
              amount={paymentDetails.chequeAmount || subtotal}
              notes={paymentDetails.chequeNotes || ""}
              totalAmount={subtotal}
              onChange={handlePaymentDetailChange}
            />
          )}

          {paymentType === "hybrid" && (
            <HybridFields
              totalAmount={subtotal}
              downPaymentType={paymentDetails.downPaymentType || "cash"}
              downPaymentPercent={paymentDetails.downPaymentPercent || 50}
              downPaymentAmount={paymentDetails.downPaymentAmount || 0}
              remainingInstallmentMonths={paymentDetails.remainingInstallmentMonths || 6}
              downPaymentChequeNumber={paymentDetails.downPaymentChequeNumber || ""}
              downPaymentChequeBank={paymentDetails.downPaymentChequeBank || ""}
              downPaymentChequeDueDate={paymentDetails.downPaymentChequeDueDate || ""}
              paymentStartDate={paymentDetails.paymentStartDate || ""}
              downPaymentDueDate={paymentDetails.downPaymentDueDate || ""}
              onDownPaymentTypeChange={(val) => handlePaymentDetailChange("downPaymentType", val)}
              onDownPaymentPercentChange={(val) => handlePaymentDetailChange("downPaymentPercent", val)}
              onDownPaymentAmountChange={(val) => handlePaymentDetailChange("downPaymentAmount", val)}
              onRemainingInstallmentMonthsChange={(val) => handlePaymentDetailChange("remainingInstallmentMonths", val)}
              onDownPaymentChequeNumberChange={(val) => handlePaymentDetailChange("downPaymentChequeNumber", val)}
              onDownPaymentChequeBankChange={(val) => handlePaymentDetailChange("downPaymentChequeBank", val)}
              onDownPaymentChequeDueDateChange={(val) => handlePaymentDetailChange("downPaymentChequeDueDate", val)}
              onPaymentStartDateChange={(val) => handlePaymentDetailChange("paymentStartDate", val)}
              onDownPaymentDueDateChange={(val) => handlePaymentDetailChange("downPaymentDueDate", val)}
            />
          )}

          {/* Payment Schedule Editor - for Installments and Hybrid */}
          {(paymentType === "installments" || paymentType === "hybrid") && (
            <PaymentScheduleEditor
              paymentType={paymentType}
              totalAmount={subtotal * 1.14}
              downPaymentAmount={paymentDetails.downPaymentAmount || 0}
              downPaymentDueDate={paymentDetails.downPaymentDueDate || ""}
              installmentMonths={paymentType === "installments" ? (paymentDetails.installmentMonths || 6) : (paymentDetails.remainingInstallmentMonths || 6)}
              paymentStartDate={paymentDetails.paymentStartDate || ""}
              onScheduleChange={setPaymentSchedule}
            />
          )}

        </CardContent>
      </Card>

      {/* Combined pricing + payment summary - shown once, at the end, after all inputs are set */}
      <OrderSummaryCard
        subtotal={subtotal}
        discountType={discountType}
        discountValue={discountValue}
        vatEnabled={true}
        vatRate={VAT_RATE}
        paymentType={paymentType}
        paymentDetails={paymentDetails}
      />

      <Card>
        <CardHeader>
          <CardTitle>Additional Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes / Terms & Conditions</Label>
            <Textarea
              id="notes"
              placeholder="Enter any additional notes or terms and conditions..."
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <Button onClick={handleSaveAndGeneratePDF} size="lg" className="gap-2" disabled={isCreatingQuotation}>
                <Printer className="h-5 w-5" />
                {isCreatingQuotation ? "Saving..." : "Save & Generate PDF"}
              </Button>
              <p className="text-sm text-muted-foreground">Saves quotation and opens PDF in new window</p>
              {isSavingDraft && <p className="text-xs text-muted-foreground">Saving draft…</p>}

              {savedQuotation && (
                <div className="mt-4 pt-4 border-t">
                  <SupplierQuoteComparison
                    salesQuotationId={savedQuotation.id}
                    quotationItems={items.map((item) => ({
                      id: item.id,
                      productName: item.product_name,
                      quantity: item.quantity,
                      unitPrice: item.unit_price,
                    }))}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2 min-w-[300px]">
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium">Subtotal:</span>
                <span><Money value={subtotal} /> EGP</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium">VAT (14%):</span>
                <span><Money value={tax} /> EGP</span>
              </div>
              <div className="flex justify-between py-2 text-lg font-bold">
                <span>Total:</span>
                <span><Money value={total} /> EGP</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
