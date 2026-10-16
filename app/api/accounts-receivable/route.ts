import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { resolveInstallmentCount } from "@/lib/payment-type"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data, error } = await supabase
        .from("accounts_receivable")
        .select(`
          *,
          customers:customer_id (customer_name),
          sales_orders:so_id (
            so_number,
            quotation_request_number,
            quotation_request_file_name,
            quotation_request_file_path
          )
        `)
        .order("created_at", { ascending: false })

      if (error) throw error

      if (!Array.isArray(data)) {
        throw new Error("Invalid response format from database")
      }

      let dpLinks: any[] = []
      try {
        const { data: linksData } = await supabase.from("invoice_delivery_permits").select(`
            invoice_id,
            delivery_permits:permit_id (
              permit_id,
              permit_no,
              status
            )
          `)

        dpLinks = linksData || []
      } catch (dpError) {
      }

      const dataWithDPs = data.map((invoice: any) => ({
        ...invoice,
        invoice_delivery_permits: dpLinks.filter((link: any) => link.invoice_id === invoice.invoice_id),
      }))

      return dataWithDPs
    })

    if (!result || !Array.isArray(result)) {
      console.error("AR GET: Invalid result format", result)
      return NextResponse.json([], { status: 200 })
    }

    const transformed =
      result?.map((invoice: any) => ({
        id: invoice.invoice_id?.toString() || invoice.id?.toString(),
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.customer_id?.toString(),
        customerName: invoice.customers?.customer_name || "",
        soId: invoice.so_id?.toString(),
        soNumber: invoice.sales_orders?.so_number || "",
        paymentTerms: invoice.payment_terms || null,
        date: invoice.invoice_date || invoice.created_at,
        dueDate: invoice.due_date || invoice.created_at,
        amount: invoice.amount,
        collectedAmount: invoice.collected_amount || 0,
        status: invoice.status,
        // Single-payment invoices (cash / bank transfer / cheque) are always 1 payment; a stale stored 6 is
        // never exposed as an installment plan. Display-only: the stored value is not modified.
        installmentMonths: resolveInstallmentCount(invoice.payment_terms, invoice.installment_months) || 0,
        monthsPaid: invoice.months_paid || 0,
        isMaintenance: invoice.invoice_number?.startsWith("INV-MNT-") || false,
        items: invoice.items || [],
        deliveryPermits:
          invoice.invoice_delivery_permits?.map((link: any) => ({
            permitId: link.delivery_permits?.permit_id?.toString(),
            permitNo: link.delivery_permits?.permit_no,
            status: link.delivery_permits?.status,
          })) || [],
        quotationRequest: invoice.sales_orders?.quotation_request_number
          ? {
              qrNumber: invoice.sales_orders.quotation_request_number,
              fileName: invoice.sales_orders.quotation_request_file_name,
              filePath: invoice.sales_orders.quotation_request_file_path,
            }
          : null,
        pdfUrl: invoice.pdf_url,
        vatInvoiceUrl: invoice.vat_invoice_url,
      })) || []

    return NextResponse.json(transformed)
  } catch (error: any) {
    console.error("AR GET: Final error after all retries:", error?.message || error)
    return NextResponse.json([], { status: 200 })
  }
}

// RETIRED (BIZ-S-003). Invoices are created only from approved delivery permits
// (POST /api/accounts-receivable/create-from-dps); a client-built invoice could carry any amount or collected total.
export async function POST() {
  return NextResponse.json(
    {
      error: "Creating an invoice directly is no longer supported. Invoices are created from approved delivery permits.",
      code: "AR_CREATE_RETIRED",
    },
    { status: 410 },
  )
}

// Only the VAT invoice file can be changed here. Payments go through POST /api/accounts-receivable/payments, so
// collected_amount, months_paid and status are never written by this handler. The id is body.id or body.invoiceId
// (the receivables screen sends invoiceId).
const AR_MONEY_FIELDS = [
  "amount", "status", "collectedAmount", "collected_amount", "monthsPaid", "months_paid", "balance",
  "installmentMonths", "installment_months", "dueDate", "due_date",
]
export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const numericId = parsePositiveId(body?.id ?? body?.invoiceId)
    if (numericId === null) {
      return NextResponse.json({ error: "A valid numeric id (id or invoiceId) is required" }, { status: 400 })
    }
    const refused = AR_MONEY_FIELDS.filter((field) => body[field] !== undefined)
    if (refused.length > 0) {
      return NextResponse.json(
        { error: `Only the VAT invoice file can be changed here (refused: ${refused.join(", ")}). Record payments from the receivables screen.` },
        { status: 400 },
      )
    }
    if (body.vatInvoiceUrl === undefined) {
      return NextResponse.json({ error: "vatInvoiceUrl is required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("accounts_receivable")
      .update({ vat_invoice_url: body.vatInvoiceUrl || null })
      .eq("invoice_id", numericId)
      .select()

    if (error) {
      console.error("AR PUT: Error", error.message)
      throw error
    }
    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    return NextResponse.json(data[0])
  } catch (error: any) {
    console.error("Error updating customer invoice:", error?.message || error)
    return NextResponse.json({ error: error?.message || "Failed to update customer invoice" }, { status: 500 })
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

    // An invoice that holds money is never deleted (BIZ-S-003): collected_amount > 0 or any customer payment row.
    const { data: invoice, error: readError } = await supabase
      .from("accounts_receivable")
      .select("invoice_id, collected_amount")
      .eq("invoice_id", numericId)
      .maybeSingle()
    if (readError) throw readError
    if (invoice && (Number(invoice.collected_amount) || 0) > 0) {
      return NextResponse.json(
        { error: "This invoice has collected payments and cannot be deleted.", code: "AR_HAS_PAYMENTS" },
        { status: 409 },
      )
    }
    const { data: payments, error: paymentsError } = await supabase
      .from("customer_payments")
      .select("payment_id")
      .eq("invoice_id", numericId)
      .limit(1)
    if (paymentsError) throw paymentsError
    if (Array.isArray(payments) && payments.length > 0) {
      return NextResponse.json(
        { error: "This invoice has customer payments and cannot be deleted.", code: "AR_HAS_PAYMENTS" },
        { status: 409 },
      )
    }

    const { error } = await supabase.from("accounts_receivable").delete().eq("invoice_id", numericId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting customer invoices:", error)
    return NextResponse.json({ error: "Failed to delete customer invoices" }, { status: 500 })
  }
}
