// Inventory page, Pending tab (owner decisions, 2026-11-17): an outsourced item purchased for a sales order belongs to
// that order until it is delivered, whether it was received straight to the customer (receipt line without a
// warehouse: no inventory row) or into a warehouse (an inventory row on hold for the order, lib/outsourced-hold.ts).
// It is listed here until a delivery permit carries it (the permit then shows it as pending; once signed the Sold tab
// does). Only a customer return put into a warehouse becomes free stock (On hand).
//
// Per (order, item name), for an open order:
//   in warehouse  = the order's purchased rows left (signed permits already took theirs, lib/dp-stock.ts)
//   straight      = received without a warehouse (capped at the order's quantity of the item) - what signed permits
//                   delivered beyond what they took from the warehouse rows
//   pending       = in warehouse + straight - what live, not yet signed permits carry
import { CLOSED_SO_STATUSES, isPurchasedRow, sameName } from "./outsourced-hold"
import { outsourcedUnitCost } from "./goods-receiving"
import { STOCK_OUT_DP_STATUSES, selectInChunks } from "./stock-hold"
import { parseFromStock } from "./from-stock-line"

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
  /** of `quantity`, what sits in one of our warehouses (the rest goes straight to the customer) */
  inWarehouse: number
  /** sale price per unit (the order line) */
  unitPrice: number
  /** our cost per unit: the purchase order's (landed once its cost is finalized, else the PO line unit price) */
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
  /** inventory rows purchased for the orders (lib/outsourced-hold.ts isPurchasedRow) */
  storedRows?: {
    so_number?: string | null
    outsourced_name?: string | null
    quantity: unknown
    product_id?: unknown
    is_outsourced?: unknown
    is_returned?: unknown
    outsourced_description?: string | null
    unit_cost?: unknown
    supplier_name?: string | null
  }[]
}): DirectPendingItem[] {
  const poItemById = new Map(input.poItems.map((p) => [p.po_item_id, p]))
  const soItem = new Map(input.soItems.map((l) => [l.so_item_id, l]))
  const liveOrders = new Map(input.orders.filter((o) => !CLOSED_SO_STATUSES.includes(o.status)).map((o) => [o.so_id, o]))
  const orderByNumber = new Map([...liveOrders.values()].map((o) => [String(o.so_number), o]))
  const key = (soId: number, name: unknown) => `${soId}\u0000${sameName(name)}`
  const soLineOf = (g: (typeof input.grnLines)[number]) =>
    g.source_so_item_id ?? (g.po_item_id != null ? poItemById.get(g.po_item_id)?.source_so_item_id ?? null : null)

  interface Group { soId: number; firstLine: number; straight: number; receivedIn: number; storedNow: number; poItem?: number; ordered: number; name?: string; rowCost?: number; rowSupplier?: string }
  const groups = new Map<string, Group>()
  const groupOf = (lineId: number) => {
    const l = soItem.get(lineId)!
    const k = key(l.so_id, l.outsourced_name)
    let g = groups.get(k)
    if (!g) {
      g = { soId: l.so_id, firstLine: lineId, straight: 0, receivedIn: 0, storedNow: 0, ordered: 0 }
      for (const other of input.soItems) if (other.so_id === l.so_id && !other.product_id && sameName(other.outsourced_name) === sameName(l.outsourced_name)) g.ordered += num(other.quantity)
      groups.set(k, g)
    }
    g.firstLine = Math.min(g.firstLine, lineId)
    return g
  }
  for (const r of input.grnLines) {
    if (r.item_type && r.item_type !== "outsourced") continue
    const line = soLineOf(r)
    if (line == null || !soItem.has(line) || soItem.get(line)!.product_id || !liveOrders.has(soItem.get(line)!.so_id)) continue
    const g = groupOf(line)
    if (r.warehouse_id === null || r.warehouse_id === undefined) g.straight += num(r.quantity_received)
    else g.receivedIn += num(r.quantity_received)
    if (r.po_item_id != null && g.poItem === undefined) g.poItem = r.po_item_id
  }
  for (const row of input.storedRows || []) {
    if (!isPurchasedRow(row) || !row.so_number) continue
    const order = orderByNumber.get(String(row.so_number))
    if (!order) continue
    let g = groups.get(key(order.so_id, row.outsourced_name))
    if (!g) {
      // the order's line was removed or renamed: the item is still the order's (held), so it is still listed
      g = { soId: order.so_id, firstLine: 0, straight: 0, receivedIn: 0, storedNow: 0, ordered: 0, name: row.outsourced_name || "Outsourced Item" }
      groups.set(key(order.so_id, row.outsourced_name), g)
    }
    g.storedNow += Math.max(0, num(row.quantity))
    // the row's own cost / supplier (set from its PO at receipt and on finalize) when no receipt line names the PO
    if (g.rowCost === undefined) g.rowCost = num((row as any).unit_cost)
    if (!g.rowSupplier) g.rowSupplier = (row as any).supplier_name || undefined
  }

  const signed = new Map<string, number>()
  const live = new Map<string, number>()
  const permitById = new Map(input.permits.map((p) => [p.permit_id, p]))
  for (const i of input.permitItems) {
    const p = permitById.get(i.permit_id)
    if (!p || i.product_id || DEAD_DP_STATUSES.includes(p.status) || !liveOrders.has(p.sales_order_id)) continue
    const target = STOCK_OUT_DP_STATUSES.includes(p.status) ? signed : live
    const k = key(p.sales_order_id, i.item_name_snapshot)
    target.set(k, (target.get(k) || 0) + num(i.quantity))
  }

  const out: DirectPendingItem[] = []
  for (const [k, g] of [...groups].sort((a, b) => a[1].firstLine - b[1].firstLine)) {
    const order = liveOrders.get(g.soId)!
    const line = soItem.get(g.firstLine) || { outsourced_name: g.name, unit_price: 0 }
    const takenFromWarehouse = Math.max(0, g.receivedIn - g.storedNow)
    const straightDelivered = Math.max(0, (signed.get(k) || 0) - takenFromWarehouse)
    const straight = Math.max(0, Math.min(g.straight, g.ordered) - straightDelivered)
    const total = g.storedNow + straight
    const pending = Math.max(0, total - (live.get(k) || 0))
    if (pending <= 0) continue
    const poItem = g.poItem !== undefined ? poItemById.get(g.poItem) : undefined
    const po = poItem ? input.pos.find((p) => p.po_id === poItem.po_id) : undefined
    out.push({
      id: `pending-${g.firstLine || k}`,
      soItemId: g.firstLine,
      soId: g.soId,
      soNumber: String(order.so_number),
      customerId: order.customer_id ?? null,
      customerName: input.customers.find((c) => c.customer_id === order.customer_id)?.customer_name ?? null,
      name: line.outsourced_name || "Outsourced Item",
      quantity: pending,
      inWarehouse: Math.min(pending, g.storedNow),
      unitPrice: num(line.unit_price),
      unitCost: poItem ? outsourcedUnitCost(poItem, !!po?.cost_finalized) : g.rowCost ?? 0,
      supplierName: (po?.supplier_id ? input.suppliers.find((s) => s.supplier_id === po.supplier_id)?.supplier_name : null) ?? g.rowSupplier ?? null,
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
  const poItemIds = [...new Set(grnLines.map((g: any) => g.po_item_id).filter((v: any) => v != null))]
  const poItems = poItemIds.length
    ? await selectInChunks(poItemIds, (c) => db.from("purchase_order_items").select("po_item_id, po_id, quantity, unit_price, landed_cost, source_so_item_id").in("po_item_id", c), "load PO lines")
    : []
  const poIds = [...new Set(poItems.map((p: any) => p.po_id))]
  const pos = poIds.length ? await selectInChunks(poIds, (c) => db.from("purchase_orders").select("po_id, po_number, supplier_id, cost_finalized").in("po_id", c), "load POs") : []
  const supplierIds = [...new Set(pos.map((p: any) => p.supplier_id).filter(Boolean))]
  const suppliers = supplierIds.length ? must(await db.from("suppliers").select("supplier_id, supplier_name").in("supplier_id", supplierIds), "load suppliers") : []
  const lineIds = [...new Set([...grnLines.map((g: any) => g.source_so_item_id), ...poItems.map((p: any) => p.source_so_item_id)].filter((v: any) => v != null))]
  const firstLines = lineIds.length
    ? await selectInChunks(lineIds, (c) => db.from("sales_order_items").select("so_item_id, so_id").in("so_item_id", c), "load order lines")
    : []
  // purchased rows still in a warehouse (their order's line may be gone): their orders count too
  const storedRows = must(
    await db
      .from("inventory")
      .select("inventory_id, product_id, quantity, unit_cost, supplier_name, is_outsourced, is_returned, outsourced_name, outsourced_description, so_number")
      .eq("is_outsourced", true)
      .eq("is_returned", false)
      .like("outsourced_description", "Received on %"),
    "load purchased rows",
  )
  const rowNumbers = [...new Set(storedRows.filter((r: any) => r.so_number && Number(r.quantity) > 0).map((r: any) => String(r.so_number)))]
  const byNumber = rowNumbers.length
    ? await selectInChunks(rowNumbers, (c) => db.from("sales_orders").select("so_id").in("so_number", c), "load orders of purchased rows")
    : []
  const soIds = [...new Set([...firstLines.map((l: any) => l.so_id), ...byNumber.map((o: any) => o.so_id)])]
  if (soIds.length === 0) return []
  // every line of those orders (an item can be on several lines)
  const soItems = await selectInChunks(soIds, (c) => db.from("sales_order_items").select("so_item_id, so_id, quantity, unit_price, outsourced_name, product_id").in("so_id", c), "load order lines")
  const orders = await selectInChunks(soIds, (c) => db.from("sales_orders").select("so_id, so_number, status, customer_id").in("so_id", c), "load orders")
  const customerIds = [...new Set(orders.map((o: any) => o.customer_id).filter(Boolean))]
  const customers = customerIds.length ? must(await db.from("customers").select("customer_id, customer_name").in("customer_id", customerIds), "load customers") : []
  const permits = await selectInChunks(soIds, (c) => db.from("delivery_permits").select("permit_id, sales_order_id, status").in("sales_order_id", c), "load permits")
  const permitItems = permits.length
    ? await selectInChunks(permits.map((p: any) => p.permit_id), (c) => db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", c), "load permit items")
    : []
  return computeDirectPending({ grnLines, poItems, pos, suppliers, soItems, orders, customers, permits, permitItems, storedRows })
}

export interface OutsourcedLineCost {
  soId: number
  soItemId: number
  name: string
  /** per unit, from the purchase order (landed once finalized, else the PO line unit price); null = no PO yet */
  unitCost: number | null
  supplierName: string | null
}

/**
 * Our cost of each outsourced sales-order line (owner decision, 2026-11-17: from the PURCHASE ORDER, not the order's
 * cost estimate): the quantity-weighted cost of the PO lines bought for it (rejected POs left out). A line taken from
 * stock costs what its reserved inventory row costs (that row's cost came from its own PO).
 */
export function computeOutsourcedLineCosts(input: {
  soItems: { so_item_id: number; so_id: number; outsourced_name?: string | null; outsourced_description?: string | null; product_id?: unknown }[]
  poItems: { po_item_id: number; po_id: number; quantity: unknown; unit_price: unknown; landed_cost?: unknown; source_so_item_id?: number | null }[]
  pos: { po_id: number; status?: string | null; supplier_id?: number | null; cost_finalized?: boolean | null }[]
  suppliers: { supplier_id: number; supplier_name: string }[]
  reservedRows: { inventory_id: number; unit_cost?: unknown; supplier_name?: string | null }[]
}): OutsourcedLineCost[] {
  const out: OutsourcedLineCost[] = []
  for (const line of input.soItems) {
    if (line.product_id) continue
    const marker = parseFromStock(line.outsourced_description)
    let unitCost: number | null = null
    let supplierName: string | null = null
    if (marker) {
      const row = input.reservedRows.find((r) => r.inventory_id === marker.reservedId)
      if (row) {
        unitCost = num(row.unit_cost)
        supplierName = row.supplier_name ?? null
      }
    } else {
      const poOf = (p: { po_id: number }) => input.pos.find((po) => po.po_id === p.po_id)
      const bought = input.poItems.filter((p) => p.source_so_item_id === line.so_item_id && poOf(p)?.status !== "rejected")
      if (bought.length > 0) {
        const cost = (p: (typeof bought)[number]) => outsourcedUnitCost(p, !!poOf(p)?.cost_finalized)
        const qty = bought.reduce((s, p) => s + num(p.quantity), 0)
        unitCost = qty > 0 ? Math.round((bought.reduce((s, p) => s + num(p.quantity) * cost(p), 0) / qty) * 100) / 100 : cost(bought[0])
        const po = poOf(bought[bought.length - 1])
        supplierName = po?.supplier_id ? input.suppliers.find((s) => s.supplier_id === po.supplier_id)?.supplier_name ?? null : null
      }
    }
    out.push({ soId: line.so_id, soItemId: line.so_item_id, name: line.outsourced_name || "", unitCost, supplierName })
  }
  return out
}

/** Loads computeOutsourcedLineCosts' inputs for every outsourced sales-order line. Throws on query errors. */
export async function loadOutsourcedLineCosts(db: Db): Promise<OutsourcedLineCost[]> {
  const soItems = must(
    await db.from("sales_order_items").select("so_item_id, so_id, outsourced_name, outsourced_description, product_id").eq("item_type", "outsourced"),
    "load outsourced order lines",
  )
  if (soItems.length === 0) return []
  const poItems = await selectInChunks(
    soItems.map((l: any) => l.so_item_id),
    (c) => db.from("purchase_order_items").select("po_item_id, po_id, quantity, unit_price, landed_cost, source_so_item_id").in("source_so_item_id", c),
    "load PO lines",
  )
  const poIds = [...new Set(poItems.map((p: any) => p.po_id))]
  const pos = poIds.length ? await selectInChunks(poIds, (c) => db.from("purchase_orders").select("po_id, status, supplier_id, cost_finalized").in("po_id", c), "load POs") : []
  const supplierIds = [...new Set(pos.map((p: any) => p.supplier_id).filter(Boolean))]
  const suppliers = supplierIds.length ? must(await db.from("suppliers").select("supplier_id, supplier_name").in("supplier_id", supplierIds), "load suppliers") : []
  const reservedIds = [...new Set(soItems.map((l: any) => parseFromStock(l.outsourced_description)?.reservedId).filter((v: any) => v != null))]
  const reservedRows = reservedIds.length
    ? await selectInChunks(reservedIds, (c) => db.from("inventory").select("inventory_id, unit_cost, supplier_name").in("inventory_id", c), "load reserved rows")
    : []
  return computeOutsourcedLineCosts({ soItems, poItems, pos, suppliers, reservedRows })
}
