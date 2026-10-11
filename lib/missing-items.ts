// Missing Items report data (Batch 3). One function loads every source separately and a pure function combines them,
// so quantities can never be multiplied by a join: SO lines, delivery permits, returns, purchase orders and goods
// receipts are each read with their own query and aggregated on their own before being matched to the SO lines.
//
// Definitions (approved for Batch 3):
//   Ordered        SO line quantity
//   Delivered      quantity on delivery permits that count as delivered (DP_DELIVERED_STATUSES from
//                  lib/delivery-status.ts - the same rule that decides whether an SO is "delivered"). DRAFT, REJECTED
//                  and not-yet-delivered permits never count.
//   Out for delivery  quantity on permits whose status is exactly OUT_FOR_DELIVERY (shown on its own: neither delivered
//                  nor missing). Returns filed against such a permit (Batch 2 allows them) come off this column.
//   Returned       valid (non-rejected) returns against the delivered permits (Batch 2: lib/return-lines.ts)
//   Net delivered  max(0, Delivered - Returned)
//   Missing        max(0, Ordered - Net delivered - Out for delivery)   <- the customer-fulfilment view, nothing else
//   PO ordered     sum of quantities of this line's PO lines whose purchase order is not rejected
//   Received       sum of goods_receipt_lines.quantity_received for this line. For a STOCK line it is at least the
//                  stock cover (below): goods already in our warehouse count as received, not missing.
//   In stock       stock cover of a stock line: min(still to deliver, what the warehouse can give this order), where
//                  that is on-hand (non-returned rows) minus what OTHER holding orders hold (lib/stock-hold.ts), shared
//                  between this order's lines of one product in so_item_id order. Missing = still to deliver - In stock.
//                  On hold = the order is in a holding status (accountant approved onwards) and some stock covers it.
//   In progress    informational: quantity on other live permits (e.g. READY_FOR_PICKUP, PRINTED); not subtracted
//   Unit cost      1) PO landed cost per unit, quantity-weighted over the line's non-rejected PO lines
//                     = sum(landed_cost of the lines) / sum(quantity of those lines)   (purchase_order_items.landed_cost
//                     is the LINE total - item total + allocated tax/overhead - so it is divided by the quantity;
//                     lines whose landed cost is not set, i.e. <= 0, are ignored, never treated as free)
//                  2) products.last_landed_cost
//                  3) inventory.unit_cost of the product's non-returned rows, weighted by on-hand quantity
//                     (plain average when nothing is on hand)
//                  4) PO unit price (purchase_order_items.unit_price, the supplier's price - not a landed cost), quantity-weighted
//                     over the line's non-rejected PO lines and labelled "PO Price" on the report
//                  5) null -> printed as n/a. The selling price is never used.
import { DP_DELIVERED_STATUSES } from "./delivery-status"
import { HOLDING_SO_STATUSES, loadHeldByProduct } from "./stock-hold"

/** The one permit status that means "left the warehouse, not yet signed for". */
export const DP_OUT_FOR_DELIVERY_STATUS = "OUT_FOR_DELIVERY"
import { lineKey, loadReturnLines, type ReturnLine } from "./return-lines"

type Db = any // supabase-js client (or a test double)

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const must = (result: any, what: string): any[] => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}

/** Permit statuses that are neither delivered nor dead: goods are being prepared or are on the road. */
export const DP_DEAD_STATUSES = ["DRAFT", "REJECTED"]

export interface MissingSoLine {
  so_item_id: number
  product_id: number | null
  item_type: string | null
  outsourced_name: string | null
  outsourced_description: string | null
  quantity: number
  unit_price: number
}
export interface MissingDpItem {
  permit_id: number
  product_id: number | null
  item_name_snapshot: string | null
  quantity: number
}
export interface MissingPoLine {
  po_item_id: number
  po_id: number
  source_so_item_id: number
  quantity: number
  landed_cost: number
  unit_price?: number
}
export interface MissingPo {
  po_id: number
  po_number: string
  status: string
}
export interface MissingGrnLine {
  line_id: number
  po_item_id: number | null
  source_so_item_id: number | null
  quantity_received: number
}

export interface MissingItemRow {
  soItemId: number
  name: string
  sku: string
  isOutsourced: boolean
  supplierName: string
  ordered: number
  outForDelivery: number
  delivered: number
  returned: number
  netDelivered: number
  missing: number
  inProgress: number
  poOrdered: number
  received: number
  /** stock cover of a stock line (0 for outsourced lines) */
  inStock: number
  /** the order holds this line's stock (accountant approved onwards) */
  onHold: boolean
  poLabels: string[]
  rejectedPoLabels: string[]
  procurementStatus: string
  /** null = n/a */
  unitCost: number | null
  costSource: "po" | "product" | "inventory" | "po_price" | null
}

export interface MissingItemsInput {
  soLines: MissingSoLine[]
  products: Map<number, { name: string; sku: string; lastLandedCost: number | null }>
  /** non-returned inventory rows per product id */
  inventory: Map<number, { quantity: number; unit_cost: number }[]>
  permits: { permit_id: number; status: string }[]
  dpItems: MissingDpItem[]
  returns: ReturnLine[]
  poLines: MissingPoLine[]
  pos: Map<number, MissingPo>
  grnLines: MissingGrnLine[]
  /** what the warehouse can give this order per product: on-hand minus other holding orders' holds (absent = none) */
  stockAvailable?: Map<number, number>
  /** this order's status holds stock (HOLDING_SO_STATUSES) */
  holding?: boolean
}

const keyOfSoLine = (l: MissingSoLine) => lineKey(l.product_id, l.outsourced_name)
const keyOfDpItem = (i: MissingDpItem) => lineKey(i.product_id, i.item_name_snapshot)

/**
 * Hands a per-key total out to the SO lines that share that key, in so_item_id order, each line taking at most its
 * ordered quantity (the last line of a key takes whatever is left). This stops two lines for the same product from
 * each being credited with the full total.
 */
function allocate(lines: MissingSoLine[], totals: Map<string, number>): Map<number, number> {
  const left = new Map(totals)
  const lastOfKey = new Map<string, number>()
  for (const l of lines) lastOfKey.set(keyOfSoLine(l), l.so_item_id)
  const out = new Map<number, number>()
  for (const l of lines) {
    const key = keyOfSoLine(l)
    const have = Math.max(0, left.get(key) || 0)
    const take = lastOfKey.get(key) === l.so_item_id ? have : Math.min(have, num(l.quantity))
    left.set(key, have - take)
    out.set(l.so_item_id, take)
  }
  return out
}

export function buildMissingItems(input: MissingItemsInput): MissingItemRow[] {
  const lines = [...input.soLines].sort((a, b) => a.so_item_id - b.so_item_id)
  const statusOf = new Map(input.permits.map((p) => [p.permit_id, p.status]))

  // 1. delivered / in-progress quantity per line key (each DP item counted once)
  const deliveredByKey = new Map<string, number>()
  const inProgressByKey = new Map<string, number>()
  const outByKey = new Map<string, number>()
  for (const item of input.dpItems) {
    const status = statusOf.get(item.permit_id)
    if (!status || DP_DEAD_STATUSES.includes(status)) continue
    const target = DP_DELIVERED_STATUSES.includes(status) ? deliveredByKey : status === DP_OUT_FOR_DELIVERY_STATUS ? outByKey : inProgressByKey
    const key = keyOfDpItem(item)
    target.set(key, (target.get(key) || 0) + num(item.quantity))
  }
  // 2. returned quantity per key (returns on delivered permits only - the permits Delivered is counted from)
  const deliveredPermitIds = new Set(input.permits.filter((p) => DP_DELIVERED_STATUSES.includes(p.status)).map((p) => p.permit_id))
  const outPermitIds = new Set(input.permits.filter((p) => p.status === DP_OUT_FOR_DELIVERY_STATUS).map((p) => p.permit_id))
  const returnedByKeyMap = new Map<string, number>()
  const returnedOutByKey = new Map<string, number>()
  for (const r of input.returns) {
    if (deliveredPermitIds.has(r.permit_id)) returnedByKeyMap.set(r.key, (returnedByKeyMap.get(r.key) || 0) + r.quantity)
    else if (outPermitIds.has(r.permit_id)) returnedOutByKey.set(r.key, (returnedOutByKey.get(r.key) || 0) + r.quantity)
  }

  const delivered = allocate(lines, deliveredByKey)
  // a line cannot be credited with more returned units than it was delivered
  const returnedAlloc = new Map<number, number>()
  const retLeft = new Map(returnedByKeyMap)
  for (const l of lines) {
    const key = keyOfSoLine(l)
    const take = Math.min(retLeft.get(key) || 0, delivered.get(l.so_item_id) || 0)
    retLeft.set(key, (retLeft.get(key) || 0) - take)
    returnedAlloc.set(l.so_item_id, take)
  }
  const inProgress = allocate(lines, inProgressByKey)
  // out for delivery, net of returns filed against those permits
  const outAlloc = allocate(lines, outByKey)
  const outLeft = new Map(returnedOutByKey)
  const outNet = new Map<number, number>()
  for (const l of lines) {
    const key = keyOfSoLine(l)
    const gross = outAlloc.get(l.so_item_id) || 0
    const take = Math.min(outLeft.get(key) || 0, gross)
    outLeft.set(key, (outLeft.get(key) || 0) - take)
    outNet.set(l.so_item_id, gross - take)
  }

  // 3. purchase orders: only non-rejected POs; each line is matched through its own source_so_item_id
  const poLinesBySo = new Map<number, MissingPoLine[]>()
  for (const pl of input.poLines) poLinesBySo.set(pl.source_so_item_id, [...(poLinesBySo.get(pl.source_so_item_id) || []), pl])
  // 4. goods receipts: a receipt line belongs to an SO line directly, or through its PO line; counted once by line_id
  const poItemToSo = new Map(input.poLines.map((pl) => [pl.po_item_id, pl.source_so_item_id]))
  const receivedBySo = new Map<number, number>()
  const seenGrn = new Set<number>()
  for (const g of input.grnLines) {
    if (seenGrn.has(g.line_id)) continue
    seenGrn.add(g.line_id)
    const soItem = g.source_so_item_id ?? (g.po_item_id != null ? poItemToSo.get(g.po_item_id) : undefined)
    if (soItem == null) continue
    receivedBySo.set(soItem, (receivedBySo.get(soItem) || 0) + num(g.quantity_received))
  }

  const stockLeft = new Map(input.stockAvailable || [])
  return lines.map((line) => {
    const isOutsourced = line.item_type === "outsourced"
    const product = line.product_id ? input.products.get(line.product_id) : undefined
    const ordered = num(line.quantity)
    const deliveredQty = delivered.get(line.so_item_id) || 0
    const returnedQty = returnedAlloc.get(line.so_item_id) || 0
    const netDelivered = Math.max(0, deliveredQty - returnedQty)
    const outQty = outNet.get(line.so_item_id) || 0

    const allPoLines = poLinesBySo.get(line.so_item_id) || []
    const activePoLines = allPoLines.filter((pl) => {
      const po = input.pos.get(pl.po_id)
      return po !== undefined && po.status !== "rejected"
    })
    const rejectedPoLines = allPoLines.filter((pl) => input.pos.get(pl.po_id)?.status === "rejected")
    const label = (pl: MissingPoLine) => `${input.pos.get(pl.po_id)?.po_number} (${num(pl.quantity)}, ${input.pos.get(pl.po_id)?.status})`
    const poOrdered = activePoLines.reduce((sum, pl) => sum + num(pl.quantity), 0)

    // unit cost
    let unitCost: number | null = null
    let costSource: MissingItemRow["costSource"] = null
    const costed = activePoLines.filter((pl) => num(pl.landed_cost) > 0 && num(pl.quantity) > 0)
    const costedQty = costed.reduce((s, pl) => s + num(pl.quantity), 0)
    if (costedQty > 0) {
      unitCost = costed.reduce((s, pl) => s + num(pl.landed_cost), 0) / costedQty
      costSource = "po"
    } else if (product && product.lastLandedCost !== null && num(product.lastLandedCost) > 0) {
      unitCost = num(product.lastLandedCost)
      costSource = "product"
    } else if (line.product_id) {
      const rows = (input.inventory.get(line.product_id) || []).filter((r) => num(r.unit_cost) > 0)
      const onHand = rows.reduce((s, r) => s + Math.max(0, num(r.quantity)), 0)
      if (rows.length > 0) {
        unitCost = onHand > 0 ? rows.reduce((s, r) => s + Math.max(0, num(r.quantity)) * num(r.unit_cost), 0) / onHand : rows.reduce((s, r) => s + num(r.unit_cost), 0) / rows.length
        costSource = "inventory"
      }
    }
    if (unitCost === null) {
      // last resort: what the supplier charges per unit on the line's active POs, weighted by quantity (never summed)
      const priced = activePoLines.filter((pl) => num(pl.unit_price) > 0 && num(pl.quantity) > 0)
      const pricedQty = priced.reduce((s, pl) => s + num(pl.quantity), 0)
      if (pricedQty > 0) {
        unitCost = priced.reduce((s, pl) => s + num(pl.quantity) * num(pl.unit_price), 0) / pricedQty
        costSource = "po_price"
      }
    }

    const toDeliver = Math.max(0, ordered - netDelivered - outQty)
    let inStock = 0
    if (!isOutsourced && line.product_id) {
      const have = Math.max(0, stockLeft.get(line.product_id) || 0)
      inStock = Math.min(have, toDeliver)
      stockLeft.set(line.product_id, have - inStock)
    }
    const onHold = Boolean(input.holding) && inStock > 0
    const received = Math.max(receivedBySo.get(line.so_item_id) || 0, inStock)
    let procurementStatus: string
    if (!isOutsourced && allPoLines.length === 0) {
      const short = toDeliver - inStock
      if (inStock > 0 && short <= 0) procurementStatus = onHold ? "On Hold — In Stock" : "In Stock — No PO Needed"
      else if (inStock > 0) procurementStatus = `${onHold ? "On Hold" : "In stock"} ${inStock}/${toDeliver} — Needs PO for ${short}`
      else procurementStatus = "Stock Item — No PO Needed"
    }
    else if (activePoLines.length > 0) {
      const cover = poOrdered >= ordered ? "Ordered" : "Partially ordered"
      procurementStatus = `${cover} ${poOrdered}/${ordered} — ${activePoLines.map(label).join(", ")}`
    } else if (rejectedPoLines.length > 0) procurementStatus = `Rejected PO — Needs Reorder (${rejectedPoLines.map(label).join(", ")})`
    else procurementStatus = "Not Ordered — Needs PO"

    // Receipts above what was ordered are real data (e.g. a receipt entered twice): show them, but say so
    if (received > poOrdered && poOrdered > 0) procurementStatus += ` ⚠ received ${received} > PO ${poOrdered}`

    const supplierMatch = (line.outsourced_description || "").match(/Supplier:\s*([^|]+)/)
    return {
      soItemId: line.so_item_id,
      name: isOutsourced ? line.outsourced_name || "Unnamed item" : product?.name || `Product #${line.product_id}`,
      sku: isOutsourced ? "-" : product?.sku || "-",
      isOutsourced,
      supplierName: isOutsourced && supplierMatch ? supplierMatch[1].trim() : "-",
      ordered,
      outForDelivery: outQty,
      delivered: deliveredQty,
      returned: returnedQty,
      netDelivered,
      missing: toDeliver - inStock,
      inProgress: inProgress.get(line.so_item_id) || 0,
      poOrdered,
      received,
      inStock,
      onHold,
      poLabels: activePoLines.map(label),
      rejectedPoLabels: rejectedPoLines.map(label),
      procurementStatus,
      unitCost: unitCost === null ? null : Math.round(unitCost * 100) / 100,
      costSource,
    }
  })
}

export interface MissingItemsReport {
  so: { so_id: number; so_number: string; order_date: string | null; delivery_date: string | null; status: string; customerName: string }
  permitCount: number
  rows: MissingItemRow[]
}

/** Loads everything for one sales order. Returns null when the order does not exist; throws on query errors. */
export async function loadMissingItems(db: Db, soId: number): Promise<MissingItemsReport | null> {
  const soRes = await db.from("sales_orders").select("so_id, so_number, order_date, delivery_date, status, customer_id").eq("so_id", soId).maybeSingle()
  if (soRes.error) throw new Error(`load sales order: ${soRes.error.message}`)
  const so = soRes.data
  if (!so) return null

  let customerName = "-"
  if (so.customer_id) {
    const c = await db.from("customers").select("customer_name").eq("customer_id", so.customer_id).maybeSingle()
    if (c.error) throw new Error(`load customer: ${c.error.message}`)
    customerName = c.data?.customer_name || "-"
  }

  const soLines = must(
    await db.from("sales_order_items").select("so_item_id, product_id, quantity, unit_price, item_type, outsourced_name, outsourced_description").eq("so_id", soId).order("so_item_id", { ascending: true }),
    "load sales order items",
  ).map((l) => ({ ...l, quantity: num(l.quantity), unit_price: num(l.unit_price) })) as MissingSoLine[]
  const soItemIds = soLines.map((l) => l.so_item_id)
  const productIds = [...new Set(soLines.filter((l) => l.product_id).map((l) => l.product_id as number))]

  const products = new Map<number, { name: string; sku: string; lastLandedCost: number | null }>()
  const inventory = new Map<number, { quantity: number; unit_cost: number }[]>()
  if (productIds.length > 0) {
    for (const p of must(await db.from("products").select("product_id, product_name, sku, last_landed_cost").in("product_id", productIds), "load products")) {
      products.set(p.product_id, { name: p.product_name, sku: p.sku, lastLandedCost: p.last_landed_cost === null || p.last_landed_cost === undefined ? null : num(p.last_landed_cost) })
    }
    for (const r of must(await db.from("inventory").select("product_id, quantity, unit_cost, is_returned").in("product_id", productIds), "load inventory")) {
      if (r.is_returned) continue
      inventory.set(r.product_id, [...(inventory.get(r.product_id) || []), { quantity: num(r.quantity), unit_cost: num(r.unit_cost) }])
    }
  }

  const permits = must(await db.from("delivery_permits").select("permit_id, status").eq("sales_order_id", soId), "load delivery permits") as { permit_id: number; status: string }[]
  const livePermitIds = permits.filter((p) => !DP_DEAD_STATUSES.includes(p.status)).map((p) => p.permit_id)
  const dpItems = livePermitIds.length
    ? (must(await db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity").in("permit_id", livePermitIds), "load delivery permit items") as MissingDpItem[])
    : []
  const returnPermitIds = permits.filter((p) => DP_DELIVERED_STATUSES.includes(p.status) || p.status === DP_OUT_FOR_DELIVERY_STATUS).map((p) => p.permit_id)
  const returns = await loadReturnLines(db, returnPermitIds)

  const poLines = soItemIds.length
    ? (must(await db.from("purchase_order_items").select("po_item_id, po_id, source_so_item_id, quantity, landed_cost, unit_price").in("source_so_item_id", soItemIds), "load purchase order items") as MissingPoLine[])
    : []
  const poIds = [...new Set(poLines.map((p) => p.po_id))]
  const pos = new Map<number, MissingPo>()
  if (poIds.length > 0) for (const p of must(await db.from("purchase_orders").select("po_id, po_number, status").in("po_id", poIds), "load purchase orders") as MissingPo[]) pos.set(p.po_id, p)

  const grnLines: MissingGrnLine[] = []
  if (soItemIds.length > 0) {
    grnLines.push(...(must(await db.from("goods_receipt_lines").select("line_id, po_item_id, source_so_item_id, quantity_received").in("source_so_item_id", soItemIds), "load goods receipts") as MissingGrnLine[]))
    const poItemIds = poLines.map((p) => p.po_item_id)
    if (poItemIds.length > 0) grnLines.push(...(must(await db.from("goods_receipt_lines").select("line_id, po_item_id, source_so_item_id, quantity_received").in("po_item_id", poItemIds), "load goods receipts by po item") as MissingGrnLine[]))
  }

  // stock this order can draw on: on-hand minus what other holding orders already hold
  const stockAvailable = new Map<number, number>()
  if (productIds.length > 0) {
    const heldElsewhere = await loadHeldByProduct(db, { excludeSoId: soId })
    for (const id of productIds) {
      const onHand = (inventory.get(id) || []).reduce((sum, r) => sum + num(r.quantity), 0)
      stockAvailable.set(id, Math.max(0, onHand - (heldElsewhere.get(id) || 0)))
    }
  }

  return {
    so: { so_id: so.so_id, so_number: so.so_number, order_date: so.order_date, delivery_date: so.delivery_date, status: so.status, customerName },
    permitCount: permits.length,
    rows: buildMissingItems({ soLines, products, inventory, permits, dpItems, returns, poLines, pos, grnLines, stockAvailable, holding: HOLDING_SO_STATUSES.includes(so.status) }),
  }
}
