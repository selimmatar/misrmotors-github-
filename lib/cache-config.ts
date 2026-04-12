export const CACHE_TAGS = {
  // Reference data (rarely changes)
  CUSTOMERS: "customers",
  SUPPLIERS: "suppliers",
  PRODUCTS: "products",
  COURIERS: "couriers",
  WAREHOUSES: "warehouses",
  USERS: "users",

  // Transactional data (frequently changes)
  INVENTORY: "inventory",
  PURCHASE_ORDERS: "purchase-orders",
  SALES_ORDERS: "sales-orders",
  ACCOUNTS_PAYABLE: "accounts-payable",
  ACCOUNTS_RECEIVABLE: "accounts-receivable",
  PAYMENT_SCHEDULES: "payment-schedules",
  DELIVERY_PERMITS: "delivery-permits",
  BALANCE: "balance",

  // Dashboard/analytics (computed)
  DASHBOARD_FINANCIAL: "dashboard-financial",
  DASHBOARD_INVENTORY: "dashboard-inventory",
  ANALYTICS: "analytics",
} as const

export const CACHE_TTL = {
  // Reference data - long cache
  REFERENCE: 60 * 60, // 1 hour

  // Lists - medium cache
  LISTS: 120, // 2 minutes

  // Financial/inventory - short cache
  FINANCIAL: 30, // 30 seconds
  INVENTORY: 20, // 20 seconds

  // Dashboards - medium cache
  DASHBOARDS: 120, // 2 minutes

  // Analytics - long cache (should be precomputed)
  ANALYTICS: 300, // 5 minutes
} as const

export function getCacheTags(endpoint: string): string[] {
  // Map endpoints to their cache tags
  if (endpoint.includes("/customers")) return [CACHE_TAGS.CUSTOMERS]
  if (endpoint.includes("/suppliers")) return [CACHE_TAGS.SUPPLIERS]
  if (endpoint.includes("/products")) return [CACHE_TAGS.PRODUCTS]
  if (endpoint.includes("/couriers")) return [CACHE_TAGS.COURIERS]
  if (endpoint.includes("/users")) return [CACHE_TAGS.USERS]
  if (endpoint.includes("/inventory")) return [CACHE_TAGS.INVENTORY]
  if (endpoint.includes("/purchase-orders")) return [CACHE_TAGS.PURCHASE_ORDERS]
  if (endpoint.includes("/sales-orders")) return [CACHE_TAGS.SALES_ORDERS]
  if (endpoint.includes("/accounts-payable")) return [CACHE_TAGS.ACCOUNTS_PAYABLE]
  if (endpoint.includes("/accounts-receivable")) return [CACHE_TAGS.ACCOUNTS_RECEIVABLE]
  if (endpoint.includes("/payment-schedules")) return [CACHE_TAGS.PAYMENT_SCHEDULES]
  if (endpoint.includes("/delivery-permits")) return [CACHE_TAGS.DELIVERY_PERMITS]
  if (endpoint.includes("/balance")) return [CACHE_TAGS.BALANCE]

  return []
}

export function getCacheTTL(endpoint: string): number {
  // Reference data
  if (endpoint.match(/(customers|suppliers|products|couriers|warehouses|users)/)) {
    return CACHE_TTL.REFERENCE
  }

  // Financial/inventory
  if (endpoint.match(/(accounts-payable|accounts-receivable|payment-schedules|balance)/)) {
    return CACHE_TTL.FINANCIAL
  }

  if (endpoint.includes("/inventory")) {
    return CACHE_TTL.INVENTORY
  }

  // Dashboards/analytics
  if (endpoint.match(/(dashboard|analytics)/)) {
    return CACHE_TTL.DASHBOARDS
  }

  // Default for lists
  return CACHE_TTL.LISTS
}
