import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { checkIdempotency, completeIdempotency, generatePaymentIdempotencyKey } from "@/lib/idempotency"

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

/**
 * After a schedule payment: add the paid amount to the linked AR invoice. Returns an error message when the invoice
 * could not be read or written (the caller must then NOT report success), or null. A schedule whose invoice row does
 * not exist is skipped as before. The amounts logic is unchanged.
 */
async function applySchedulePaymentToInvoice(
  supabase: any,
  invoiceId: number,
  amountToPay: number,
  extraFields: Record<string, any> = {},
): Promise<string | null> {
  const { data: arInvoice, error: arReadError } = await withRetry(() =>
    supabase
      .from("accounts_receivable")
      .select("invoice_id, collected_amount, months_paid, installment_months, amount")
      .eq("invoice_id", invoiceId)
      .single(),
  )
  if (arReadError && arReadError.code !== "PGRST116") {
    console.error("Payment Schedule - could not read AR invoice", arReadError.message)
    return `Could not read the invoice: ${arReadError.message}`
  }
  if (!arInvoice) return null

  const newCollectedAmount = (arInvoice.collected_amount || 0) + amountToPay

  const { data: paidSchedules, error: paidError } = await withRetry(() =>
    supabase.from("payment_schedules").select("schedule_id").eq("invoice_id", arInvoice.invoice_id).eq("status", "paid"),
  )
  if (paidError) {
    console.error("Payment Schedule - could not count paid schedules", paidError.message)
    return `Could not read the paid schedules: ${paidError.message}`
  }

  const monthsPaid = paidSchedules?.length || 0
  const isInvoiceFullyPaid = newCollectedAmount >= arInvoice.amount

  const { error: arUpdateError } = await withRetry(() =>
    supabase
      .from("accounts_receivable")
      .update({
        collected_amount: newCollectedAmount,
        months_paid: monthsPaid,
        status: isInvoiceFullyPaid ? "paid" : monthsPaid > 0 ? "partially_paid" : "pending",
        ...extraFields,
      })
      .eq("invoice_id", arInvoice.invoice_id),
  )
  if (arUpdateError) {
    console.error("Payment Schedule - could not update AR invoice", arUpdateError.message)
    return `Could not update the invoice: ${arUpdateError.message}`
  }

  return null
}

const SCHEDULE_PAID_INVOICE_FAILED =
  "The payment was recorded on the schedule, but the invoice totals could NOT be updated. Do not repeat the payment; contact an administrator."

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
    } = body

    if (scheduleId && paidAmount && action !== "ACTIVATE" && action !== "LINK_INVOICE") {
      // Generate idempotency key for this payment
      const idempotencyKey = generatePaymentIdempotencyKey(
        invoiceId || 0,
        Number.parseInt(scheduleId),
        paymentDate ? new Date(paymentDate).getTime() : Date.now(),
      )


      const idempotencyCheck = await checkIdempotency(
        "payment",
        idempotencyKey,
        "payment_schedules",
        Number.parseInt(scheduleId),
        userId,
      )

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
          supabase.from("payment_schedules").select("*").eq("schedule_id", Number.parseInt(scheduleId)).single(),
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

        const amountToPay = paidAmount || current.amount
        const newPaidAmount = (current.paid_amount || 0) + amountToPay
        const isFullyPaid = newPaidAmount >= current.amount

        const { data: updated, error: updateError } = await withRetry(() =>
          supabase
            .from("payment_schedules")
            .update({
              paid_amount: newPaidAmount,
              payment_date: paymentDate || new Date().toISOString().split("T")[0],
              status: isFullyPaid ? "paid" : "partial",
              receipt_url: receiptUrl || current.receipt_url,
              notes: notes || current.notes,
              invoice_file_url: invoiceFileUrl || current.invoice_file_url,
              payment_idempotency_key: idempotencyKey,
            })
            .eq("schedule_id", Number.parseInt(scheduleId))
            .select()
            .single(),
        )

        if (updateError) {
          console.error("Payment Schedule update error:", updateError.message)
          await completeIdempotency("payment", idempotencyKey, false, updateError.message)
          return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        // Update AR invoice if applicable
        const isPayable = scheduleType === "payable" || current.schedule_type === "payable"

        if (!isPayable && current.invoice_id) {
          const arError = await applySchedulePaymentToInvoice(supabase, current.invoice_id, amountToPay, {
            last_payment_at: new Date().toISOString(),
          })
          if (arError) {
            await completeIdempotency("payment", idempotencyKey, false, arError)
            return NextResponse.json(
              { error: SCHEDULE_PAID_INVOICE_FAILED, detail: arError, schedulePaid: true, invoiceUpdated: false },
              { status: 500 },
            )
          }
        }

        await completeIdempotency("payment", idempotencyKey, true)

        return NextResponse.json({
          message: "Payment recorded successfully",
          schedule: updated,
        })
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

    // Handle individual payment recording without idempotency guard
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

    const amountToPay = paidAmount || current.amount
    const newPaidAmount = (current.paid_amount || 0) + amountToPay
    const isFullyPaid = newPaidAmount >= current.amount

    const { data: updated, error: updateError } = await withRetry(() =>
      supabase
        .from("payment_schedules")
        .update({
          paid_amount: newPaidAmount,
          payment_date: paymentDate || new Date().toISOString().split("T")[0],
          status: isFullyPaid ? "paid" : "partial",
          receipt_url: receiptUrl || current.receipt_url,
          notes: notes || current.notes,
          invoice_file_url: invoiceFileUrl || current.invoice_file_url,
        })
        .eq("schedule_id", Number.parseInt(scheduleId))
        .select()
        .single(),
    )

    if (updateError) {
      console.error("Payment Schedule update error:", updateError.message)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // AP invoice updates are handled by the client to avoid confusion
    const isPayable = scheduleType === "payable" || current.schedule_type === "payable"

    if (!isPayable && current.invoice_id) {
      const arError = await applySchedulePaymentToInvoice(supabase, current.invoice_id, amountToPay)
      if (arError) {
        return NextResponse.json(
          { error: SCHEDULE_PAID_INVOICE_FAILED, detail: arError, schedulePaid: true, invoiceUpdated: false },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      message: "Payment recorded successfully",
      schedule: updated,
    })
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
