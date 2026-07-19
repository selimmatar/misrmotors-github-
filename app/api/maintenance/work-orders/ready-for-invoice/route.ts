import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const adminClient = createAdminClient()
    
    // Get completed work orders with their reports
    const { data, error } = await adminClient
      .from("maintenance_work_orders")
      .select(`
        work_order_id,
        work_order_number,
        sales_order_id,
        title,
        description,
        customer_id,
        status,
        created_at,
        customers!left (
          customer_name
        ),
        sales_orders!maintenance_work_orders_sales_order_id_fkey!left (
          so_number
        ),
        maintenance_reports!left (
          report_id,
          summary,
          findings,
          actions_taken,
          actual_hours,
          actual_cost,
          parts_used,
          submitted_at,
          uploaded_pdf_url
        )
      `)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
    
    if (error) {
      console.error("Error fetching work orders:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Filter to only include orders with reports
    const withReports = (data || []).filter(wo => {
      const reports = wo.maintenance_reports
      return Array.isArray(reports) && reports.length > 0
    })
    
    // Check maintenance_ar_invoices table to see which work orders already have invoices
    const workOrderIds = withReports.map(wo => wo.work_order_id)
    
    let existingInvoices: any[] = []
    if (workOrderIds.length > 0) {
      const { data: invoiceData } = await adminClient
        .from("maintenance_ar_invoices")
        .select("work_order_id")
        .in("work_order_id", workOrderIds)
      existingInvoices = invoiceData || []
    }
    
    const invoicedWorkOrderIds = new Set(
      existingInvoices.map(inv => inv.work_order_id).filter(Boolean)
    )
    
    // Also check AR table for INV-MNT- pattern and get invoice amounts
    // Invoice numbers are formatted as INV-MNT-{work_order_number}
    const woNumbers = withReports.map(wo => `INV-MNT-${wo.work_order_number}`)
    const invoiceAmounts: Record<string, number> = {}
    
    if (woNumbers.length > 0) {
      const { data: arInvoices } = await adminClient
        .from("accounts_receivable")
        .select("invoice_number, amount")
        .in("invoice_number", woNumbers)
      
      arInvoices?.forEach(inv => {
        const woNumber = inv.invoice_number?.replace("INV-MNT-", "")
        if (woNumber) {
          invoiceAmounts[woNumber] = inv.amount || 0
        }
      })
      
      const invoicedWoNumbers = new Set(Object.keys(invoiceAmounts))
      // Add the work_order_id for any matched work_order_number
      withReports.forEach(wo => {
        if (invoicedWoNumbers.has(wo.work_order_number)) {
          invoicedWorkOrderIds.add(wo.work_order_id)
        }
      })
    }
    
    // Map ALL completed work orders with has_invoice flag
    const allWorkOrders = withReports.map(wo => {
      const latestReport = wo.maintenance_reports[0]
      const salesOrder = Array.isArray(wo.sales_orders) ? wo.sales_orders[0] : wo.sales_orders
      const customer = Array.isArray(wo.customers) ? wo.customers[0] : wo.customers
      
      const partsUsed = latestReport.parts_used || []
      const partsCost = partsUsed.reduce((sum: number, p: any) => sum + (p.totalCost || 0), 0)
      const totalCost = latestReport.actual_cost || partsCost || 0
      const laborCost = totalCost - partsCost
      
      // Check if this work order has been invoiced
      const hasInvoice = invoicedWorkOrderIds.has(wo.work_order_id)
      // Use invoice amount if invoiced, otherwise use work order cost
      const invoicedAmount = invoiceAmounts[wo.work_order_number] || 0

      return {
        work_order_id: wo.work_order_id,
        work_order_number: wo.work_order_number,
        sales_order_id: wo.sales_order_id,
        sales_order_number: salesOrder?.so_number || "N/A",
        customer_id: wo.customer_id,
        customer_name: customer?.customer_name || "Unknown",
        title: wo.title,
        description: wo.description,
        actual_cost: totalCost,
        labor_cost: laborCost,
        parts_cost: partsCost,
        invoice_amount: hasInvoice ? invoicedAmount : 0,
        report_summary: latestReport.summary,
        report_findings: latestReport.findings,
        actual_hours: latestReport.actual_hours || 0,
        submitted_at: latestReport.submitted_at,
        uploaded_pdf_url: latestReport.uploaded_pdf_url || null,
        status: wo.status,
        has_invoice: hasInvoice,
      }
    })

    return NextResponse.json(allWorkOrders)
  } catch (error) {
    console.error("Error in ready-for-invoice endpoint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
