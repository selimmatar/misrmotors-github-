// Schedule utility functions for consistent calculations across AR/AP

export interface ScheduleEntry {
  installmentNumber: number
  dueDate: string
  amount: number
  isDownPayment?: boolean
  notes?: string
}

/**
 * Generate payment schedule with proper rounding
 * Ensures total of all installments exactly equals the invoice total
 */
export function generateSchedule(params: {
  total: number
  downPaymentAmount?: number
  downPaymentDueDate?: string
  installmentMonths: number
  paymentStartDate?: string
  customEntries?: ScheduleEntry[]
}): ScheduleEntry[] {
  const {
    total,
    downPaymentAmount = 0,
    downPaymentDueDate,
    installmentMonths,
    paymentStartDate,
    customEntries,
  } = params

  // If custom entries provided, use them directly
  if (customEntries && customEntries.length > 0) {
    // Validate sum equals total
    const customSum = customEntries.reduce((sum, e) => sum + e.amount, 0)
    if (Math.abs(customSum - total) > 0.01) {
      console.warn(`[v0] Schedule sum (${customSum}) doesn't match total (${total})`)
    }
    return customEntries
  }

  const schedules: ScheduleEntry[] = []
  const today = new Date().toISOString().split("T")[0]

  // Add down payment if exists
  if (downPaymentAmount > 0) {
    schedules.push({
      installmentNumber: 0,
      dueDate: downPaymentDueDate || today,
      amount: roundCurrency(downPaymentAmount),
      isDownPayment: true,
      notes: "Down payment",
    })
  }

  // Calculate remaining amount and monthly payment
  const remainingAmount = total - downPaymentAmount
  const baseMonthlyAmount = remainingAmount / installmentMonths

  // Use floor for all but last installment
  const flooredAmount = Math.floor(baseMonthlyAmount * 100) / 100
  let runningTotal = downPaymentAmount

  const startDate = paymentStartDate ? new Date(paymentStartDate) : new Date()

  for (let i = 1; i <= installmentMonths; i++) {
    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + (i - 1))

    // Last installment gets the remainder to ensure exact total
    const isLast = i === installmentMonths
    const amount = isLast ? roundCurrency(total - runningTotal) : flooredAmount

    schedules.push({
      installmentNumber: i,
      dueDate: dueDate.toISOString().split("T")[0],
      amount: amount,
      isDownPayment: false,
    })

    runningTotal += amount
  }

  return schedules
}

/**
 * Round to 2 decimal places for currency
 */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Calculate schedule status based on due date and payment
 */
export function getScheduleStatus(
  dueDate: string,
  amount: number,
  paidAmount: number,
): "pending" | "partial" | "paid" | "overdue" {
  if (paidAmount >= amount) return "paid"

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)

  if (paidAmount > 0 && paidAmount < amount) return "partial"
  if (due < today) return "overdue"
  return "pending"
}

/**
 * Validate that schedule entries sum to total
 */
export function validateScheduleSum(schedules: ScheduleEntry[], expectedTotal: number): boolean {
  const sum = schedules.reduce((total, s) => total + s.amount, 0)
  return Math.abs(sum - expectedTotal) < 0.01 // Allow 1 cent tolerance
}
