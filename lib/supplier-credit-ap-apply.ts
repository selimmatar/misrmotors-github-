// Using supplier credits (returns written off, overpayments) on an open AP invoice: the supplier is paid less.
// POST /api/accounts-payable/apply-credit. Same lifecycle and safeguards as using a supplier credit on an AR invoice:
//   1. an idempotency claim (idempotency_log, operation "ap_credit_apply")
//   2. validation: every credit is the invoice supplier's and still active, and the total is at most the invoice's
//      remaining balance
//   3. each credit moves active -> used with used_in_po_id = the invoice's purchase order (supplier_credits has no
//      "used in invoice" column; a PO has one payable, and the PO screens only read this before the payable exists)
//   4. a guarded UPDATE of accounts_payable (compare-and-swap on paid_amount and amount); months_paid is unchanged
//   5. one supplier_payments row with payment_method "supplier_credit" (no cash: no balance_entries row)
// A failure in 3 or 4 puts the credits back; a failure in 5 puts the invoice and the credits back.
import { SUPPLIER_CREDIT_LEDGER, type CreditLedger, creditMoney as round2, CREDIT_TOLERANCE, parseCreditSelections, reserveCredits, validateCredits } from "./credit-apply"
import { SUPPLIER_CREDIT_PAYMENT_METHOD } from "./supplier-credit-apply"

// Supplier credits, worded for an invoice (the column is still used_in_po_id, see above)
const AP_CREDIT_LEDGER: CreditLedger = { ...SUPPLIER_CREDIT_LEDGER, target: "invoice", limitLabel: "the invoice's remaining balance" }

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
const apStatus = (amount: number, paid: number) => (amount - paid <= CREDIT_TOLERANCE ? "paid" : paid > CREDIT_TOLERANCE ? "partially_paid" : "pending")

export type SupplierCreditResult = { status: number; body: Record<string, any> }

const OPERATION_TYPE = "ap_credit_apply"

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): SupplierCreditResult => ({
  status,
  body: { error, ...extra },
})

export const apCreditLogKey = (invoiceId: number, clientKey: string) => `ap_credit_${invoiceId}_${clientKey}`

export async function applySupplierCredits(supabase: any, body: any): Promise<SupplierCreditResult> {
  // ---- Input validation -------------------------------------------------------------------------
  const invoiceId = Number(body?.invoiceId)
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) return fail(400, "A valid invoiceId is required")

  const clientKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(clientKey)) {
    return fail(400, "idempotencyKey is required (8-100 characters: letters, digits, _ . : -)")
  }
  const idempotencyKey = apCreditLogKey(invoiceId, clientKey)

  const parsed = parseCreditSelections(body?.credits, AP_CREDIT_LEDGER)
  if (!parsed.ok) return { status: parsed.result.status, body: parsed.result.body }
  const selections = parsed.selections
  if (selections.length === 0) return fail(400, "Choose at least one credit", { code: "CREDIT_INPUT_INVALID" })
  const applied = round2(selections.reduce((sum, s) => sum + s.amount, 0))

  // ---- Idempotency claim ------------------------------------------------------------------------
  const claim = await supabase.from("idempotency_log").insert({
    operation_type: OPERATION_TYPE,
    idempotency_key: idempotencyKey,
    entity_type: "accounts_payable",
    entity_id: invoiceId,
    status: "processing",
  })
  if (claim.error) {
    if (claim.error.code !== "23505") {
      console.error("AP credit - idempotency claim failed:", claim.error.message)
      return fail(500, "Could not start applying the credit. Nothing was saved.")
    }
    const { data: previous } = await supabase
      .from("idempotency_log")
      .select("status")
      .eq("operation_type", OPERATION_TYPE)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()
    if (previous?.status === "completed") {
      const { data: current } = await supabase.from("accounts_payable").select("*").eq("invoice_id", invoiceId).maybeSingle()
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
    if (error) console.error("AP credit - could not update idempotency row:", error.message)
  }
  const reject = async (status: number, error: string, extra: Record<string, unknown> = {}) => {
    await finish("failed", error)
    return fail(status, error, extra)
  }

  let undoCredits: (() => Promise<number[]>) | null = null
  let invoiceUpdated = false
  // The credits were moved but could not all be put back: parked as a partial failure.
  const creditsNotRestored = async (step: string, cause: string, notRestored: number[]) => {
    const list = notRestored.map((id) => `#${id}`).join(", ")
    const detail = `PARTIAL: ${step} failed for invoice ${invoiceId} (${cause}) and supplier credit ${list} could not be put back`
    console.error("AP credit -", detail)
    await finish("partial_failure", detail)
    return fail(500, `The credit could not be applied and credit ${list} could not be put back. Do not repeat it; contact an administrator.`, {
      partialFailure: true,
      failedStep: step,
      notRestored,
    })
  }
  try {
    // ---- Invoice and credits: validate before anything is written ----------------------------------
    const { data: row, error: readError } = await supabase.from("accounts_payable").select("*").eq("invoice_id", invoiceId).maybeSingle()
    if (readError) return await reject(500, "Could not read the invoice. Nothing was saved.")
    if (!row) return await reject(404, "Invoice not found")
    const invoiceAmount = round2(Number(row.amount) || 0)
    const oldPaid = row.paid_amount === null || row.paid_amount === undefined ? null : Number(row.paid_amount)
    const remaining = round2(invoiceAmount - (oldPaid ?? 0))
    if (row.status === "paid" || remaining <= CREDIT_TOLERANCE) {
      return await reject(409, "This invoice is already fully paid", { remaining: Math.max(remaining, 0) })
    }
    if (row.supplier_id === null || row.supplier_id === undefined) return await reject(409, "This invoice has no supplier")
    if (row.po_id === null || row.po_id === undefined) return await reject(409, "This invoice is not linked to a purchase order, so a supplier credit cannot be used on it")
    if (row.paid_amount === null || row.paid_amount === undefined) return await reject(409, "This invoice has no paid amount recorded and cannot take a credit")

    const checked = await validateCredits(supabase, AP_CREDIT_LEDGER, { ownerId: row.supplier_id, limit: remaining, selections })
    if (!checked.ok) return await reject(checked.result.status, checked.result.body.error, { ...checked.result.body, remaining })

    // ---- Reserve the credits (guarded; puts them back itself on failure) ----------------------------
    const reserved = await reserveCredits(supabase, AP_CREDIT_LEDGER, {
      targetId: row.po_id,
      targetNumber: row.invoice_number,
      selections,
      rows: checked.rows,
    })
    if (reserved.error) {
      if (reserved.error.body.partialFailure) {
        await finish("partial_failure", `PARTIAL: ${reserved.error.body.error}`)
        return { status: reserved.error.status, body: reserved.error.body }
      }
      return await reject(reserved.error.status, reserved.error.body.error, reserved.error.body)
    }
    undoCredits = reserved.undo

    // ---- Guarded update of the invoice -------------------------------------------------------------
    const newPaid = round2((oldPaid ?? 0) + applied)
    let update = supabase
      .from("accounts_payable")
      .update({ paid_amount: newPaid, status: apStatus(invoiceAmount, newPaid) })
      .eq("invoice_id", invoiceId)
    update = oldPaid === null ? update.is("paid_amount", null) : update.eq("paid_amount", row.paid_amount)
    update = row.amount === null || row.amount === undefined ? update.is("amount", null) : update.eq("amount", row.amount)
    const { data: updatedRows, error: updateError } = await update.select("*")
    if (updateError || !updatedRows || updatedRows.length !== 1) {
      const notRestored = await undoCredits()
      undoCredits = null
      if (notRestored.length > 0) return await creditsNotRestored("accounts_receivable", updateError?.message || "invoice changed meanwhile", notRestored)
      if (updateError) return await reject(500, "Could not update the invoice. Nothing was saved.")
      return await reject(409, "The invoice was changed by someone else at the same time. Nothing was saved; please retry.", { conflict: true })
    }
    const invoice = updatedRows[0]
    invoiceUpdated = true

    // ---- The credit "payment" row (no cash: no balance_entries row) --------------------------------
    const { data: paymentRow, error: paymentError } = await supabase
      .from("supplier_payments")
      .insert({
        invoice_id: invoiceId,
        supplier_id: row.supplier_id,
        amount: applied,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: SUPPLIER_CREDIT_PAYMENT_METHOD,
        reference_number: `${row.invoice_number}-CREDIT`,
        receipt_url: null,
        recorded_by: null,
      })
      .select("payment_id")
      .single()
    if (paymentError) {
      const parked = async (why: string) => {
        const detail = `PARTIAL: invoice ${invoiceId} paid_amount increased by ${applied.toFixed(2)} from supplier credit but supplier_payments failed (${paymentError.message}); ${why}`
        console.error("AP credit -", detail)
        await finish("partial_failure", detail)
        return fail(500, "The credit was applied to the invoice but the payment record could not be saved. Do not repeat it; contact an administrator.", {
          partialFailure: true,
          failedStep: "supplier_payments",
        })
      }
      // An error does not always mean nothing was written (a timeout after the commit): if the row is there, the
      // invoice and the credits are right and only the response was lost, so nothing is undone.
      const { data: written, error: writtenError } = await supabase
        .from("supplier_payments")
        .select("payment_id")
        .eq("invoice_id", invoiceId)
        .eq("payment_method", SUPPLIER_CREDIT_PAYMENT_METHOD)
        .eq("reference_number", `${row.invoice_number}-CREDIT`)
        .eq("amount", applied)
      if (writtenError || (written || []).length > 0) {
        return await parked(writtenError ? "the payment rows could not be checked" : "the payment row was found, nothing was undone")
      }
      // Put the invoice back (guarded on the value just written), then the credits.
      const restore = supabase
        .from("accounts_payable")
        .update({ paid_amount: row.paid_amount ?? null, status: row.status })
        .eq("invoice_id", invoiceId)
        .eq("paid_amount", newPaid)
      const { data: restored, error: restoreError } = await restore.select("invoice_id")
      if (restoreError || !restored || restored.length !== 1) return await parked("the invoice could not be put back")
      invoiceUpdated = false
      const notRestored = await undoCredits()
      undoCredits = null
      if (notRestored.length > 0) return await creditsNotRestored("supplier_payments", paymentError.message, notRestored)
      return await reject(500, "Could not record the credit payment. Nothing was saved.")
    }

    await finish("completed")
    return {
      status: 200,
      body: {
        success: true,
        invoice: mapInvoice(invoice),
        payment: { id: paymentRow?.payment_id?.toString(), amount: applied, paymentMethod: SUPPLIER_CREDIT_PAYMENT_METHOD },
        applied,
      },
    }
  } catch (error: any) {
    console.error("AP credit - unexpected error:", error?.message || error)
    if (invoiceUpdated) {
      await finish("partial_failure", `Unexpected error after invoice update: ${error?.message || error}`)
      return fail(500, "Unexpected error after the invoice was updated. Do not repeat it; contact an administrator.", { partialFailure: true })
    }
    if (undoCredits) {
      const notRestored = await undoCredits()
      if (notRestored.length > 0) return await creditsNotRestored("unexpected error", String(error?.message || error), notRestored)
    }
    await finish("failed", `Unexpected error: ${error?.message || error}`)
    return fail(500, "Unexpected error while applying the credit. Nothing was saved.")
  }
}
