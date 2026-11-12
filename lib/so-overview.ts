// The 360 "Order overview" of one sales order (owner request, 2026-11-12): everything about the order on one page —
// where the money stands, what is left to finish, each line from ordered to delivered, its delivery permits and
// purchase orders, and one timeline with the notes. Read-only. Delivered follows the same rule as the prints and the
// fulfilment check: quantities on signed / approved permits, less valid returns. Profit is built separately
// (soProfit) because only the CEO and admins may see what the goods cost.
import { lineKey, loadReturnLines, returnedByKey, returnedTotalsByPermit } from "./return-lines"
import { lineDeliveryStates, DP_DELIVERED_STATUSES } from "./delivery-status"
import { loadSoInvoicingState } from "./invoicing"

type Db = any
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => Number(v) || 0
const EPS = 1e-6

export type OverviewLineState = "delivered" | "partial" | "ready" | "waiting_supplier" | "no_po" | "to_deliver"

export interface OverviewLine {
  id: number
  name: string
  /** "po" when bought for this order (outsourced, or a product put on a PO for it), otherwise "stock" */
  source: "po" | "stock"
  ordered: number
  /** quantity on purchase orders for this line; null for a stock line */
  onPo: number | null
  /** received from the supplier; null for a stock line */
  received: number | null
  delivered: number
  returned: number
  unitPrice: number
  state: OverviewLineState
  poNumbers: string[]
  dpNumbers: string[]
}

export interface OverviewPermit {
  id: number
  number: string
  status: string
  date: string | null
  value: number
  returned: number
  /** "dp" invoiced on its own, "so" covered by an invoice for the whole order, null not invoiced */
  invoiced: "dp" | "so" | null
}

export interface OverviewPo {
  id: number
  number: string
  supplier: string
  status: string
  total: number
  /** cost of this PO's lines that are for this order */
  forThisOrder: number
  paid: number
  closed: boolean
  exchanges: number
  expected: string | null
}

export type OverviewTodo =
  | { kind: "no_po"; name: string; quantity: number }
  | { kind: "waiting_supplier"; name: string; quantity: number; po: string; expected: string | null }
  | { kind: "ready"; name: string; quantity: number }
  | { kind: "to_deliver"; name: string; quantity: number }
  | { kind: "draft_dp"; dp: string }
  | { kind: "not_invoiced"; dp: string; value: number }
  | { kind: "unpaid"; amount: number }

export interface OverviewEvent {
  at: string | null
  kind: "so_created" | "note" | "so_event" | "dp_created" | "dp_signed" | "returned" | "po_created" | "po_event" | "invoiced" | "paid"
  /** what the event is about: a document number, an item name, the note text, an event type */
  subject: string
  amount?: number
  quantity?: number
  detail?: string | null
}

export interface SoOverview {
  so: { id: number; number: string; customer: string; createdAt: string | null; status: string; fulfilment: string | null }
  money: { total: number; delivered: number; invoiced: number; paid: number; invoicedUnpaid: number; deliveredNotInvoiced: number; notDelivered: number }
  lines: OverviewLine[]
  permits: OverviewPermit[]
  pos: OverviewPo[]
  todo: OverviewTodo[]
  timeline: OverviewEvent[]
}

const STOCK_OUT = new Set(DP_DELIVERED_STATUSES)

/** Everything the overview needs, except costs. null when the sales order does not exist. */
export async function buildSoOverview(db: Db, soId: number): Promise<SoOverview | null> {
  const so = must(await db.from("sales_orders").select("*").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so) return null

  const customer = so.customer_id
    ? must(await db.from("customers").select("customer_name").eq("customer_id", so.customer_id).maybeSingle(), "load customer")
    : null

  const soItems = must(
    await db
      .from("sales_order_items")
      .select("so_item_id, product_id, quantity, unit_price, total, item_type, outsourced_name")
      .eq("so_id", soId)
      .order("so_item_id", { ascending: true }),
    "load sales order items",
  ) as any[]

  const productIds = [...new Set(soItems.filter((i) => i.product_id).map((i) => Number(i.product_id)))]
  const productNames = new Map<number, string>()
  if (productIds.length) {
    for (const p of must(await db.from("products").select("product_id, product_name").in("product_id", productIds), "load products") as any[]) {
      productNames.set(Number(p.product_id), p.product_name)
    }
  }
  const nameOf = (i: any) =>
    i.item_type === "outsourced" || !i.product_id ? i.outsourced_name || "-" : productNames.get(Number(i.product_id)) || `#${i.product_id}`

  // ---- delivery permits, their items and returns
  const permitRows = must(
    await db.from("delivery_permits").select("permit_id, permit_no, status, created_at, submitted_signed_at").eq("sales_order_id", soId),
    "load delivery permits",
  ) as any[]
  const permits = permitRows.filter((p) => p.status !== "REJECTED")
  const permitIds = permits.map((p) => Number(p.permit_id))
  const dpItems = permitIds.length
    ? (must(
        await db.from("delivery_permit_items").select("permit_id, product_id, item_name_snapshot, quantity, total, unit_price").in("permit_id", permitIds),
        "load delivery permit items",
      ) as any[])
    : []
  const returnLines = await loadReturnLines(db, permitIds)
  const signed = permits.filter((p) => STOCK_OUT.has(p.status))

  const confirmed = new Map<string, number>()
  const signedIds = new Set(signed.map((p) => Number(p.permit_id)))
  for (const it of dpItems) {
    if (!signedIds.has(Number(it.permit_id))) continue
    const key = lineKey(it.product_id, it.item_name_snapshot)
    confirmed.set(key, (confirmed.get(key) || 0) + num(it.quantity))
  }
  for (const p of signed) {
    for (const [key, qty] of returnedByKey(returnLines, { permitId: p.permit_id })) confirmed.set(key, (confirmed.get(key) || 0) - qty)
  }
  const lineKeys = soItems.map((i) => lineKey(i.product_id, i.outsourced_name))
  const states = lineDeliveryStates(soItems.map((i, idx) => ({ key: lineKeys[idx], quantity: num(i.quantity) })), confirmed)

  // returns and permit numbers per line (first line with the key takes them)
  const returnedLeft = returnedByKey(returnLines)
  const dpNumbersByKey = new Map<string, Set<string>>()
  const permitNo = new Map(permits.map((p) => [Number(p.permit_id), p.permit_no || `#${p.permit_id}`]))
  for (const it of dpItems) {
    const key = lineKey(it.product_id, it.item_name_snapshot)
    if (!dpNumbersByKey.has(key)) dpNumbersByKey.set(key, new Set())
    dpNumbersByKey.get(key)!.add(permitNo.get(Number(it.permit_id))!)
  }

  // ---- purchase orders linked to the order's lines
  const soItemIds = soItems.map((i) => Number(i.so_item_id))
  const poItems = soItemIds.length
    ? (must(
        await db.from("purchase_order_items").select("po_item_id, po_id, source_so_item_id, quantity, unit_price").in("source_so_item_id", soItemIds),
        "load purchase order items",
      ) as any[])
    : []
  const poIds = [...new Set(poItems.map((p) => Number(p.po_id)))]
  const poRows = poIds.length
    ? (must(await db.from("purchase_orders").select("*").in("po_id", poIds), "load purchase orders") as any[]).filter(
        (po) => !["cancelled", "rejected"].includes(String(po.status || "").toLowerCase()),
      )
    : []
  const livePo = new Set(poRows.map((po) => Number(po.po_id)))
  const linkedPoItems = poItems.filter((p) => livePo.has(Number(p.po_id)))
  const receipts = linkedPoItems.length
    ? (must(
        await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", linkedPoItems.map((p) => Number(p.po_item_id))),
        "load goods receipts",
      ) as any[])
    : []
  const receivedByPoItem = new Map<number, number>()
  for (const r of receipts) receivedByPoItem.set(Number(r.po_item_id), (receivedByPoItem.get(Number(r.po_item_id)) || 0) + num(r.quantity_received))
  const poNumber = new Map(poRows.map((po) => [Number(po.po_id), po.po_number || `#${po.po_id}`]))

  // ---- lines
  const lines: OverviewLine[] = soItems.map((i, idx) => {
    const key = lineKeys[idx]
    const ordered = num(i.quantity)
    const mine = linkedPoItems.filter((p) => Number(p.source_so_item_id) === Number(i.so_item_id))
    const isPo = i.item_type === "outsourced" || !i.product_id || mine.length > 0
    const onPo = isPo ? mine.reduce((s, p) => s + num(p.quantity), 0) : null
    const received = isPo ? mine.reduce((s, p) => s + (receivedByPoItem.get(Number(p.po_item_id)) || 0), 0) : null
    const delivered = states[idx].deliveredQuantity
    const returned = returnedLeft.get(key) || 0
    if (returned > 0) returnedLeft.set(key, 0)
    let state: OverviewLineState
    if (ordered <= EPS || delivered >= ordered - EPS) state = "delivered"
    else if (!isPo) state = delivered > EPS ? "partial" : "to_deliver"
    else if ((received || 0) > delivered + EPS) state = "ready"
    else if ((onPo || 0) > (received || 0) + EPS) state = "waiting_supplier"
    else if ((onPo || 0) < ordered - EPS) state = "no_po"
    else state = delivered > EPS ? "partial" : "to_deliver"
    return {
      id: Number(i.so_item_id),
      name: nameOf(i),
      source: isPo ? "po" : "stock",
      ordered,
      onPo,
      received,
      delivered,
      returned,
      unitPrice: ordered > 0 ? money(num(i.total) / ordered) || num(i.unit_price) : num(i.unit_price),
      state,
      poNumbers: [...new Set(mine.map((p) => poNumber.get(Number(p.po_id))!))],
      dpNumbers: [...(dpNumbersByKey.get(key) || [])],
    }
  })

  // ---- invoices and customer payments
  const invoicing = await loadSoInvoicingState(db, soId)
  const invoices = invoicing?.invoices || []
  const invoiceIds = invoices.map((inv) => Number(inv.invoice_id))
  const arRows = invoiceIds.length
    ? (must(await db.from("accounts_receivable").select("invoice_id, invoice_number, amount, balance, created_at").in("invoice_id", invoiceIds), "load invoices") as any[])
    : []
  const payments = invoiceIds.length
    ? (must(await db.from("customer_payments").select("invoice_id, amount, payment_date, payment_method").in("invoice_id", invoiceIds), "load customer payments") as any[])
    : []
  const soLevelInvoice = invoices.some((inv) => inv.permit_ids.length === 0)
  const invoicedPermits = new Set(invoices.flatMap((inv) => inv.permit_ids.map(Number)))

  // ---- permits
  const returnedByPermit = returnedTotalsByPermit(returnLines)
  const permitList: OverviewPermit[] = permits
    .map((p) => {
      const id = Number(p.permit_id)
      const value = dpItems.filter((it) => Number(it.permit_id) === id).reduce((s, it) => s + (num(it.total) || num(it.quantity) * num(it.unit_price)), 0)
      return {
        id,
        number: permitNo.get(id)!,
        status: p.status,
        date: p.submitted_signed_at || p.created_at || null,
        value: money(value),
        returned: returnedByPermit.get(id) || 0,
        invoiced: invoicedPermits.has(id) ? ("dp" as const) : soLevelInvoice ? ("so" as const) : null,
      }
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))

  // ---- purchase orders: paid = the bill's paid amount once closed, otherwise the advances given
  const bills = poIds.length ? (must(await db.from("accounts_payable").select("po_id, amount, paid_amount").in("po_id", poIds), "load supplier bills") as any[]) : []
  const advances = poIds.length
    ? (must(
        await db.from("supplier_credits").select("used_in_po_id, amount, credit_type, status").in("used_in_po_id", poIds),
        "load advances",
      ) as any[]).filter((c) => c.credit_type === "advance" && c.status === "used")
    : []
  const poEvents = poIds.length
    ? (must(
        await db
          .from("workflow_events")
          .select("entity_id, event_type, notes, performed_at")
          .eq("entity_type", "PURCHASE_ORDER")
          .in("entity_id", poIds),
        "load purchase order history",
      ) as any[])
    : []
  const supplierIds = [...new Set(poRows.map((po) => po.supplier_id).filter(Boolean))]
  const supplierNames = new Map<number, string>()
  if (supplierIds.length) {
    for (const s of must(await db.from("suppliers").select("supplier_id, supplier_name").in("supplier_id", supplierIds), "load suppliers") as any[]) {
      supplierNames.set(Number(s.supplier_id), s.supplier_name)
    }
  }
  const pos: OverviewPo[] = poRows
    .map((po) => {
      const id = Number(po.po_id)
      const myBills = bills.filter((b) => Number(b.po_id) === id)
      const closed = myBills.length > 0
      const paid = closed
        ? myBills.reduce((s, b) => s + num(b.paid_amount), 0)
        : advances.filter((c) => Number(c.used_in_po_id) === id).reduce((s, c) => s + num(c.amount), 0)
      return {
        id,
        number: poNumber.get(id)!,
        supplier: supplierNames.get(Number(po.supplier_id)) || "-",
        status: String(po.status || ""),
        total: money(num(po.total) || num(po.total_amount)),
        forThisOrder: money(linkedPoItems.filter((p) => Number(p.po_id) === id).reduce((s, p) => s + num(p.quantity) * num(p.unit_price), 0)),
        paid: money(paid),
        closed,
        exchanges: poEvents.filter((e) => Number(e.entity_id) === id && e.event_type === "PO_ITEM_EXCHANGED").length,
        expected: po.delivery_date || null,
      }
    })
    .sort((a, b) => a.number.localeCompare(b.number))

  // ---- money: every number once; the four parts add up to the order total
  const total = money(num(so.total))
  const lineSum = soItems.reduce((s, i) => s + num(i.total), 0)
  const ratio = lineSum > EPS ? total / lineSum : 1
  const delivered = money(lines.reduce((s, l) => s + l.delivered * l.unitPrice, 0) * ratio)
  const invoiced = money(arRows.reduce((s, r) => s + num(r.amount), 0))
  const paid = money(arRows.reduce((s, r) => s + Math.max(0, num(r.amount) - num(r.balance)), 0))
  const moneyBox = {
    total,
    delivered,
    invoiced,
    paid,
    invoicedUnpaid: money(Math.max(0, invoiced - paid)),
    deliveredNotInvoiced: money(Math.max(0, delivered - invoiced)),
    notDelivered: money(Math.max(0, total - Math.max(delivered, invoiced))),
  }

  // ---- what is left to finish
  const todo: OverviewTodo[] = []
  for (const l of lines) {
    if (l.state === "delivered") continue
    if (l.source === "po") {
      const missing = l.ordered - (l.onPo || 0)
      if (missing > EPS) todo.push({ kind: "no_po", name: l.name, quantity: missing })
      const waiting = (l.onPo || 0) - (l.received || 0)
      if (waiting > EPS) {
        const po = pos.find((p) => l.poNumbers.includes(p.number))
        todo.push({ kind: "waiting_supplier", name: l.name, quantity: waiting, po: po?.number || l.poNumbers[0] || "", expected: po?.expected || null })
      }
      const ready = (l.received || 0) - l.delivered
      if (ready > EPS) todo.push({ kind: "ready", name: l.name, quantity: Math.min(ready, l.ordered - l.delivered) })
    } else if (l.ordered - l.delivered > EPS) {
      todo.push({ kind: "to_deliver", name: l.name, quantity: l.ordered - l.delivered })
    }
  }
  for (const p of permitList) {
    if (!STOCK_OUT.has(p.status)) todo.push({ kind: "draft_dp", dp: p.number })
    else if (!p.invoiced) todo.push({ kind: "not_invoiced", dp: p.number, value: p.value })
  }
  if (moneyBox.invoicedUnpaid > 0.009) todo.push({ kind: "unpaid", amount: moneyBox.invoicedUnpaid })

  // ---- timeline, newest first, notes included
  const timeline: OverviewEvent[] = []
  timeline.push({ at: so.created_at || null, kind: "so_created", subject: so.so_number || `#${soId}` })
  const soEvents = must(
    await db.from("workflow_events").select("event_type, notes, new_value, performed_at").eq("entity_type", "SALES_ORDER").eq("entity_id", soId),
    "load sales order history",
  ) as any[]
  for (const e of soEvents) {
    if (e.event_type === "NOTE") timeline.push({ at: e.performed_at, kind: "note", subject: String(e.notes || "") })
    else timeline.push({ at: e.performed_at, kind: "so_event", subject: e.event_type, detail: e.notes || null })
  }
  for (const p of permits) {
    const no = permitNo.get(Number(p.permit_id))!
    timeline.push({ at: p.created_at || null, kind: "dp_created", subject: no })
    if (p.submitted_signed_at) timeline.push({ at: p.submitted_signed_at, kind: "dp_signed", subject: no })
  }
  const keyName = new Map<string, string>()
  soItems.forEach((i, idx) => keyName.set(lineKeys[idx], nameOf(i)))
  for (const r of returnLines) {
    timeline.push({ at: r.created_at, kind: "returned", subject: keyName.get(r.key) || r.key, quantity: r.quantity, detail: permitNo.get(Number(r.permit_id)) || null })
  }
  for (const po of poRows) timeline.push({ at: po.created_at || po.order_date || null, kind: "po_created", subject: poNumber.get(Number(po.po_id))! })
  for (const e of poEvents) {
    timeline.push({ at: e.performed_at, kind: "po_event", subject: e.event_type, detail: `${poNumber.get(Number(e.entity_id))}${e.notes ? ` · ${e.notes}` : ""}` })
  }
  for (const r of arRows) timeline.push({ at: r.created_at || null, kind: "invoiced", subject: r.invoice_number || `#${r.invoice_id}`, amount: money(num(r.amount)) })
  for (const p of payments) timeline.push({ at: p.payment_date || null, kind: "paid", subject: p.payment_method || "", amount: money(num(p.amount)) })
  timeline.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))

  return {
    so: {
      id: soId,
      number: so.so_number || `#${soId}`,
      customer: customer?.customer_name || "-",
      createdAt: so.created_at || null,
      status: String(so.status || ""),
      fulfilment: so.fulfillment_status || null,
    },
    money: moneyBox,
    lines,
    permits: permitList,
    pos,
    todo,
    timeline,
  }
}

export interface SoProfit {
  selling: number
  poCost: number
  stockCost: number
  cost: number
  profit: number
  /** percent of the selling total */
  margin: number
  /** stock lines with no recorded cost (counted as 0) */
  noCost: string[]
}

/**
 * Selling total against what the goods cost: lines bought for the order at their PO cost, stock lines at the
 * product's last landed cost. CEO and admins only (the route enforces it).
 */
export async function soProfit(db: Db, soId: number): Promise<SoProfit | null> {
  const so = must(await db.from("sales_orders").select("so_id, total").eq("so_id", soId).maybeSingle(), "load sales order")
  if (!so) return null
  const soItems = must(
    await db.from("sales_order_items").select("so_item_id, product_id, quantity, item_type, outsourced_name").eq("so_id", soId),
    "load sales order items",
  ) as any[]
  const soItemIds = soItems.map((i) => Number(i.so_item_id))
  const poItems = soItemIds.length
    ? (must(await db.from("purchase_order_items").select("po_id, source_so_item_id, quantity, unit_price").in("source_so_item_id", soItemIds), "load purchase order items") as any[])
    : []
  const poIds = [...new Set(poItems.map((p) => Number(p.po_id)))]
  const live = new Set(
    poIds.length
      ? (must(await db.from("purchase_orders").select("po_id, status").in("po_id", poIds), "load purchase orders") as any[])
          .filter((po) => !["cancelled", "rejected"].includes(String(po.status || "").toLowerCase()))
          .map((po) => Number(po.po_id))
      : [],
  )
  const linked = poItems.filter((p) => live.has(Number(p.po_id)))
  const poCost = linked.reduce((s, p) => s + num(p.quantity) * num(p.unit_price), 0)

  const stockLines = soItems.filter((i) => i.product_id && i.item_type !== "outsourced" && !linked.some((p) => Number(p.source_so_item_id) === Number(i.so_item_id)))
  const productIds = [...new Set(stockLines.map((i) => Number(i.product_id)))]
  const products = new Map<number, any>()
  if (productIds.length) {
    for (const p of must(await db.from("products").select("product_id, product_name, last_landed_cost").in("product_id", productIds), "load product costs") as any[]) {
      products.set(Number(p.product_id), p)
    }
  }
  let stockCost = 0
  const noCost: string[] = []
  for (const l of stockLines) {
    const p = products.get(Number(l.product_id))
    const unit = num(p?.last_landed_cost)
    if (unit <= 0 && num(l.quantity) > 0) noCost.push(p?.product_name || `#${l.product_id}`)
    stockCost += unit * num(l.quantity)
  }
  const selling = money(num(so.total))
  const cost = money(poCost + stockCost)
  const profit = money(selling - cost)
  return {
    selling,
    poCost: money(poCost),
    stockCost: money(stockCost),
    cost,
    profit,
    margin: selling > 0 ? Math.round((profit / selling) * 1000) / 10 : 0,
    noCost: [...new Set(noCost)],
  }
}
