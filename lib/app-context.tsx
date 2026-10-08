"use client"

import { createContext, useContext, useState, useEffect, useRef, type ReactNode, useCallback } from "react"
import useSWR from "swr"
import type {
  InventoryItem,
  PurchaseOrder,
  SalesOrder,
  SupplierInvoice,
  CustomerInvoice,
  Supplier,
  Customer,
  Product,
  User,
  BalanceEntry,
  LostSale,
} from "./types"

interface Courier {
  id: string
  name: string
  phone?: string
  email?: string
  vehicleType?: string
  vehiclePlate?: string
  isActive: boolean
  notes?: string
}

interface AppContextType {
  inventory: InventoryItem[]
  setInventory: (items: InventoryItem[]) => void
  addInventoryItem: (item: InventoryItem) => Promise<void>
  updateInventoryItem: (item: InventoryItem) => Promise<void>
  updateInventoryQuantity: (productId: string, quantityChange: number, warehouseId?: string) => Promise<void>
  purchaseOrders: PurchaseOrder[]
  setPurchaseOrders: (orders: PurchaseOrder[]) => void
  addPurchaseOrder: (order: PurchaseOrder) => Promise<void>
  updatePurchaseOrder: (order: PurchaseOrder | (Partial<SalesOrder> & { id: string })) => Promise<void>
  salesOrders: SalesOrder[]
  setSalesOrders: (orders: SalesOrder[]) => void
  addSalesOrder: (order: SalesOrder) => Promise<any>
  updateSalesOrder: (order: SalesOrder | (Partial<SalesOrder> & { id: string })) => Promise<void>
  supplierInvoices: SupplierInvoice[]
  setSupplierInvoices: (invoices: SupplierInvoice[]) => void
  addSupplierInvoice: (invoice: SupplierInvoice) => Promise<void>
  updateSupplierInvoice: (invoiceId: string, updates: Partial<SupplierInvoice>) => Promise<void>
  customerInvoices: CustomerInvoice[]
  setCustomerInvoices: (invoices: CustomerInvoice[]) => void
  addCustomerInvoice: (invoice: CustomerInvoice) => Promise<void>
  updateCustomerInvoice: (invoiceId: string, updates: Partial<CustomerInvoice>) => Promise<void>
  suppliers: Supplier[]
  setSuppliers: (suppliers: Supplier[]) => void
  addSupplier: (supplier: Supplier) => Promise<void>
  updateSupplier: (supplier: Supplier) => Promise<void>
  deleteSupplier: (id: string) => Promise<void>
  customers: Customer[]
  setCustomers: (customers: Customer[]) => void
  addCustomer: (customer: Customer) => Promise<void>
  updateCustomer: (customer: Customer) => Promise<void>
  deleteCustomer: (id: string) => Promise<void>
  products: Product[]
  setProducts: (products: Product[]) => void
  addProduct: (product: Product) => Promise<void>
  updateProduct: (product: Product) => Promise<void>
  deleteProduct: (id: string) => Promise<void>
  couriers: Courier[]
  setCouriers: (couriers: Courier[]) => void
  refreshCouriers: () => Promise<any>
  warehouses: any[]
  setWarehouses: (warehouses: any[]) => void
  refreshWarehouses: () => Promise<any>
  prepaidBalance: number
  setPrepaidBalance: (balance: number) => void
  loadData: () => Promise<void>
  isLoading: boolean
  resetAllData: () => Promise<void>
  lostSales: LostSale[]
  setLostSales: (lostSales: LostSale[]) => void
  balanceEntries: BalanceEntry[]
  setBalanceEntries: (balanceEntries: BalanceEntry[]) => void
  users: User[]
  setUsers: (users: User[]) => void
  refreshPurchaseOrders: () => Promise<any>
  refreshSalesOrders: () => Promise<any>
  refreshInventory: () => Promise<any>
  refreshSupplierInvoices: () => Promise<any>
  refreshCustomerInvoices: () => Promise<any>
  refreshBalanceEntries: () => Promise<any>
  refreshCustomers: () => Promise<any>
  refreshSuppliers: () => Promise<any>
}

const AppContext = createContext<AppContextType | undefined>(undefined)

const swrFetcher = async (url: string) => {
  const response = await fetch(url)

  const contentType = response.headers.get("content-type")
  const isJson = contentType?.includes("application/json")

  if (response.status === 429) {
    const text = await response.text()
    console.error("Rate limited (429):", text)
    throw new Error("Rate limited")
  }

  if (response.status === 401 && url === "/api/users") {
    return []
  }

  if (!response.ok) {
    const text = await response.text()
    console.error(`[v0] Fetch error ${response.status} for ${url}:`, text)

    if (text.includes("Too Many") || text.includes("rate limit") || text.includes("429")) {
      throw new Error("Rate limited")
    }
    throw new Error(`Failed to fetch: ${response.status}`)
  }

  if (!isJson) {
    console.warn("Non-JSON response for", url, "Content-Type:", contentType)
    return null
  }

  const text = await response.text()
  if (!text || text.trim() === "") {
    return null
  }

  try {
    return JSON.parse(text)
  } catch (err) {
    console.error("JSON parse error for", url, ":", text.substring(0, 100))
    throw new Error("Invalid JSON response")
  }
}

const SWR_OPTIONS = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60000, // 60s dedupe
  errorRetryCount: 2,
  errorRetryInterval: 3000,
  shouldRetryOnError: (error: any) => {
    return !error.message.includes("Rate limited") && !error.message.includes("429")
  },
}

const REFERENCE_DATA_SWR_OPTIONS = {
  ...SWR_OPTIONS,
  dedupingInterval: 300000, // 5 minutes dedupe for reference data
  revalidateIfStale: false,
  revalidateOnMount: true,
  errorRetryCount: 1, // Only 1 retry for reference data
  errorRetryInterval: 10000, // Wait 10s before retry
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [prepaidBalance, setPrepaidBalance] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(true)
  const hasMountedRef = useRef(false)
  const couriersRetryCountRef = useRef(0)
  const couriersLastRetryRef = useRef(0)

  const { data: customersData, mutate: mutateCustomers } = useSWR<Customer[]>(
    "/api/customers",
    swrFetcher,
    REFERENCE_DATA_SWR_OPTIONS,
  )
  const { data: suppliersData, mutate: mutateSuppliers } = useSWR<Supplier[]>(
    "/api/suppliers",
    swrFetcher,
    REFERENCE_DATA_SWR_OPTIONS,
  )
  const { data: productsData, mutate: mutateProducts } = useSWR<Product[]>(
    "/api/products",
    swrFetcher,
    REFERENCE_DATA_SWR_OPTIONS,
  )
  const { data: warehousesData, mutate: mutateWarehouses } = useSWR<any[]>(
    "/api/warehouses",
    swrFetcher,
    REFERENCE_DATA_SWR_OPTIONS,
  )
  const { data: couriersData, mutate: mutateCouriers } = useSWR<Courier[]>("/api/couriers", swrFetcher, {
    ...REFERENCE_DATA_SWR_OPTIONS,
    dedupingInterval: 300000, // 5 minutes
  })
  const { data: inventoryData, mutate: mutateInventory } = useSWR<any[]>("/api/inventory", swrFetcher, {
    ...SWR_OPTIONS,
    revalidateOnMount: true,
    revalidateIfStale: true,
    dedupingInterval: 5000, // short dedup so fresh data always loads
  })
  const { data: purchaseOrdersData, mutate: mutatePurchaseOrders } = useSWR<any[]>(
    "/api/purchase-orders",
    swrFetcher,
    SWR_OPTIONS,
  )
  const { data: salesOrdersData, mutate: mutateSalesOrders } = useSWR<any[]>(
    "/api/sales-orders",
    swrFetcher,
    SWR_OPTIONS,
  )
  const { data: supplierInvoicesData, mutate: mutateSupplierInvoices } = useSWR<SupplierInvoice[]>(
    "/api/accounts-payable",
    swrFetcher,
    SWR_OPTIONS,
  )
  const { data: customerInvoicesData, mutate: mutateCustomerInvoices } = useSWR<any[]>(
    "/api/accounts-receivable",
    swrFetcher,
    SWR_OPTIONS,
  )
  const { data: balanceEntriesData, mutate: mutateBalanceEntries } = useSWR<BalanceEntry[]>(
    "/api/balance",
    swrFetcher,
    SWR_OPTIONS,
  )
  const { data: lostSalesData, mutate: mutateLostSales } = useSWR<LostSale[]>(
    "/api/lost-sales",
    swrFetcher,
    SWR_OPTIONS,
  )
  const { data: usersData, mutate: mutateUsers } = useSWR<User[]>("/api/users", swrFetcher, SWR_OPTIONS)

  const customers = customersData || []
  const suppliers = suppliersData || []
  const products = productsData || []
  const couriers = couriersData || []
  const supplierInvoices = supplierInvoicesData || []
  const balanceEntries = balanceEntriesData || []
  const lostSales = lostSalesData || []
  const users = usersData || []

  // Process inventory
  const inventory: InventoryItem[] = (inventoryData || []).map((inv: any) => ({
    id: inv.inventory_id?.toString() || inv.id,
    inventoryId: inv.inventory_id ?? inv.inventoryId,
    productId: inv.product_id?.toString() || inv.productId,
    productName: inv.products?.product_name || inv.productName || inv.outsourcedName || inv.outsourced_name || "Unknown",
    sku: inv.products?.sku || inv.sku || "",
    unit: inv.products?.unit || inv.unit || "unit",
    quantity: inv.quantity,
    reorderPoint: inv.reorder_point ?? inv.reorderPoint,
    location: inv.location,
    warehouseId: inv.warehouse_id ?? inv.warehouseId,
    warehouseName: inv.warehouses?.warehouse_name || inv.warehouseName,
    lastUpdated: inv.last_updated || inv.lastUpdated,
    unitCost: inv.unit_cost ?? inv.unitCost ?? 0,
    isReturned: inv.is_returned ?? inv.isReturned ?? false,
    isOutsourced: inv.is_outsourced ?? inv.isOutsourced ?? false,
    supplierName: inv.supplier_name ?? inv.supplierName ?? null,
    soNumber: inv.so_number ?? inv.soNumber ?? null,
    outsourcedName: inv.outsourced_name ?? inv.outsourcedName ?? null,
  }))

  // Process purchase orders
  const purchaseOrders: PurchaseOrder[] = (purchaseOrdersData || []).map((po: any) => ({
    ...po,
    items:
      po.items?.map((item: any) => ({
        ...item,
        productId: item.productId || item.product_id?.toString(),
        productName: item.productName || item.product_name || item.products?.product_name,
        quantity: item.quantity,
        unitPrice: item.unitPrice || item.unit_price,
      })) || [],
  }))

  // Process sales orders
  const salesOrders: SalesOrder[] = salesOrdersData || []

  // Process customer invoices
  const customerInvoices: CustomerInvoice[] = (customerInvoicesData || []).map((inv: any) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    soId: inv.soId,
    customerId: inv.customerId,
    customerName: inv.customerName,
    soNumber: inv.soNumber,
    amount: Number.parseFloat(inv.amount),
    collectedAmount: Number.parseFloat(inv.collectedAmount || 0),
    date: inv.date,
    dueDate: inv.dueDate,
    status: inv.status,
    installmentMonths: inv.installmentMonths,
    monthsPaid: inv.monthsPaid || 0,
    items: inv.items || [],
  }))

  useEffect(() => {
    if (hasMountedRef.current) return
    hasMountedRef.current = true

    // Once we have core data, mark as not loading
    if (customersData !== undefined && productsData !== undefined) {
      setIsLoading(false)
    }
  }, [customersData, productsData])

  // Also check on data changes
  useEffect(() => {
    if (customersData !== undefined && productsData !== undefined && suppliersData !== undefined) {
      setIsLoading(false)
    }
  }, [customersData, productsData, suppliersData])

  // Load prepaid balance from localStorage
  useEffect(() => {
    const savedPrepaidBalance = localStorage.getItem("prepaidBalance")
    if (savedPrepaidBalance) {
      setPrepaidBalance(JSON.parse(savedPrepaidBalance))
    }
  }, [])

  useEffect(() => {
    if (
      couriersData === undefined && // Only retry on undefined (error state), NOT empty array []
      couriersRetryCountRef.current < 2 &&
      Date.now() - couriersLastRetryRef.current > 5000
    ) {
      couriersRetryCountRef.current++
      couriersLastRetryRef.current = Date.now()

      const delay = couriersRetryCountRef.current === 1 ? 2000 : 5000
      setTimeout(() => {
        mutateCouriers()
      }, delay)
    } else if (couriersData !== undefined && couriersData.length === 0) {
    }
  }, [couriersData, mutateCouriers])

  const refreshPurchaseOrders = useCallback(() => mutatePurchaseOrders(), [mutatePurchaseOrders])
  const refreshSalesOrders = useCallback(() => mutateSalesOrders(), [mutateSalesOrders])
  const refreshInventory = useCallback(() => mutateInventory(), [mutateInventory])
  const refreshSupplierInvoices = useCallback(() => mutateSupplierInvoices(), [mutateSupplierInvoices])
  const refreshCustomerInvoices = useCallback(() => mutateCustomerInvoices(), [mutateCustomerInvoices])
  const refreshBalanceEntries = useCallback(() => mutateBalanceEntries(), [mutateBalanceEntries])
  const refreshCustomers = useCallback(() => mutateCustomers(), [mutateCustomers])
  const refreshSuppliers = useCallback(() => mutateSuppliers(), [mutateSuppliers])
  const refreshCouriers = useCallback(() => mutateCouriers(), [mutateCouriers])

  const loadData = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([
      mutateCustomers(),
      mutateSuppliers(),
      mutateProducts(),
      mutateCouriers(),
      mutateInventory(),
      mutatePurchaseOrders(),
      mutateSalesOrders(),
      mutateSupplierInvoices(),
      mutateCustomerInvoices(),
      mutateBalanceEntries(),
      mutateLostSales(),
      mutateUsers(),
    ])
    setIsLoading(false)
  }, [
    mutateCustomers,
    mutateSuppliers,
    mutateProducts,
    mutateCouriers,
    mutateInventory,
    mutatePurchaseOrders,
    mutateSalesOrders,
    mutateSupplierInvoices,
    mutateCustomerInvoices,
    mutateBalanceEntries,
    mutateLostSales,
    mutateUsers,
  ])

  // Setters that update SWR cache directly for optimistic updates
  const setCustomers = useCallback(
    (newCustomers: Customer[]) => {
      mutateCustomers(newCustomers, false)
    },
    [mutateCustomers],
  )

  const setSuppliers = useCallback(
    (newSuppliers: Supplier[]) => {
      mutateSuppliers(newSuppliers, false)
    },
    [mutateSuppliers],
  )

  const setProducts = useCallback(
    (newProducts: Product[]) => {
      mutateProducts(newProducts, false)
    },
    [mutateProducts],
  )

  const setCouriers = useCallback(
    (newCouriers: Courier[]) => {
      mutateCouriers(newCouriers, false)
    },
    [mutateCouriers],
  )

  const setInventory = useCallback(
    (newInventory: InventoryItem[]) => {
      mutateInventory(newInventory as any, false)
    },
    [mutateInventory],
  )

  const setPurchaseOrders = useCallback(
    (newOrders: PurchaseOrder[]) => {
      mutatePurchaseOrders(newOrders as any, false)
    },
    [mutatePurchaseOrders],
  )

  const setSalesOrders = useCallback(
    (newOrders: SalesOrder[]) => {
      mutateSalesOrders(newOrders as any, false)
    },
    [mutateSalesOrders],
  )

  const setSupplierInvoices = useCallback(
    (newInvoices: SupplierInvoice[]) => {
      mutateSupplierInvoices(newInvoices, false)
    },
    [mutateSupplierInvoices],
  )

  const setCustomerInvoices = useCallback(
    (newInvoices: CustomerInvoice[]) => {
      mutateCustomerInvoices(newInvoices as any, false)
    },
    [mutateCustomerInvoices],
  )

  const setBalanceEntries = useCallback(
    (newEntries: BalanceEntry[]) => {
      mutateBalanceEntries(newEntries, false)
    },
    [mutateBalanceEntries],
  )

  const setLostSales = useCallback(
    (newLostSales: LostSale[]) => {
      mutateLostSales(newLostSales, false)
    },
    [mutateLostSales],
  )

  const setUsers = useCallback(
    (newUsers: User[]) => {
      mutateUsers(newUsers, false)
    },
    [mutateUsers],
  )

  // CRUD Operations with optimistic updates
  const addInventoryItem = async (item: InventoryItem) => {
    // Optimistic update
    mutateInventory([...(inventoryData || []), item] as any, false)
    try {
      await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      })
      // Revalidate to get server data
      mutateInventory()
    } catch (error) {
      // Revert on error
      mutateInventory()
      throw error
    }
  }

  const updateInventoryItem = async (item: InventoryItem) => {
    try {
      await fetch("/api/inventory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      })
      mutateInventory()
    } catch (error) {
      console.error("Error updating inventory item:", error)
      throw error
    }
  }

  const updateInventoryQuantity = async (productId: string, quantityChange: number, warehouseId?: string) => {
    // Optimistic update
    const currentData = inventoryData || []
    const updatedData = currentData.map((inv: any) => {
      const matchesProduct = (inv.product_id?.toString() || inv.productId) === productId
      const matchesWarehouse = !warehouseId || (inv.warehouse_id?.toString() || inv.warehouseId) === warehouseId
      if (matchesProduct && matchesWarehouse) {
        return { ...inv, quantity: inv.quantity + quantityChange }
      }
      return inv
    })
    mutateInventory(updatedData, false)

    try {
      await fetch("/api/inventory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          quantityChange,
          updateType: "increment",
          warehouseId,
        }),
      })
      mutateInventory()
    } catch (error) {
      mutateInventory()
      console.error("Error updating inventory:", error)
    }
  }

  const addPurchaseOrder = async (order: PurchaseOrder) => {
    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_number: order.poNumber,
          supplier_id: order.supplierId,
          supplier_name: order.supplierName,
          order_date: order.orderDate,
          expected_delivery: order.expectedDelivery,
          delivery_date: order.deliveryDate,
          status: order.status || "Pending",
          total: order.total,
          tax_amount: order.taxAmount ?? null,
          notes: order.notes,
          payment_type: order.paymentType,
          payment_terms: order.paymentTerms,
          installments: order.installments,
          paymentDetails: order.paymentDetails,
          items: order.items,
          // Hybrid & installment fields — send both camelCase and snake_case for safety
          down_payment_amount: order.downPaymentAmount ?? order.paymentDetails?.downPaymentAmount ?? null,
          down_payment_percent: order.downPaymentPercent ?? order.paymentDetails?.downPaymentPercent ?? null,
          down_payment_type: order.downPaymentType ?? order.paymentDetails?.downPaymentType ?? null,
          down_payment_due_date: order.downPaymentDueDate ?? order.paymentDetails?.downPaymentDueDate ?? null,
          down_payment_cheque_number: order.downPaymentChequeNumber ?? order.paymentDetails?.downPaymentChequeNumber ?? null,
          down_payment_cheque_bank: order.downPaymentChequeBank ?? order.paymentDetails?.downPaymentChequeBank ?? null,
          down_payment_cheque_due_date: order.downPaymentChequeDueDate ?? order.paymentDetails?.downPaymentChequeDueDate ?? null,
          remaining_amount: order.remainingAmount ?? order.paymentDetails?.remainingAmount ?? null,
          remaining_installment_months: order.remainingInstallmentMonths ?? order.paymentDetails?.remainingInstallmentMonths ?? null,
          monthly_amount: order.monthlyAmount ?? order.paymentDetails?.monthlyAmount ?? null,
          payment_start_date: order.paymentStartDate ?? order.paymentDetails?.paymentStartDate ?? null,
          schedule_entries: order.scheduleEntries ? JSON.stringify(order.scheduleEntries) : null,
          schedule_mode: order.scheduleMode,
          // Bank details
          bank_name: order.bankName,
          bank_account_number: order.bankAccountNumber,
          bank_swift_code: order.bankSwiftCode,
          bank_iban: order.bankIban,
          bank_branch: order.bankBranch,
          bank_holder_name: order.bankHolderName,
          // Other
          currency: order.currency,
          po_type: order.poType,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to create purchase order")
      }

      // Refresh PO list
      mutatePurchaseOrders()
    } catch (error) {
      console.error("Error adding purchase order:", error)
      throw error
    }
  }

  const updatePurchaseOrder = async (order: PurchaseOrder | (Partial<PurchaseOrder> & { id: string })) => {
    try {
      const response = await fetch("/api/purchase-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.id,
          status: order.status,
          notes: order.notes,
          payment_type: order.paymentType,
          total: order.total,
          ...(order.rejectionReason ? { rejectionReason: order.rejectionReason } : {}),
        }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        throw new Error(errorBody?.error || "Failed to update purchase order")
      }

      // Refresh multiple caches that might be affected
      await Promise.all([mutatePurchaseOrders(), mutateSupplierInvoices()])
    } catch (error) {
      console.error("Error updating purchase order:", error)
      throw error
    }
  }

  const addSalesOrder = async (order: SalesOrder) => {
    try {
      const response = await fetch("/api/sales-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          so_number: order.soNumber,
          customer_id: order.customerId,
          customer_name: order.customerName,
          order_date: order.orderDate,
          delivery_date: order.deliveryDate,
          status: order.status || "Pending",
          total: order.total,
          subtotal: order.subtotal, // VAT-exclusive amount after discount
          discount_type: order.discountType,
          discount_value: order.discountValue,
          discount_amount: order.discountAmount,
          net_total: order.netTotal || order.total, // VAT-inclusive total
          notes: order.notes,
          payment_type: order.paymentType,
          paymentDetails: order.paymentDetails,
          items: order.items,
          down_payment_amount: order.downPaymentAmount || order.paymentDetails?.downPaymentAmount,
          down_payment_percent: order.downPaymentPercent || order.paymentDetails?.downPaymentPercent,
          down_payment_due_date: order.downPaymentDueDate || order.paymentDetails?.downPaymentDueDate,
          remaining_installment_months:
            order.remainingInstallmentMonths || order.paymentDetails?.remainingInstallmentMonths,
          payment_start_date: order.paymentStartDate || order.paymentDetails?.paymentStartDate,
          schedule_entries: order.scheduleEntries ? JSON.stringify(order.scheduleEntries) : null,
          schedule_mode: order.scheduleMode,
          // Quotation request and contact information
          quotation_request_number: (order as any).quotation_request_number || (order as any).quotationRequestNumber || null,
          quotation_request_file_path: (order as any).quotation_request_file_path || null,
          quotation_request_file_name: (order as any).quotation_request_file_name || null,
          department_name: (order as any).department_name || (order as any).departmentName || null,
          receiver_name: (order as any).receiver_name || (order as any).receiverName || null,
          // Delivery contact info
          delivery_address: order.deliveryAddress,
          delivery_contact_name: order.deliveryContactName,
          delivery_contact_phone: order.deliveryContactPhone,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to create sales order")
      }

      const data = await response.json()

      // Refresh relevant caches
      await Promise.all([mutateSalesOrders(), mutateInventory()])

      return data
    } catch (error) {
      console.error("Error adding sales order:", error)
      throw error
    }
  }

  const updateSalesOrder = async (order: SalesOrder | (Partial<SalesOrder> & { id: string })) => {
    try {
      const soId = (order as any).soId || (order as any).so_id || order.id
      
      
      if (!soId) {
        throw new Error("Sales order ID is required for update")
      }
      
      const payload: Record<string, unknown> = {
        so_id: soId,
        status: order.status,
        notes: order.notes,
        payment_type: order.paymentType,
        total: order.total,
        invoice_file_url: (order as any).invoiceFileUrl,
      }

      // Extended fields used by the "Edit Order" dialog (e.g. correcting an already-approved
      // order to match what was actually approved). Optional so existing narrower callers
      // that only pass status/notes/etc. are unaffected.
      const extended = order as any
      if (extended.items !== undefined) payload.items = extended.items
      if (extended.customerId !== undefined) payload.customerId = extended.customerId
      if (extended.deliveryAddress !== undefined) payload.deliveryAddress = extended.deliveryAddress
      if (extended.deliveryContactName !== undefined) payload.deliveryContactName = extended.deliveryContactName
      if (extended.deliveryContactPhone !== undefined) payload.deliveryContactPhone = extended.deliveryContactPhone
      if (extended.paymentTerms !== undefined) payload.paymentTerms = extended.paymentTerms
      if (extended.installments !== undefined) payload.installments = extended.installments
      if (extended.subtotal !== undefined) payload.subtotal = extended.subtotal
      if (extended.discountType !== undefined) payload.discountType = extended.discountType
      if (extended.discountValue !== undefined) payload.discountValue = extended.discountValue
      if (extended.discountAmount !== undefined) payload.discountAmount = extended.discountAmount
      if (extended.paymentDetails !== undefined) payload.paymentDetails = extended.paymentDetails

      
      const response = await fetch("/api/sales-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Sales order update failed:", response.status, errorText)
        let errorData: any = {}
        try {
          errorData = JSON.parse(errorText)
        } catch (e) {
          console.error("Could not parse error response as JSON")
        }
        throw new Error(errorData.error || `Failed to update sales order (${response.status})`)
      }

      await Promise.all([mutateSalesOrders(), mutateCustomerInvoices()])
    } catch (error) {
      console.error("Error updating sales order:", error)
      throw error
    }
  }

  const addSupplierInvoice = async (invoice: SupplierInvoice) => {
    try {
      const response = await fetch("/api/accounts-payable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to add supplier invoice")
      }
      mutateSupplierInvoices()
    } catch (error) {
      console.error("Error adding supplier invoice:", error)
      throw error
    }
  }

  const updateSupplierInvoice = async (invoiceId: string, updates: Partial<SupplierInvoice>) => {
    try {
      const response = await fetch("/api/accounts-payable", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoiceId, ...updates }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to update supplier invoice")
      }
      mutateSupplierInvoices()
    } catch (error) {
      console.error("Error updating supplier invoice:", error)
      throw error
    }
  }

  const addCustomerInvoice = async (invoice: CustomerInvoice) => {
    try {
      await fetch("/api/accounts-receivable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice),
      })
      mutateCustomerInvoices()
    } catch (error) {
      console.error("Error adding customer invoice:", error)
      throw error
    }
  }

  const updateCustomerInvoice = async (invoiceId: string, updates: Partial<CustomerInvoice>) => {
    try {
      await fetch("/api/accounts-receivable", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoiceId, ...updates }),
      })
      mutateCustomerInvoices()
    } catch (error) {
      console.error("Error updating customer invoice:", error)
      throw error
    }
  }

  const addSupplier = async (supplier: Supplier) => {
    // Optimistic update
    mutateSuppliers([...suppliers, supplier], false)
    try {
      await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplier),
      })
      mutateSuppliers()
    } catch (error) {
      mutateSuppliers()
      throw error
    }
  }

  const updateSupplier = async (supplier: Supplier) => {
    try {
      await fetch("/api/suppliers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplier),
      })
      mutateSuppliers()
    } catch (error) {
      console.error("Error updating supplier:", error)
      throw error
    }
  }

  const deleteSupplier = async (id: string) => {
    // Optimistic update
    mutateSuppliers(
      suppliers.filter((s) => s.id !== id),
      false,
    )
    try {
      await fetch(`/api/suppliers?id=${id}`, { method: "DELETE" })
      mutateSuppliers()
    } catch (error) {
      mutateSuppliers()
      throw error
    }
  }

  const addCustomer = async (customer: Customer) => {
    mutateCustomers([...customers, customer], false)
    try {
      await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customer),
      })
      mutateCustomers()
    } catch (error) {
      mutateCustomers()
      throw error
    }
  }

  const updateCustomer = async (customer: Customer) => {
    try {
      await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customer),
      })
      mutateCustomers()
    } catch (error) {
      console.error("Error updating customer:", error)
      throw error
    }
  }

  const deleteCustomer = async (id: string) => {
    mutateCustomers(
      customers.filter((c) => c.id !== id),
      false,
    )
    try {
      await fetch(`/api/customers?id=${id}`, { method: "DELETE" })
      mutateCustomers()
    } catch (error) {
      mutateCustomers()
      throw error
    }
  }

  const addProduct = async (product: Product) => {
    mutateProducts([...products, product], false)
    try {
      await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product),
      })
      mutateProducts()
    } catch (error) {
      mutateProducts()
      throw error
    }
  }

  const updateProduct = async (product: Product) => {
    try {
      await fetch("/api/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product),
      })
      mutateProducts()
    } catch (error) {
      console.error("Error updating product:", error)
      throw error
    }
  }

  const deleteProduct = async (id: string) => {
    mutateProducts(
      products.filter((p) => p.id !== id),
      false,
    )
    try {
      await fetch(`/api/products?id=${id}`, { method: "DELETE" })
      mutateProducts()
    } catch (error) {
      mutateProducts()
      throw error
    }
  }

  const resetAllData = async () => {
    try {
      await fetch("/api/reset", { method: "POST" })
      // Clear all SWR caches and reload
      await Promise.all([
        mutateCustomers(),
        mutateSuppliers(),
        mutateProducts(),
        mutateCouriers(),
        mutateInventory(),
        mutatePurchaseOrders(),
        mutateSalesOrders(),
        mutateSupplierInvoices(),
        mutateCustomerInvoices(),
        mutateBalanceEntries(),
        mutateLostSales(),
        mutateUsers(),
      ])
    } catch (error) {
      console.error("Error resetting data:", error)
    }
  }

  return (
    <AppContext.Provider
      value={{
        inventory,
        setInventory,
        addInventoryItem,
        updateInventoryItem,
        updateInventoryQuantity,
        purchaseOrders,
        setPurchaseOrders,
        addPurchaseOrder,
        updatePurchaseOrder,
        salesOrders,
        setSalesOrders,
        addSalesOrder,
        updateSalesOrder,
        supplierInvoices,
        setSupplierInvoices,
        addSupplierInvoice,
        updateSupplierInvoice,
        customerInvoices,
        setCustomerInvoices,
        addCustomerInvoice,
        updateCustomerInvoice,
        suppliers,
        setSuppliers,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        customers,
        setCustomers,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        products,
        setProducts,
        addProduct,
        updateProduct,
        deleteProduct,
        couriers,
        setCouriers,
        refreshCouriers,
        warehouses: warehousesData || [],
        setWarehouses: mutateWarehouses,
        refreshWarehouses: mutateWarehouses,
        prepaidBalance,
        setPrepaidBalance,
        loadData,
        isLoading,
        resetAllData,
        lostSales,
        setLostSales,
        balanceEntries,
        setBalanceEntries,
        users,
        setUsers,
        refreshPurchaseOrders,
        refreshSalesOrders,
        refreshInventory,
        refreshSupplierInvoices,
        refreshCustomerInvoices,
        refreshBalanceEntries,
        refreshCustomers,
        refreshSuppliers,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider")
  }
  return context
}

export const useApp = useAppContext
