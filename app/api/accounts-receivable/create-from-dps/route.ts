import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { permit_ids } = body

    if (!permit_ids || !Array.isArray(permit_ids) || permit_ids.length === 0) {
      return NextResponse.json({ error: "At least one delivery permit ID is required" }, { status: 400 })
    }


    const { data: permits, error: permitsError } = await supabase
      .from("delivery_permits")
      .select(`
        *,
        sales_orders:sales_order_id (
          so_id,
          so_number,
          customer_id,
          total,
          subtotal,
          payment_type,
          payment_terms,
          customers:customer_id (customer_name)
        ),
        delivery_permit_items (
          quantity,
          unit_price,
          total,
          item_name_snapshot
        )
      `)
      .in("permit_id", permit_ids)

    if (permitsError || !permits || permits.length === 0) {
      console.error("DPs not found:", permitsError)
      return NextResponse.json({ error: "Delivery permits not found" }, { status: 404 })
    }

    // Validation: Same customer
    const customerIds = new Set(permits.map((p: any) => p.sales_orders?.customer_id))
    if (customerIds.size > 1) {
      return NextResponse.json(
        { error: "Selected delivery permits belong to different customers. Cannot consolidate." },
        { status: 400 },
      )
    }

    // Validation: Not already invoiced
    const { data: existingLinks } = await supabase
      .from("invoice_delivery_permits")
      .select("permit_id")
      .in("permit_id", permit_ids)

    if (existingLinks && existingLinks.length > 0) {
      const alreadyInvoiced = existingLinks.map((l: any) => l.permit_id)
      return NextResponse.json(
        { error: `Delivery permits already invoiced: ${alreadyInvoiced.join(", ")}` },
        { status: 400 },
      )
    }

    const dpsByPaymentType: Record<string, any[]> = {}
    permits.forEach((permit: any) => {
      const paymentType = permit.sales_orders?.payment_type || permit.sales_orders?.payment_terms || "cash"
      if (!dpsByPaymentType[paymentType]) {
        dpsByPaymentType[paymentType] = []
      }
      dpsByPaymentType[paymentType].push(permit)
    })

    const paymentTypes = Object.keys(dpsByPaymentType)

    if (paymentTypes.length > 1) {
      const preview = paymentTypes.map((pt) => ({
        payment_type: pt,
        dp_count: dpsByPaymentType[pt].length,
        permit_ids: dpsByPaymentType[pt].map((p: any) => p.permit_id),
      }))

      return NextResponse.json(
        {
          requiresSplit: true,
          message: `Selected DPs have ${paymentTypes.length} different payment terms. Will create ${paymentTypes.length} separate invoices.`,
          preview,
        },
        { status: 200 },
      )
    }

    // Single payment type - create one invoice
    const customerId = Array.from(customerIds)[0] as number
    const createdInvoices: any[] = []

    for (const [paymentType, groupPermits] of Object.entries(dpsByPaymentType)) {
      const firstSoId = groupPermits[0].sales_order_id
      const firstSo = groupPermits[0].sales_orders
      
      // Use the sales order total, not the sum of delivered items
      // This ensures the invoice amount matches the SO amount
      const invoiceAmount = firstSo?.total || 0
      
      // Get the SO's installment months - need to fetch full SO data
      const { data: soData } = await supabase
        .from("sales_orders")
        .select("installments")
        .eq("so_id", firstSoId)
        .single()
      
      const installmentMonths = soData?.installments || 1

      // Check if invoice already exists for this SO
      const { data: existingInvoice } = await supabase
        .from("accounts_receivable")
        .select("invoice_number, invoice_id")
        .eq("so_id", firstSoId)
        .maybeSingle()

      if (existingInvoice) {
        return NextResponse.json(
          {
            error: `Invoice ${existingInvoice.invoice_number} already exists for Sales Order. Cannot create duplicate.`,
            invoiceId: existingInvoice.invoice_id,
            invoiceNumber: existingInvoice.invoice_number,
          },
          { status: 400 },
        )
      }

      // Generate invoice number
      const year = new Date().getFullYear()
      const { data: lastInvoice } = await supabase
        .from("accounts_receivable")
        .select("invoice_number")
        .like("invoice_number", `INV-${year}-%`)
        .order("invoice_number", { ascending: false })
        .limit(1)
        .maybeSingle()

      let nextNum = 1
      if (lastInvoice?.invoice_number) {
        const lastN = Number.parseInt(lastInvoice.invoice_number.split("-").pop() || "0")
        nextNum = lastN + 1
      }
      const invoiceNumber = `INV-${year}-${String(nextNum).padStart(4, "0")}`

      // Create invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from("accounts_receivable")
        .insert({
          invoice_number: invoiceNumber,
          customer_id: customerId,
          so_id: firstSoId,
          invoice_date: new Date().toISOString().split("T")[0],
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          amount: invoiceAmount,
          collected_amount: 0,
          payment_terms: paymentType,
          installment_months: installmentMonths,
          months_paid: 0,
          status: "pending",
        })
        .select()
        .single()

      if (invoiceError) {
        console.error("Error creating invoice:", invoiceError)
        return NextResponse.json({ error: invoiceError.message }, { status: 500 })
      }

      // Create invoice_delivery_permits links
      const links = groupPermits.map((permit: any) => ({
        invoice_id: invoice.invoice_id,
        permit_id: permit.permit_id,
      }))

      const { error: linksError } = await supabase.from("invoice_delivery_permits").insert(links)

      if (linksError) {
        console.error("Error creating DP links:", linksError)
        await supabase.from("accounts_receivable").delete().eq("invoice_id", invoice.invoice_id)
        return NextResponse.json({ error: "Failed to link delivery permits" }, { status: 500 })
      }

      // Update delivery_permits.invoice_id for backward compatibility
      const permitIds = groupPermits.map((p: any) => p.permit_id)
      await supabase.from("delivery_permits").update({ invoice_id: invoice.invoice_id }).in("permit_id", permitIds)

      createdInvoices.push({
        ...invoice,
        invoiceNumber: invoice.invoice_number,
        deliveryPermits: groupPermits.map((p: any) => p.permit_no),
        paymentType,
      })

      console.log(
        `[v0] Created invoice ${invoiceNumber} for ${groupPermits.length} DPs with payment type: ${paymentType}`,
      )
    }

    return NextResponse.json({
      success: true,
      invoices: createdInvoices,
      message:
        createdInvoices.length === 1
          ? "Invoice created successfully"
          : `Created ${createdInvoices.length} invoices (split by payment terms)`,
    })
  } catch (error: any) {
    console.error("Error creating invoice from DPs:", error)
    return NextResponse.json({ error: error.message || "Failed to create invoice" }, { status: 500 })
  }
}
