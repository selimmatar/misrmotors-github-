import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { so_id } = body

    if (!so_id) {
      return NextResponse.json({ error: "Sales order ID is required" }, { status: 400 })
    }

    console.log("[v0] Creating AR invoice from SO:", so_id, "Type:", typeof so_id)

    // Check if invoice already exists for this SO
    const { data: existingInvoice } = await supabase
      .from("accounts_receivable")
      .select("invoice_number, invoice_id")
      .eq("so_id", so_id)
      .maybeSingle()

    if (existingInvoice) {
      console.log("[v0] AR Invoice already exists:", existingInvoice.invoice_number)
      return NextResponse.json(
        { 
          error: `Invoice ${existingInvoice.invoice_number} already exists for this Sales Order`,
          invoiceId: existingInvoice.invoice_id,
          invoiceNumber: existingInvoice.invoice_number
        }, 
        { status: 400 }
      )
    }

    // Fetch SO with items
    console.log("[v0] Fetching sales order with so_id:", so_id)
    const { data: so, error: soError } = await supabase
      .from("sales_orders")
      .select(`
        *,
        sales_order_items (
          quantity,
          unit_price,
          total,
          products:product_id (product_name, sku)
        ),
        customers:customer_id (customer_name)
      `)
      .eq("so_id", so_id)
      .single()

    if (soError || !so) {
      console.error("[v0] AR - Sales order not found. Error:", soError, "SO ID:", so_id)
      return NextResponse.json({ 
        error: "Sales order not found", 
        details: { so_id, soError: soError?.message }
      }, { status: 404 })
    }

    console.log("[v0] AR - Found SO:", so.so_number, "Total:", so.total)

    // Fetch delivery permits associated with this SO
    const { data: deliveryPermits } = await supabase
      .from("delivery_permits")
      .select(`
        permit_id,
        permit_no,
        permit_number,
        status,
        delivery_date,
        printed_at,
        approved_at
      `)
      .eq("sales_order_id", so_id)
      .order("permit_id", { ascending: true })

    // Generate invoice number - get the highest invoice number
    const currentYear = new Date().getFullYear()
    const { data: allInvoices } = await supabase
      .from("accounts_receivable")
      .select("invoice_number")
      .like("invoice_number", `INV-${currentYear}-%`)
      .order("invoice_number", { ascending: false })
      .limit(10)

    let invoiceNumber = `INV-${currentYear}-001`
    if (allInvoices && allInvoices.length > 0) {
      // Find the highest sequence number
      let maxSeq = 0
      for (const inv of allInvoices) {
        const match = inv.invoice_number?.match(/INV-(\d+)-(\d+)/)
        if (match) {
          const seq = Number.parseInt(match[2])
          if (seq > maxSeq) maxSeq = seq
        }
      }
      invoiceNumber = `INV-${currentYear}-${(maxSeq + 1).toString().padStart(3, "0")}`
    }
    
    console.log("[v0] Generated invoice number:", invoiceNumber)

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("accounts_receivable")
      .insert({
        invoice_number: invoiceNumber,
        customer_id: so.customer_id,
        so_id: so.so_id,
        invoice_date: new Date().toISOString().split("T")[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        amount: so.total,
        collected_amount: 0,
        status: "pending",
      })
      .select()
      .single()

    if (invoiceError) {
      console.error("[v0] Error creating invoice:", invoiceError)
      return NextResponse.json({ error: invoiceError.message }, { status: 500 })
    }

    console.log("[v0] Invoice created successfully:", invoice.invoice_id, "with", deliveryPermits?.length || 0, "delivery permits")
    return NextResponse.json({
      ...invoice,
      invoiceNumber: invoice.invoice_number,
      customerId: invoice.customer_id,
      customerName: so.customers?.customer_name,
      soId: invoice.so_id,
      soNumber: so.so_number,
      deliveryPermits: deliveryPermits || [],
    })
  } catch (error: any) {
    console.error("[v0] Error creating invoice from SO:", error)
    return NextResponse.json({ error: error.message || "Failed to create invoice" }, { status: 500 })
  }
}
