// Supplier bill numbers of a purchase order (owner request, 2026-11-17: "bill received items", several bills per PO).
// Pure helpers, safe in the browser too.
//
//   APINV-<po number>        the bill that CLOSES the PO (the final bill; also every bill made before 2026-11-17)
//   APINV-<po number>-B<n>   a bill for received items while the PO stays open (n = 1, 2, ...)
//
// A PO is closed when it has a closing bill. Partial bills alone leave it open.

export const closingBillNumber = (poNumber: string) => `APINV-${poNumber}`
export const partialBillNumber = (poNumber: string, n: number) => `APINV-${poNumber}-B${n}`

/** The n of a partial bill of this PO, or null when the number is not one. */
export function partialBillNo(invoiceNumber: unknown, poNumber: unknown): number | null {
  const prefix = `APINV-${String(poNumber ?? "")}-B`
  const s = String(invoiceNumber ?? "")
  if (!poNumber || !s.startsWith(prefix)) return null
  const rest = s.slice(prefix.length)
  return /^\d{1,6}$/.test(rest) ? Number(rest) : null
}

export const isPartialBill = (bill: { invoice_number?: unknown; invoiceNumber?: unknown }, poNumber: unknown) =>
  partialBillNo(bill.invoice_number ?? bill.invoiceNumber, poNumber) !== null

/** Bills in the order they were made (oldest first). */
export const sortBills = <T extends { invoice_id?: unknown; id?: unknown }>(bills: T[]): T[] =>
  [...bills].sort((a, b) => Number(a.invoice_id ?? a.id) - Number(b.invoice_id ?? b.id))

/** The bill that closed the PO, or null while the PO is open. */
export function closingBillOf<T extends { invoice_number?: unknown; invoiceNumber?: unknown }>(bills: T[], poNumber: unknown): T | null {
  return bills.find((b) => !isPartialBill(b, poNumber)) || null
}
