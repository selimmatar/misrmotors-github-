// Automatic invoice-level matching for the AP <-> portal comparison (owner request 2026-11-17): every candidate pair of
// one supplier's ERP bill and portal invoice gets a score from
//   - the reference: the supplier's invoice number (accounts_payable.supplier_invoice_number), our bill number or our
//     PO number found in the portal document's internal ID or its references;
//   - the total amount (equal within AMOUNT_TOLERANCE, or close);
//   - the number of lines (the bill's lines against the portal lines);
//   - how close the dates are.
// The pairs are then taken best first, one portal invoice per bill (a tie between two candidates without a reference
// is left to a person). Pure, no I/O. Manual links and rejections are applied afterwards (lib/eta/ap-links.ts) and win.
import { AMOUNT_TOLERANCE, DATE_WINDOW_DAYS, numberKey, type ApForMatch, type ReceivedForMatch, type SupplierForMatch } from "./ap-match"
import { standingDoc, supplierResolver, type AutoMatch } from "./ap-links"

export interface ApForScore extends ApForMatch {
  supplier_invoice_number?: string | null
  po_number?: string | null
  /** lines of the bill (its ap_invoice_lines, or its PO lines for a bill without lines); null = not known */
  line_count?: number | null
}
export interface ReceivedForScore extends ReceivedForMatch {
  /** extra texts of the portal document that may carry our numbers (references, PO / sales-order references) */
  references?: string[] | null
  /** portal lines; null = not known */
  line_count?: number | null
}
export type MatchReason = "supplier_number" | "our_number" | "po_number" | "amount" | "amount_close" | "lines" | "date"
export interface ScoredPair {
  receivedId: number
  apInvoiceId: number
  score: number
  reasons: MatchReason[]
  /** a number of ours or the supplier's was found on the portal document */
  reference: boolean
}

export const SCORE = {
  supplierNumber: 50,
  ourNumber: 45,
  amountExact: 40,
  amountClose: 20,
  lines: 10,
  dateNear: 10, // within 3 days
  dateClose: 6, // within 10 days
  dateWindow: 3, // within DATE_WINDOW_DAYS
} as const
/** an amount within this share of the bill is "close" */
export const CLOSE_AMOUNT_SHARE = 0.02
/** a close amount (not equal) without a reference needs the same number of lines and dates this near */
export const CLOSE_AMOUNT_MAX_DAYS = 15

const text = (v: unknown) => (v == null ? "" : String(v).trim())
/** letters and digits only, lower case: "PO-2026/0012" -> "po20260012" */
export const compact = (v: unknown) => text(v).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
const dayOf = (v: unknown): number => {
  const t = Date.parse(text(v))
  return Number.isNaN(t) ? NaN : Math.floor(t / 86_400_000)
}

/**
 * True when one of our numbers is on the portal document: the same digits (leading zeros ignored, at least 2 digits)
 * or the same letters and digits, or - for a number of at least 5 characters - written inside a longer portal text.
 */
export function numberOnDoc(ours: unknown, portalTexts: readonly unknown[]): boolean {
  const c = compact(ours)
  if (!c) return false
  const n = numberKey(ours)
  for (const p of portalTexts) {
    const pc = compact(p)
    if (!pc) continue
    if (pc === c) return true
    if (n.length >= 2 && numberKey(p) === n && /^\D*\d+\D*$/.test(text(ours))) return true
    if (c.length >= 5 && pc.includes(c)) return true
  }
  return false
}

export function scorePair(r: ReceivedForScore, a: ApForScore): ScoredPair {
  const reasons: MatchReason[] = []
  let score = 0
  const portalTexts = [r.internal_id, ...(r.references || [])]
  if (numberOnDoc(a.supplier_invoice_number, portalTexts)) {
    score += SCORE.supplierNumber
    reasons.push("supplier_number")
  } else if (numberOnDoc(a.invoice_number, portalTexts)) {
    score += SCORE.ourNumber
    reasons.push("our_number")
  } else if (numberOnDoc(a.po_number, portalTexts)) {
    score += SCORE.ourNumber
    reasons.push("po_number")
  }
  const total = Number(r.total) || 0
  const amount = Number(a.amount) || 0
  const diff = Math.abs(total - amount)
  if (diff <= AMOUNT_TOLERANCE) {
    score += SCORE.amountExact
    reasons.push("amount")
  } else if (amount > 0 && diff / amount <= CLOSE_AMOUNT_SHARE) {
    score += SCORE.amountClose
    reasons.push("amount_close")
  }
  if (r.line_count != null && a.line_count != null && r.line_count > 0 && r.line_count === a.line_count) {
    score += SCORE.lines
    reasons.push("lines")
  }
  const days = Math.abs(dayOf(r.date_issued) - dayOf(text(a.invoice_date) || text(a.created_at)))
  if (days <= 3) score += SCORE.dateNear
  else if (days <= 10) score += SCORE.dateClose
  else if (days <= DATE_WINDOW_DAYS) score += SCORE.dateWindow
  if (days <= DATE_WINDOW_DAYS) reasons.push("date")
  return { receivedId: r.received_id, apInvoiceId: a.invoice_id, score, reasons, reference: reasons.some((x) => x === "supplier_number" || x === "our_number" || x === "po_number") }
}

/** a pair that may be suggested at all: a reference, or the same amount near in time, or a close amount with everything else agreeing */
export function eligible(p: ScoredPair, days: number): boolean {
  if (p.reference) return true
  if (Number.isNaN(days) || days > DATE_WINDOW_DAYS) return false
  if (p.reasons.includes("amount")) return true
  return p.reasons.includes("amount_close") && p.reasons.includes("lines") && days <= CLOSE_AMOUNT_MAX_DAYS
}

export interface ScoredMatch extends AutoMatch {
  score: number
  reasons: MatchReason[]
}

/**
 * The automatic suggestions: standing invoices / debit notes (credit notes are never matched to a bill) of a known
 * supplier, against that supplier's bills, best score first, each side used once. When the best pair of a side ties
 * with another free pair of that side and neither has a reference, that side is left for a person to link.
 */
export function scoreMatches(received: readonly ReceivedForScore[], apInvoices: readonly ApForScore[], suppliers: readonly SupplierForMatch[]): ScoredMatch[] {
  const supplierOf = supplierResolver(suppliers)
  const apBySupplier = new Map<number, ApForScore[]>()
  for (const a of apInvoices) if (a.supplier_id != null) apBySupplier.set(a.supplier_id, [...(apBySupplier.get(a.supplier_id) || []), a])
  const pairs: ScoredPair[] = []
  for (const r of received) {
    if (r.document_type === "C" || !standingDoc(r)) continue
    const s = supplierOf(r)
    if (s == null) continue
    for (const a of apBySupplier.get(s) || []) {
      const p = scorePair(r, a)
      const days = Math.abs(dayOf(r.date_issued) - dayOf(text(a.invoice_date) || text(a.created_at)))
      if (eligible(p, days)) pairs.push(p)
    }
  }
  pairs.sort((x, y) => y.score - x.score || Number(y.reference) - Number(x.reference) || x.receivedId - y.receivedId || x.apInvoiceId - y.apInvoiceId)
  const usedR = new Set<number>()
  const usedA = new Set<number>()
  const out: ScoredMatch[] = []
  for (const p of pairs) {
    if (usedR.has(p.receivedId) || usedA.has(p.apInvoiceId)) continue
    if (!p.reference) {
      const ties = pairs.filter(
        (q) => q !== p && q.score === p.score && !q.reference && (q.receivedId === p.receivedId || q.apInvoiceId === p.apInvoiceId) && !usedR.has(q.receivedId) && !usedA.has(q.apInvoiceId),
      )
      if (ties.length) {
        // ambiguous: the side shared with an equal candidate is left for a person (not given to a weaker candidate)
        for (const q of ties) {
          if (q.receivedId === p.receivedId) usedR.add(p.receivedId)
          if (q.apInvoiceId === p.apInvoiceId) usedA.add(p.apInvoiceId)
        }
        continue
      }
    }
    usedR.add(p.receivedId)
    usedA.add(p.apInvoiceId)
    out.push({ receivedId: p.receivedId, apInvoiceId: p.apInvoiceId, score: p.score, reasons: p.reasons })
  }
  return out.sort((x, y) => x.receivedId - y.receivedId)
}
