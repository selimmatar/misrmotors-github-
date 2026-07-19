import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    const { work_order_id, customer_id, amount, notes, payment_terms, due_days } = body
    

    // Get work order details for invoice number
    const { data: workOrder } = await adminClient
      .from("maintenance_work_orders")
      .select("work_order_number, sales_order_id")
      .eq("work_order_id", work_order_id)
      .single()

    if (!workOrder) {
      return NextResponse.json({ error: "Work order not found" }, { status: 404 })
    }

    // Create AR entry (invoice)
    const invoiceNumber = `INV-MNT-${workOrder.work_order_number}`
    
    // Check if invoice already exists
    const { data: existingInvoice } = await adminClient
      .from("accounts_receivable")
      .select("invoice_number")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle()
    
    if (existingInvoice) {
      return NextResponse.json({ error: "Invoice already exists for this work order" }, { status: 409 })
    }
    
    const daysToAdd = due_days || 30
    const dueDate = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    const invoiceDate = new Date().toISOString().split("T")[0]

    // Get the maintenance report for cost breakdown
    const { data: report } = await adminClient
      .from("maintenance_reports")
      .select("actual_hours, actual_cost, parts_used")
      .eq("work_order_id", work_order_id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const partsUsed = report?.parts_used || []
    const partsCost = partsUsed.reduce((sum: number, p: any) => sum + (p.totalCost || 0), 0)
    const laborCost = (amount || 0) - partsCost

    // Create AR entry WITHOUT so_id - maintenance invoices are independent
    // Do NOT link to the sales order to avoid inheriting SO payment terms
    const { data: invoice, error: arError } = await adminClient
      .from("accounts_receivable")
      .insert({
        customer_id,
        // so_id is intentionally NOT set - maintenance invoices have their own payment terms
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        amount,
        collected_amount: 0,
        status: "pending",
        payment_terms: payment_terms || `Net ${daysToAdd} Days`,
      })
      .select()
      .single()

    if (arError) {
      console.error("Error creating AR entry:", arError)
      return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 })
    }

    // Also create a detailed record in maintenance_ar_invoices
    await adminClient.from("maintenance_ar_invoices").insert({
      work_order_id,
      invoice_id: invoice.invoice_id,
      invoice_amount: amount,
      labor_cost: laborCost > 0 ? laborCost : 0,
      parts_cost: partsCost,
      invoice_date: invoiceDate,
      due_date: dueDate,
      invoice_status: "pending",
      notes: notes || null,
      created_by: "accountant",
    })

    return NextResponse.json({
      success: true,
      invoice,
      message: "Invoice created successfully",
    })
  } catch (error) {
    console.error("Error creating maintenance invoice:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
