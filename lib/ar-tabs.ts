// Accounts Receivable list tabs (spec 2026-11-17): Sales and Maintenance. The server tells each invoice's tab
// (app/api/accounts-receivable GET, `arTab`, from isMaintenanceInvoice in lib/maintenance-quick-invoice.ts); an invoice
// without it is a sales invoice, except a work-order maintenance invoice (INV-MNT-), which is always maintenance.
export const AR_TABS = ["sales", "maintenance"] as const
export type ArTab = (typeof AR_TABS)[number]

export function tabOf(inv: { arTab?: string | null; invoiceNumber?: string | null }): ArTab {
  if (inv.arTab === "maintenance" || String(inv.invoiceNumber || "").startsWith("INV-MNT-")) return "maintenance"
  return "sales"
}

export function invoicesForTab<T extends { arTab?: string | null; invoiceNumber?: string | null }>(list: readonly T[], tab: ArTab): T[] {
  return list.filter((inv) => tabOf(inv) === tab)
}
