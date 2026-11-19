// Invoice codes (spec docs/superpowers/specs/2026-11-19-invoice-codes-and-maintenance-photos-design.md, part 1).
// Sales invoices are INV, maintenance invoices are MINV, each followed by the last two digits of the year and its own
// serial, no dashes: INV265567, MINV265567. Each code and year starts at 5567. Older numbers (INV-2026-0001, 10503,
// INV-MNT-...) never match these patterns, so they do not move the new counters.
// No imports on purpose: lib/invoicing.ts, lib/maintenance-quick-invoice.ts and client code all use this file.

export type InvoiceCode = "INV" | "MINV"

export const INVOICE_SERIAL_START = 5567

/** Sales order type of a quick maintenance order (an allowed value of sales_orders.so_type). */
export const QUICK_SO_TYPE = "MAINTENANCE_PARTS"
/** Notes on the quick order: with QUICK_SO_TYPE it marks the order (and its invoice) as maintenance. */
export const QUICK_SO_NOTE = "Maintenance quick invoice"

/** Last two digits of the current year in Cairo, e.g. "26". */
export function invoiceYear2(now: Date = new Date()): string {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric" }).format(now)
  return year.slice(-2)
}

/** The next free number of a code and year, given the numbers that already start with that code and year. */
export function nextCodedNumber(code: InvoiceCode, year2: string, existing: Array<string | null | undefined>, attemptOffset = 0): string {
  const pattern = new RegExp(`^${code}${year2}(\\d+)$`)
  let max = 0
  for (const number of existing) {
    const match = pattern.exec(String(number || ""))
    if (match) max = Math.max(max, Number.parseInt(match[1], 10))
  }
  const serial = Math.max(max + 1, INVOICE_SERIAL_START) + attemptOffset
  return `${code}${year2}${serial}`
}

/** A quick maintenance order: its invoices are maintenance (MINV). */
export function isQuickMaintenanceOrder(order: { so_type?: string | null; notes?: string | null } | null | undefined): boolean {
  return !!order && order.so_type === QUICK_SO_TYPE && String(order.notes || "").startsWith(QUICK_SO_NOTE)
}

/** MINV only when every order of the invoice is a quick maintenance order; anything else is a sales invoice. */
export function invoiceCodeForOrders(orders: Array<{ so_type?: string | null; notes?: string | null } | null | undefined>): InvoiceCode {
  return orders.length > 0 && orders.every(isQuickMaintenanceOrder) ? "MINV" : "INV"
}

/** An MINV number (new maintenance invoices). */
export function isMinvNumber(number: string | null | undefined): boolean {
  return /^MINV/i.test(String(number || ""))
}

/** A number that by itself marks a maintenance invoice: MINV, or an old work-order invoice (INV-MNT-...). */
export function isMaintenanceNumber(number: string | null | undefined): boolean {
  return /^(MINV|INV-MNT-)/i.test(String(number || ""))
}
