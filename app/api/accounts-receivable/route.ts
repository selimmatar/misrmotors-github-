import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
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
      console.error("[v0] AR GET: Invalid result format", result)
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
        installmentMonths: invoice.installment_months || 0,
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
    console.error("[v0] AR GET: Final error after all retries:", error?.message || error)
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()

    const dbData = {
      invoice_number: body.invoice_number || body.invoiceNumber,
      customer_id: Number.parseInt(body.customer_id || body.customerId),
      so_id: Number.parseInt(body.so_id || body.soId),
      invoice_date: body.date || body.invoice_date || new Date().toISOString().split("T")[0],
      due_date: body.dueDate || body.due_date || new Date().toISOString().split("T")[0],
      amount: body.amount,
      collected_amount: body.collectedAmount || body.collected_amount || 0,
      installment_months: body.installment_months || body.installmentMonths,
      months_paid: body.months_paid || body.monthsPaid || 0,
      status: body.status || "pending",
    }

    const { data, error } = await supabase.from("accounts_receivable").insert(dbData).select().single()

    if (error) {
      console.error("[v0] AR POST: Error", error.message)
      throw error
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error creating customer invoice:", error.message)
    return NextResponse.json({ error: "Failed to create customer invoice" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const { id, ...updates } = body

    const dbUpdates: any = {}

    if (updates.monthsPaid !== undefined || updates.months_paid !== undefined) {
      dbUpdates.months_paid = updates.monthsPaid ?? updates.months_paid
    }
    if (updates.status !== undefined) dbUpdates.status = updates.status
    if (updates.collectedAmount !== undefined || updates.collected_amount !== undefined) {
      dbUpdates.collected_amount = updates.collectedAmount ?? updates.collected_amount
    }
    if (updates.vatInvoiceUrl !== undefined) {
      dbUpdates.vat_invoice_url = updates.vatInvoiceUrl
    }
    // balance is auto-calculated as (amount - collected_amount) by the database


    const { data, error } = await supabase
      .from("accounts_receivable")
      .update(dbUpdates)
      .eq("invoice_id", id)
      .select()
      .single()

    if (error) {
      console.error("[v0] AR PUT: Error", error.message)
      throw error
    }

    return NextResponse.json(data)
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

    if (id) {
      const { error } = await supabase.from("accounts_receivable").delete().eq("invoice_id", id)
      if (error) throw error
    } else {
      const { error } = await supabase.from("accounts_receivable").delete().neq("invoice_id", 0)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting customer invoices:", error)
    return NextResponse.json({ error: "Failed to delete customer invoices" }, { status: 500 })
  }
}
