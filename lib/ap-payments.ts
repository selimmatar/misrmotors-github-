// Authoritative AP (supplier) payment operation, Batch 4B. Mirrors the AR payment route (Batch 1A).
//
// Every new supplier payment against an accounts_payable invoice goes through recordApPayment(). It owns, in order:
//   1. an idempotency claim (idempotency_log, plain INSERT guarded by UNIQUE(operation_type, idempotency_key))
//   2. validation (invoice exists, not already paid, method allowed, receipt present, amount valid)
//   3. a guarded UPDATE of accounts_payable (compare-and-swap on the previously read paid_amount)
//   4. the supplier_payments row and the balance_entries row (both results are checked)
//
// Steps 3 and 4 are not one database transaction. The guarded update in step 3 keeps two concurrent payments from
// both being applied against the same balance; if step 4 fails the failure is reported as a partial failure
// (HTTP 500, partialFailure: true) and the idempotency row is parked as `partial_failure`, so the same key can
// never be replayed into a second increase. accounts_payable.balance is a generated column and is never written.
//
// Historical rows are never modified by this function except the invoice being paid, and only when it is a
// valid unpaid invoice: a row with status `paid` (including the historical `paid` rows with paid_amount 0) or a
// NULL paid_amount is refused.

export const AP_PAYMENT_METHODS = ["cash", "cheque", "bank_transfer"] as const
const CURRENCY_TOLERANCE = 0.005
const MAX_ATTEMPTS = 2 // first attempt + one retry after losing a compare-and-swap race
const OPERATION_TYPE = "payment"
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/

export type ApPaymentResult = { status: number; body: Record<string, any> }

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim())
  return null
}

function mapInvoice(row: any) {
  const amount = Number(row.amount) || 0
  const paid = Number(row.paid_amount) || 0
  return {
    id: row.invoice_id?.toString(),
    invoiceNumber: row.invoice_number,
    poId: row.po_id?.toString() ?? "",
    supplierId: row.supplier_id?.toString() ?? "",
    amount,
    paidAmount: paid,
    balance: round2(amount - paid),
    status: row.status,
    monthsPaid: row.months_paid || 0,
  }
}

const reply = (status: number, error: string, extra: Record<string, unknown> = {}): ApPaymentResult => ({
  status,
  body: { error, ...extra },
})

// Adds a payment to one payable schedule row (compare-and-swap on its paid_amount). Only a row of type "payable" that
// belongs to this invoice or its PO is touched. Returns false (and logs) instead of throwing.
async function markScheduleRow(
  supabase: any,
  scheduleId: number,
  invoiceId: number,
  poId: number | null,
  paymentAmount: number,
  paymentDate: string,
  receiptUrl: string,
): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: row, error } = await supabase.from("payment_schedules").select("*").eq("schedule_id", scheduleId).maybeSingle()
      if (error || !row) {
        console.error(`AP payment - schedule ${scheduleId} not readable:`, error?.message || "not found")
        return false
      }
      const belongs = row.invoice_id === invoiceId || (poId != null && row.po_id === poId)
      if (row.schedule_type !== "payable" || !belongs) {
        console.error(`AP payment - schedule ${scheduleId} is not a payable schedule of invoice ${invoiceId}; left unchanged`)
        return false
      }
      const oldPaid = Number(row.paid_amount) || 0
      const newPaid = round2(oldPaid + paymentAmount)
      const fullyPaid = newPaid >= Number(row.amount) - CURRENCY_TOLERANCE
      const { data: updated, error: updateError } = await supabase
        .from("payment_schedules")
        .update({
          paid_amount: newPaid,
          status: fullyPaid ? "paid" : "partial",
          payment_date: paymentDate,
          receipt_url: receiptUrl,
        })
        .eq("schedule_id", scheduleId)
        .eq("paid_amount", row.paid_amount)
        .select("schedule_id")
      if (updateError) {
        console.error(`AP payment - schedule ${scheduleId} update failed:`, updateError.message)
        return false
      }
      if (updated && updated.length === 1) return true
    }
  } catch (e: any) {
    console.error(`AP payment - schedule ${scheduleId} unexpected error:`, e?.message || e)
  }
  return false
}

export async function recordApPayment(supabase: any, body: any): Promise<ApPaymentResult> {
  // ---- Input validation -------------------------------------------------------------------------
  const invoiceId = Number(body?.invoiceId)
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) return reply(400, "A valid invoiceId is required")

  const parsedAmount = parseAmount(body?.amount)
  if (parsedAmount === null) return reply(400, "amount must be a valid number")
  const paymentAmount = round2(parsedAmount)
  if (paymentAmount <= 0) return reply(400, "amount must be greater than zero")

  const clientKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
  if (!KEY_PATTERN.test(clientKey)) {
    return reply(400, "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)")
  }
  const idempotencyKey = `ap_pay_${invoiceId}_${clientKey}`

  const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim() : ""
  if (!(AP_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return reply(400, `paymentMethod must be one of: ${AP_PAYMENT_METHODS.join(", ")}`)
  }

  const receiptUrl = typeof body?.receiptUrl === "string" ? body.receiptUrl.trim() : ""
  if (!receiptUrl) return reply(400, "A payment receipt (receiptUrl) is required")

  const allowOverpayment = body?.allowOverpayment === true

  // Optional: the payable schedule row this payment is for (generated "gen-" rows have no id and are not sent).
  let scheduleId: number | null = null
  if (body?.scheduleId !== undefined && body?.scheduleId !== null && body?.scheduleId !== "") {
    const parsed = Number(body.scheduleId)
    if (!Number.isInteger(parsed) || parsed <= 0) return reply(400, "scheduleId must be a positive integer")
    scheduleId = parsed
  }

  let paymentDate = new Date().toISOString().split("T")[0]
  if (body?.paymentDate !== undefined && body?.paymentDate !== null && body?.paymentDate !== "") {
    if (typeof body.paymentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate) || Number.isNaN(Date.parse(body.paymentDate))) {
      return reply(400, "paymentDate must be YYYY-MM-DD")
    }
    paymentDate = body.paymentDate
  }

  let recordedBy: number | null = null
  if (body?.recordedBy !== undefined && body?.recordedBy !== null && body?.recordedBy !== "") {
    const parsed = Number(body.recordedBy)
    if (Number.isInteger(parsed) && parsed > 0) recordedBy = parsed
  }

  // ---- Idempotency claim ------------------------------------------------------------------------
  const claim = await supabase.from("idempotency_log").insert({
    operation_type: OPERATION_TYPE,
    idempotency_key: idempotencyKey,
    entity_type: "accounts_payable",
    entity_id: invoiceId,
    status: "processing",
  })

  let claimedHere = !claim.error
  if (claim.error) {
    if (claim.error.code !== "23505") {
      console.error("AP payment - idempotency claim failed:", claim.error.message)
      return reply(500, "Could not start the payment. Nothing was recorded.")
    }

    const { data: previous } = await supabase
      .from("idempotency_log")
      .select("status, error_message")
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()

    if (previous?.status === "completed") {
      const { data: current } = await supabase.from("accounts_payable").select("*").eq("invoice_id", invoiceId).maybeSingle()
      return {
        status: 200,
        body: { success: true, isDuplicate: true, message: "This payment was already recorded", invoice: current ? mapInvoice(current) : null },
      }
    }
    if (previous?.status === "partial_failure") {
      return reply(
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
    if (!claimedHere) return reply(409, "This payment is already being processed")
  }

  const finish = async (status: "completed" | "failed" | "partial_failure", message?: string) => {
    const { error } = await supabase
      .from("idempotency_log")
      .update({ status, error_message: message ?? null, completed_at: new Date().toISOString() })
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
    if (error) console.error("AP payment - could not update idempotency row:", error.message)
  }
  // `failed` is only ever used when the invoice was NOT modified.
  const reject = async (status: number, error: string, extra: Record<string, unknown> = {}) => {
    await finish("failed", error)
    return reply(status, error, extra)
  }

  let invoiceUpdated = false

  try {
    // ---- Guarded update of accounts_payable (compare-and-swap, at most one retry) -------------------
    let invoice: any = null
    let newPaid = 0
    let newMonthsPaid = 0

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data: row, error: readError } = await supabase.from("accounts_payable").select("*").eq("invoice_id", invoiceId).maybeSingle()

      if (readError) {
        console.error("AP payment - invoice read failed:", readError.message)
        return await reject(500, "Could not read the invoice. Nothing was recorded.")
      }
      if (!row) return await reject(404, "Invoice not found")

      const invoiceAmount = round2(Number(row.amount) || 0)
      if (invoiceAmount <= 0) return await reject(409, "This invoice has no payable amount")
      if (row.paid_amount === null || row.paid_amount === undefined) {
        return await reject(409, "This invoice has no recorded paid amount and cannot take a payment until it is reviewed")
      }
      const oldPaid = Number(row.paid_amount)
      if (!Number.isFinite(oldPaid)) return await reject(409, "This invoice has an invalid paid amount and cannot take a payment")
      const remaining = round2(invoiceAmount - oldPaid)

      // Includes the historical rows marked `paid` with paid_amount 0: they are refused, never "completed".
      if (row.status === "paid" || remaining <= CURRENCY_TOLERANCE) {
        return await reject(409, "This invoice is already marked as paid", { remaining: Math.max(remaining, 0) })
      }
      if (paymentAmount > remaining + CURRENCY_TOLERANCE && !allowOverpayment) {
        return await reject(
          409,
          `Payment of ${paymentAmount.toFixed(2)} exceeds the remaining balance of ${remaining.toFixed(2)}. Confirm it as an advance / overpayment to record it.`,
          { remaining, overpayment: true },
        )
      }

      newPaid = round2(oldPaid + paymentAmount)
      newMonthsPaid = (row.months_paid || 0) + 1
      const isFullyPaid = round2(invoiceAmount - newPaid) <= CURRENCY_TOLERANCE

      // UPDATE ... WHERE invoice_id = ? AND paid_amount = <value we just read> AND status = <status we just read>
      const { data: updatedRows, error: updateError } = await supabase
        .from("accounts_payable")
        .update({
          paid_amount: newPaid,
          months_paid: newMonthsPaid,
          status: isFullyPaid ? "paid" : "partially_paid",
          last_payment_at: new Date().toISOString(),
          payment_receipt_url: receiptUrl,
        })
        .eq("invoice_id", invoiceId)
        .eq("paid_amount", oldPaid)
        .eq("status", row.status)
        .select("*")

      if (updateError) {
        console.error("AP payment - invoice update failed:", updateError.message)
        return await reject(500, "Could not update the invoice. Nothing was recorded.")
      }
      if (updatedRows && updatedRows.length === 1) {
        invoice = updatedRows[0]
        break
      }
      // 0 rows: another request changed the invoice between our read and write. Loop re-reads and re-validates.
    }

    if (!invoice) {
      return await reject(409, "The invoice was changed by another payment at the same time. Nothing was recorded; please retry.", {
        conflict: true,
      })
    }

    // ---- From here the invoice HAS been increased. Failures below are partial failures. ---------------
    invoiceUpdated = true
    const invoiceNumber: string = invoice.invoice_number
    const referenceNumber = `${invoiceNumber}-PAY-${newMonthsPaid}`
    const completed: string[] = ["accounts_payable"]

    const partial = async (step: string, message: string): Promise<ApPaymentResult> => {
      const detail = `PARTIAL: invoice ${invoiceId} paid_amount increased by ${paymentAmount.toFixed(2)} (months_paid ${newMonthsPaid}) but ${step} failed: ${message}. Completed: ${completed.join(", ")}`
      console.error("AP payment -", detail)
      await finish("partial_failure", detail)
      return reply(
        500,
        `The payment was applied to the invoice but "${step}" could not be recorded. Do not repeat the payment; contact an administrator.`,
        { partialFailure: true, completed, failedStep: step, invoice: mapInvoice(invoice) },
      )
    }

    const { data: paymentRow, error: paymentError } = await supabase
      .from("supplier_payments")
      .insert({
        invoice_id: invoiceId,
        supplier_id: invoice.supplier_id ?? null,
        amount: paymentAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        receipt_url: receiptUrl,
        recorded_by: recordedBy,
      })
      .select("payment_id")
      .single()
    if (paymentError) return await partial("supplier_payments", paymentError.message)
    completed.push("supplier_payments")

    // Same convention as the existing AP ledger rows: ap_payment, negative amount, reference_id = po_id.
    const { error: balanceError } = await supabase.from("balance_entries").insert({
      entry_type: "ap_payment",
      reference_type: "purchase_order",
      reference_id: invoice.po_id ?? null,
      reference_number: referenceNumber,
      amount: -paymentAmount,
      description: `AP payment for ${invoiceNumber} (payment ${newMonthsPaid})`,
      status: "active",
      created_by: recordedBy,
    })
    if (balanceError) return await partial("balance_entries", balanceError.message)
    completed.push("balance_entries")

    // Mark the matching payable schedule row. The payment is already fully recorded, so a problem here is reported
    // as scheduleUpdated:false and never fails or un-does the payment.
    let scheduleUpdated: boolean | undefined
    if (scheduleId !== null) {
      scheduleUpdated = await markScheduleRow(supabase, scheduleId, invoiceId, invoice.po_id, paymentAmount, paymentDate, receiptUrl)
    }

    await finish("completed")

    return {
      status: 200,
      body: {
        success: true,
        invoice: mapInvoice(invoice),
        payment: { id: paymentRow?.payment_id?.toString(), amount: paymentAmount, referenceNumber, paymentMethod },
        ...(scheduleUpdated === undefined ? {} : { scheduleUpdated }),
      },
    }
  } catch (error: any) {
    // Unexpected exception. If it happened after the guarded update the key must not become retryable.
    console.error("AP payment - unexpected error:", error?.message || error)
    if (invoiceUpdated) {
      await finish("partial_failure", `Unexpected error after invoice update: ${error?.message || error}`)
      return reply(500, "Unexpected error after the invoice was updated. Do not repeat the payment; contact an administrator.", {
        partialFailure: true,
      })
    }
    await finish("failed", `Unexpected error: ${error?.message || error}`)
    return reply(500, "Unexpected error while recording the payment. Nothing was recorded.")
  }
}
