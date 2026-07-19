"use client"

import useSWR from "swr"
import { useMemo } from "react"
import type {
  InventoryItem,
  PurchaseOrder,
  SalesOrder,
  SupplierInvoice,
  CustomerInvoice,
  Supplier,
  Customer,
  Product,
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

// SWR options for different data types
const CORE_DATA_OPTIONS = {
  revalidateOnFocus: false,
  revalidateIfStale: false, // Use cache, don't auto-revalidate
  dedupingInterval: 30000, // 30 second dedup window
}

const TRANSACTION_DATA_OPTIONS = {
  revalidateOnFocus: false,
  revalidateIfStale: true, // Can be stale, will revalidate in background
  dedupingInterval: 10000, // 10 second dedup window
}

// Core reference data hooks (rarely changes)
export function useProducts() {
  const { data, error, isLoading, mutate } = useSWR<Product[]>("/api/products", { ...CORE_DATA_OPTIONS })
  return { products: data || [], error, isLoading, refresh: mutate }
}

export function useCustomers() {
  const { data, error, isLoading, mutate } = useSWR<Customer[]>("/api/customers", { ...CORE_DATA_OPTIONS })
  return { customers: data || [], error, isLoading, refresh: mutate }
}

export function useSuppliers() {
  const { data, error, isLoading, mutate } = useSWR<Supplier[]>("/api/suppliers", { ...CORE_DATA_OPTIONS })
  return { suppliers: data || [], error, isLoading, refresh: mutate }
}

export function useCouriers() {
  const { data, error, isLoading, mutate } = useSWR<Courier[]>("/api/couriers", { ...CORE_DATA_OPTIONS })
  return { couriers: data || [], error, isLoading, refresh: mutate }
}

// Transaction data hooks (changes frequently)
export function useSalesOrders() {
  const { data, error, isLoading, mutate } = useSWR<SalesOrder[]>("/api/sales-orders", { ...TRANSACTION_DATA_OPTIONS })
  return { salesOrders: data || [], error, isLoading, refresh: mutate }
}

export function usePurchaseOrders() {
  const { data, error, isLoading, mutate } = useSWR<PurchaseOrder[]>("/api/purchase-orders", {
    ...TRANSACTION_DATA_OPTIONS,
  })

  // Process PO data to normalize items
  const processedOrders = useMemo(() => {
    if (!data) return []
    return data.map((po: any) => ({
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
  }, [data])

  return { purchaseOrders: processedOrders, error, isLoading, refresh: mutate }
}

export function useInventory() {
  const { data, error, isLoading, mutate } = useSWR<any[]>("/api/inventory", { ...TRANSACTION_DATA_OPTIONS })

  // Process inventory data
  const processedInventory = useMemo(() => {
    if (!data) return []
    return data.map((inv: any) => ({
      id: inv.inventory_id?.toString() || inv.id,
      inventoryId: inv.inventory_id ?? inv.inventoryId,
      productId: inv.product_id?.toString() || inv.productId,
      productName: inv.products?.product_name || inv.productName || inv.outsourcedName || inv.outsourced_name || "Unknown",
      sku: inv.products?.sku || inv.sku || "",
      unit: inv.products?.unit || inv.unit || "unit",
      quantity: inv.quantity,
      reorderPoint: inv.reorder_point ?? inv.reorderPoint,
      location: inv.location,
      lastUpdated: inv.last_updated || inv.lastUpdated,
      unitCost: inv.unit_cost ?? inv.unitCost ?? 0,
      isReturned: inv.isReturned ?? inv.is_returned ?? false,
      isOutsourced: inv.isOutsourced ?? inv.is_outsourced ?? false,
      supplierName: inv.supplierName ?? inv.supplier_name ?? null,
      soNumber: inv.soNumber ?? inv.so_number ?? null,
      outsourcedName: inv.outsourcedName ?? inv.outsourced_name ?? null,
      warehouseId: inv.warehouseId ?? inv.warehouse_id,
      warehouseName: inv.warehouseName ?? inv.warehouses?.warehouse_name,
    }))
  }, [data])

  return { inventory: processedInventory as InventoryItem[], error, isLoading, refresh: mutate }
}

export function useSupplierInvoices() {
  const { data, error, isLoading, mutate } = useSWR<SupplierInvoice[]>("/api/accounts-payable", {
    ...TRANSACTION_DATA_OPTIONS,
  })
  return { supplierInvoices: data || [], error, isLoading, refresh: mutate }
}

export function useCustomerInvoices() {
  const { data, error, isLoading, mutate } = useSWR<any[]>("/api/accounts-receivable", { ...TRANSACTION_DATA_OPTIONS })

  // Process customer invoices
  const processedInvoices = useMemo(() => {
    if (!data) return []
    return data.map((inv: any) => ({
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
  }, [data])

  return { customerInvoices: processedInvoices as CustomerInvoice[], error, isLoading, refresh: mutate }
}

export function useBalanceEntries() {
  const { data, error, isLoading, mutate } = useSWR<BalanceEntry[]>("/api/balance", { ...TRANSACTION_DATA_OPTIONS })
  return { balanceEntries: data || [], error, isLoading, refresh: mutate }
}

export function useLostSales() {
  const { data, error, isLoading, mutate } = useSWR<LostSale[]>("/api/lost-sales", { ...CORE_DATA_OPTIONS })
  return { lostSales: data || [], error, isLoading, refresh: mutate }
}

export function useUsers() {
  const { data, error, isLoading, mutate } = useSWR<any[]>("/api/users", { ...CORE_DATA_OPTIONS })
  return { users: data || [], error, isLoading, refresh: mutate }
}
