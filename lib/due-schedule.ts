// When each customer and supplier invoice is due, and how much of it is late. One calculation shared by the
// Accounts Receivable / Accounts Payable screens (their Overdue tiles) and the Reports page, so they always agree.
//
// The due dates follow the same rules as the payment-schedule dialogs on those screens (the payment_schedules table
// is not used): a single payment (cash, bank transfer, cheque) is one amount on one date; installments, hybrid
// (down payment + installments) and manual schedules are spread over several dates. Payments on an invoice fill
// its due amounts in date order. An amount is late from the day after its due date.
//
// Plain functions with no React or database imports, so they run in screens, API routes and node tests.
import { round2, scheduleShare, scaleSchedule } from "@/lib/invoicing"
import { isSinglePayment } from "@/lib/payment-type"

export interface DueEntry {
  dueDate: string // YYYY-MM-DD
  amount: number
  paid: number
  isDownPayment: boolean
}

/** Amounts below this are treated as zero (rounding). */
export const DUE_TOLERANCE = 0.01

const num = (value: any) => Number(value) || 0
const ymd = (value: any): string => (value ? String(value).slice(0, 10) : "")

/** YYYY-MM-DD plus n calendar months (same overflow as the screens: 31 Jan + 1 month = 3 Mar). */
export function addMonths(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD plus n days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86400000)
}

/** Today's date on this computer's calendar, as YYYY-MM-DD. */
export function todayYmd(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** Payments fill the due amounts in order; returns the entries with `paid` set. */
function fill(entries: { dueDate: string; amount: number; isDownPayment: boolean }[], paidTotal: number): DueEntry[] {
  let left = Math.max(0, paidTotal)
  return entries.map((e) => {
    const amount = round2(e.amount)
    const paid = round2(Math.max(0, Math.min(left, amount)))
    left = round2(left - paid)
    return { dueDate: e.dueDate, amount, paid, isDownPayment: e.isDownPayment }
  })
}

const isSettledStatus = (status?: string | null) => status === "paid" || status === "cancelled"

// ---------------------------------------------------------------------------------------------------------------
// Customer invoices (accounts receivable)
// ---------------------------------------------------------------------------------------------------------------

/** A customer invoice as the screens hold it (GET /api/accounts-receivable). */
export interface ArInvoiceLike {
  invoiceNumber?: string | null
  soId?: string | number | null
  amount?: any
  collectedAmount?: any
  status?: string | null
  date?: string | null
  dueDate?: string | null
  paymentTerms?: string | null
  installmentMonths?: number | null
  isMaintenance?: boolean
}

/** A sales order as the screens hold it (GET /api/sales-orders). */
export interface SoLike {
  total?: any
  orderDate?: string | null
  paymentType?: string | null
  paymentTerms?: string | null
  installments?: number | null
  scheduleMode?: string | null
  scheduleEntries?: any[] | null
  downPaymentDueDate?: string | null
  paymentDetails?: {
    downPaymentAmount?: any
    downPaymentDueDate?: string | null
    remainingAmount?: any
    remainingInstallmentMonths?: any
    monthlyAmount?: any
    paymentStartDate?: string | null
    chequeDueDate?: string | null
  } | null
}

const isMaintenanceInvoice = (inv: ArInvoiceLike) => !!inv.isMaintenance || !!inv.invoiceNumber?.startsWith("INV-MNT-")

/** How a customer invoice is paid: the sales order's payment type (maintenance invoices use their own terms). */
export function arPaymentType(inv: ArInvoiceLike, so: SoLike | null | undefined): string {
  if (isMaintenanceInvoice(inv)) return inv.paymentTerms || "cash"
  if (!so) return "cash"
  return (so as any).payment_type || so.paymentType || (so as any).payment_terms || so.paymentTerms || "cash"
}

/** What has been received on a customer invoice (all of it once it is marked paid). */
export const arPaid = (inv: ArInvoiceLike) => (isSettledStatus(inv.status) ? num(inv.amount) : num(inv.collectedAmount))

/** The due dates and amounts of one customer invoice, with what has been received filled in. */
export function arDueSchedule(inv: ArInvoiceLike, so: SoLike | null | undefined): DueEntry[] {
  const total = num(inv.amount)
  const paidTotal = arPaid(inv)
  const invoiceDue = ymd(inv.dueDate) || ymd(inv.date)
  const type = arPaymentType(inv, so)
  const d = (!isMaintenanceInvoice(inv) && so?.paymentDetails) || {}
  const single = (dueDate: string) => fill([{ dueDate, amount: total, isDownPayment: false }], paidTotal)

  // The order's own down payment and installments are for the whole order; an invoice shows its share of them.
  const share = scheduleShare(total, num(so?.total))
  const fitted = (entries: { dueDate: string; amount: number; isDownPayment: boolean }[]) => {
    const amounts = scaleSchedule(entries.map((e) => e.amount), share)
    return fill(entries.map((e, i) => ({ ...e, amount: amounts[i] })), paidTotal)
  }

  if (isMaintenanceInvoice(inv) || !so) return single(invoiceDue)

  const downPaymentAmount = num(d.downPaymentAmount)
  const downPaymentDue = ymd(so.downPaymentDueDate) || ymd(d.downPaymentDueDate) || ymd(so.orderDate) || ymd(inv.date)

  if (so.scheduleMode === "MANUAL" && Array.isArray(so.scheduleEntries) && so.scheduleEntries.length > 0) {
    const entries: { dueDate: string; amount: number; isDownPayment: boolean }[] = []
    const hasDown = so.scheduleEntries.some((e: any) => e?.isDownPayment || e?.installmentNumber === 0)
    if (type === "hybrid" && downPaymentAmount > 0 && !hasDown) {
      entries.push({ dueDate: downPaymentDue, amount: downPaymentAmount, isDownPayment: true })
    }
    for (const e of so.scheduleEntries) {
      entries.push({ dueDate: ymd(e?.dueDate) || invoiceDue, amount: num(e?.amount), isDownPayment: !!e?.isDownPayment })
    }
    return fitted(entries)
  }

  if (type === "cheque") return single(ymd(d.chequeDueDate) || invoiceDue)
  if (isSinglePayment(type)) return single(invoiceDue)

  if (type === "hybrid") {
    const remainingAmount = num(d.remainingAmount) || total - downPaymentAmount
    const months = num(d.remainingInstallmentMonths) || num(so.installments) || num(inv.installmentMonths) || 6
    const monthly = num(d.monthlyAmount) || (months > 0 ? remainingAmount / months : remainingAmount)
    const start = ymd(d.paymentStartDate) || addMonths(downPaymentDue, 1)
    const entries: { dueDate: string; amount: number; isDownPayment: boolean }[] = []
    if (downPaymentAmount > 0) entries.push({ dueDate: downPaymentDue, amount: downPaymentAmount, isDownPayment: true })
    for (let i = 1; i <= months; i++) entries.push({ dueDate: addMonths(start, i - 1), amount: monthly, isDownPayment: false })
    return fitted(entries)
  }

  if (type === "installments") {
    const months = num(so.installments) || num(inv.installmentMonths) || 6
    const start = ymd(d.paymentStartDate) || invoiceDue
    const entries = Array.from({ length: months }, (_, i) => ({ dueDate: addMonths(start, i), amount: total / months, isDownPayment: false }))
    return fill(entries, paidTotal)
  }

  return single(invoiceDue)
}

// ---------------------------------------------------------------------------------------------------------------
// Supplier invoices (accounts payable)
// ---------------------------------------------------------------------------------------------------------------

/** A supplier invoice as the screens hold it (GET /api/accounts-payable). */
export interface ApInvoiceLike {
  amount?: any
  totalAmount?: any
  paidAmount?: any
  status?: string | null
  invoiceDate?: string | null
  dueDate?: string | null
  paymentType?: string | null
  paymentTerms?: string | null
  installmentMonths?: any
  downPaymentAmount?: any
  downPaymentDueDate?: string | null
  remainingAmount?: any
  remainingInstallmentMonths?: any
  monthlyAmount?: any
  paymentStartDate?: string | null
  scheduleEntries?: any[] | null
}

/** A purchase order as the screens hold it (GET /api/purchase-orders). */
export interface PoLike {
  paymentType?: string | null
  paymentTerms?: string | null
  installments?: any
  downPaymentAmount?: any
  downPaymentDueDate?: string | null
  remainingAmount?: any
  remainingInstallmentMonths?: any
  monthlyAmount?: any
  paymentStartDate?: string | null
  scheduleEntries?: any[] | null
}

/** What has been paid on a supplier invoice (all of it once it is marked paid). */
export const apPaid = (inv: ApInvoiceLike) =>
  isSettledStatus(inv.status) ? num(inv.totalAmount || inv.amount) : num(inv.paidAmount)

/** The due dates and amounts of one supplier invoice, with what has been paid filled in. */
export function apDueSchedule(inv: ApInvoiceLike, po: PoLike | null | undefined): DueEntry[] {
  const total = num(inv.totalAmount || inv.amount)
  const paidTotal = apPaid(inv)
  const type = inv.paymentType || po?.paymentType || po?.paymentTerms || inv.paymentTerms || "installments"
  const start = ymd(inv.paymentStartDate) || ymd(po?.paymentStartDate) || ymd(inv.dueDate) || ymd(inv.invoiceDate)

  if (isSinglePayment(type)) return fill([{ dueDate: start, amount: total, isDownPayment: false }], paidTotal)

  if (type === "hybrid") {
    const saved = (Array.isArray(inv.scheduleEntries) && inv.scheduleEntries.length > 0 && inv.scheduleEntries) ||
      (Array.isArray(po?.scheduleEntries) && po!.scheduleEntries!.length > 0 && po!.scheduleEntries) || null
    if (saved) {
      return fill(saved.map((e: any) => ({ dueDate: ymd(e?.dueDate) || start, amount: num(e?.amount), isDownPayment: !!e?.isDownPayment })), paidTotal)
    }
    const down = num(inv.downPaymentAmount ?? po?.downPaymentAmount)
    const downDue = ymd(inv.downPaymentDueDate) || ymd(po?.downPaymentDueDate) || ymd(inv.dueDate) || ymd(inv.invoiceDate)
    const remaining = inv.remainingAmount ?? po?.remainingAmount ?? total - down
    const months = num(inv.remainingInstallmentMonths ?? po?.remainingInstallmentMonths ?? 6)
    if (down === 0 && num(remaining) === 0) {
      const n = num(inv.remainingInstallmentMonths) || num(po?.remainingInstallmentMonths) || num(po?.installments) || 6
      return fill(Array.from({ length: n }, (_, i) => ({ dueDate: addMonths(start, i), amount: total / n, isDownPayment: false })), paidTotal)
    }
    const monthly = num(inv.monthlyAmount ?? po?.monthlyAmount) || (months > 0 ? num(remaining) / months : num(remaining))
    const entries: { dueDate: string; amount: number; isDownPayment: boolean }[] = []
    if (down > 0) entries.push({ dueDate: downDue, amount: down, isDownPayment: true })
    const n = months > 0 ? months : num(remaining) > 0 ? 1 : 0
    for (let i = 1; i <= n; i++) entries.push({ dueDate: addMonths(start, i - 1), amount: monthly, isDownPayment: false })
    return fill(entries, paidTotal)
  }

  const months =
    num(inv.remainingInstallmentMonths) || num(po?.remainingInstallmentMonths) || num(po?.installments) || num(inv.installmentMonths) || 6
  return fill(Array.from({ length: months }, (_, i) => ({ dueDate: addMonths(start, i), amount: total / months, isDownPayment: false })), paidTotal)
}

// ---------------------------------------------------------------------------------------------------------------
// Late and coming-due amounts
// ---------------------------------------------------------------------------------------------------------------

export type AgeBucket = "1-30" | "31-60" | "61-90" | "90+"
export const AGE_BUCKETS: AgeBucket[] = ["1-30", "31-60", "61-90", "90+"]

/** The ageing column for an amount this many days late (null when it is not late). */
export function ageBucket(daysLate: number): AgeBucket | null {
  if (daysLate <= 0) return null
  if (daysLate <= 30) return "1-30"
  if (daysLate <= 60) return "31-60"
  if (daysLate <= 90) return "61-90"
  return "90+"
}

export interface DueSummary {
  /** Still owed on the invoice. */
  balance: number
  /** Owed amounts whose due date has passed (late from the day after the due date). */
  overdue: number
  /** Days since the oldest unpaid due date that has passed (0 when nothing is late). */
  daysLate: number
  /** The oldest unpaid due date that has passed ("" when nothing is late). */
  oldestLateDate: string
  /** Late amounts split by how late each one is. */
  buckets: Record<AgeBucket, number>
  /** Owed amounts due from today up to `soonDays` days ahead. */
  dueSoon: number
  /** The next unpaid due date that has not passed yet ("" when none). */
  nextDueDate: string
}

/** Late and coming-due amounts of one invoice's schedule on `today` (YYYY-MM-DD). */
export function summarizeDue(entries: DueEntry[], today: string, soonDays = 7): DueSummary {
  const buckets: Record<AgeBucket, number> = { "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }
  let balance = 0
  let overdue = 0
  let dueSoon = 0
  let oldestLateDate = ""
  let nextDueDate = ""
  const soonEnd = addDays(today, soonDays)
  for (const e of entries) {
    const unpaid = round2(e.amount - e.paid)
    if (unpaid <= DUE_TOLERANCE) continue
    balance += unpaid
    const late = daysBetween(e.dueDate, today)
    const bucket = ageBucket(late)
    if (bucket) {
      overdue += unpaid
      buckets[bucket] = round2(buckets[bucket] + unpaid)
      if (!oldestLateDate || e.dueDate < oldestLateDate) oldestLateDate = e.dueDate
    } else {
      if (e.dueDate <= soonEnd) dueSoon += unpaid
      if (!nextDueDate || e.dueDate < nextDueDate) nextDueDate = e.dueDate
    }
  }
  return {
    balance: round2(balance),
    overdue: round2(overdue),
    daysLate: oldestLateDate ? daysBetween(oldestLateDate, today) : 0,
    oldestLateDate,
    buckets,
    dueSoon: round2(dueSoon),
    nextDueDate,
  }
}

/** Unpaid amounts falling due between `from` and `to` (inclusive), each with its date. */
export function unpaidBetween(entries: DueEntry[], from: string, to: string): { dueDate: string; amount: number }[] {
  return entries
    .map((e) => ({ dueDate: e.dueDate, amount: round2(e.amount - e.paid) }))
    .filter((e) => e.amount > DUE_TOLERANCE && e.dueDate >= from && e.dueDate <= to)
}

// Lookups the screens and the Reports page use to pair an invoice with its order.
export const findSalesOrder = <T extends { id?: any; so_id?: any }>(orders: T[], soId: any): T | undefined =>
  soId == null || soId === "" ? undefined : orders.find((o) => String(o.id ?? o.so_id) === String(soId))
export const findPurchaseOrder = <T extends { id?: any; po_id?: any }>(orders: T[], poId: any): T | undefined =>
  poId == null || poId === "" ? undefined : orders.find((o) => String(o.id ?? o.po_id) === String(poId))
