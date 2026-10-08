import { createAdminClient } from "@/lib/supabase/admin"
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

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()


    const amount = Number.parseFloat(body.amount) || 0

    const paymentType =
      body.payment_type || body.paymentType || body.payment_terms || body.paymentTerms || "installments"

    // Dedup: never create a second AP invoice for the same PO
    const poIdNum = Number.parseInt(body.po_id || body.poId)
    if (!Number.isNaN(poIdNum)) {
      const { data: existing } = await supabase
        .from("accounts_payable")
        .select("invoice_id, invoice_number")
        .eq("po_id", poIdNum)
        .limit(1)

      if (existing && existing.length > 0) {
        return NextResponse.json({
          invoice_id: existing[0].invoice_id,
          invoiceId: existing[0].invoice_id,
          invoice_number: existing[0].invoice_number,
          po_id: poIdNum,
          duplicate: true,
        })
      }
    }


    const dbData: any = {
      invoice_number: body.invoice_number || body.invoiceNumber,
      supplier_id: Number.parseInt(body.supplier_id || body.supplierId),
      po_id: Number.parseInt(body.po_id || body.poId),
      invoice_date: body.invoice_date || body.date || new Date().toISOString().split("T")[0],
      due_date: body.due_date || body.dueDate || new Date().toISOString().split("T")[0],
      amount: amount,
      paid_amount: 0, // payments are recorded only through /api/accounts-payable/payments
      installment_months: body.installment_months || body.installmentMonths || 1,
      months_paid: 0,
      status: "pending",
      payment_terms: body.payment_terms || body.paymentTerms || paymentType,
      payment_type: paymentType,
    }

    if (paymentType === "hybrid") {
      dbData.down_payment_amount = body.down_payment_amount ?? body.downPaymentAmount ?? null
      dbData.down_payment_percent = body.down_payment_percent ?? body.downPaymentPercent ?? null
      dbData.down_payment_type = body.down_payment_type ?? body.downPaymentType ?? "amount"
      dbData.down_payment_due_date = body.down_payment_due_date ?? body.downPaymentDueDate ?? null
      dbData.remaining_amount = body.remaining_amount ?? body.remainingAmount ?? null
      dbData.remaining_installment_months = body.remaining_installment_months ?? body.remainingInstallmentMonths ?? null
      dbData.monthly_amount = body.monthly_amount ?? body.monthlyAmount ?? null
      dbData.payment_start_date = body.payment_start_date ?? body.paymentStartDate ?? null
      dbData.schedule_entries = body.schedule_entries ?? body.scheduleEntries ?? null
      dbData.schedule_mode = body.schedule_mode ?? body.scheduleMode ?? "AUTO"


    } else {
      // Non-hybrid: still set some fields if provided
      dbData.down_payment_amount = body.down_payment_amount ?? body.downPaymentAmount ?? null
      dbData.remaining_amount = body.remaining_amount ?? body.remainingAmount ?? null
      dbData.remaining_installment_months = body.remaining_installment_months ?? body.remainingInstallmentMonths ?? null
      dbData.monthly_amount = body.monthly_amount ?? body.monthlyAmount ?? null
      dbData.payment_start_date = body.payment_start_date ?? body.paymentStartDate ?? null
    }

    const { data, error } = await supabase.from("accounts_payable").insert(dbData).select().single()

    if (error) {
      console.error("AP POST: Error", error.message)
      throw error
    }

    if (!data || !data.invoice_id) {
      console.error("AP POST: Invoice created but invoice_id is missing", data)
      throw new Error("Invoice created but invoice_id was not returned")
    }

    return NextResponse.json({
      invoice_id: data.invoice_id,
      invoiceId: data.invoice_id,
      invoice_number: data.invoice_number,
      po_id: data.po_id,
      supplier_id: data.supplier_id,
      invoice_date: data.invoice_date,
      due_date: data.due_date,
      amount: data.amount,
      paid_amount: data.paid_amount,
      balance: data.balance,
      payment_terms: data.payment_terms,
      payment_type: data.payment_type,
      installment_months: data.installment_months,
      months_paid: data.months_paid,
      status: data.status,
      created_at: data.created_at,
      payment_start_date: data.payment_start_date,
      down_payment_amount: data.down_payment_amount,
      down_payment_percent: data.down_payment_percent,
      down_payment_type: data.down_payment_type,
      down_payment_due_date: data.down_payment_due_date,
      remaining_amount: data.remaining_amount,
      remaining_installment_months: data.remaining_installment_months,
      monthly_amount: data.monthly_amount,
      schedule_entries: data.schedule_entries,
      schedule_mode: data.schedule_mode,
    })
  } catch (error: any) {
    console.error("Error creating accounts payable:", error.message)
    return NextResponse.json({ error: "Failed to create accounts payable" }, { status: 500 })
  }
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

    if (id) {
      const { error } = await supabase.from("accounts_payable").delete().eq("invoice_id", Number.parseInt(id))
      if (error) throw error
    } else {
      const { error } = await supabase.from("accounts_payable").delete().gt("invoice_id", 0)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting accounts payable:", error)
    return NextResponse.json({ error: "Failed to delete accounts payable" }, { status: 500 })
  }
}
