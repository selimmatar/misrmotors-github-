import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { AR_PAID_TOLERANCE, computeArStatus } from "@/lib/ar-status"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from("reschedule_requests")
      .select("*")
      .order("created_at", { ascending: false })
    
    if (error) {
      console.error("Reschedule Requests GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Transform snake_case to camelCase for frontend
    const transformedData = (data || []).map((item: any) => ({
      id: item.id,
      invoiceId: item.invoice_id,
      invoiceNumber: item.invoice_number,
      customerId: item.customer_id,
      customerName: item.customer_name,
      soNumber: item.so_number,
      currentMonths: item.current_months,
      requestedMonths: item.requested_months,
      currentAmount: item.current_amount,
      requestedAmount: item.requested_amount,
      currentDueDate: item.current_due_date,
      requestedDueDate: item.requested_due_date,
      newMonthlyPayment: item.new_monthly_payment,
      reason: item.reason,
      requestedBy: item.requested_by,
      status: item.status,
      reviewNotes: item.review_notes,
      reviewedBy: item.reviewed_by,
      reviewedAt: item.reviewed_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }))
    
    return NextResponse.json(transformedData)
  } catch (error: any) {
    console.error("Reschedule Requests GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const {
      invoiceId,
      invoiceNumber,
      customerId,
      customerName,
      soNumber,
      currentMonths,
      requestedMonths,
      currentAmount,
      requestedAmount,
      currentDueDate,
      requestedDueDate,
      reason,
      requestedBy,
    } = body
    
    const finalAmount = requestedAmount || currentAmount
    const newMonthlyPayment = finalAmount / requestedMonths
    
    const { data, error } = await supabase
      .from("reschedule_requests")
      .insert({
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        customer_id: customerId,
        customer_name: customerName,
        so_number: soNumber,
        current_months: currentMonths,
        requested_months: requestedMonths,
        current_amount: currentAmount,
        requested_amount: finalAmount,
        current_due_date: currentDueDate,
        requested_due_date: requestedDueDate || currentDueDate,
        new_monthly_payment: newMonthlyPayment,
        reason: reason || "Requested by accountant",
        requested_by: requestedBy || "accountant",
        status: "pending",
      })
      .select()
      .single()
    
    if (error) {
      console.error("Reschedule Request POST error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, request: data })
  } catch (error: any) {
    console.error("Reschedule Request POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// The invoice a request applies to: its own invoice_id, else the one AR invoice of its sales order (requests from the
// payment schedule screen carry only the order number), found on the order or on the order's payment schedule. null
// when there is none or more than one.
async function resolveRequestInvoiceId(supabase: any, request: any): Promise<number | null> {
  if (request.invoice_id !== null && request.invoice_id !== undefined && request.invoice_id !== "") return request.invoice_id
  if (!request.so_number) return null
  let orderQuery = supabase.from("sales_orders").select("so_id").eq("so_number", request.so_number)
  if (request.customer_id !== null && request.customer_id !== undefined) orderQuery = orderQuery.eq("customer_id", request.customer_id)
  const { data: orders } = await orderQuery
  if (!Array.isArray(orders) || orders.length !== 1) return null
  const soId = orders[0].so_id
  const { data: invoices } = await supabase.from("accounts_receivable").select("invoice_id").eq("so_id", soId)
  let ids = [...new Set((invoices || []).map((r: any) => r.invoice_id))]
  if (ids.length === 0) {
    const { data: schedules } = await supabase.from("payment_schedules").select("invoice_id, schedule_type").eq("so_id", soId)
    ids = [...new Set((schedules || []).filter((r: any) => r.invoice_id && r.schedule_type !== "payable").map((r: any) => r.invoice_id))]
  }
  return ids.length === 1 ? (ids[0] as number) : null
}

// Approve / reject a reschedule request (BIZ-S-012). The request moves out of `pending` only once (guarded update,
// 0 rows -> 409). An approval never sets the invoice amount below what was already collected, recomputes the invoice
// status from the new amount (lib/ar-status.ts), and when the invoice cannot be updated the request is put back to
// pending so it is not left approved with the old terms. A request whose invoice cannot be resolved is approved
// without changing any invoice, as before.
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    const { id, status, reviewNotes, reviewedBy, rejectionReason } = body
    if (id === undefined || id === null || id === "") {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    if (status !== "approved" && status !== "rejected") {
      return NextResponse.json({ error: 'status must be "approved" or "rejected"' }, { status: 400 })
    }

    const { data: existing, error: readError } = await supabase.from("reschedule_requests").select("*").eq("id", id).maybeSingle()
    if (readError) {
      console.error("Reschedule Request PUT read error:", readError)
      return NextResponse.json({ error: readError.message }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: "Reschedule request not found" }, { status: 404 })
    if (existing.status !== "pending") {
      return NextResponse.json({ error: `This request was already ${existing.status}. Reload.`, code: "REQUEST_NOT_PENDING" }, { status: 409 })
    }

    // Approval: the new terms are checked against the invoice before the request is approved.
    let invoice: any = null
    const updateData: any = {}
    const invoiceId = status === "approved" ? await resolveRequestInvoiceId(supabase, existing) : null
    if (invoiceId !== null) {
      const { data: arRow, error: arReadError } = await supabase
        .from("accounts_receivable")
        .select("*")
        .eq("invoice_id", invoiceId)
        .maybeSingle()
      if (arReadError) {
        console.error("Reschedule Request PUT - AR read error:", arReadError)
        return NextResponse.json({ error: "Could not read the invoice. Nothing was changed." }, { status: 500 })
      }
      if (!arRow) return NextResponse.json({ error: "The invoice of this request was not found. Nothing was changed." }, { status: 404 })
      invoice = arRow

      updateData.installment_months = existing.requested_months
      updateData.updated_at = new Date().toISOString()
      // Update amount if it changed
      if (existing.requested_amount && existing.requested_amount !== existing.current_amount) {
        updateData.amount = existing.requested_amount
      }
      // Update due date if it changed
      if (existing.requested_due_date && existing.requested_due_date !== existing.current_due_date) {
        updateData.due_date = existing.requested_due_date
      }
      const collected = Number(arRow.collected_amount) || 0
      const newAmount = updateData.amount !== undefined ? Number(updateData.amount) : Number(arRow.amount) || 0
      if (newAmount < collected - AR_PAID_TOLERANCE) {
        return NextResponse.json(
          {
            error: `The new amount (${newAmount.toFixed(2)}) is less than what the customer has already paid (${collected.toFixed(2)}). The request cannot be approved.`,
            code: "AMOUNT_BELOW_COLLECTED",
          },
          { status: 409 },
        )
      }
      updateData.status = computeArStatus({ amount: newAmount, collectedAmount: collected, dueDate: updateData.due_date ?? arRow.due_date })
    }

    // Update the reschedule request, only while it is still pending
    const { data: requestRows, error: requestError } = await supabase
      .from("reschedule_requests")
      .update({
        status,
        review_notes: rejectionReason || reviewNotes,
        reviewed_by: reviewedBy || "ceo",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select()

    if (requestError) {
      console.error("Reschedule Request PUT error:", requestError)
      return NextResponse.json({ error: requestError.message }, { status: 500 })
    }
    const requestData = Array.isArray(requestRows) ? requestRows[0] : null
    if (!requestData) {
      return NextResponse.json({ error: "This request was reviewed by someone else. Reload.", code: "REQUEST_NOT_PENDING" }, { status: 409 })
    }

    // If approved, update the accounts_receivable record with the new terms, guarded on the collected amount the
    // check above used (a payment in between would make the status stale).
    if (invoice) {
      const arUpdate = supabase.from("accounts_receivable").update(updateData).eq("invoice_id", invoiceId)
      const { data: arRows, error: arError } = await (invoice.collected_amount === null || invoice.collected_amount === undefined
        ? arUpdate.is("collected_amount", null)
        : arUpdate.eq("collected_amount", invoice.collected_amount)
      ).select("invoice_id")

      if (arError || !Array.isArray(arRows) || arRows.length !== 1) {
        console.error("Reschedule Request PUT - AR update failed:", arError?.message || "invoice changed meanwhile")
        // put the request back (guarded: only while it still holds this approval)
        const { error: revertError } = await supabase
          .from("reschedule_requests")
          .update({
            status: "pending",
            review_notes: existing.review_notes ?? null,
            reviewed_by: existing.reviewed_by ?? null,
            reviewed_at: existing.reviewed_at ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("status", "approved")
        if (revertError) console.error("Reschedule Request PUT - could not put the request back to pending:", revertError.message)
        return NextResponse.json(
          {
            error: arError
              ? "The invoice could not be updated, so the request was not approved. Please try again."
              : "The invoice changed while the request was being approved (a payment was recorded). Nothing was changed; please try again.",
          },
          { status: arError ? 500 : 409 },
        )
      }
    }

    return NextResponse.json({ success: true, request: requestData, ...(status === "approved" ? { invoiceUpdated: !!invoice } : {}) })
  } catch (error: any) {
    console.error("Reschedule Request PUT error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
