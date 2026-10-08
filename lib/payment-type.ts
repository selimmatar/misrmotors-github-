// Single source of truth for payment-type semantics (Batch 1C).
//
// Cash, cheque and bank transfer are SINGLE-PAYMENT types: they never have an installment plan, no matter
// what stale/default installment values (e.g. the quotation form's default of 6) are lying around in the
// payment details. "installments" is the installment-based type. "hybrid" (down payment + installments) is
// deliberately NOT redesigned here: every helper leaves hybrid values exactly as they were.
//
// This file has no imports so it can be used from API routes, client components and plain node tests.

export type PaymentKind = "single" | "installment" | "hybrid" | "unknown"

// Values seen in sales_quotations.payment_type, sales_orders.payment_type / payment_terms and
// accounts_receivable.payment_terms (the last one stores the SO's payment_type).
const SINGLE_TYPES = new Set(["cash", "bank_transfer", "cheque", "prepaid"])
const INSTALLMENT_TYPES = new Set(["installments", "installment"])

export function getPaymentKind(paymentType?: string | null): PaymentKind {
  const value = (paymentType || "").toString().trim().toLowerCase()
  if (SINGLE_TYPES.has(value)) return "single"
  if (INSTALLMENT_TYPES.has(value)) return "installment"
  if (value === "hybrid") return "hybrid"
  return "unknown"
}

export const isSinglePayment = (paymentType?: string | null) => getPaymentKind(paymentType) === "single"

// Installment count for a payment type. Single-payment types are always 1, whatever raw value is passed.
// Every other kind (installment, hybrid, unknown) returns the raw value untouched.
export function resolveInstallmentCount<T extends number | null | undefined>(
  paymentType: string | null | undefined,
  rawInstallments: T,
): T | 1 {
  return isSinglePayment(paymentType) ? 1 : rawInstallments
}

// sales_orders.payment_terms only allows 'prepaid' | 'installment' (DB CHECK, unchanged).
// Single-payment types (including cheque) -> 'prepaid'; installments and hybrid -> 'installment'.
export function toSalesOrderPaymentTerms(paymentType?: string | null): "prepaid" | "installment" {
  const kind = getPaymentKind(paymentType)
  return kind === "installment" || kind === "hybrid" ? "installment" : "prepaid"
}

const toNull = (value: any) => (value === undefined || value === null || value === "" ? null : value)

// The payment columns written on a sales order converted from a quotation, from the quotation's
// payment_type and its stored payment_details JSON.
//  - installments / hybrid / unknown: copied exactly as before this batch.
//  - cash / bank_transfer: single payment -> installments = 1, no installment/down-payment/cheque fields.
//  - cheque: single payment -> installments = 1, cheque fields only.
export function buildSalesOrderPaymentFields(paymentType: string, paymentDetails: any) {
  const d = paymentDetails || {}
  const kind = getPaymentKind(paymentType)
  const base = { payment_type: paymentType, payment_terms: toSalesOrderPaymentTerms(paymentType) }

  if (kind === "single") {
    const isCheque = paymentType === "cheque"
    return {
      ...base,
      installments: 1,
      monthly_amount: null,
      payment_start_date: null,
      down_payment_type: null,
      down_payment_percent: null,
      down_payment_amount: null,
      down_payment_due_date: null,
      down_payment_cheque_number: null,
      down_payment_cheque_bank: null,
      down_payment_cheque_due_date: null,
      remaining_installment_months: null,
      remaining_amount: null,
      cheque_number: isCheque ? d.chequeNumber || null : null,
      cheque_bank_name: isCheque ? d.chequeBankName || null : null,
      cheque_due_date: isCheque ? toNull(d.chequeDueDate) : null,
      cheque_amount: isCheque ? d.chequeAmount || null : null,
      cheque_notes: isCheque ? d.chequeNotes || null : null,
    }
  }

  // installments, hybrid and anything unrecognised: unchanged from the previous behaviour.
  return {
    ...base,
    installments: d.installmentMonths || null,
    monthly_amount: d.monthlyAmount || null,
    payment_start_date: toNull(d.paymentStartDate),
    down_payment_type: d.downPaymentType || null,
    down_payment_percent: d.downPaymentPercent || null,
    down_payment_amount: d.downPaymentAmount || null,
    down_payment_due_date: toNull(d.downPaymentDueDate),
    down_payment_cheque_number: d.downPaymentChequeNumber || null,
    down_payment_cheque_bank: d.downPaymentChequeBank || null,
    down_payment_cheque_due_date: toNull(d.downPaymentChequeDueDate),
    remaining_installment_months: d.remainingInstallmentMonths || null,
    remaining_amount: d.remainingAmount || null,
    cheque_number: d.chequeNumber || null,
    cheque_bank_name: d.chequeBankName || null,
    cheque_due_date: toNull(d.chequeDueDate),
    cheque_amount: d.chequeAmount || null,
    cheque_notes: d.chequeNotes || null,
  }
}

// payment_details JSON to store on a quotation. Always records the real payment type (the form used to leave
// it at its initial "cash"). For single-payment types the installment / down-payment / remaining defaults
// are dropped (cheque keeps its cheque fields). Installments and hybrid details are returned unchanged
// apart from the corrected paymentType.
export function normalizeQuotationPaymentDetails(paymentType: string, paymentDetails: any) {
  const d = paymentDetails || {}
  if (getPaymentKind(paymentType) !== "single") return { ...d, paymentType }
  if (paymentType === "cheque") {
    return {
      paymentType,
      chequeNumber: d.chequeNumber,
      chequeBankName: d.chequeBankName,
      chequeDueDate: d.chequeDueDate,
      chequeAmount: d.chequeAmount,
      chequeNotes: d.chequeNotes,
    }
  }
  return { paymentType }
}
