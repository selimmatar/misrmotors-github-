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
const QUICK_INVOICE: UserRole[] = ["maintenance", "accountant"]

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
  rule("/api/notes", ALL, ALL),
  rule("/api/sales-orders", ALL, SALES),
  rule("/api/sales-orders/overview/profit", ONLY_TOP, ONLY_TOP),
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
  // "Correct delivery permit" during correct-and-reissue (spec §6.5a): accountant, CEO, admin only
  rule("/api/delivery-permits/correct", ACCOUNTANT, ACCOUNTANT),
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
  // Maintenance quick invoice (owner-approved 2026-11-17): the maintenance person's one screen; the accountant too
  rule("/api/maintenance/quick-invoice", QUICK_INVOICE, QUICK_INVOICE),
  // Maintenance photo drafts (owner-approved 2026-11-19): the accountant reviews them; worker links: admin / CEO only
  rule("/api/maintenance/photo-drafts", ACCOUNTANT, ACCOUNTANT),
  rule("/api/maintenance/upload-links", ONLY_TOP, ONLY_TOP),
  // Carbon booklets (owner request 2026-11-19): only admin / CEO see, print and give them out (Maintenance tab)
  rule("/api/maintenance/booklets", ONLY_TOP, ONLY_TOP),
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
  rule("/api/pending-counts/dismiss", ["po-rep"], ["po-rep"]),
  rule("/api/chain", ALL, ONLY_TOP),
  // E-invoice (ETA) settings, item codes and name memory
  rule("/api/eta", ACCOUNTANT, ACCOUNTANT),
  // how well the item-code prediction does on the real memory (tuning): CEO / admin only
  rule("/api/eta/predict/evaluate", ONLY_TOP, ONLY_TOP),
  // Own session (any logged-in person)
  rule("/api/auth", ALL, ALL),
]

/**
 * Reachable without logging in. The e-invoice signer paths check the signer key themselves (x-eta-signer-key) and
 * /api/eta-sync checks the cron secret (spec §8, owner-approved 2026-11-15); each refuses anything without it.
 */
export const PUBLIC_PATHS = [
  "/api/auth/login", "/api/auth/logout", "/api/auth/forgot", "/api/auth/me",
  "/api/eta-signer/next", "/api/eta-signer/signed", "/api/eta-signer/ping", "/api/eta-sync",
]

/**
 * Reachable without logging in, for every path under these. /api/worker-upload/<secret>: the maintenance worker's
 * photo upload (owner-approved 2026-11-19); the route checks the secret itself and can only add a photo draft.
 */
export const PUBLIC_PREFIXES = ["/api/worker-upload/"]

export const isPublicPath = (path: string) => PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))

export function ruleFor(path: string): Rule | null {
  let best: Rule | null = null
  for (const r of RULES) {
    if (path === r.prefix || path.startsWith(r.prefix + "/")) {
      if (!best || r.prefix.length > best.prefix.length) best = r
    }
  }
  return best
}

/** Besides the rules that name it, a person whose only role is "maintenance" may use their own session. */
const MAINTENANCE_ONLY_OPEN = ["/api/auth"]

export function allows(rule: Rule, method: string, roles: UserRole[]): boolean {
  if (roles.includes("admin") || roles.includes("ceo")) return true
  if (roles.length === 0) return false
  const m = method.toUpperCase()
  const access = m === "GET" || m === "HEAD" ? rule.read : rule.write
  // The maintenance role reaches only the rules that name it: "signed-in" does not open the rest of the system to it
  // (owner-approved 2026-11-17). Someone with another role as well gets that role's access as usual.
  if (roles.every((r) => r === "maintenance")) {
    return MAINTENANCE_ONLY_OPEN.includes(rule.prefix) || (access !== "signed-in" && access.includes("maintenance"))
  }
  if (access === "signed-in") return true
  return roles.some((r) => access.includes(r))
}
