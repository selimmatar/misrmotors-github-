// Inventory page, Pending tab (owner, 2026-11-17): outsourced items received for a sales order WITHOUT a warehouse
// (lib/goods-receiving.ts: such a receipt line has warehouse_id null) go straight to that customer. They are not
// inventory rows, so they are not On hand; they are pending for their order until a delivery permit takes them
// (then the permit shows them as pending, and once signed the Sold tab does).
//
// Per sales order line: pending = min(received straight, the line's quantity: a lowered or removed line needs no
// more) - what the order's live permits carry of that name beyond what was received into a warehouse for the order.
import { CLOSED_SO_STATUSES, sameName } from "./outsourced-hold"
import { outsourcedUnitCost } from "./goods-receiving"
import { selectInChunks } from "./stock-hold"

type Db = any
const num = (v: unknown) => Number(v) || 0
const must = (result: any, what: string): any[] => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}

/** Delivery-permit statuses that no longer carry anything. */
const DEAD_DP_STATUSES = ["REJECTED"]

export interface DirectPendingItem {
  id: string
  soItemId: number
  soId: number
  soNumber: string
  customerId: number | null
  customerName: string | null
  name: string
  quantity: number
  /** sale price per unit (the order line) */
  unitPrice: number
  /** our cost per unit (the PO line: landed once the PO's cost is finalized) */
  unitCost: number
  supplierName: string | null
  poNumber: string | null
}

export function computeDirectPending(input: {
  grnLines: { po_item_id: number | null; source_so_item_id: number | null; quantity_received: unknown; warehouse_id: unknown; item_type?: string | null }[]
  poItems: { po_item_id: number; po_id: number; quantity: unknown; unit_price: unknown; landed_cost?: unknown; source_so_item_id?: number | null }[]
  pos: { po_id: number; po_number: string; supplier_id?: number | null; cost_finalized?: boolean | null }[]
  suppliers: { supplier_id: number; supplier_name: string }[]
  soItems: { so_item_id: number; so_id: number; quantity: unknown; unit_price?: unknown; outsourced_name?: string | null; product_id?: unknown }[]
  orders: { so_id: number; so_number: string; status: string; customer_id?: number | null }[]
  customers: { customer_id: number; customer_name: string }[]
  permits: { permit_id: number; sales_order_id: number; status: string }[]
  permitItems: { permit_id: number; product_id?: unknown; item_name_snapshot?: string | null; quantity: unknown }[]
}): DirectPendingItem[] {
  const poItemById = new Map(input.poItems.map((p) => [p.po_item_id, p]))
  const soLineOf = (g: (typeof input.grnLines)[number]) => g.source_so_item_id ?? (g.po_item_id != null ? poItemById.get(g.po_item_id)?.source_so_item_id ?? null : null)
  const direct = new Map<number, number>()
  const directPoItem = new Map<number, number>()
  const stored = new Map<string, number>() // (so, name) received into a warehouse
  const soItem = new Map(input.soItems.map((l) => [l.so_item_id, l]))
  const key = (soId: number, name: unknown) => `${soId}\u0000${sameName(name)}`
  for (const g of input.grnLines) {
    if (g.item_type && g.item_type !== "outsourced") continue
    const line = soLineOf(g)
    if (line == null || !soItem.has(line)) continue
    if (g.warehouse_id === null || g.warehouse_id === undefined) {
      direct.set(line, (direct.get(line) || 0) + num(g.quantity_received))
      if (g.po_item_id != null) directPoItem.set(line, g.po_item_id)
    } else {
      const l = soItem.get(line)!
      stored.set(key(l.so_id, l.outsourced_name), (stored.get(key(l.so_id, l.outsourced_name)) || 0) + num(g.quantity_received))
    }
  }
  const liveOrders = new Map(input.orders.filter((o) => !CLOSED_SO_STATUSES.includes(o.status)).map((o) => [o.so_id, o]))
  const permitSo = new Map<number, number>()
  for (const p of input.permits) if (!DEAD_DP_STATUSES.includes(p.status) && liveOrders.has(p.sales_order_id)) permitSo.set(p.permit_id, p.sales_order_id)
  const onDp = new Map<string, number>()
  for (const i of input.permitItems) {
    const soId = permitSo.get(i.permit_id)
    if (soId === undefined || i.product_id) continue
    onDp.set(key(soId, i.item_name_snapshot), (onDp.get(key(soId, i.item_name_snapshot)) || 0) + num(i.quantity))
  }
  // what the permits carry beyond the warehouse stock comes off the straight-to-customer quantity, first lines first
  const covered = new Map<string, number>()
  for (const [k, q] of onDp) covered.set(k, Math.max(0, q - (stored.get(k) || 0)))

  const out: DirectPendingItem[] = []
  for (const [lineId, received] of [...direct].sort((a, b) => a[0] - b[0])) {
    const line = soItem.get(lineId)!
    const order = liveOrders.get(line.so_id)
    if (!order || line.product_id) continue
    const k = key(line.so_id, line.outsourced_name)
    let pending = Math.min(received, num(line.quantity))
    const c = covered.get(k) || 0
    const off = Math.min(c, pending)
    covered.set(k, c - off)
    pending -= off
    if (pending <= 0) continue
    const poItem = poItemById.get(directPoItem.get(lineId) ?? -1)
    const po = poItem ? input.pos.find((p) => p.po_id === poItem.po_id) : undefined
    out.push({
      id: `direct-${lineId}`,
      soItemId: lineId,
      soId: line.so_id,
      soNumber: String(order.so_number),
      customerId: order.customer_id ?? null,
      customerName: input.customers.find((c) => c.customer_id === order.customer_id)?.customer_name ?? null,
      name: line.outsourced_name || "Outsourced Item",
      quantity: pending,
      unitPrice: num(line.unit_price),
      unitCost: poItem ? outsourcedUnitCost(poItem, !!po?.cost_finalized) : 0,
      supplierName: po?.supplier_id ? input.suppliers.find((s) => s.supplier_id === po.supplier_id)?.supplier_name ?? null : null,
      poNumber: po?.po_number ?? null,
    })
  }
  return out
}

/** Loads computeDirectPending's inputs. Throws on query errors. */
export async function loadDirectPending(db: Db): Promise<DirectPendingItem[]> {
  const grnLines = must(
    await db.from("goods_receipt_lines").select("po_item_id, source_so_item_id, quantity_received, warehouse_id, item_type").eq("item_type", "outsourced"),
    "load outsourced receipt lines",
  )
  if (!grnLines.some((g: any) => g.warehouse_id === null || g.warehouse_id === undefined)) return []
  const poItemIds = [...new Set(grnLines.map((g: any) => g.po_item_id).filter((v: any) => v != null))]
  const poItems = poItemIds.length
    ? await selectInChunks(poItemIds, (c) => db.from("purchase_order_items").select("po_item_id, po_id, quantity, unit_price, landed_cost, source_so_item_id").in("po_item_id", c), "load PO lines")
    : []
  const poIds = [...new Set(poItems.map((p: any) => p.po_id))]
  const pos = poIds.length ? await selectInChunks(poIds, (c) => db.from("purchase_orders").select("po_id, po_number, supplier_id, cost_finalized").in("po_id", c), "load POs") : []
  const supplierIds = [...new Set(pos.map((p: any) => p.supplier_id).filter(Boolean))]
  const suppliers = supplierIds.length ? must(await db.from("suppliers").select("supplier_id, supplier_name").in("supplier_id", supplierIds), "load suppliers") : []
  const soItemIds = [
    ...new Set([...grnLines.map((g: any) => g.source_so_item_id), ...poItems.map((p: any) => p.source_so_item_id)].filter((v: any) => v != null)),
  ]
  const soItems = soItemIds.length
    ? await selectInChunks(soItemIds, (c) => db.from("sales_order_items").select("so_item_id, so_id, quantity, unit_price, outsourced_name, product_id").in("so_item_id", c), "load order lines")
    : []
  const soIds = [...new Set(soItems.map((l: any) => l.so_id))]
  const orders = soIds.length ? await selectInChunks(soIds, (c) => db.from("sales_orders").select("so_id, so_number, status, customer_id").in("so_id", c), "load orders") : []
  const customerIds = [...new Set(orders.map((o: any) => o.customer_id).filter(Boolean))]
  const customers = customerIds.length ? must(await db.from("customers").select("customer_id, customer_name").in("customer_id", customerIds), "load customers") : []
  const permits = soIds.length
    ? await selectInChunks(soIds, (c) => db.from("delivery_permits").select("permit_id, sales_order_id, status").in("sales_order_id", c), "load permits")
    : []
  const permitItems = permits.length
    ? await selectInChunks(permits.map((p: any) => p.permit_id), (c) => db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", c), "load permit items")
    : []
  return computeDirectPending({ grnLines, poItems, pos, suppliers, soItems, orders, customers, permits, permitItems })
}
