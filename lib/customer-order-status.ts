// Customers tab: per-order payment and delivery summary. Invoices are raised per delivery permit (create-from-dps),
// so one sales order can have several AR invoices; the order is only paid when the money collected across ALL of
// them covers the ORDER total, not just the invoices raised so far. Display-only: nothing stored is changed.

export type OrderInvoice = { amount?: number | string | null; collectedAmount?: number | string | null; monthsPaid?: number | null; installmentMonths?: number | null }

export type OrderPayment = {
  status: "no_invoice" | "unpaid" | "partially_paid" | "paid"
  monthsPaid: number
  totalMonths: number
  amountPaid: number
  totalAmount: number
  amountDue: number
}

const num = (v: unknown) => Number(v) || 0
// Money is compared in piastres so float sums like 0.1 + 0.2 don't leave a phantom balance.
const cents = (v: number) => Math.round(v * 100)

export function orderPayment(order: { total: number; installments?: number | null }, invoices: OrderInvoice[]): OrderPayment {
  const totalMonths = order.installments || Math.max(0, ...invoices.map((i) => num(i.installmentMonths))) || 1
  if (invoices.length === 0) {
    return { status: "no_invoice", monthsPaid: 0, totalMonths, amountPaid: 0, totalAmount: num(order.total), amountDue: num(order.total) }
  }
  const amountPaid = invoices.reduce((s, i) => s + num(i.collectedAmount), 0)
  const invoiced = invoices.reduce((s, i) => s + num(i.amount), 0)
  // The order total is what the customer owes; fall back to the invoiced sum only when it is larger (or the total is missing).
  const totalAmount = Math.max(num(order.total), invoiced)
  const amountDue = Math.max(0, (cents(totalAmount) - cents(amountPaid)) / 100)
  const monthsPaid = Math.max(0, ...invoices.map((i) => num(i.monthsPaid)))
  const status = cents(amountPaid) <= 0 ? "unpaid" : cents(amountPaid) < cents(totalAmount) ? "partially_paid" : "paid"
  return { status, monthsPaid, totalMonths, amountPaid, totalAmount, amountDue }
}

/**
 * The status to show for an order. By design the stored status stays "ready_for_delivery" (fulfillment
 * PARTIALLY_DELIVERED) until every line is delivered, so when some lines have been delivered but not all, show
 * "partially_delivered" instead of "Ready for Delivery".
 */
export function orderDisplayStatus(order: { status: string; items?: readonly any[] }): string {
  if (order.status === "delivered") return order.status
  const states = (order.items || []).map((i) => i.deliveryState).filter(Boolean)
  const some = states.some((s) => s === "delivered" || s === "partial")
  const all = states.length > 0 && states.length === (order.items || []).length && states.every((s) => s === "delivered")
  return some && !all ? "partially_delivered" : order.status
}
