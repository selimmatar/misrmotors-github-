import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadMissingItems } from "@/lib/missing-items"
import { HOLDING_QUOTATION_STATUSES } from "@/lib/stock-hold"
import { SO_STATUSES_NEEDING_PO, rowsNeedPo, unappliedQuotedRequests } from "@/lib/notifications/counts"

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

      // Sales orders made from a quotation that still have lines needing a purchase order
      const { data: orders } = await adminClient
        .from("sales_orders")
        .select("so_id")
        .not("parent_quotation_id", "is", null)
        .in("status", SO_STATUSES_NEEDING_PO)
      for (const order of orders || []) {
        try {
          const report = await loadMissingItems(adminClient, order.so_id)
          if (report && rowsNeedPo(report.rows)) counts["purchase-orders"] += 1
        } catch (error) {
          console.error("pending-counts: missing items of SO", order.so_id, error)
        }
      }

      // Price requests sent by a sales rep, waiting for the supplier's price
      const { count: pendingRequests } = await adminClient
        .from("po_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
      counts["po-requests"] = pendingRequests || 0
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

      // Price requests with a supplier price that is not on its quotation yet
      const { data: quoted } = await adminClient
        .from("po_requests")
        .select("request_id, sales_quotation_id, po_request_items(*)")
        .eq("status", "quoted")
        .not("sales_quotation_id", "is", null)
      const quotationIds = [...new Set((quoted || []).map((r) => r.sales_quotation_id as number))]
      if (quotationIds.length > 0) {
        const [{ data: quotations }, { data: converted }, { data: lines }] = await Promise.all([
          adminClient.from("sales_quotations").select("id").in("id", quotationIds).in("status", HOLDING_QUOTATION_STATUSES),
          adminClient.from("sales_orders").select("parent_quotation_id").in("parent_quotation_id", quotationIds),
          adminClient.from("sales_quotation_items").select("quotation_id, product_name, unit_cost, item_type").in("quotation_id", quotationIds),
        ])
        const convertedIds = new Set((converted || []).map((o) => o.parent_quotation_id))
        const open = new Set((quotations || []).map((q) => q.id as number).filter((id) => !convertedIds.has(id)))
        counts["sales-orders"] += unappliedQuotedRequests(quoted as any[], open, lines || [])
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

    // ===== DELIVERY PERMITS SIGNED AND WAITING FOR APPROVAL =====
    // The people who approve them (the delivery permit card's APPROVE button): accountant, ceo, admin
    if (["accountant", "ceo", "admin"].includes(role)) {
      const { count } = await adminClient
        .from("delivery_permits")
        .select("*", { count: "exact", head: true })
        .eq("status", "SUBMITTED_SIGNED")
      counts["delivery-permits"] = count || 0
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
    console.error("Error fetching pending counts:", error)
    return NextResponse.json({})
  }
}
