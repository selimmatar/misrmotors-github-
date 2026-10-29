// "Waiting for you" lists at the top of a screen: the items behind its sidebar counter. The counter
// (app/api/pending-counts) counts these same lists, so the number and the list always agree.
import { loadMissingItems } from "@/lib/missing-items"
import { HOLDING_QUOTATION_STATUSES } from "@/lib/stock-hold"
import { isMaintenanceLive } from "@/lib/workflow-switch"
import { NEEDS_PO, SO_STATUSES_NEEDING_PO, filterUnappliedQuotedRequests, type QuotedRequest } from "@/lib/notifications/counts"

type Db = any // supabase-js client (or a test double)

async function namesById(db: Db, table: string, idColumn: string, nameColumn: string, ids: unknown[]): Promise<Map<unknown, string>> {
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined))]
  if (unique.length === 0) return new Map()
  const { data } = await db.from(table).select(`${idColumn}, ${nameColumn}`).in(idColumn, unique)
  return new Map((data || []).map((row: any) => [row[idColumn], row[nameColumn] || ""]))
}

export interface SoNeedingPo {
  so_id: number
  so_number: string
  customer_name: string
  items: string[]
}

// Sales orders made from a quotation with lines that still need a purchase order.
export async function loadSalesOrdersNeedingPo(db: Db): Promise<SoNeedingPo[]> {
  const { data: orders } = await db
    .from("sales_orders")
    .select("so_id")
    .not("parent_quotation_id", "is", null)
    .in("status", SO_STATUSES_NEEDING_PO)
  const list: SoNeedingPo[] = []
  for (const order of orders || []) {
    try {
      const report = await loadMissingItems(db, order.so_id)
      const items = (report?.rows || []).filter((r) => NEEDS_PO.test(r.procurementStatus || "")).map((r) => r.name)
      if (report && items.length > 0) {
        list.push({ so_id: report.so.so_id, so_number: report.so.so_number, customer_name: report.so.customerName || "", items })
      }
    } catch (error) {
      console.error("waiting: missing items of SO", order.so_id, error)
    }
  }
  return list
}

export interface PendingPo {
  po_id: number
  po_number: string
  supplier_name: string
  total: number
  currency: string
}

// Purchase orders waiting for approval.
export async function loadPendingPurchaseOrders(db: Db): Promise<PendingPo[]> {
  const { data } = await db.from("purchase_orders").select("po_id, po_number, supplier_id, total, currency").eq("status", "pending")
  const suppliers = await namesById(db, "suppliers", "supplier_id", "supplier_name", (data || []).map((po: any) => po.supplier_id))
  return (data || []).map((po: any) => ({
    po_id: po.po_id,
    po_number: po.po_number || "",
    supplier_name: suppliers.get(po.supplier_id) || "",
    total: Number(po.total || 0),
    currency: po.currency || "EGP",
  }))
}

export interface WaitingPriceRequest {
  request_id: number
  request_number: string
  quotation_number: string
  customer_name: string
  supplier_name: string
}

// Price requests waiting for the supplier's price.
export async function loadPendingPriceRequests(db: Db): Promise<WaitingPriceRequest[]> {
  const { data } = await db.from("po_requests").select("request_id, request_number, supplier_id, sales_quotation_id").eq("status", "pending")
  const rows = data || []
  const suppliers = await namesById(db, "suppliers", "supplier_id", "supplier_name", rows.map((r: any) => r.supplier_id))
  const quotationIds = [...new Set(rows.map((r: any) => r.sales_quotation_id).filter(Boolean))]
  const { data: quotations } = quotationIds.length
    ? await db.from("sales_quotations").select("id, quotation_number, customer_name").in("id", quotationIds)
    : { data: [] }
  const byId = new Map((quotations || []).map((q: any) => [q.id, q]))
  return rows.map((r: any) => {
    const quotation: any = byId.get(r.sales_quotation_id)
    return {
      request_id: r.request_id,
      request_number: r.request_number || "",
      quotation_number: quotation?.quotation_number || "",
      customer_name: quotation?.customer_name || "",
      supplier_name: suppliers.get(r.supplier_id) || "",
    }
  })
}

export interface ReportToReview {
  work_order_id: number
  work_order_number: string
  customer_name: string
}

// Maintenance reports sent by shipping (work order on hold) waiting for the sales rep's review.
// Nothing while maintenance is switched off.
export async function loadReportsToReview(db: Db): Promise<ReportToReview[]> {
  if (!isMaintenanceLive()) return []
  const { data } = await db.from("maintenance_work_orders").select("work_order_id, work_order_number, customer_name").eq("status", "on_hold")
  return (data || []).map((w: any) => ({
    work_order_id: w.work_order_id,
    work_order_number: w.work_order_number || "",
    customer_name: w.customer_name || "",
  }))
}

export interface UnappliedPrice {
  request_id: number
  request_number: string
  quotation_id: number
  quotation_number: string
  customer_name: string
  items: { name: string; price: number }[]
}

// Price requests with a supplier price that is not on their (still open) quotation yet.
export async function loadUnappliedPrices(db: Db): Promise<UnappliedPrice[]> {
  const { data: quoted } = await db
    .from("po_requests")
    .select("request_id, request_number, sales_quotation_id, po_request_items(*)")
    .eq("status", "quoted")
    .not("sales_quotation_id", "is", null)
  const quotationIds = [...new Set((quoted || []).map((r: any) => r.sales_quotation_id as number))]
  if (quotationIds.length === 0) return []
  const [{ data: quotations }, { data: converted }, { data: lines }] = await Promise.all([
    db.from("sales_quotations").select("id, quotation_number, customer_name").in("id", quotationIds).in("status", HOLDING_QUOTATION_STATUSES),
    db.from("sales_orders").select("parent_quotation_id").in("parent_quotation_id", quotationIds),
    db.from("sales_quotation_items").select("quotation_id, product_name, unit_cost, item_type").in("quotation_id", quotationIds),
  ])
  const convertedIds = new Set((converted || []).map((o: any) => o.parent_quotation_id))
  const byId = new Map<number, any>((quotations || []).filter((q: any) => !convertedIds.has(q.id)).map((q: any) => [q.id as number, q]))
  const open = new Set(byId.keys())
  return filterUnappliedQuotedRequests((quoted || []) as (QuotedRequest & { request_number: string })[], open, lines || []).map((r) => {
    const quotation: any = byId.get(r.sales_quotation_id as number)
    return {
      request_id: r.request_id,
      request_number: r.request_number || "",
      quotation_id: r.sales_quotation_id as number,
      quotation_number: quotation?.quotation_number || "",
      customer_name: quotation?.customer_name || "",
      items: (r.po_request_items || [])
        .filter((i) => Number(i.unit_price || 0) > 0)
        .map((i) => ({ name: i.product_name || "", price: Number(i.unit_price) })),
    }
  })
}
