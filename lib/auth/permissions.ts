// Who may read (GET/HEAD) or change (anything else) each part of /api. Admin and CEO always pass.
// One rule per route prefix; the longest prefix that matches on whole path segments wins. Owner-approved 2026-10-31.
import type { UserRole } from "@/lib/types"

export type Access = UserRole[] | "signed-in"
export interface Rule {
  prefix: string
  read: Access
  write: Access
}

const ALL: Access = "signed-in"
const ONLY_TOP: Access = [] // admin and CEO only

const SALES: UserRole[] = ["sales-rep", "accountant"]
const PURCHASING: UserRole[] = ["po-rep", "accountant"]
const PO_READERS: UserRole[] = ["po-rep", "accountant", "warehouse-rep"]
const STOCK_PLANNERS: UserRole[] = ["po-rep", "warehouse-rep", "sales-rep"]
const RETURNS: UserRole[] = ["sales-rep", "accountant", "warehouse-rep"]
const CUSTOMER_MONEY: UserRole[] = ["accountant", "sales-rep"]
const ACCOUNTANT: UserRole[] = ["accountant"]

const rule = (prefix: string, read: Access, write: Access): Rule => ({ prefix, read, write })

export const RULES: Rule[] = [
  // Products and suppliers
  rule("/api/products", ALL, PURCHASING),
  rule("/api/products/update-pricing", PURCHASING, PURCHASING),
  rule("/api/categories", ALL, PURCHASING),
  rule("/api/product-images", ALL, PURCHASING),
  rule("/api/suppliers", ALL, PURCHASING),
  // Customers and contacts
  rule("/api/customers", ALL, SALES),
  rule("/api/party-contacts", ALL, ["sales-rep", "accountant", "po-rep"]),
  // Stock
  rule("/api/warehouses", ALL, ["warehouse-rep"]),
  rule("/api/inventory", ALL, ["warehouse-rep"]),
  rule("/api/inventory/audit", ["warehouse-rep", "po-rep"], ["warehouse-rep"]),
  rule("/api/warehouse-transfers", ["warehouse-rep", "po-rep"], ["warehouse-rep"]),
  rule("/api/inventory/reorder-suggestions", STOCK_PLANNERS, ["po-rep"]),
  rule("/api/lowstock", STOCK_PLANNERS, ["po-rep"]),
  // Sales
  rule("/api/sales-quotations", ALL, SALES),
  // The sales rep's conversion of a quotation approves the order (workflow of 2026-10-28), so they need these too.
  rule("/api/sales-quotations/approve", SALES, SALES),
  rule("/api/sales-quotations/reject", SALES, SALES),
  rule("/api/sales-quotations/supplier-quotes/upload", ALL, ALL),
  rule("/api/quotation-drafts", ALL, SALES),
  rule("/api/quotations", ALL, SALES),
  rule("/api/sales-orders", ALL, SALES),
  rule("/api/lost-sales", ["sales-rep", "po-rep"], ["sales-rep"]),
  rule("/api/lost-sales-summary", ["sales-rep", "po-rep"], ["sales-rep"]),
  // Purchasing
  rule("/api/po-requests", ALL, ["sales-rep", "po-rep", "accountant"]),
  rule("/api/po-requests/read-prices", PURCHASING, PURCHASING),
  rule("/api/purchase-orders", PO_READERS, PURCHASING),
  rule("/api/goods-receipts", PO_READERS, ["warehouse-rep"]),
  // Delivery
  rule("/api/delivery-permits", ALL, ["sales-rep", "accountant", "warehouse-rep", "shipment"]),
  rule("/api/delivery-permits/upload", ALL, ALL),
  rule("/api/couriers", ALL, ONLY_TOP),
  rule("/api/operations", ALL, ONLY_TOP),
  rule("/api/returns", RETURNS, RETURNS),
  rule("/api/product-returns", RETURNS, RETURNS),
  // Customer money
  rule("/api/accounts-receivable", CUSTOMER_MONEY, ACCOUNTANT),
  rule("/api/customer-payments", CUSTOMER_MONEY, ACCOUNTANT),
  rule("/api/customer-credits", CUSTOMER_MONEY, ACCOUNTANT),
  rule("/api/invoices/ar", CUSTOMER_MONEY, ACCOUNTANT),
  // Supplier money
  rule("/api/accounts-payable", ACCOUNTANT, ACCOUNTANT),
  rule("/api/supplier-payments", ACCOUNTANT, ACCOUNTANT),
  rule("/api/supplier-credits", ACCOUNTANT, ACCOUNTANT),
  rule("/api/invoices/ap", ACCOUNTANT, ACCOUNTANT),
  // Schedules and balance (a sales rep may ask for a new schedule)
  rule("/api/payment-schedules", ACCOUNTANT, ["accountant", "sales-rep"]),
  rule("/api/balance", ACCOUNTANT, ACCOUNTANT),
  // Maintenance
  rule("/api/maintenance", ["accountant", "sales-rep", "warehouse-rep"], ["accountant", "sales-rep"]),
  // Reports
  rule("/api/reports", ["accountant", "sales-rep"], ONLY_TOP),
  rule("/api/analytics", ["accountant", "sales-rep", "po-rep"], ONLY_TOP),
  rule("/api/metrics", ["accountant", "sales-rep"], ONLY_TOP),
  rule("/api/metrics/validate", ONLY_TOP, ONLY_TOP),
  // AI assistant
  rule("/api/ai", ONLY_TOP, ONLY_TOP),
  rule("/api/ai/po-assistant", PURCHASING, PURCHASING),
  rule("/api/ai/extract-invoice", PURCHASING, PURCHASING),
  rule("/api/ai/analyze-inventory", PURCHASING, PURCHASING),
  rule("/api/ai/action-recommendations", PURCHASING, PURCHASING),
  rule("/api/ai/sales-insights", ["sales-rep"], ["sales-rep"]),
  // Files
  rule("/api/documents/upload", ALL, ALL),
  rule("/api/upload", ALL, ALL),
  // HR, accounts, settings
  rule("/api/hr", ONLY_TOP, ONLY_TOP),
  rule("/api/users", ONLY_TOP, ONLY_TOP),
  rule("/api/settings", ALL, ONLY_TOP),
  rule("/api/system-health", ONLY_TOP, ONLY_TOP),
  // Counters and links shown to everyone
  rule("/api/pending-counts", ALL, ONLY_TOP),
  rule("/api/chain", ALL, ONLY_TOP),
  // Own session (any logged-in person)
  rule("/api/auth", ALL, ALL),
]

/** Reachable without logging in. */
export const PUBLIC_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/forgot", "/api/auth/me"]

export function ruleFor(path: string): Rule | null {
  let best: Rule | null = null
  for (const r of RULES) {
    if (path === r.prefix || path.startsWith(r.prefix + "/")) {
      if (!best || r.prefix.length > best.prefix.length) best = r
    }
  }
  return best
}

export function allows(rule: Rule, method: string, roles: UserRole[]): boolean {
  if (roles.includes("admin") || roles.includes("ceo")) return true
  if (roles.length === 0) return false
  const m = method.toUpperCase()
  const access = m === "GET" || m === "HEAD" ? rule.read : rule.write
  if (access === "signed-in") return true
  return roles.some((r) => access.includes(r))
}
