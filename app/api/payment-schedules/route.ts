import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { checkIdempotency, completeIdempotency } from "@/lib/idempotency"
import { arPaymentLogKey, recordArPayment } from "@/lib/ar-payments"

export const dynamic = "force-dynamic"

// GET - Fetch payment schedules for an invoice, SO, or PO
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const invoiceId = searchParams.get("invoiceId")
    const soId = searchParams.get("soId")
    const poId = searchParams.get("poId")

    let query = supabase.from("payment_schedules").select("*").order("installment_number", { ascending: true })

    if (invoiceId) {
      query = query.eq("invoice_id", Number.parseInt(invoiceId))
    } else if (soId) {
      query = query.eq("so_id", Number.parseInt(soId))
    } else if (poId) {
      query = query.eq("po_id", Number.parseInt(poId))
    } else {
      return NextResponse.json({ error: "Invoice ID, SO ID, or PO ID required" }, { status: 400 })
    }

    const { data: schedules, error } = await withRetry(() => query)

    if (error) {
      console.error("Payment Schedules GET error:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const mappedSchedules = (schedules || []).map((s: any) => ({
      id: s.schedule_id?.toString(),
      invoiceId: s.invoice_id?.toString(),
      soId: s.so_id?.toString(),
      poId: s.po_id?.toString(),
      installmentNumber: s.installment_number,
      dueDate: s.due_date,
      amount: s.amount,
      paidAmount: s.paid_amount || 0,
      paymentDate: s.payment_date,
      status: s.status,
      receiptUrl: s.receipt_url,
      notes: s.notes,
      scheduleMode: s.schedule_mode || "LEGACY_MONTHLY",
      isActive: s.is_active ?? true,
      isDownPayment: s.is_down_payment || false,
      scheduleType: s.schedule_type || "AR",
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }))

    return NextResponse.json(mappedSchedules)
  } catch (error) {
    console.error("Payment Schedules GET exception:", error)
    return NextResponse.json({ error: "Failed to fetch payment schedules" }, { status: 500 })
  }
}

// POST - Create payment schedules (legacy or custom)
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const {
      invoiceId,
      soId,
      poId,
      amount,
      installmentMonths,
      startDate,
      downPaymentAmount,
      scheduleMode = "LEGACY_MONTHLY",
      customSchedule,
      scheduleType = "AR",
      isActive = false,
      schedules: directSchedules,
    } = body

    const entityId = invoiceId
      ? Number.parseInt(invoiceId)
      : soId
        ? Number.parseInt(soId)
        : poId
          ? Number.parseInt(poId)
          : null

    const entityType = invoiceId ? "invoice_id" : soId ? "so_id" : "po_id"

    if (!entityId || isNaN(entityId)) {
      console.error("Payment Schedules POST: Invalid or missing entity ID", { invoiceId, soId, poId })
      return NextResponse.json({ error: "Valid invoice_id, so_id, or po_id is required" }, { status: 400 })
    }

    if (entityId) {
      const { data: existing, error: checkError } = await withRetry(() =>
        supabase.from("payment_schedules").select("schedule_id").eq(entityType, entityId).limit(1),
      )

      if (checkError) {
        console.error("Payment Schedules - Error checking existing schedules:", checkError.message)
      } else if (existing && existing.length > 0) {
        return NextResponse.json(
          {
            message: "Payment schedules already exist",
            alreadyExists: true,
            count: existing.length,
          },
          { status: 200 },
        )
      }
    }

    let schedules: any[] = []

    if (directSchedules && Array.isArray(directSchedules) && directSchedules.length > 0) {
      schedules = directSchedules.map((s: any) => {
        const scheduleInvoiceId = s.invoice_id || (invoiceId ? Number.parseInt(invoiceId) : null)
        const scheduleSoId = s.so_id || (soId ? Number.parseInt(soId) : null)
        const schedulePoId = s.po_id || (poId ? Number.parseInt(poId) : null)

        // Validate that at least one ID is present
        if (!scheduleInvoiceId && !scheduleSoId && !schedulePoId) {
          throw new Error("Each schedule must have at least one of: invoice_id, so_id, or po_id")
        }

        return {
          invoice_id: scheduleInvoiceId,
          so_id: scheduleSoId,
          po_id: schedulePoId,
          installment_number: s.installment_number,
          due_date: s.due_date,
          amount: s.amount,
          paid_amount: s.paid_amount || 0,
          status: s.status || "pending",
          notes: s.notes || null,
          schedule_mode: s.schedule_mode || scheduleMode,
          is_active: s.is_active ?? isActive,
          is_down_payment: s.is_down_payment || false,
          schedule_type: s.schedule_type || scheduleType,
        }
      })
    } else {
      // Validate required fields for auto-generation
      if (!amount || amount <= 0) {
        return NextResponse.json({ error: "Valid amount required" }, { status: 400 })
      }

      const paymentStartDate = startDate ? new Date(startDate) : new Date()

      // Handle custom schedule (MANUAL mode)
      if (scheduleMode === "CUSTOM_DATES" && customSchedule && Array.isArray(customSchedule)) {
        // Add down payment if exists (for hybrid)
        if (downPaymentAmount && downPaymentAmount > 0) {
          schedules.push({
            invoice_id: invoiceId ? Number.parseInt(invoiceId) : null,
            so_id: soId ? Number.parseInt(soId) : null,
            po_id: poId ? Number.parseInt(poId) : null,
            installment_number: 0,
            due_date: new Date().toISOString().split("T")[0],
            amount: downPaymentAmount,
            status: "pending",
            notes: "Down payment",
            schedule_mode: "CUSTOM_DATES",
            is_active: isActive,
            is_down_payment: true,
            schedule_type: scheduleType,
          })
        }

        // Add custom schedule entries
        customSchedule.forEach((entry: any, index: number) => {
          schedules.push({
            invoice_id: invoiceId ? Number.parseInt(invoiceId) : null,
            so_id: soId ? Number.parseInt(soId) : null,
            po_id: poId ? Number.parseInt(poId) : null,
            installment_number: index + 1,
            due_date: entry.dueDate,
            amount: entry.amount,
            status: "pending",
            notes: entry.note || null,
            schedule_mode: "CUSTOM_DATES",
            is_active: isActive,
            is_down_payment: false,
            schedule_type: scheduleType,
          })
        })
      } else {
        // Legacy monthly schedule (AUTO mode)
        if (!installmentMonths || installmentMonths < 1) {
          return NextResponse.json({ error: "Valid installment months required for auto schedule" }, { status: 400 })
        }

        // Add down payment if exists (for hybrid)
        if (downPaymentAmount && downPaymentAmount > 0) {
          schedules.push({
            invoice_id: invoiceId ? Number.parseInt(invoiceId) : null,
            so_id: soId ? Number.parseInt(soId) : null,
            po_id: poId ? Number.parseInt(poId) : null,
            installment_number: 0,
            due_date: new Date().toISOString().split("T")[0],
            amount: downPaymentAmount,
            status: "pending",
            notes: "Down payment",
            schedule_mode: "LEGACY_MONTHLY",
            is_active: isActive,
            is_down_payment: true,
            schedule_type: scheduleType,
          })
        }

        // Calculate monthly amount for remaining installments
        const remainingAmount = amount - (downPaymentAmount || 0)
        const monthlyAmount = remainingAmount / installmentMonths

        for (let i = 1; i <= installmentMonths; i++) {
          const dueDate = new Date(paymentStartDate)
          dueDate.setMonth(dueDate.getMonth() + i - 1)

          schedules.push({
            invoice_id: invoiceId ? Number.parseInt(invoiceId) : null,
            so_id: soId ? Number.parseInt(soId) : null,
            po_id: poId ? Number.parseInt(poId) : null,
            installment_number: i,
            due_date: dueDate.toISOString().split("T")[0],
            amount: monthlyAmount,
            status: "pending",
            schedule_mode: "LEGACY_MONTHLY",
            is_active: isActive,
            is_down_payment: false,
            schedule_type: scheduleType,
          })
        }
      }
    }

    if (schedules.length === 0) {
      return NextResponse.json({ error: "No schedules to create" }, { status: 400 })
    }

    const invalidSchedules = schedules.filter((s) => !s.invoice_id && !s.so_id && !s.po_id)
    if (invalidSchedules.length > 0) {
      console.error("Payment Schedules POST: Found schedules with all IDs null", invalidSchedules)
      return NextResponse.json(
        { error: "All schedules must have at least one of: invoice_id, so_id, or po_id" },
        { status: 400 },
      )
    }

    const { data, error } = await withRetry(() => supabase.from("payment_schedules").insert(schedules).select())

    if (error) {
      console.error("Payment Schedules POST error:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: "Payment schedules created successfully",
      count: schedules.length,
      schedules: data,
    })
  } catch (error) {
    console.error("Payment Schedules POST exception:", error)
    return NextResponse.json({ error: "Failed to create payment schedules" }, { status: 500 })
  }
}

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const whereValue = (query: any, column: string, value: unknown) =>
  value === null || value === undefined ? query.is(column, null) : query.eq(column, value)

type InvoiceOutcome =
  | { ok: true }
  | { ok: false; kind: "overpay" | "conflict"; status: 400 | 409; error: string }
  | { ok: false; kind: "db"; error: string }

const overpayMessage = (amountToPay: number, invoice: any) =>
  `This payment of ${money(amountToPay)} would overpay the invoice: ${money(Number(invoice.collected_amount) || 0)} of ${money(
    Number(invoice.amount) || 0,
  )} is already collected (remaining ${money(Math.max(0, (Number(invoice.amount) || 0) - (Number(invoice.collected_amount) || 0)))}). Nothing was recorded.`

async function readArInvoice(supabase: any, invoiceId: number): Promise<{ invoice: any; error: string | null }> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("accounts_receivable")
      .select("invoice_id, collected_amount, months_paid, installment_months, amount")
      .eq("invoice_id", invoiceId)
      .single(),
  )
  if (error && error.code !== "PGRST116") {
    console.error("Payment Schedule - could not read AR invoice", error.message)
    return { invoice: null, error: `Could not read the invoice: ${error.message}` }
  }
  return { invoice: data || null, error: null }
}

/** Refuses (before anything is written) a payment that would take the AR invoice above its total. */
async function checkInvoiceCap(supabase: any, invoiceId: number, amountToPay: number): Promise<InvoiceOutcome> {
  const { invoice, error } = await readArInvoice(supabase, invoiceId)
  if (error) return { ok: false, kind: "db", error }
  if (!invoice) return { ok: true }
  if (cents(invoice.collected_amount) + cents(amountToPay) > cents(invoice.amount)) {
    return { ok: false, kind: "overpay", status: 400, error: overpayMessage(amountToPay, invoice) }
  }
  return { ok: true }
}

/**
 * After a schedule payment: add the paid amount to the linked AR invoice. A schedule whose invoice row does not exist
 * is skipped as before. The write is a compare-and-set on the collected_amount that was read (one re-read + retry when
 * another payment got there first), and it never takes collected_amount above the invoice total.
 */
async function applySchedulePaymentToInvoice(
  supabase: any,
  invoiceId: number,
  amountToPay: number,
  extraFields: Record<string, any> = {},
): Promise<InvoiceOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { invoice: arInvoice, error: readError } = await readArInvoice(supabase, invoiceId)
    if (readError) return { ok: false, kind: "db", error: readError }
    if (!arInvoice) return { ok: true }

    if (cents(arInvoice.collected_amount) + cents(amountToPay) > cents(arInvoice.amount)) {
      return { ok: false, kind: "overpay", status: 400, error: overpayMessage(amountToPay, arInvoice) }
    }
    const newCollectedAmount = money((Number(arInvoice.collected_amount) || 0) + amountToPay)

    const { data: paidSchedules, error: paidError } = await withRetry(() =>
      supabase.from("payment_schedules").select("schedule_id").eq("invoice_id", arInvoice.invoice_id).eq("status", "paid"),
    )
    if (paidError) {
      console.error("Payment Schedule - could not count paid schedules", paidError.message)
      return { ok: false, kind: "db", error: `Could not read the paid schedules: ${paidError.message}` }
    }

    const monthsPaid = paidSchedules?.length || 0
    const isInvoiceFullyPaid = cents(newCollectedAmount) >= cents(arInvoice.amount)

    const { data: updatedRows, error: arUpdateError } = await withRetry(() =>
      whereValue(
        supabase
          .from("accounts_receivable")
          .update({
            collected_amount: newCollectedAmount,
            months_paid: monthsPaid,
            status: isInvoiceFullyPaid ? "paid" : monthsPaid > 0 ? "partially_paid" : "pending",
            ...extraFields,
          })
          .eq("invoice_id", arInvoice.invoice_id),
        "collected_amount",
        arInvoice.collected_amount,
      ).select("invoice_id"),
    )
    if (arUpdateError) {
      console.error("Payment Schedule - could not update AR invoice", arUpdateError.message)
      return { ok: false, kind: "db", error: `Could not update the invoice: ${arUpdateError.message}` }
    }
    if (Array.isArray(updatedRows) && updatedRows.length === 1) return { ok: true }
    // another payment changed collected_amount since we read it: re-read and try once more
  }
  return {
    ok: false,
    kind: "conflict",
    status: 409,
    error: "The invoice was changed by another payment at the same moment. Nothing was recorded; reload and try again.",
  }
}

const SCHEDULE_PAID_INVOICE_FAILED =
  "The payment was recorded on the schedule, but the invoice totals could NOT be updated. Do not repeat the payment; contact an administrator."

/**
 * Records `amountToPay` on schedule `current` and on its AR invoice. Shared by both payment paths of PUT.
 *  1. refuses an AR overpayment before anything is written (400);
 *  2. updates the schedule with a compare-and-set on the paid_amount that was read (409 when it changed);
 *  3. adds the amount to the invoice (compare-and-set, see applySchedulePaymentToInvoice). If that is refused
 *     (overpay / conflict) the schedule write is put back and the refusal is returned.
 */
async function recordSchedulePayment(
  supabase: any,
  current: any,
  amountToPay: number,
  fields: Record<string, any>,
  isPayable: boolean,
  invoiceExtraFields: Record<string, any> = {},
): Promise<{ status: number; body: any }> {
  const linkedInvoice = !isPayable && current.invoice_id
  if (linkedInvoice) {
    const cap = await checkInvoiceCap(supabase, current.invoice_id, amountToPay)
    if (!cap.ok) {
      return cap.kind === "db"
        ? { status: 500, body: { error: cap.error, schedulePaid: false, invoiceUpdated: false } }
        : { status: cap.status, body: { error: cap.error, code: cap.kind === "overpay" ? "INVOICE_OVERPAYMENT" : "INVOICE_CONFLICT" } }
    }
  }

  const newPaidAmount = money((Number(current.paid_amount) || 0) + amountToPay)
  const isFullyPaid = cents(newPaidAmount) >= cents(current.amount)
  const { data: updatedRows, error: updateError } = await withRetry(() =>
    whereValue(
      supabase
        .from("payment_schedules")
        .update({ ...fields, paid_amount: newPaidAmount, status: isFullyPaid ? "paid" : "partial" })
        .eq("schedule_id", current.schedule_id),
      "paid_amount",
      current.paid_amount,
    ).select(),
  )
  if (updateError) {
    console.error("Payment Schedule update error:", updateError.message)
    return { status: 500, body: { error: updateError.message } }
  }
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : null
  if (!updated) {
    return {
      status: 409,
      body: { error: "This schedule was changed by another payment at the same moment. Nothing was recorded; reload and try again.", code: "SCHEDULE_CONFLICT" },
    }
  }

  if (linkedInvoice) {
    const outcome = await applySchedulePaymentToInvoice(supabase, current.invoice_id, amountToPay, invoiceExtraFields)
    if (!outcome.ok) {
      if (outcome.kind === "db") {
        return { status: 500, body: { error: SCHEDULE_PAID_INVOICE_FAILED, detail: outcome.error, schedulePaid: true, invoiceUpdated: false } }
      }
      // put the schedule back (guarded: only while it still holds what this request wrote)
      const revert: Record<string, any> = { paid_amount: current.paid_amount ?? null, status: current.status ?? null }
      for (const key of Object.keys(fields)) revert[key] = current[key] ?? null
      const { data: reverted, error: revertError } = await withRetry(() =>
        supabase
          .from("payment_schedules")
          .update(revert)
          .eq("schedule_id", current.schedule_id)
          .eq("paid_amount", newPaidAmount)
          .select("schedule_id"),
      )
      if (revertError || !Array.isArray(reverted) || reverted.length !== 1) {
        console.error("Payment Schedule - could not put the schedule back after the invoice refused the payment", revertError?.message)
        return { status: 500, body: { error: SCHEDULE_PAID_INVOICE_FAILED, detail: outcome.error, schedulePaid: true, invoiceUpdated: false } }
      }
      return { status: outcome.status, body: { error: outcome.error, code: outcome.kind === "overpay" ? "INVOICE_OVERPAYMENT" : "INVOICE_CONFLICT" } }
    }
  }

  return { status: 200, body: { message: "Payment recorded successfully", schedule: updated } }
}

const CLIENT_KEY = /^[A-Za-z0-9_.:-]{8,100}$/
/**
 * Deterministic idempotency key of a schedule payment (never the clock): a client-supplied idempotencyKey when one is
 * sent, otherwise built from the request itself.
 */
function schedulePaymentKey(scheduleId: number, clientKey: unknown, fallback: string): string {
  if (typeof clientKey === "string" && CLIENT_KEY.test(clientKey)) return `pay_${scheduleId}_key_${clientKey}`
  return fallback
}

/**
 * BIZ-S-009: a payment of a receivable schedule that is linked to an AR invoice is recorded through the same operation
 * as POST /api/accounts-receivable/payments (lib/ar-payments.ts), so it writes the customer_payments row and the
 * balance_entries row as well as the invoice and the schedule. The idempotency key is the schedule key the PUT always
 * used (the client's key or the deterministic fallback), so a repeat is still recognised as a duplicate.
 */
async function payLinkedReceivable(
  supabase: any,
  current: any,
  amountToPay: number,
  idempotencyKey: string,
  body: any,
): Promise<{ status: number; body: any }> {
  const scheduleFields: Record<string, any> = {}
  if (body.paymentDate) scheduleFields.payment_date = body.paymentDate
  if (body.notes) scheduleFields.notes = body.notes
  if (body.invoiceFileUrl) scheduleFields.invoice_file_url = body.invoiceFileUrl
  const result = await recordArPayment(
    supabase,
    {
      invoiceId: current.invoice_id,
      amount: money(amountToPay),
      idempotencyKey,
      scheduleId: current.schedule_id,
      receiptUrl: body.receiptUrl || null,
      paymentMethod: body.paymentMethod,
      label: `Installment ${current.installment_number ?? current.schedule_id}`,
      allowOverpayment: body.allowOverpayment === true,
      confirmDuplicate: body.confirmDuplicate === true,
      referenceNumber: body.referenceNumber,
    },
    { scheduleFields },
  )
  if (result.status === 200 && result.body.isDuplicate) {
    return { status: 200, body: { message: "Payment already recorded", isDuplicate: true, invoice: result.body.invoice } }
  }
  if (result.status === 200) {
    const { data: schedule } = await supabase.from("payment_schedules").select("*").eq("schedule_id", current.schedule_id).maybeSingle()
    return {
      status: 200,
      body: {
        message: "Payment recorded successfully",
        schedule,
        invoice: result.body.invoice,
        payment: result.body.payment,
        ...(result.body.credit ? { credit: result.body.credit } : {}),
        schedulePaid: true,
        invoiceUpdated: true,
      },
    }
  }
  const completed: string[] = Array.isArray(result.body.completed) ? result.body.completed : []
  return {
    status: result.status,
    body: { ...result.body, schedulePaid: completed.includes("payment_schedules"), invoiceUpdated: result.body.partialFailure === true },
  }
}

// A schedule of a purchase order is payable even when an older row has no schedule_type: its invoice_id is an AP
// invoice id and must never be paid as the AR invoice with the same number.
const isPayableSchedule = (current: any, scheduleType: unknown) =>
  scheduleType === "payable" || current.schedule_type === "payable" || (!!current.po_id && !current.so_id)
// A schedule linked to an AR invoice (receivable) is paid through lib/ar-payments.ts.
const isLinkedReceivable = (current: any, scheduleType: unknown) => !isPayableSchedule(current, scheduleType) && !!current.invoice_id
// Key for the shared AR operation (8-100 characters): the client's key scoped to the schedule, else the schedule key.
function arScheduleKey(scheduleId: number, clientKey: unknown, scheduleKey: string): string {
  if (typeof clientKey === "string" && CLIENT_KEY.test(clientKey)) {
    const scoped = `s${scheduleId}_${clientKey}`
    return scoped.length <= 100 ? scoped : clientKey
  }
  return scheduleKey.length <= 100 ? scheduleKey : scheduleKey.slice(0, 100)
}

// PUT - Update payment schedule (mark as paid or activate schedules)
export async function PUT(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const {
      scheduleId,
      action,
      paidAmount,
      paymentDate,
      receiptUrl,
      notes,
      invoiceId,
      soId,
      poId,
      invoiceFileUrl,
      scheduleType,
      userId,
      idempotencyKey: clientIdempotencyKey,
    } = body

    if (scheduleId && paidAmount && action !== "ACTIVATE" && action !== "LINK_INVOICE") {
      const scheduleIdNum = Number.parseInt(scheduleId)
      const amountToPay = Number(paidAmount)
      if (!Number.isFinite(amountToPay) || amountToPay <= 0) {
        return NextResponse.json({ error: "paidAmount must be a positive amount" }, { status: 400 })
      }
      // Deterministic key: schedule + payment date + amount (or the client's idempotencyKey). A repeat of the same
      // payment is recognised; the clock is never part of the key.
      const idempotencyKey = schedulePaymentKey(
        scheduleIdNum,
        clientIdempotencyKey,
        `pay_${invoiceId || 0}_${scheduleIdNum}_${new Date(paymentDate || new Date().toISOString().split("T")[0]).getTime()}_${cents(amountToPay)}`,
      )

      const { data: linked, error: linkedError } = await supabase
        .from("payment_schedules")
        .select("*")
        .eq("schedule_id", scheduleIdNum)
        .maybeSingle()
      if (linkedError) return NextResponse.json({ error: "Could not read the schedule. Nothing was recorded." }, { status: 500 })
      if (!linked) return NextResponse.json({ error: "Schedule not found" }, { status: 404 })
      if (isLinkedReceivable(linked, scheduleType)) {
        const result = await payLinkedReceivable(supabase, linked, amountToPay, arScheduleKey(linked.schedule_id, clientIdempotencyKey, idempotencyKey), body)
        return NextResponse.json(result.body, { status: result.status })
      }

      const idempotencyCheck = await checkIdempotency("payment", idempotencyKey, "payment_schedules", scheduleIdNum, userId)

      if (!idempotencyCheck.success) {
        if (idempotencyCheck.isRetry) {
          return NextResponse.json({
            message: "Payment already recorded",
            isDuplicate: true,
            previousResult: idempotencyCheck.previousResult,
          })
        }
        return NextResponse.json({ error: idempotencyCheck.error }, { status: 400 })
      }

      try {
        // Get current schedule
        const { data: current, error: fetchError } = await withRetry(() =>
          supabase.from("payment_schedules").select("*").eq("schedule_id", scheduleIdNum).single(),
        )

        if (fetchError || !current) {
          await completeIdempotency("payment", idempotencyKey, false, "Schedule not found")
          return NextResponse.json({ error: "Schedule not found" }, { status: 404 })
        }

        // Check if already paid
        if (current.status === "paid") {
          await completeIdempotency("payment", idempotencyKey, false, "Schedule already paid in full")
          return NextResponse.json({ error: "This schedule has already been paid in full" }, { status: 400 })
        }

        const isPayable = isPayableSchedule(current, scheduleType)
        const result = await recordSchedulePayment(
          supabase,
          current,
          amountToPay,
          {
            payment_date: paymentDate || new Date().toISOString().split("T")[0],
            receipt_url: receiptUrl || current.receipt_url,
            notes: notes || current.notes,
            invoice_file_url: invoiceFileUrl || current.invoice_file_url,
            payment_idempotency_key: idempotencyKey,
          },
          isPayable,
          { last_payment_at: new Date().toISOString() },
        )
        await completeIdempotency(
          "payment",
          idempotencyKey,
          // Once the schedule row holds the payment the key is done, even if the invoice was not updated: a retry of the
          // same payment must not add it to the schedule again.
          result.status === 200 || result.body.schedulePaid === true,
          result.status === 200 ? undefined : result.body.detail || result.body.error,
        )
        return NextResponse.json(result.body, { status: result.status })
      } catch (error: any) {
        await completeIdempotency("payment", idempotencyKey, false, error.message)
        throw error
      }
    }

    // Handle bulk activation of schedules
    if (action === "ACTIVATE") {
      let query = supabase.from("payment_schedules").update({ is_active: true }).eq("is_active", false)

      if (invoiceId) {
        query = query.eq("invoice_id", Number.parseInt(invoiceId))
      } else if (soId) {
        query = query.eq("so_id", Number.parseInt(soId))
      } else if (poId) {
        query = query.eq("po_id", Number.parseInt(poId))
      } else {
        return NextResponse.json({ error: "Invoice ID, SO ID, or PO ID required for activation" }, { status: 400 })
      }

      const { error } = await withRetry(() => query)

      if (error) {
        console.error("Payment Schedules ACTIVATE error:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ message: "Schedules activated successfully" })
    }

    // Handle linking schedules to invoice
    if (action === "LINK_INVOICE") {
      if (!invoiceId || (!soId && !poId)) {
        return NextResponse.json({ error: "Invoice ID and SO/PO ID required for linking" }, { status: 400 })
      }

      let query = supabase.from("payment_schedules").update({ invoice_id: Number.parseInt(invoiceId), is_active: true })

      if (soId) {
        query = query.eq("so_id", Number.parseInt(soId))
      } else if (poId) {
        query = query.eq("po_id", Number.parseInt(poId))
      }

      const { error } = await withRetry(() => query)

      if (error) {
        console.error("Payment Schedules LINK error:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ message: "Schedules linked to invoice successfully" })
    }

    // Handle individual payment recording ("pay in full", no paidAmount)
    if (!scheduleId) {
      return NextResponse.json({ error: "Schedule ID required" }, { status: 400 })
    }

    // Get current schedule
    const { data: current, error: fetchError } = await withRetry(() =>
      supabase.from("payment_schedules").select("*").eq("schedule_id", Number.parseInt(scheduleId)).single(),
    )

    if (fetchError || !current) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 })
    }

    if (invoiceFileUrl && !paidAmount) {
      const { data: updated, error: updateError } = await withRetry(() =>
        supabase
          .from("payment_schedules")
          .update({
            invoice_file_url: invoiceFileUrl,
          })
          .eq("schedule_id", Number.parseInt(scheduleId))
          .select()
          .single(),
      )

      if (updateError) {
        console.error("Payment Schedule invoice file update error:", updateError.message)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({
        message: "Invoice file uploaded successfully",
        schedule: updated,
      })
    }

    // "Pay in full" (no paidAmount): pays what is still open on the schedule. Idempotent like the partial path:
    // the key is the schedule itself (or the client's idempotencyKey), so a double submit is recorded once.
    const idempotencyKey = schedulePaymentKey(
      current.schedule_id,
      clientIdempotencyKey,
      `pay_full_${current.invoice_id || invoiceId || 0}_${current.schedule_id}`,
    )
    if (isLinkedReceivable(current, scheduleType)) {
      const amountToPay = money(Math.max(0, (Number(current.amount) || 0) - (Number(current.paid_amount) || 0)))
      if (current.status === "paid" || amountToPay <= 0) {
        // Nothing is open, so nothing is ever recorded here: a repeat of a completed "pay in full" (its key is in
        // the log as completed) is answered as a duplicate, anything else is refused.
        const { data: done } = await supabase
          .from("idempotency_log")
          .select("status")
          .eq("operation_type", "payment")
          .eq("idempotency_key", arPaymentLogKey(current.invoice_id, arScheduleKey(current.schedule_id, clientIdempotencyKey, idempotencyKey)))
          .eq("status", "completed")
        if ((done || []).length > 0) return NextResponse.json({ message: "Payment already recorded", isDuplicate: true })
        return NextResponse.json({ error: "This schedule has already been paid in full" }, { status: 400 })
      }
      const result = await payLinkedReceivable(supabase, current, amountToPay, arScheduleKey(current.schedule_id, clientIdempotencyKey, idempotencyKey), body)
      return NextResponse.json(result.body, { status: result.status })
    }

    const idempotencyCheck = await checkIdempotency("payment", idempotencyKey, "payment_schedules", current.schedule_id, userId)
    if (!idempotencyCheck.success) {
      if (idempotencyCheck.isRetry) {
        return NextResponse.json({
          message: "Payment already recorded",
          isDuplicate: true,
          previousResult: idempotencyCheck.previousResult,
        })
      }
      return NextResponse.json({ error: idempotencyCheck.error }, { status: 400 })
    }

    try {
      const amountToPay = money(Math.max(0, (Number(current.amount) || 0) - (Number(current.paid_amount) || 0)))
      if (current.status === "paid" || amountToPay <= 0) {
        await completeIdempotency("payment", idempotencyKey, false, "Schedule already paid in full")
        return NextResponse.json({ error: "This schedule has already been paid in full" }, { status: 400 })
      }

      // AP invoice updates are handled by the client to avoid confusion
      const isPayable = isPayableSchedule(current, scheduleType)
      const result = await recordSchedulePayment(
        supabase,
        current,
        amountToPay,
        {
          payment_date: paymentDate || new Date().toISOString().split("T")[0],
          receipt_url: receiptUrl || current.receipt_url,
          notes: notes || current.notes,
          invoice_file_url: invoiceFileUrl || current.invoice_file_url,
          payment_idempotency_key: idempotencyKey,
        },
        isPayable,
      )
      await completeIdempotency(
        "payment",
        idempotencyKey,
        // Once the schedule row holds the payment the key is done, even if the invoice was not updated: a retry of the
        // same payment must not add it to the schedule again.
        result.status === 200 || result.body.schedulePaid === true,
        result.status === 200 ? undefined : result.body.detail || result.body.error,
      )
      return NextResponse.json(result.body, { status: result.status })
    } catch (error: any) {
      await completeIdempotency("payment", idempotencyKey, false, error.message)
      throw error
    }
  } catch (error) {
    console.error("Payment Schedule PUT exception:", error)
    return NextResponse.json({ error: "Failed to update payment schedule" }, { status: 500 })
  }
}

// DELETE - Delete payment schedules (only inactive/planned ones)
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const soId = searchParams.get("soId")
    const poId = searchParams.get("poId")

    if (!soId && !poId) {
      return NextResponse.json({ error: "SO ID or PO ID required" }, { status: 400 })
    }

    let query = supabase.from("payment_schedules").delete().eq("is_active", false).is("invoice_id", null)

    if (soId) {
      query = query.eq("so_id", Number.parseInt(soId))
    } else if (poId) {
      query = query.eq("po_id", Number.parseInt(poId))
    }

    const { error } = await withRetry(() => query)

    if (error) {
      console.error("Payment Schedules DELETE error:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: "Inactive schedules deleted successfully" })
  } catch (error) {
    console.error("Payment Schedules DELETE exception:", error)
    return NextResponse.json({ error: "Failed to delete payment schedules" }, { status: 500 })
  }
}
