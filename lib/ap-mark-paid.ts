// Request-building for the Accountant screen's supplier "Mark as paid" button (Batch 4F).
//
// The button used to change the invoice in the browser and write a balance entry itself. It now only describes ONE
// installment payment for POST /api/accounts-payable/payments (lib/ap-payments.ts recordApPayment), which is the
// only place that updates the invoice and writes supplier_payments + balance_entries. The server requires a payment
// method and a receipt; this helper never invents either: without them it returns { ok: false } with the reason, and
// the button stays disabled.

export type MarkPaidInvoice = {
  id: string | number
  amount: number
  paidAmount?: number | null
  monthsPaid?: number | null
  status?: string
}

export type MarkPaidResult =
  | { ok: true; amount: number; body: Record<string, unknown> }
  | { ok: false; reason: string }

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function buildMarkAsPaidRequest(input: {
  invoice: MarkPaidInvoice
  installmentMonths: number
  paymentMethod?: string
  receiptUrl?: string
  idempotencyKey?: string
}): MarkPaidResult {
  const { invoice, installmentMonths } = input
  const invoiceId = Number(invoice.id)
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) return { ok: false, reason: "Invalid invoice" }
  if (!(installmentMonths > 0)) {
    return {
      ok: false,
      reason: "This invoice has no installment plan, so the instalment amount cannot be determined. Use the Accounts Payable screen.",
    }
  }

  const amount = round2(Number(invoice.amount) || 0)
  const paidSoFar = round2(Number(invoice.paidAmount) || 0)
  const remaining = round2(amount - paidSoFar)
  if (invoice.status === "paid" || remaining <= 0.005) return { ok: false, reason: "This invoice is already paid" }

  // One instalment, never more than the remaining balance; the final instalment settles the exact remainder.
  const monthsPaid = Number(invoice.monthsPaid) || 0
  const instalment = round2(amount / installmentMonths)
  const payment = monthsPaid + 1 >= installmentMonths ? remaining : Math.min(instalment, remaining)

  if (!input.paymentMethod) {
    return { ok: false, reason: "A payment method is required. Record this payment from the Accounts Payable screen." }
  }
  if (!input.receiptUrl) {
    return { ok: false, reason: "A payment receipt is required. Record this payment from the Accounts Payable screen." }
  }
  if (!input.idempotencyKey) return { ok: false, reason: "Missing idempotency key" }

  return {
    ok: true,
    amount: payment,
    body: {
      invoiceId,
      amount: payment,
      paymentMethod: input.paymentMethod,
      receiptUrl: input.receiptUrl,
      idempotencyKey: input.idempotencyKey,
    },
  }
}
