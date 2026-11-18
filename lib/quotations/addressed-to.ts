// "Quote addressed to" (owner request, 2026-11-18): an optional name the quotation is made out to (e.g. a branch or
// sub-brand of the customer). It is printed on the quotation instead of the customer's name; the customer stays the
// real customer for everything else (sales order, invoices, balances).
// Stored in sales_quotations.addressed_to once scripts/sql/2026-11-18-line-order.sql is applied; until then it is
// not saved (silently) and the customer's name is printed as before.

export const ADDRESSED_TO_MAX = 200

/** The typed name, trimmed and cut to ADDRESSED_TO_MAX; null when empty. */
export function cleanAddressedTo(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim().slice(0, ADDRESSED_TO_MAX)
  return text === "" ? null : text
}

/** The name the quotation is printed to: the "addressed to" name when set, else the customer's name. */
export function quoteAddressee(quotation: { addressed_to?: unknown; customer_name?: unknown }): string {
  return cleanAddressedTo(quotation.addressed_to) ?? String(quotation.customer_name ?? "")
}
