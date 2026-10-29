// Authoritative AR (customer) payment operation, shared by POST /api/accounts-receivable/payments and the payment
// paths of PUT /api/payment-schedules for schedules linked to an AR invoice (BIZ-S-009), so every customer payment
// writes the same rows.
//
// recordArPayment() owns, in this order:
//   1. an idempotency claim (idempotency_log, plain INSERT guarded by the table's UNIQUE constraint)
//   2. validation (invoice exists, not already paid, amount valid, amount <= remaining balance unless confirmed)
//   3. a guarded UPDATE of accounts_receivable (compare-and-swap on the previously read collected_amount and amount)
//   4. the customer_payments row, the balance_entries row and (for a persisted schedule) the schedule row
//
// Steps 3 and 4 are NOT one database transaction (no RPC is used). The guarded update in step 3 is what
// keeps the invoice from being over-collected; if a later step fails the failure is reported as a partial
// failure (HTTP 500, partialFailure: true) and the idempotency row is parked as `partial_failure` so the
// same key cannot be replayed into a second AR increase.
//
// Duplicates: a payment whose receipt or reference (referenceNumber) matches a payment already recorded on the
// invoice is refused with 409 DUPLICATE_PAYMENT unless the request carries confirmDuplicate: true.
// Overpayments: a payment above the remaining balance is refused with 409 OVERPAYMENT unless the request carries
// allowOverpayment: true. Confirmed, the invoice is capped at its amount (status paid), the payment and ledger rows
// keep the full cash amount, and the excess becomes one active customer_credits row (credit_type "overpayment").
// The credit's customer is the invoice's, else its sales order's; with neither, the overpayment is refused before
// anything is written (409 OVERPAYMENT_NO_CUSTOMER).
// The credit payment methods ("customer_credit", "supplier_credit") are not cash and are refused here: a customer
// credit is used through lib/customer-credit-apply.ts.
import { computeArStatus } from "./ar-status"
import { CUSTOMER_CREDIT_PAYMENT_METHOD } from "./credit-apply"

export type ArPaymentResult = { status: number; body: Record<string, any> }
export type ArPaymentOptions = {
  /** extra columns written on the schedule row together with the payment (payment-schedules PUT: notes, files) */
  scheduleFields?: Record<string, any>
}

const CURRENCY_TOLERANCE = 0.005
const MAX_ATTEMPTS = 2 // first attempt + one retry after losing a compare-and-swap race
const OPERATION_TYPE = "payment"
// payment_method values of credits (no cash moved); never accepted on a cash payment
const CREDIT_PAYMENT_METHODS = [CUSTOMER_CREDIT_PAYMENT_METHOD, "supplier_credit"]

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ArPaymentResult => ({
  status,
  body: { error, ...extra },
})

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim())
  return null
}

export function mapArInvoice(row: any) {
  const amount = Number(row.amount) || 0
  const collected = Number(row.collected_amount) || 0
  return {
    id: row.invoice_id?.toString(),
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id?.toString(),
    soId: row.so_id?.toString(),
    paymentTerms: row.payment_terms || null,
    amount,
    collectedAmount: collected,
    balance: round2(amount - collected),
    status: row.status,
    installmentMonths: row.installment_months || 0,
    monthsPaid: row.months_paid || 0,
  }
}

// The idempotency_log key of an AR payment made with the client's key.
export const arPaymentLogKey = (invoiceId: number, clientKey: string) => `ar_pay_${invoiceId}_${clientKey}`

export async function recordArPayment(supabase: any, body: any, options: ArPaymentOptions = {}): Promise<ArPaymentResult> {
  // ---- Input validation -------------------------------------------------------------------------
  const invoiceId = Number(body?.invoiceId)
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return fail(400, "A valid invoiceId is required")
  }

  const parsedAmount = parseAmount(body?.amount)
  if (parsedAmount === null) return fail(400, "amount must be a valid number")
  const paymentAmount = round2(parsedAmount)
  if (paymentAmount <= 0) return fail(400, "amount must be greater than zero")

  const clientKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(clientKey)) {
    return fail(400, "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)")
  }
  const idempotencyKey = arPaymentLogKey(invoiceId, clientKey)

  const receiptUrl = typeof body?.receiptUrl === "string" && body.receiptUrl ? body.receiptUrl : null
  const paymentMethod =
    typeof body?.paymentMethod === "string" && body.paymentMethod.trim() ? body.paymentMethod.trim() : "bank_transfer"
  if (CREDIT_PAYMENT_METHODS.includes(paymentMethod)) {
    return fail(400, `paymentMethod "${paymentMethod}" is not a cash payment; use the credit dialog to apply customer credit`)
  }
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null
  const allowOverpayment = body?.allowOverpayment === true
  const confirmDuplicate = body?.confirmDuplicate === true
  // Optional bank / cheque reference typed by the user. It is checked for duplicates and saved as the payment's
  // reference_number; without it the generated <invoice>-PAY-<n> reference is used.
  const clientReference = typeof body?.referenceNumber === "string" ? body.referenceNumber.trim() : ""
  if (clientReference.length > 50) return fail(400, "referenceNumber must be at most 50 characters")

  // scheduleId: only a persisted schedule (integer id) is written to payment_schedules; client-side
  // generated ids ("gen-...") are ignored here.
  let scheduleId: number | null = null
  if (body?.scheduleId !== undefined && body?.scheduleId !== null && body?.scheduleId !== "") {
    const rawScheduleId = String(body.scheduleId)
    if (!rawScheduleId.startsWith("gen-")) {
      scheduleId = Number(rawScheduleId)
      if (!Number.isInteger(scheduleId) || scheduleId <= 0) return fail(400, "scheduleId is not valid")
    }
  }

  // ---- Idempotency claim (atomic INSERT; the UNIQUE(operation_type, idempotency_key) decides) -----
  const claim = await supabase.from("idempotency_log").insert({
    operation_type: OPERATION_TYPE,
    idempotency_key: idempotencyKey,
    entity_type: "accounts_receivable",
    entity_id: invoiceId,
    status: "processing",
  })

  let claimedHere = !claim.error
  if (claim.error) {
    if (claim.error.code !== "23505") {
      console.error("AR payment - idempotency claim failed:", claim.error.message)
      return fail(500, "Could not start the payment. Nothing was recorded.")
    }

    // Same key seen before.
    const { data: previous } = await supabase
      .from("idempotency_log")
      .select("status, error_message")
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()

    if (previous?.status === "completed") {
      const { data: current } = await supabase.from("accounts_receivable").select("*").eq("invoice_id", invoiceId).maybeSingle()
      return {
        status: 200,
        body: {
          success: true,
          isDuplicate: true,
          message: "This payment was already recorded",
          invoice: current ? mapArInvoice(current) : null,
        },
      }
    }
    if (previous?.status === "partial_failure") {
      return fail(
        409,
        "This payment was applied to the invoice but part of the record failed. It will not be repeated; contact an administrator to review.",
        { partialFailure: true },
      )
    }
    if (previous?.status === "failed") {
      // Rejected before the invoice was touched: the same key may be retried. Re-claim atomically.
      const { data: reclaimed } = await supabase
        .from("idempotency_log")
        .update({ status: "processing", error_message: null, completed_at: null })
        .eq("operation_type", OPERATION_TYPE)
        .eq("idempotency_key", idempotencyKey)
        .eq("status", "failed")
        .select("id")
      claimedHere = !!reclaimed && reclaimed.length === 1
    }
    if (!claimedHere) {
      return fail(409, "This payment is already being processed")
    }
  }

  // Marks the idempotency row. `failed` is only ever used when the invoice was NOT modified.
  const finish = async (status: "completed" | "failed" | "partial_failure", message?: string) => {
    const { error } = await supabase
      .from("idempotency_log")
      .update({ status, error_message: message ?? null, completed_at: new Date().toISOString() })
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
    if (error) console.error("AR payment - could not update idempotency row:", error.message)
  }
  const reject = async (status: number, error: string, extra: Record<string, unknown> = {}) => {
    await finish("failed", error)
    return fail(status, error, extra)
  }

  let invoiceUpdated = false

  try {
    // ---- Duplicate check: same receipt or same reference already recorded on this invoice ------------
    if (!confirmDuplicate && (receiptUrl || clientReference)) {
      const { data: existing, error: existingError } = await supabase
        .from("customer_payments")
        .select("payment_id, payment_date, amount, receipt_url, reference_number")
        .eq("invoice_id", invoiceId)
      if (existingError) {
        console.error("AR payment - existing payments read failed:", existingError.message)
        return await reject(500, "Could not check the existing payments. Nothing was recorded.")
      }
      const match = (existing || []).find(
        (p: any) =>
          (receiptUrl !== null && p.receipt_url && String(p.receipt_url).trim() === receiptUrl.trim()) ||
          (clientReference !== "" && p.reference_number && String(p.reference_number).trim() === clientReference),
      )
      if (match) {
        return await reject(409, "This looks like a payment that is already recorded on this invoice", {
          code: "DUPLICATE_PAYMENT",
          existingPayment: { id: match.payment_id?.toString(), paymentDate: match.payment_date, amount: Number(match.amount) || 0 },
        })
      }
    }

    // ---- Optional persisted schedule: validate before touching the invoice ----------------------
    let schedule: any = null
    if (scheduleId !== null) {
      const { data, error } = await supabase.from("payment_schedules").select("*").eq("schedule_id", scheduleId).maybeSingle()
      if (error) {
        console.error("AR payment - schedule lookup failed:", error.message)
        return await reject(500, "Could not read the payment schedule. Nothing was recorded.")
      }
      if (!data) return await reject(404, "Payment schedule not found")
      if (data.invoice_id !== invoiceId) return await reject(400, "This schedule does not belong to the invoice")
      if (data.status === "paid") return await reject(409, "This schedule has already been paid in full")
      schedule = data
    }

    // ---- Guarded update of accounts_receivable (compare-and-swap, at most one retry) ----------------
    let invoice: any = null
    let newCollected = 0
    let newMonthsPaid = 0
    let excess = 0
    let creditCustomerId: number | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data: row, error: readError } = await supabase
        .from("accounts_receivable")
        .select("*")
        .eq("invoice_id", invoiceId)
        .maybeSingle()

      if (readError) {
        console.error("AR payment - invoice read failed:", readError.message)
        return await reject(500, "Could not read the invoice. Nothing was recorded.")
      }
      if (!row) return await reject(404, "Invoice not found")

      const invoiceAmount = round2(Number(row.amount) || 0)
      const oldCollected = row.collected_amount === null ? null : Number(row.collected_amount)
      const collected = round2(oldCollected ?? 0)
      const remaining = round2(invoiceAmount - collected)

      if (row.status === "paid" || remaining <= CURRENCY_TOLERANCE) {
        return await reject(409, "This invoice is already fully paid", { remaining: Math.max(remaining, 0) })
      }
      const isOverpayment = paymentAmount > remaining + CURRENCY_TOLERANCE
      if (isOverpayment && !allowOverpayment) {
        return await reject(
          409,
          `Payment of ${paymentAmount.toFixed(2)} exceeds the remaining balance of ${remaining.toFixed(2)}. Confirm it to save the extra as customer credit.`,
          { code: "OVERPAYMENT", remaining, excess: round2(paymentAmount - remaining), overpayment: true },
        )
      }

      // The excess becomes credit of the invoice's customer (an older row may have none: then the sales order's).
      // Resolved before any write, so an overpayment that could not be saved as credit is never booked.
      if (isOverpayment && creditCustomerId === null) {
        creditCustomerId = row.customer_id ?? null
        if (creditCustomerId === null && row.so_id) {
          const { data: so, error: soError } = await supabase.from("sales_orders").select("customer_id").eq("so_id", row.so_id).maybeSingle()
          if (soError) {
            console.error("AR payment - sales order read failed:", soError.message)
            return await reject(500, "Could not read the sales order of the invoice. Nothing was recorded.")
          }
          creditCustomerId = so?.customer_id ?? null
        }
        if (creditCustomerId === null) {
          return await reject(409, "This invoice has no customer, so the extra cannot be saved as customer credit. Record at most the remaining balance.", {
            code: "OVERPAYMENT_NO_CUSTOMER",
            remaining,
          })
        }
      }

      // The invoice never goes above its amount; the excess is saved as customer credit after the payment rows.
      excess = isOverpayment ? round2(paymentAmount - remaining) : 0
      newCollected = isOverpayment ? invoiceAmount : round2(collected + paymentAmount)
      newMonthsPaid = (row.months_paid || 0) + 1

      // UPDATE ... WHERE invoice_id = ? AND collected_amount = <value we just read>
      let update = supabase
        .from("accounts_receivable")
        .update({
          collected_amount: newCollected,
          months_paid: newMonthsPaid,
          status: computeArStatus({ amount: invoiceAmount, collectedAmount: newCollected }),
          last_payment_at: new Date().toISOString(),
        })
        .eq("invoice_id", invoiceId)
      update = oldCollected === null ? update.is("collected_amount", null) : update.eq("collected_amount", oldCollected)
      // and on the amount the balance was checked against
      update = row.amount === null || row.amount === undefined ? update.is("amount", null) : update.eq("amount", row.amount)

      const { data: updatedRows, error: updateError } = await update.select("*")

      if (updateError) {
        console.error("AR payment - invoice update failed:", updateError.message)
        return await reject(500, "Could not update the invoice. Nothing was recorded.")
      }
      if (updatedRows && updatedRows.length === 1) {
        invoice = updatedRows[0]
        break
      }
      // 0 rows: another request changed collected_amount (or the amount) between our read and write. Loop re-reads and
      // re-validates against the new balance (or gives up after MAX_ATTEMPTS).
    }

    if (!invoice) {
      return await reject(409, "The invoice was changed by another payment at the same time. Nothing was recorded; please retry.", {
        conflict: true,
      })
    }

    // ---- From here the invoice HAS been increased. Failures below are partial failures. -------------
    invoiceUpdated = true
    const invoiceNumber: string = invoice.invoice_number
    const referenceNumber = clientReference || `${invoiceNumber}-PAY-${newMonthsPaid}`
    const description = `AR Payment - ${invoiceNumber} (Payment ${newMonthsPaid}${label ? `: ${label}` : ""})`
    const completed: string[] = ["accounts_receivable"]

    const partial = async (step: string, message: string) => {
      const detail = `PARTIAL: invoice ${invoiceId} collected_amount increased by ${round2(paymentAmount - excess).toFixed(2)} (months_paid ${newMonthsPaid}) but ${step} failed: ${message}. Completed: ${completed.join(", ")}`
      console.error("AR payment -", detail)
      await finish("partial_failure", detail)
      return fail(
        500,
        `The payment was applied to the invoice but "${step}" could not be recorded. Do not repeat the payment; contact an administrator.`,
        { partialFailure: true, completed, failedStep: step, invoice: mapArInvoice(invoice) },
      )
    }

    const { data: paymentRow, error: paymentError } = await supabase
      .from("customer_payments")
      .insert({
        invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        amount: paymentAmount,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        receipt_url: receiptUrl,
      })
      .select("payment_id")
      .single()
    if (paymentError) return await partial("customer_payments", paymentError.message)
    completed.push("customer_payments")

    const { error: balanceError } = await supabase.from("balance_entries").insert({
      entry_type: "ar_payment",
      reference_type: "accounts_receivable",
      reference_id: invoiceId,
      reference_number: referenceNumber,
      amount: paymentAmount,
      description,
      status: "active",
    })
    if (balanceError) return await partial("balance_entries", balanceError.message)
    completed.push("balance_entries")

    // Confirmed overpayment: the excess is an open credit for this customer, usable on a later invoice.
    let credit: { id: string | undefined; amount: number } | undefined
    if (excess > CURRENCY_TOLERANCE) {
      const note = `Overpayment on ${invoiceNumber}`
      const { data: creditRow, error: creditError } = await supabase
        .from("customer_credits")
        .insert({
          customer_id: creditCustomerId,
          amount: excess,
          status: "active",
          credit_type: "overpayment",
          reference_type: "ar_payment",
          reference_id: paymentRow?.payment_id ?? null,
          invoice_id: invoiceId,
          description: note,
          notes: note,
        })
        .select("credit_id")
        .single()
      if (creditError) return await partial("customer_credits", creditError.message)
      completed.push("customer_credits")
      credit = { id: creditRow?.credit_id?.toString(), amount: excess }
    }

    if (schedule) {
      // Compare-and-swap on the schedule's paid_amount (re-read once when another payment of the same schedule got
      // there first), so two payments of one schedule are both added.
      let scheduleRow: any = schedule
      let scheduleWritten = false
      for (let attempt = 1; attempt <= MAX_ATTEMPTS + 1 && !scheduleWritten; attempt++) {
        if (attempt > 1) {
          const { data: fresh, error: freshError } = await supabase
            .from("payment_schedules")
            .select("*")
            .eq("schedule_id", scheduleId as number)
            .maybeSingle()
          if (freshError || !fresh) return await partial("payment_schedules", freshError?.message || "schedule not found")
          scheduleRow = fresh
        }
        // only the part that went to the invoice counts on the schedule (the excess is customer credit)
        const newPaid = round2((Number(scheduleRow.paid_amount) || 0) + paymentAmount - excess)
        const scheduleDone = newPaid >= round2(Number(scheduleRow.amount) || 0) - CURRENCY_TOLERANCE
        let scheduleUpdate = supabase
          .from("payment_schedules")
          .update({
            paid_amount: newPaid,
            payment_date: new Date().toISOString().split("T")[0],
            status: scheduleDone ? "paid" : "partial",
            receipt_url: receiptUrl || scheduleRow.receipt_url,
            payment_idempotency_key: idempotencyKey,
            ...(options.scheduleFields || {}),
          })
          .eq("schedule_id", scheduleId as number)
        scheduleUpdate =
          scheduleRow.paid_amount === null || scheduleRow.paid_amount === undefined
            ? scheduleUpdate.is("paid_amount", null)
            : scheduleUpdate.eq("paid_amount", scheduleRow.paid_amount)
        const { data: scheduleRows, error: scheduleError } = await scheduleUpdate.select("schedule_id")
        if (scheduleError) return await partial("payment_schedules", scheduleError.message)
        scheduleWritten = Array.isArray(scheduleRows) && scheduleRows.length === 1
      }
      if (!scheduleWritten) return await partial("payment_schedules", "the schedule kept changing while it was updated")
      completed.push("payment_schedules")
    }

    await finish("completed")

    return {
      status: 200,
      body: {
        success: true,
        invoice: mapArInvoice(invoice),
        payment: {
          id: paymentRow?.payment_id?.toString(),
          amount: paymentAmount,
          referenceNumber,
          paymentMethod,
        },
        ...(credit ? { credit } : {}),
      },
    }
  } catch (error: any) {
    // Unexpected exception. If it happened after the guarded update the key must not become retryable.
    console.error("AR payment - unexpected error:", error?.message || error)
    if (invoiceUpdated) {
      await finish("partial_failure", `Unexpected error after invoice update: ${error?.message || error}`)
      return fail(500, "Unexpected error after the invoice was updated. Do not repeat the payment; contact an administrator.", {
        partialFailure: true,
      })
    }
    await finish("failed", `Unexpected error: ${error?.message || error}`)
    return fail(500, "Unexpected error while recording the payment. Nothing was recorded.")
  }
}
