// Using customer credits (raised by overpayments, lib/ar-payments.ts) on an open AR invoice.
// POST /api/accounts-receivable/apply-credit.
//
// Lifecycle (customer_credits, same columns and rules as supplier_credits, lib/credit-apply.ts):
//   1. an idempotency claim (idempotency_log, operation "ar_credit_apply")
//   2. validation: every credit is the invoice customer's and still active, and the total is at most the invoice's
//      remaining balance
//   3. each credit moves active -> used with used_in_invoice_id = the invoice (guarded on status and amount); a
//      partly used credit is split, the remainder stays active
//   4. a guarded UPDATE of accounts_receivable (compare-and-swap on collected_amount and amount); months_paid is
//      unchanged (no instalment was paid in cash)
//   5. one customer_payments row with payment_method "customer_credit"
// No balance_entries row is written: no cash moved. A failure in 3 or 4 puts the credits back; a failure in 5 puts
// the invoice and the credits back, and only when that undo fails is it reported as a partial failure.
import { mapArInvoice as mapInvoice } from "./ar-payments"
import { computeArStatus } from "./ar-status"
import { CUSTOMER_CREDIT_LEDGER, CUSTOMER_CREDIT_PAYMENT_METHOD, creditMoney as round2, CREDIT_TOLERANCE, parseCreditSelections, reserveCredits, validateCredits } from "./credit-apply"

export { CUSTOMER_CREDIT_PAYMENT_METHOD }

export type CustomerCreditResult = { status: number; body: Record<string, any> }

const OPERATION_TYPE = "ar_credit_apply"

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): CustomerCreditResult => ({
  status,
  body: { error, ...extra },
})

export const arCreditLogKey = (invoiceId: number, clientKey: string) => `ar_credit_${invoiceId}_${clientKey}`

export async function applyCustomerCredits(supabase: any, body: any): Promise<CustomerCreditResult> {
  // ---- Input validation -------------------------------------------------------------------------
  const invoiceId = Number(body?.invoiceId)
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) return fail(400, "A valid invoiceId is required")

  const clientKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(clientKey)) {
    return fail(400, "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)")
  }
  const idempotencyKey = arCreditLogKey(invoiceId, clientKey)

  const parsed = parseCreditSelections(body?.credits, CUSTOMER_CREDIT_LEDGER)
  if (!parsed.ok) return { status: parsed.result.status, body: parsed.result.body }
  const selections = parsed.selections
  if (selections.length === 0) return fail(400, "Choose at least one credit", { code: "CREDIT_INPUT_INVALID" })
  const applied = round2(selections.reduce((sum, s) => sum + s.amount, 0))

  // ---- Idempotency claim ------------------------------------------------------------------------
  const claim = await supabase.from("idempotency_log").insert({
    operation_type: OPERATION_TYPE,
    idempotency_key: idempotencyKey,
    entity_type: "accounts_receivable",
    entity_id: invoiceId,
    status: "processing",
  })
  if (claim.error) {
    if (claim.error.code !== "23505") {
      console.error("AR credit - idempotency claim failed:", claim.error.message)
      return fail(500, "Could not start applying the credit. Nothing was saved.")
    }
    const { data: previous } = await supabase
      .from("idempotency_log")
      .select("status")
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()
    if (previous?.status === "completed") {
      const { data: current } = await supabase.from("accounts_receivable").select("*").eq("invoice_id", invoiceId).maybeSingle()
      return { status: 200, body: { success: true, isDuplicate: true, message: "This credit was already applied", invoice: current ? mapInvoice(current) : null } }
    }
    if (previous?.status === "partial_failure") {
      return fail(409, "This credit was applied but part of the record failed. It will not be repeated; contact an administrator to review.", {
        partialFailure: true,
      })
    }
    let reclaimed = false
    if (previous?.status === "failed") {
      const { data } = await supabase
        .from("idempotency_log")
        .update({ status: "processing", error_message: null, completed_at: null })
        .eq("operation_type", OPERATION_TYPE)
        .eq("idempotency_key", idempotencyKey)
        .eq("status", "failed")
        .select("id")
      reclaimed = !!data && data.length === 1
    }
    if (!reclaimed) return fail(409, "This credit is already being applied")
  }

  const finish = async (status: "completed" | "failed" | "partial_failure", message?: string) => {
    const { error } = await supabase
      .from("idempotency_log")
      .update({ status, error_message: message ?? null, completed_at: new Date().toISOString() })
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
    if (error) console.error("AR credit - could not update idempotency row:", error.message)
  }
  const reject = async (status: number, error: string, extra: Record<string, unknown> = {}) => {
    await finish("failed", error)
    return fail(status, error, extra)
  }

  let undoCredits: (() => Promise<void>) | null = null
  let invoiceUpdated = false
  try {
    // ---- Invoice and credits: validate before anything is written ----------------------------------
    const { data: row, error: readError } = await supabase.from("accounts_receivable").select("*").eq("invoice_id", invoiceId).maybeSingle()
    if (readError) return await reject(500, "Could not read the invoice. Nothing was saved.")
    if (!row) return await reject(404, "Invoice not found")
    const invoiceAmount = round2(Number(row.amount) || 0)
    const oldCollected = row.collected_amount === null || row.collected_amount === undefined ? null : Number(row.collected_amount)
    const remaining = round2(invoiceAmount - (oldCollected ?? 0))
    if (row.status === "paid" || remaining <= CREDIT_TOLERANCE) {
      return await reject(409, "This invoice is already fully paid", { remaining: Math.max(remaining, 0) })
    }
    if (row.customer_id === null || row.customer_id === undefined) return await reject(409, "This invoice has no customer")

    const checked = await validateCredits(supabase, CUSTOMER_CREDIT_LEDGER, { ownerId: row.customer_id, limit: remaining, selections })
    if (!checked.ok) return await reject(checked.result.status, checked.result.body.error, { ...checked.result.body, remaining })

    // ---- Reserve the credits (guarded; puts them back itself on failure) ----------------------------
    const reserved = await reserveCredits(supabase, CUSTOMER_CREDIT_LEDGER, {
      targetId: invoiceId,
      targetNumber: row.invoice_number,
      selections,
      rows: checked.rows,
    })
    if (reserved.error) return await reject(reserved.error.status, reserved.error.body.error, reserved.error.body)
    undoCredits = reserved.undo

    // ---- Guarded update of the invoice -------------------------------------------------------------
    const newCollected = round2((oldCollected ?? 0) + applied)
    let update = supabase
      .from("accounts_receivable")
      .update({ collected_amount: newCollected, status: computeArStatus({ amount: invoiceAmount, collectedAmount: newCollected }) })
      .eq("invoice_id", invoiceId)
    update = oldCollected === null ? update.is("collected_amount", null) : update.eq("collected_amount", row.collected_amount)
    update = row.amount === null || row.amount === undefined ? update.is("amount", null) : update.eq("amount", row.amount)
    const { data: updatedRows, error: updateError } = await update.select("*")
    if (updateError || !updatedRows || updatedRows.length !== 1) {
      await undoCredits()
      undoCredits = null
      if (updateError) return await reject(500, "Could not update the invoice. Nothing was saved.")
      return await reject(409, "The invoice was changed by someone else at the same time. Nothing was saved; please retry.", { conflict: true })
    }
    const invoice = updatedRows[0]
    invoiceUpdated = true

    // ---- The credit "payment" row (no cash: no balance_entries row) --------------------------------
    const { data: paymentRow, error: paymentError } = await supabase
      .from("customer_payments")
      .insert({
        invoice_id: invoiceId,
        customer_id: row.customer_id,
        amount: applied,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: CUSTOMER_CREDIT_PAYMENT_METHOD,
        reference_number: `${row.invoice_number}-CREDIT`,
        receipt_url: null,
      })
      .select("payment_id")
      .single()
    if (paymentError) {
      // Put the invoice back (guarded on the value just written), then the credits.
      const restore = supabase
        .from("accounts_receivable")
        .update({ collected_amount: row.collected_amount ?? null, status: row.status })
        .eq("invoice_id", invoiceId)
        .eq("collected_amount", newCollected)
      const { data: restored, error: restoreError } = await restore.select("invoice_id")
      if (restoreError || !restored || restored.length !== 1) {
        const detail = `PARTIAL: invoice ${invoiceId} collected_amount increased by ${applied.toFixed(2)} from customer credit but customer_payments failed (${paymentError.message}) and the invoice could not be put back`
        console.error("AR credit -", detail)
        await finish("partial_failure", detail)
        return fail(500, "The credit was applied to the invoice but the payment record could not be saved. Do not repeat it; contact an administrator.", {
          partialFailure: true,
          failedStep: "customer_payments",
        })
      }
      await undoCredits()
      undoCredits = null
      return await reject(500, "Could not record the credit payment. Nothing was saved.")
    }

    await finish("completed")
    return {
      status: 200,
      body: {
        success: true,
        invoice: mapInvoice(invoice),
        payment: { id: paymentRow?.payment_id?.toString(), amount: applied, paymentMethod: CUSTOMER_CREDIT_PAYMENT_METHOD },
        applied,
      },
    }
  } catch (error: any) {
    console.error("AR credit - unexpected error:", error?.message || error)
    if (invoiceUpdated) {
      await finish("partial_failure", `Unexpected error after invoice update: ${error?.message || error}`)
      return fail(500, "Unexpected error after the invoice was updated. Do not repeat it; contact an administrator.", { partialFailure: true })
    }
    if (undoCredits) await undoCredits()
    await finish("failed", `Unexpected error: ${error?.message || error}`)
    return fail(500, "Unexpected error while applying the credit. Nothing was saved.")
  }
}
