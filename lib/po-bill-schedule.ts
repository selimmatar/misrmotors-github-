// The payment schedule of each supplier bill of a purchase order with several bills (owner request, 2026-11-17).
//
// A PO's payment plan (down payment, installments, manual entries) is for the whole PO. A bill for part of it (a
// "bill received items" bill APINV-<po>-B<n>, or the closing bill APINV-<po> after such bills) gets the same plan
// applied to its own amount: the same entries and percentages, each amount scaled to the bill, and the same days,
// counted from the bill's own date instead of the PO date. Each bill's last entry takes its rounding; the closing bill
// of a PO whose bills add up to the PO total takes what is left of each entry, so the bills add up to the PO plan.
// Advances / return credits the bill took off when it was made are part of its paid amount (option A: they come off
// the FIRST bills), so they fill that bill's first due amounts like any payment (lib/due-schedule.ts).
//
// Only bills with lines in ap_invoice_lines get one, and not the single bill of a whole PO (it carries a copy of the
// PO's plan): older bills keep their schedule exactly as before. Plain functions, no React or database imports.
import { round2, scaleSchedule } from "@/lib/invoicing"
import { addDays, apDueSchedule, daysBetween, type PoLike } from "@/lib/due-schedule"
import { isPartialBill, sortBills } from "@/lib/po-bill-number"

export interface BillScheduleEntry {
  dueDate: string // YYYY-MM-DD
  amount: number
  isDownPayment: boolean
}

const num = (value: any) => Number(value) || 0
const ymd = (value: any): string => (value ? String(value).slice(0, 10) : "")

/** The whole PO's plan as due entries (a purchase_orders row), and the date its days count from. */
export function poPlan(po: any): { base: string; entries: BillScheduleEntry[] } {
  const orderDate = ymd(po.order_date) || ymd(po.created_at)
  const inv = {
    amount: num(po.total),
    paidAmount: 0,
    invoiceDate: orderDate,
    dueDate: ymd(po.down_payment_due_date) || ymd(po.payment_start_date) || orderDate,
    paymentType: po.payment_type || po.payment_terms || "cash",
    installmentMonths: po.installments,
    downPaymentAmount: po.down_payment_amount ?? null,
    downPaymentDueDate: po.down_payment_due_date ?? null,
    remainingAmount: po.remaining_amount ?? null,
    remainingInstallmentMonths: po.remaining_installment_months ?? null,
    monthlyAmount: po.monthly_amount ?? null,
    paymentStartDate: po.payment_start_date ?? null,
    scheduleEntries: Array.isArray(po.schedule_entries) ? po.schedule_entries : null,
  }
  const plan: PoLike = { installments: po.installments }
  const entries = apDueSchedule(inv, plan)
    .filter((e) => e.amount > 0)
    .map((e) => ({ dueDate: e.dueDate, amount: e.amount, isDownPayment: e.isDownPayment }))
  const dates = entries.map((e) => e.dueDate).filter(Boolean).sort()
  return { base: orderDate || dates[0] || "", entries }
}

/** True when this bill gets its own share of the PO plan (it has bill lines and is not the PO's one whole bill). */
export const hasOwnSchedule = (bill: any, po: any, poBillCount: number, billHasLines: boolean) =>
  billHasLines && (poBillCount > 1 || isPartialBill(bill, po?.po_number))

/**
 * The schedule of each of these bills (accounts_payable rows of ONE purchase order, any order), by invoice_id.
 * `withLines` holds the ids of the bills that have lines in ap_invoice_lines. Bills without their own schedule are
 * left out.
 */
export function billSchedules(po: any, bills: any[], withLines: Set<number>): Map<number, BillScheduleEntry[]> {
  const out = new Map<number, BillScheduleEntry[]>()
  const sorted = sortBills(bills)
  const own = sorted.filter((b) => hasOwnSchedule(b, po, sorted.length, withLines.has(num(b.invoice_id))))
  if (own.length === 0) return out
  const { base, entries } = poPlan(po)
  const planTotal = round2(entries.reduce((s, e) => s + e.amount, 0))
  const total = num(po.total)
  // the plan scaled to the PO total exactly (an entered monthly amount can leave a few piasters over or under)
  const whole = planTotal > 0 ? scaleSchedule(entries.map((e) => e.amount), total > 0 ? total / planTotal : 1) : []
  const billsTotal = round2(sorted.reduce((s, b) => s + num(b.amount), 0))
  const taken = whole.map(() => 0)

  for (const bill of own) {
    const amount = round2(num(bill.amount))
    const billDate = ymd(bill.invoice_date) || base
    if (amount <= 0) {
      out.set(num(bill.invoice_id), [])
      continue
    }
    if (entries.length === 0 || planTotal <= 0) {
      out.set(num(bill.invoice_id), [{ dueDate: billDate, amount, isDownPayment: false }])
      continue
    }
    const shift = base && billDate ? Math.max(0, daysBetween(base, billDate)) : 0
    let amounts = scaleSchedule(entries.map((e) => e.amount), amount / planTotal)
    // the closing bill of a PO billed in full: what is left of each entry, so all the bills add up to the PO plan
    const closing = !isPartialBill(bill, po?.po_number) && own.length === sorted.length && Math.abs(billsTotal - total) <= 0.01
    if (closing && own.length > 1) {
      const rest = whole.map((w, i) => round2(w - taken[i]))
      if (rest.every((r) => r >= 0) && Math.abs(round2(rest.reduce((s, r) => s + r, 0)) - amount) <= 0.01) amounts = rest
    }
    amounts.forEach((a, i) => (taken[i] = round2(taken[i] + a)))
    out.set(
      num(bill.invoice_id),
      entries
        .map((e, i) => ({ dueDate: shift ? addDays(e.dueDate, shift) : e.dueDate, amount: amounts[i], isDownPayment: e.isDownPayment }))
        .filter((e) => e.amount > 0),
    )
  }
  return out
}

/** The bill's plan fields from its own schedule (what the screens show as its down payment / installments). */
export function billPlanFields(entries: BillScheduleEntry[], amount: number) {
  const down = entries.filter((e) => e.isDownPayment)
  const rest = entries.filter((e) => !e.isDownPayment)
  const downPaymentAmount = round2(down.reduce((s, e) => s + e.amount, 0))
  return {
    downPaymentAmount,
    downPaymentDueDate: down[0]?.dueDate ?? null,
    remainingAmount: round2(Math.max(0, amount - downPaymentAmount)),
    remainingInstallmentMonths: rest.length,
    monthlyAmount: rest[0]?.amount ?? 0,
    paymentStartDate: rest[0]?.dueDate ?? down[0]?.dueDate ?? null,
    scheduleEntries: null,
  }
}
