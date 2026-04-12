import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const adminClient = createAdminClient()
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role") || ""

    const counts: Record<string, number> = {}

    // ===== SALES QUOTATIONS - REMOVED per user request =====
    // User requested to remove notification from sales quotations module
    // Keeping code commented for reference
    /*
    if (["sales-rep", "ceo"].includes(role)) {
      const { count } = await adminClient
        .from("sales_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "draft")
      counts["approve-sales-quotations"] = count || 0
    }
    */

    // ===== SALES ORDERS PENDING ACCOUNTANT APPROVAL =====
    // Visible to: accountant, ceo
    if (["accountant", "ceo"].includes(role)) {
      const { count } = await adminClient
        .from("sales_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_accountant")
      counts["approve-sales-orders"] = count || 0
    }

    // ===== PURCHASE ORDERS PENDING APPROVAL =====
    // Visible to: po-rep, ceo
    if (["po-rep", "ceo"].includes(role)) {
      const { count } = await adminClient
        .from("purchase_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
      counts["purchase-orders"] = count || 0
    }

    // ===== DELIVERY PERMITS PENDING ALLOCATION (warehouse) =====
    // DPs with DRAFT status are pending allocation by warehouse
    // Visible to: warehouse-rep, ceo
    if (["warehouse-rep", "ceo"].includes(role)) {
      const { count } = await adminClient
        .from("delivery_permits")
        .select("*", { count: "exact", head: true })
        .eq("status", "DRAFT")
      counts["warehouse-delivery"] = count || 0
    }

    // ===== GOODS RECEIPT - APPROVED POs AWAITING RECEIPT =====
    // Visible to: warehouse-rep, ceo
    if (["warehouse-rep", "ceo"].includes(role)) {
      const { count } = await adminClient
        .from("purchase_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
      counts["goods-receipt"] = count || 0
    }

    // ===== MAINTENANCE REPORTS PENDING SALES APPROVAL =====
    // Reports submitted by shipping (work orders on_hold) awaiting sales review
    // Visible to: sales-rep, ceo
    if (["sales-rep", "ceo"].includes(role)) {
      const { data: onHoldWOs } = await adminClient
        .from("maintenance_work_orders")
        .select("work_order_id")
        .eq("status", "on_hold")
      
      if (onHoldWOs && onHoldWOs.length > 0) {
        counts["sales-orders"] = onHoldWOs.length
      } else {
        counts["sales-orders"] = 0
      }
    }

    // ===== MAINTENANCE INVOICES READY TO CREATE (accountant) =====
    // Completed work orders that don't have an invoice yet
    // Visible to: accountant, ceo
    if (["accountant", "ceo"].includes(role)) {
      const { data: completedWOs } = await adminClient
        .from("maintenance_work_orders")
        .select("work_order_id, work_order_number")
        .eq("status", "completed")
      
      if (completedWOs && completedWOs.length > 0) {
        const woNumbers = completedWOs.map(wo => `INV-MNT-${wo.work_order_number}`)
        const { data: existingInvoices } = await adminClient
          .from("accounts_receivable")
          .select("invoice_number")
          .in("invoice_number", woNumbers)
        
        const invoicedSet = new Set(existingInvoices?.map(inv => inv.invoice_number) || [])
        const uninvoiced = completedWOs.filter(wo => !invoicedSet.has(`INV-MNT-${wo.work_order_number}`))
        counts["maintenance-invoices"] = uninvoiced.length
      } else {
        counts["maintenance-invoices"] = 0
      }
    }

    // ===== SHIPPING: DELIVERY PERMITS READY FOR PICKUP =====
    // DPs with READY_FOR_PICKUP or PRINTED status are ready for shipping to pick up
    // Visible to: shipment, ceo
    if (["shipment", "ceo"].includes(role)) {
      const { count } = await adminClient
        .from("delivery_permits")
        .select("*", { count: "exact", head: true })
        .in("status", ["READY_FOR_PICKUP", "PRINTED"])
      counts["shipment"] = count || 0
    }
    return NextResponse.json(counts)
  } catch (error) {
    console.error("[v0] Error fetching pending counts:", error)
    return NextResponse.json({})
  }
}
