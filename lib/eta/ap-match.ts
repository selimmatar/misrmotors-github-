// Supplier e-invoices on the portal compared with Accounts Payable (spec §6.6). Pure, no I/O, read-only toward AP.
//   1. same supplier (the card whose tax number is the issuer id; none -> "unknown_supplier");
//   2. the supplier's invoice number = the portal internal id (digits only, leading zeros ignored), when the AP row has
//      one: one candidate -> matched, or amount_differs when the totals differ by more than AMOUNT_TOLERANCE;
//   3. else the total within AMOUNT_TOLERANCE and the date within DATE_WINDOW_DAYS: the unique best candidate;
//   4. else "missing_in_erp".
// Credit notes (C) are not matched to an invoice: they are listed apart and reduce the supplier's portal total.
// The reverse list: AP invoices of suppliers with a tax number, dated in the period, that no portal document matched.

export const AMOUNT_TOLERANCE = 1 // EGP
export const DATE_WINDOW_DAYS = 45

export type MatchStatus = "matched" | "amount_differs" | "missing_in_erp" | "unknown_supplier"

export interface ReceivedForMatch {
  received_id: number
  document_type?: string | null
  issuer_id?: string | null
  supplier_id?: number | null
  internal_id?: string | null
  date_issued?: string | null
  total?: number | string | null
  status?: string | null
}
export interface ApForMatch {
  invoice_id: number
  invoice_number?: string | null
  supplier_id?: number | null
  amount?: number | string | null
  invoice_date?: string | null
  created_at?: string | null
}
export interface SupplierForMatch {
  supplier_id: number
  supplier_name?: string | null
  tax_registration_number?: string | null
}
export interface MatchOutcome {
  receivedId: number
  status: MatchStatus
  supplierId: number | null
  apInvoiceId?: number
  apInvoiceNumber?: string
  /** portal total - AP amount (when matched to an AP invoice) */
  difference?: number
  /** how it was matched */
  by?: "number" | "amount"
}
export interface SupplierTotal {
  supplierId: number
  /** portal invoices + debit notes - credit notes */
  portal: number
  creditNotes: number
  /** AP invoices of the period */
  erp: number
  difference: number
}
export interface MatchReport {
  /** one per invoice / debit note */
  documents: MatchOutcome[]
  /** credit notes, listed apart (not matched to an AP invoice) */
  creditNotes: MatchOutcome[]
  missingOnPortal: { invoiceId: number; invoiceNumber: string; supplierId: number; amount: number; date: string | null }[]
  supplierTotals: SupplierTotal[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const text = (v: unknown) => (v == null ? "" : String(v).trim())
/** an invoice number as digits only, leading zeros dropped ("INV-00123" and "123" are the same number) */
export const numberKey = (v: unknown): string => text(v).replace(/\D/g, "").replace(/^0+(?=\d)/, "")
const dayOf = (v: unknown): number => {
  const t = Date.parse(text(v))
  return Number.isNaN(t) ? NaN : Math.floor(t / 86_400_000)
}
const apDate = (a: ApForMatch) => text(a.invoice_date) || text(a.created_at) || null
/** a portal document the supplier withdrew no longer stands for an invoice */
const standing = (r: ReceivedForMatch) => !["cancelled", "rejected", "invalid"].includes(text(r.status).toLowerCase())

export function matchReceived(
  received: readonly ReceivedForMatch[],
  apInvoices: readonly ApForMatch[],
  suppliers: readonly SupplierForMatch[],
  period: { from?: string; to?: string } = {},
): MatchReport {
  const byTax = new Map<string, number>()
  for (const s of suppliers) {
    const d = text(s.tax_registration_number).replace(/\D/g, "")
    if (d && !byTax.has(d)) byTax.set(d, s.supplier_id)
  }
  const supplierOf = (r: ReceivedForMatch): number | null => r.supplier_id ?? byTax.get(text(r.issuer_id).replace(/\D/g, "")) ?? null

  const used = new Set<number>()
  const outcome = new Map<number, MatchOutcome>()
  const invoices = received.filter((r) => r.document_type !== "C")
  const credits = received.filter((r) => r.document_type === "C")
  const apOf = (supplierId: number) => apInvoices.filter((a) => a.supplier_id === supplierId && !used.has(a.invoice_id))
  const settle = (r: ReceivedForMatch, supplierId: number, a: ApForMatch, by: "number" | "amount") => {
    used.add(a.invoice_id)
    const difference = round2((Number(r.total) || 0) - (Number(a.amount) || 0))
    outcome.set(r.received_id, {
      receivedId: r.received_id,
      status: Math.abs(difference) <= AMOUNT_TOLERANCE ? "matched" : "amount_differs",
      supplierId,
      apInvoiceId: a.invoice_id,
      apInvoiceNumber: text(a.invoice_number),
      difference,
      by,
    })
  }

  // standing documents first, so a withdrawn one never takes the AP invoice of the one that replaced it
  const order = [...invoices].sort((x, y) => Number(standing(y)) - Number(standing(x)) || x.received_id - y.received_id)

  // pass 1: by the supplier's invoice number
  for (const r of order) {
    const supplierId = supplierOf(r)
    if (supplierId == null) continue
    const key = numberKey(r.internal_id)
    if (!key) continue
    const hits = apOf(supplierId).filter((a) => numberKey(a.invoice_number) === key)
    if (hits.length === 1) settle(r, supplierId, hits[0], "number")
  }
  // pass 2: by amount and date, the unique best candidate
  for (const r of order) {
    if (outcome.has(r.received_id)) continue
    const supplierId = supplierOf(r)
    if (supplierId == null) {
      outcome.set(r.received_id, { receivedId: r.received_id, status: "unknown_supplier", supplierId: null })
      continue
    }
    const total = Number(r.total) || 0
    const day = dayOf(r.date_issued)
    const scored = apOf(supplierId)
      .map((a) => ({ a, amount: Math.abs((Number(a.amount) || 0) - total), days: Math.abs(dayOf(apDate(a)) - day) }))
      .filter((c) => c.amount <= AMOUNT_TOLERANCE && c.days <= DATE_WINDOW_DAYS)
      .sort((x, y) => x.days - y.days || x.amount - y.amount)
    const best = scored[0]
    const tied = scored[1] && scored[1].days === best.days && scored[1].amount === best.amount
    if (best && !tied) settle(r, supplierId, best.a, "amount")
    else outcome.set(r.received_id, { receivedId: r.received_id, status: "missing_in_erp", supplierId })
  }

  const creditNotes: MatchOutcome[] = credits.map((r) => {
    const supplierId = supplierOf(r)
    return { receivedId: r.received_id, status: supplierId == null ? "unknown_supplier" : "missing_in_erp", supplierId }
  })

  // the reverse list: AP invoices of known-tax-number suppliers in the period with no portal document
  const withTax = new Set(byTax.values())
  const fromDay = period.from ? dayOf(period.from) : -Infinity
  const toDay = period.to ? dayOf(period.to) : Infinity
  const inPeriod = (a: ApForMatch) => {
    const d = dayOf(apDate(a))
    return !Number.isNaN(d) && d >= fromDay && d <= toDay
  }
  const missingOnPortal = apInvoices
    .filter((a) => a.supplier_id != null && withTax.has(a.supplier_id) && !used.has(a.invoice_id) && inPeriod(a))
    .map((a) => ({ invoiceId: a.invoice_id, invoiceNumber: text(a.invoice_number), supplierId: a.supplier_id as number, amount: round2(Number(a.amount) || 0), date: apDate(a) }))

  // per supplier: portal (standing documents, credit notes subtracted) against AP of the period
  const totals = new Map<number, SupplierTotal>()
  const row = (id: number) => {
    let t = totals.get(id)
    if (!t) totals.set(id, (t = { supplierId: id, portal: 0, creditNotes: 0, erp: 0, difference: 0 }))
    return t
  }
  for (const r of received) {
    const id = supplierOf(r)
    if (id == null || !standing(r)) continue
    const amount = Number(r.total) || 0
    if (r.document_type === "C") {
      row(id).creditNotes += amount
      row(id).portal -= amount
    } else row(id).portal += amount
  }
  for (const a of apInvoices) if (a.supplier_id != null && withTax.has(a.supplier_id) && inPeriod(a)) row(a.supplier_id).erp += Number(a.amount) || 0
  const supplierTotals = [...totals.values()].map((t) => ({ ...t, portal: round2(t.portal), creditNotes: round2(t.creditNotes), erp: round2(t.erp), difference: round2(t.portal - t.erp) }))

  return { documents: invoices.map((r) => outcome.get(r.received_id)!), creditNotes, missingOnPortal, supplierTotals }
}
