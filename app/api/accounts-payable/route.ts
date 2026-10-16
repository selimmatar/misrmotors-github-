import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const poId = searchParams.get("poId")

    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      let query = supabase
        .from("accounts_payable")
        .select(`
          *,
          suppliers:supplier_id (supplier_name),
          purchase_orders:po_id (po_number, payment_terms, installments, payment_type, down_payment_amount, down_payment_percent, down_payment_type, remaining_amount, remaining_installment_months, monthly_amount, payment_start_date, down_payment_due_date, schedule_entries, schedule_mode)
        `)
        .order("created_at", { ascending: false })

      if (poId) {
        query = query.eq("po_id", Number.parseInt(poId))
      }

      const { data, error } = await query

      if (error) throw error

      if (!Array.isArray(data)) {
        throw new Error("Invalid response format from database")
      }

      return data
    })

    if (!result || !Array.isArray(result)) {
      console.error("Accounts Payable: Invalid result format", result)
      return NextResponse.json([], { status: 200 })
    }

    const transformed = result.map((inv: any) => {
      const amount = Number.parseFloat(inv.amount) || 0
      const paidAmount = Number.parseFloat(inv.paid_amount) || 0
      const balance = Number.parseFloat(inv.balance) || amount - paidAmount

      // Never default hybrid to installments
      const paymentType = inv.payment_type || inv.purchase_orders?.payment_type || "installments"

      return {
        id: inv.invoice_id?.toString() || "",
        invoiceNumber: inv.invoice_number,
        poId: inv.po_id?.toString() || "",
        poNumber: inv.purchase_orders?.po_number || "",
        supplierId: inv.supplier_id?.toString() || "",
        supplierName: inv.suppliers?.supplier_name || "",
        amount: amount,
        totalAmount: amount,
        paidAmount: paidAmount,
        balance: balance,
        date: inv.invoice_date,
        invoiceDate: inv.invoice_date,
        dueDate: inv.due_date,
        status: inv.status || "pending",
        installmentMonths:
          inv.installment_months || inv.remaining_installment_months || inv.purchase_orders?.installments || 1,
        monthsPaid: inv.months_paid || 0,
        paymentTerms: inv.payment_terms || inv.purchase_orders?.payment_terms || "installment",
        paymentType: paymentType,
        downPaymentAmount: inv.down_payment_amount ?? inv.purchase_orders?.down_payment_amount ?? 0,
        downPaymentPercent: inv.down_payment_percent ?? inv.purchase_orders?.down_payment_percent ?? null,
        downPaymentType: inv.down_payment_type ?? inv.purchase_orders?.down_payment_type ?? "amount",
        downPaymentDueDate: inv.down_payment_due_date ?? inv.purchase_orders?.down_payment_due_date ?? null,
        remainingAmount: inv.remaining_amount ?? inv.purchase_orders?.remaining_amount ?? 0,
        remainingInstallmentMonths:
          inv.remaining_installment_months ?? inv.purchase_orders?.remaining_installment_months ?? 0,
        monthlyAmount: inv.monthly_amount ?? inv.purchase_orders?.monthly_amount ?? 0,
        paymentStartDate: inv.payment_start_date ?? inv.purchase_orders?.payment_start_date,
        scheduleEntries: inv.schedule_entries ?? inv.purchase_orders?.schedule_entries ?? null,
        scheduleMode: inv.schedule_mode ?? inv.purchase_orders?.schedule_mode ?? "AUTO",
        invoiceFileUrl: inv.invoice_file_url,
        pdfUrl: inv.pdf_url,
        paymentReceiptUrl: inv.payment_receipt_url || null,
        items: [],
      }
    })

    return NextResponse.json(transformed)
  } catch (error: any) {
    console.error("Error fetching accounts payable:", error)
    return NextResponse.json([], { status: 200 })
  }
}

// RETIRED (BIZ-P-06), like POST /api/supplier-payments. AP invoices are created when a purchase order is approved
// (ensureApInvoice in the purchase-orders route, which writes to the database directly).
export async function POST() {
  return NextResponse.json(
    { error: "AP invoices are created when a purchase order is approved", code: "ENDPOINT_RETIRED" },
    { status: 410 },
  )
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const { id, ...updates } = body

    // Payment state is owned by POST /api/accounts-payable/payments (validated, idempotent, ledger-backed).
    const forbidden = ["paidAmount", "status", "amount", "monthsPaid", "paymentReceiptUrl", "receiptUrl"].filter(
      (field) => updates[field] !== undefined,
    )
    if (forbidden.length > 0) {
      return NextResponse.json(
        {
          error: `These fields cannot be changed here: ${forbidden.join(", ")}. Record payments through /api/accounts-payable/payments.`,
        },
        { status: 400 },
      )
    }

    const dbUpdates: any = {}
    if (updates.date !== undefined) dbUpdates.invoice_date = updates.date
    if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate
    if (updates.installmentMonths !== undefined) dbUpdates.installment_months = updates.installmentMonths
    if (updates.paymentType !== undefined) dbUpdates.payment_type = updates.paymentType
    if (updates.downPaymentAmount !== undefined) dbUpdates.down_payment_amount = updates.downPaymentAmount
    if (updates.remainingAmount !== undefined) dbUpdates.remaining_amount = updates.remainingAmount
    if (updates.remainingInstallmentMonths !== undefined)
      dbUpdates.remaining_installment_months = updates.remainingInstallmentMonths
    if (updates.monthlyAmount !== undefined) dbUpdates.monthly_amount = updates.monthlyAmount
    if (updates.paymentStartDate !== undefined) dbUpdates.payment_start_date = updates.paymentStartDate

    if (Object.keys(dbUpdates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("accounts_payable")
      .update(dbUpdates)
      .eq("invoice_id", Number.parseInt(id))
      .select()
      .single()

    if (error) {
      console.error("AP PUT: Error", error.message)
      throw error
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error updating accounts payable:", error.message)
    return NextResponse.json({ error: "Failed to update accounts payable" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    const numericId = parsePositiveId(id)
    if (numericId === null) {
      return NextResponse.json({ error: "A valid numeric id is required" }, { status: 400 })
    }

    // An invoice that has payments cannot be deleted: its supplier payments, ledger (balance) entries and paid
    // schedule rows would be left pointing at nothing. Unpaid invoices are still deleted as before.
    const { data: invoiceRows, error: readError } = await supabase
      .from("accounts_payable")
      .select("invoice_id, paid_amount, months_paid")
      .eq("invoice_id", numericId)
    if (readError) throw readError
    const invoice = invoiceRows?.[0]
    if (invoice) {
      const { data: payments, error: paymentsError } = await supabase
        .from("supplier_payments")
        .select("payment_id")
        .eq("invoice_id", numericId)
        .limit(1)
      if (paymentsError) throw paymentsError
      const { data: schedules, error: schedulesError } = await supabase
        .from("payment_schedules")
        .select("schedule_id, paid_amount, status")
        .eq("invoice_id", numericId)
        .eq("schedule_type", "payable")
      if (schedulesError) throw schedulesError
      const paidSchedule = (schedules || []).some(
        (row: any) => (Number(row.paid_amount) || 0) > 0 || row.status === "paid" || row.status === "partial",
      )
      const hasPayments =
        (Number(invoice.paid_amount) || 0) > 0 || (Number(invoice.months_paid) || 0) > 0 || (payments || []).length > 0 || paidSchedule
      if (hasPayments) {
        return NextResponse.json(
          { error: "This invoice already has payments recorded, so it cannot be deleted.", code: "AP_HAS_PAYMENTS" },
          { status: 409 },
        )
      }
    }

    const { error } = await supabase.from("accounts_payable").delete().eq("invoice_id", numericId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting accounts payable:", error)
    return NextResponse.json({ error: "Failed to delete accounts payable" }, { status: 500 })
  }
}
