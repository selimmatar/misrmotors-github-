// Money figures on the financial dashboard. Revenue and expenses are shown before VAT (VAT is collected for and paid
// to the tax authority, it is not income or cost), and supplier invoices count what is actually paid, part payments
// included.
import { VAT_RATE, round2 } from "@/lib/invoicing"

/** A customer invoice amount without its 14% VAT (every customer invoice is issued VAT-inclusive). */
export const withoutVat = (amount: number) => round2((Number(amount) || 0) / (1 + VAT_RATE))

/** A supplier invoice amount without the VAT its purchase order added (none when the order had VAT off). */
export function supplierAmountWithoutVat(amount: number, po?: { total?: number; taxAmount?: number } | null) {
  const value = Number(amount) || 0
  const total = Number(po?.total) || 0
  const tax = Number(po?.taxAmount) || 0
  return total > 0 && tax > 0 ? round2((value * (total - tax)) / total) : value
}

/** What has been paid on a supplier invoice (all of it once it is marked paid). */
export function supplierPaid(inv: { amount?: number; paidAmount?: number; status?: string }) {
  const amount = Number(inv.amount) || 0
  return inv.status === "paid" ? amount : Math.min(amount, Math.max(0, Number(inv.paidAmount) || 0))
}

/** What is still owed on a supplier invoice. */
export const supplierUnpaid = (inv: { amount?: number; paidAmount?: number; status?: string }) =>
  round2((Number(inv.amount) || 0) - supplierPaid(inv))

/** Gross margin as a percentage of revenue, "N/A" when there is no revenue. */
export const profitMarginPercent = (profit: number, revenue: number) => (revenue > 0 ? ((profit / revenue) * 100).toFixed(2) : "N/A")
