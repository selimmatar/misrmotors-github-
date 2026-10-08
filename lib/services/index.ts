/**
 * Centralized Service Layer for Misr Motors ERP
 * Single source of truth for all data access
 */

// Types
export interface ServiceResult<T> {
  data: T | null
  error: string | null
  success: boolean
}

// Helper to create service result
export function success<T>(data: T): ServiceResult<T> {
  return { data, error: null, success: true }
}

export function failure<T>(error: string): ServiceResult<T> {
  return { data: null, error, success: false }
}

// Base fetch helper with error handling
export async function serviceFetch<T>(url: string, options?: RequestInit): Promise<ServiceResult<T>> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error || errorJson.message || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      return failure(errorMessage)
    }

    const data = await response.json()
    return success(data)
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unknown error")
  }
}

// ========== SALES ORDERS ==========
export const salesOrders = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/sales-orders")
  },

  async get(id: number): Promise<ServiceResult<any>> {
    const result = await serviceFetch<any[]>("/api/sales-orders")
    if (!result.success || !result.data) return failure(result.error || "Failed to fetch")
    const order = result.data.find((o: any) => o.id === id || o.soId === id)
    return order ? success(order) : failure("Sales order not found")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async update(id: number, payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/sales-orders", {
      method: "PUT",
      body: JSON.stringify({ id, ...payload }),
    })
  },

  async updateStatus(id: number, status: string, approvedBy?: number): Promise<ServiceResult<any>> {
    return serviceFetch("/api/sales-orders", {
      method: "PUT",
      body: JSON.stringify({ id, status, approvedBy }),
    })
  },
}

// ========== PURCHASE ORDERS ==========
export const purchaseOrders = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/purchase-orders")
  },

  async get(id: number): Promise<ServiceResult<any>> {
    const result = await serviceFetch<any[]>("/api/purchase-orders")
    if (!result.success || !result.data) return failure(result.error || "Failed to fetch")
    const order = result.data.find((o: any) => o.id === id || o.poId === id)
    return order ? success(order) : failure("Purchase order not found")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async update(id: number, payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/purchase-orders", {
      method: "PUT",
      body: JSON.stringify({ id, ...payload }),
    })
  },

  async approve(id: number, approvedBy: number): Promise<ServiceResult<any>> {
    return serviceFetch("/api/purchase-orders", {
      method: "PUT",
      body: JSON.stringify({ id, status: "approved", approvedBy }),
    })
  },

  async receive(id: number): Promise<ServiceResult<any>> {
    return serviceFetch("/api/purchase-orders", {
      method: "PUT",
      body: JSON.stringify({ id, status: "received" }),
    })
  },

  async finalizeCost(id: number, payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/purchase-orders/finalize-cost", {
      method: "POST",
      body: JSON.stringify({ poId: id, ...payload }),
    })
  },
}

// ========== INVENTORY ==========
export const inventory = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/inventory")
  },

  async get(id: number): Promise<ServiceResult<any>> {
    const result = await serviceFetch<any[]>("/api/inventory")
    if (!result.success || !result.data) return failure(result.error || "Failed to fetch")
    const item = result.data.find((i: any) => i.id === id || i.inventoryId === id)
    return item ? success(item) : failure("Inventory item not found")
  },

  async adjust(payload: { productId: number; quantity: number; reason: string }): Promise<ServiceResult<any>> {
    return serviceFetch("/api/inventory", {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  },

  async getLowStock(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/inventory/low-stock")
  },

  async audit(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/inventory/audit", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}

// ========== PRODUCTS ==========
export const products = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/products")
  },

  async get(id: number): Promise<ServiceResult<any>> {
    const result = await serviceFetch<any[]>("/api/products")
    if (!result.success || !result.data) return failure(result.error || "Failed to fetch")
    const product = result.data.find((p: any) => p.id === id || p.productId === id)
    return product ? success(product) : failure("Product not found")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/products", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async update(id: number, payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/products", {
      method: "PUT",
      body: JSON.stringify({ id, ...payload }),
    })
  },

  async updatePricing(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/products/update-pricing", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}

// ========== CUSTOMERS ==========
export const customers = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/customers")
  },

  async get(id: number): Promise<ServiceResult<any>> {
    const result = await serviceFetch<any[]>("/api/customers")
    if (!result.success || !result.data) return failure(result.error || "Failed to fetch")
    const customer = result.data.find((c: any) => c.id === id || c.customerId === id)
    return customer ? success(customer) : failure("Customer not found")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/customers", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async update(id: number, payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/customers", {
      method: "PUT",
      body: JSON.stringify({ id, ...payload }),
    })
  },
}

// ========== SUPPLIERS ==========
export const suppliers = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/suppliers")
  },

  async get(id: number): Promise<ServiceResult<any>> {
    const result = await serviceFetch<any[]>("/api/suppliers")
    if (!result.success || !result.data) return failure(result.error || "Failed to fetch")
    const supplier = result.data.find((s: any) => s.id === id || s.supplierId === id)
    return supplier ? success(supplier) : failure("Supplier not found")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/suppliers", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async update(id: number, payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/suppliers", {
      method: "PUT",
      body: JSON.stringify({ id, ...payload }),
    })
  },
}

// ========== ACCOUNTS RECEIVABLE ==========
export const accountsReceivable = {
  async listInvoices(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/accounts-receivable")
  },

  async recordPayment(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/customer-payments", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}

// ========== ACCOUNTS PAYABLE ==========
export const accountsPayable = {
  async listBills(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/accounts-payable")
  },

  // Body shape of recordApPayment (lib/ap-payments.ts). The old /api/supplier-payments POST is retired (410).
  async recordPayment(payload: {
    invoiceId: number
    amount: number
    paymentMethod: "cash" | "cheque" | "bank_transfer"
    receiptUrl: string
    idempotencyKey: string
    scheduleId?: number
    paymentDate?: string
    allowOverpayment?: boolean
  }): Promise<ServiceResult<any>> {
    return serviceFetch("/api/accounts-payable/payments", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}

// ========== ANALYTICS ==========
export const analytics = {
  async getKPIs(): Promise<ServiceResult<any>> {
    return serviceFetch("/api/analytics/kpis")
  },

  async getSales(): Promise<ServiceResult<any>> {
    return serviceFetch("/api/analytics/sales")
  },

  async getFinancial(): Promise<ServiceResult<any>> {
    return serviceFetch("/api/analytics/financial")
  },

  async getInventory(): Promise<ServiceResult<any>> {
    return serviceFetch("/api/analytics/inventory")
  },
}

// ========== BALANCE ==========
export const balance = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/balance")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/balance", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}

// ========== LOST SALES ==========
export const lostSales = {
  async list(): Promise<ServiceResult<any[]>> {
    return serviceFetch("/api/lost-sales")
  },

  async create(payload: any): Promise<ServiceResult<any>> {
    return serviceFetch("/api/lost-sales", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}
