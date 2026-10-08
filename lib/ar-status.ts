// Single pure implementation of the invoice payment status (accounts_receivable.status; accounts_payable uses the
// same four CHECK values: pending | partially_paid | paid | overdue). Note `partial` is a payment_schedules value only.
//
// Rules (first match wins):
//   1. balance (amount - collected) <= tolerance        -> paid        (over-collection also counts as paid)
//   2. a due date that is before today (date only)       -> overdue     (even when part of it has been collected)
//   3. something collected                               -> partially_paid
//   4. otherwise                                         -> pending
// `dueDate` is the date the next payment is due (the invoice due date for a single payment, the next unpaid
// instalment date for instalment invoices). Callers decide which date applies; the helper never guesses.
export const AR_PAID_TOLERANCE = 0.01

export type ArPaymentStatus = "pending" | "partially_paid" | "paid" | "overdue"

export interface ArStatusInput {
  amount: number | string | null | undefined
  collectedAmount: number | string | null | undefined
  dueDate?: string | Date | null
  /** injectable for tests; defaults to now */
  today?: Date
  tolerance?: number
}

export function computeArStatus(input: ArStatusInput): ArPaymentStatus {
  const amount = Number(input.amount) || 0
  const collected = Number(input.collectedAmount) || 0
  const tolerance = input.tolerance ?? AR_PAID_TOLERANCE

  if (amount - collected <= tolerance) return "paid"

  if (input.dueDate) {
    const due = new Date(input.dueDate)
    if (!Number.isNaN(due.getTime())) {
      const today = new Date(input.today ?? Date.now())
      today.setHours(0, 0, 0, 0)
      due.setHours(0, 0, 0, 0)
      if (due < today) return "overdue"
    }
  }

  if (collected > 0) return "partially_paid"
  return "pending"
}
