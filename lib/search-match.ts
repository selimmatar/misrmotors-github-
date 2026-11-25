// Text search used by list screens (customers, inventory Pending / Sold): case-insensitive, Arabic-keyboard digits
// count as ordinary digits, empty fields are skipped (owner report 2026-11-25: customer search crashed on a customer
// with a missing field; the inventory search ignored the Sold list).
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

export const normalizeSearch = (s: unknown): string => toLatinDigits(String(s ?? "")).toLowerCase().trim()

/** true when the query is empty, or any field contains it */
export function matchesSearch(query: string, fields: unknown[]): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  return fields.some((v) => v != null && normalizeSearch(v).includes(q))
}
