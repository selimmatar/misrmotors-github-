import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Authoritative AR payment operation.
//
// Every new customer payment against an AR invoice goes through this route. It owns, in this order:
//   1. an idempotency claim (idempotency_log, plain INSERT guarded by the table's UNIQUE constraint)
//   2. validation (invoice exists, not already paid, amount valid, amount <= remaining balance)
//   3. a guarded UPDATE of accounts_receivable (compare-and-swap on the previously read collected_amount)
//   4. the customer_payments row, the balance_entries row and (for a persisted schedule) the schedule row
//
// Steps 3 and 4 are NOT one database transaction (no RPC is used). The guarded update in step 3 is what
// keeps the invoice from being over-collected; if a later step fails the failure is reported as a partial
// failure (HTTP 500, partialFailure: true) and the idempotency row is parked as `partial_failure` so the
// same key cannot be replayed into a second AR increase.

const CURRENCY_TOLERANCE = 0.005
const MAX_ATTEMPTS = 2 // first attempt + one retry after losing a compare-and-swap race
const OPERATION_TYPE = "payment"

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status })

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim())
  return null
}

function mapInvoice(row: any) {
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

export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch {
    return fail(400, "Invalid JSON body")
  }

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
  const idempotencyKey = `ar_pay_${invoiceId}_${clientKey}`

  const receiptUrl = typeof body?.receiptUrl === "string" && body.receiptUrl ? body.receiptUrl : null
  const paymentMethod =
    typeof body?.paymentMethod === "string" && body.paymentMethod.trim() ? body.paymentMethod.trim() : "bank_transfer"
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null

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
      return NextResponse.json({
        success: true,
        isDuplicate: true,
        message: "This payment was already recorded",
        invoice: current ? mapInvoice(current) : null,
      })
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
      if (paymentAmount > remaining + CURRENCY_TOLERANCE) {
        return await reject(409, `Payment of ${paymentAmount.toFixed(2)} exceeds the remaining balance of ${remaining.toFixed(2)}`, {
          remaining,
        })
      }

      newCollected = round2(collected + paymentAmount)
      newMonthsPaid = (row.months_paid || 0) + 1
      const isFullyPaid = round2(invoiceAmount - newCollected) <= CURRENCY_TOLERANCE

      // UPDATE ... WHERE invoice_id = ? AND collected_amount = <value we just read>
      let update = supabase
        .from("accounts_receivable")
        .update({
          collected_amount: newCollected,
          months_paid: newMonthsPaid,
          status: isFullyPaid ? "paid" : "partially_paid",
          last_payment_at: new Date().toISOString(),
        })
        .eq("invoice_id", invoiceId)
      update = oldCollected === null ? update.is("collected_amount", null) : update.eq("collected_amount", oldCollected)

      const { data: updatedRows, error: updateError } = await update.select("*")

      if (updateError) {
        console.error("AR payment - invoice update failed:", updateError.message)
        return await reject(500, "Could not update the invoice. Nothing was recorded.")
      }
      if (updatedRows && updatedRows.length === 1) {
        invoice = updatedRows[0]
        break
      }
      // 0 rows: another request changed collected_amount between our read and write. Loop re-reads and
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
    const referenceNumber = `${invoiceNumber}-PAY-${newMonthsPaid}`
    const description = `AR Payment - ${invoiceNumber} (Payment ${newMonthsPaid}${label ? `: ${label}` : ""})`
    const completed: string[] = ["accounts_receivable"]

    const partial = async (step: string, message: string) => {
      const detail = `PARTIAL: invoice ${invoiceId} collected_amount increased by ${paymentAmount.toFixed(2)} (months_paid ${newMonthsPaid}) but ${step} failed: ${message}. Completed: ${completed.join(", ")}`
      console.error("AR payment -", detail)
      await finish("partial_failure", detail)
      return fail(
        500,
        `The payment was applied to the invoice but "${step}" could not be recorded. Do not repeat the payment; contact an administrator.`,
        { partialFailure: true, completed, failedStep: step, invoice: mapInvoice(invoice) },
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

    if (schedule) {
      const newPaid = round2((Number(schedule.paid_amount) || 0) + paymentAmount)
      const scheduleDone = newPaid >= round2(Number(schedule.amount) || 0) - CURRENCY_TOLERANCE
      const { error: scheduleError } = await supabase
        .from("payment_schedules")
        .update({
          paid_amount: newPaid,
          payment_date: new Date().toISOString().split("T")[0],
          status: scheduleDone ? "paid" : "partial",
          receipt_url: receiptUrl || schedule.receipt_url,
          payment_idempotency_key: idempotencyKey,
        })
        .eq("schedule_id", scheduleId as number)
      if (scheduleError) return await partial("payment_schedules", scheduleError.message)
      completed.push("payment_schedules")
    }

    await finish("completed")

    return NextResponse.json({
      success: true,
      invoice: mapInvoice(invoice),
      payment: {
        id: paymentRow?.payment_id?.toString(),
        amount: paymentAmount,
        referenceNumber,
        paymentMethod,
      },
    })
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
