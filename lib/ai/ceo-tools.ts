// Tools for the CEO chat (owner request, 2026-11-14).
// - A short, correct business summary goes in front of every question (what is still owed, current statuses).
// - Lookup tools: the AI fetches exactly the records a question needs (orders, POs, balances, stock) instead of
//   guessing from the summary. Read-only.
// - Proposal tools: the AI can only PROPOSE an action (a note, a pending PO, a quotation). The proposal is shown as a
//   card; nothing is written until the person presses Confirm (app/api/ai/ceo-chat/confirm), which runs the same
//   route the screens use.
import { buildSoOverview, soProfit } from "../so-overview"
import { loadSalesOrdersNeedingPo } from "../notifications/waiting"
import { loadDismissed } from "../notifications/dismissed"

type Db = any
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data || []
}
const num = (v: unknown) => Number(v) || 0
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
/** true when every word of the query is in the text (Arabic letter variants ignored) */
export const matches = (text: unknown, query: unknown) => {
  const t = norm(text)
  const words = norm(query).split(" ").filter(Boolean)
  return words.length > 0 && words.every((w) => t.includes(w))
}
const today = () => new Date().toISOString().slice(0, 10)

// ---------------------------------------------------------------- summary
const OPEN_SO = ["pending", "pending_accountant", "pending_ceo", "accountant_approved", "approved", "ready_for_delivery", "shipped"]

/** The short summary in front of every question. Amounts owed use what is still unpaid (balance). */
export async function businessSummary(db: Db): Promise<string> {
  const [ar, ap, pos, sos, balance, inventory] = await Promise.all([
    db.from("accounts_receivable").select("invoice_id, amount, balance, due_date, status"),
    db.from("accounts_payable").select("invoice_id, amount, balance, due_date, status"),
    db.from("purchase_orders").select("po_id, status"),
    db.from("sales_orders").select("so_id, status, fulfillment_status, total"),
    db.from("balance_entries").select("*").order("created_at", { ascending: false }).limit(1),
    db.from("inventory").select("quantity, unit_cost, reorder_point, is_returned"),
  ])
  const owed = (rows: any[]) => rows.reduce((s, r) => s + Math.max(0, r.balance ?? num(r.amount)), 0)
  const late = (rows: any[]) => rows.filter((r) => r.due_date && r.due_date < today() && num(r.balance ?? r.amount) > 0.009)
  const arRows = must(ar, "receivables")
  const apRows = must(ap, "payables")
  const bills = new Set(apRows.map((r: any) => r.po_id))
  const poRows = must(pos, "purchase orders")
  const soRows = must(sos, "sales orders")
  const inv = must(inventory, "inventory").filter((i: any) => !i.is_returned)
  const count = (rows: any[], key: string) =>
    Object.entries(rows.reduce((m: Record<string, number>, r: any) => ({ ...m, [r[key] || "none"]: (m[r[key] || "none"] || 0) + 1 }), {}))
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ")
  return [
    `Date: ${today()}. Currency EGP.`,
    `Cash balance (latest entry): ${money(num(must(balance, "balance")[0]?.amount))}`,
    `Customers still owe: ${money(owed(arRows))} on ${arRows.filter((r: any) => num(r.balance ?? r.amount) > 0.009).length} invoices; overdue ${money(owed(late(arRows)))} (${late(arRows).length} invoices)`,
    `We still owe suppliers: ${money(owed(apRows))}; overdue ${money(owed(late(apRows)))} (${late(apRows).length} bills)`,
    `Stock value at cost: ${money(inv.reduce((s: number, i: any) => s + num(i.quantity) * num(i.unit_cost), 0))}; items at or below reorder point: ${inv.filter((i: any) => num(i.quantity) <= num(i.reorder_point)).length}`,
    `Sales orders by status: ${count(soRows, "status")}. Open: ${soRows.filter((s: any) => OPEN_SO.includes(s.status)).length}`,
    `Purchase orders by status: ${count(poRows, "status")}. Without a supplier bill yet (open): ${poRows.filter((p: any) => !bills.has(p.po_id) && !["rejected", "cancelled"].includes(p.status)).length}`,
  ].join("\n")
}

// ---------------------------------------------------------------- lookups
async function customersById(db: Db, ids: unknown[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map<number, string>()
  const rows = must(await db.from("customers").select("customer_id, customer_name").in("customer_id", unique), "customers")
  return new Map<number, string>(rows.map((c: any) => [Number(c.customer_id), c.customer_name]))
}
async function suppliersById(db: Db, ids: unknown[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map<number, string>()
  const rows = must(await db.from("suppliers").select("supplier_id, supplier_name").in("supplier_id", unique), "suppliers")
  return new Map<number, string>(rows.map((s: any) => [Number(s.supplier_id), s.supplier_name]))
}

async function findSalesOrders(db: Db, args: any) {
  const q = String(args?.query || "")
  const rows = must(await db.from("sales_orders").select("so_id, so_number, customer_id, status, fulfillment_status, total, created_at"), "sales orders")
  const names = await customersById(db, rows.map((r: any) => r.customer_id))
  return rows
    .map((r: any) => ({ ...r, customer: names.get(Number(r.customer_id)) || "" }))
    .filter((r: any) => !q || matches(`${r.so_number} ${r.customer}`, q))
    .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 15)
    .map((r: any) => ({ so_number: r.so_number, customer: r.customer, status: r.status, delivery: r.fulfillment_status, total: num(r.total), created: String(r.created_at || "").slice(0, 10) }))
}

async function soIdFrom(db: Db, soNumber: unknown): Promise<number | null> {
  const n = String(soNumber || "").trim()
  if (!n) return null
  const rows = must(await db.from("sales_orders").select("so_id, so_number"), "sales orders")
  const hit = rows.find((r: any) => norm(r.so_number) === norm(n)) || rows.find((r: any) => norm(r.so_number).endsWith(norm(n)))
  return hit ? Number(hit.so_id) : null
}

async function orderOverview(db: Db, args: any, ctx: ToolContext) {
  const soId = await soIdFrom(db, args?.so_number)
  if (!soId) return { error: `No sales order ${args?.so_number}. Use find_sales_orders first.` }
  const ov = await buildSoOverview(db, soId)
  if (!ov) return { error: "Not found" }
  return {
    so: ov.so,
    money: ov.money,
    lines: ov.lines.map((l) => ({ item: l.name, from: l.source, ordered: l.ordered, on_po: l.onPo, received: l.received, delivered: l.delivered, returned: l.returned, state: l.state, pos: l.poNumbers, dps: l.dpNumbers })),
    delivery_permits: ov.permits.map((p) => ({ number: p.number, status: p.status, value: p.value, returned: p.returned, invoiced: p.invoiced })),
    purchase_orders: ov.pos.map((p) => ({ number: p.number, supplier: p.supplier, for_this_order: p.forThisOrder, paid: p.paid, closed: p.closed })),
    still_to_do: ov.todo,
    latest_events: ov.timeline.slice(0, 15),
    ...(ctx.seesProfit ? { profit: await soProfit(db, soId) } : {}),
  }
}

async function findPurchaseOrders(db: Db, args: any) {
  const q = String(args?.query || "")
  const rows = must(await db.from("purchase_orders").select("po_id, po_number, supplier_id, status, total, order_date, created_at"), "purchase orders")
  const names = await suppliersById(db, rows.map((r: any) => r.supplier_id))
  const bills = must(await db.from("accounts_payable").select("po_id, amount, balance"), "supplier bills")
  return rows
    .map((r: any) => ({ ...r, supplier: names.get(Number(r.supplier_id)) || "" }))
    .filter((r: any) => !q || matches(`${r.po_number} ${r.supplier}`, q))
    .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 15)
    .map((r: any) => {
      const bill = bills.filter((b: any) => Number(b.po_id) === Number(r.po_id))
      return {
        po_number: r.po_number,
        supplier: r.supplier,
        status: r.status,
        total: num(r.total),
        closed: bill.length > 0,
        still_owed: bill.length ? money(bill.reduce((s: number, b: any) => s + num(b.balance ?? b.amount), 0)) : null,
        date: r.order_date || String(r.created_at || "").slice(0, 10),
      }
    })
}

async function purchaseOrderDetails(db: Db, args: any) {
  const n = norm(args?.po_number)
  const pos = must(await db.from("purchase_orders").select("*"), "purchase orders")
  const po = pos.find((p: any) => norm(p.po_number) === n) || pos.find((p: any) => n && norm(p.po_number).endsWith(n))
  if (!po) return { error: `No purchase order ${args?.po_number}. Use find_purchase_orders first.` }
  const items = must(await db.from("purchase_order_items").select("*").eq("po_id", po.po_id), "PO lines")
  const receipts = items.length
    ? must(await db.from("goods_receipt_lines").select("po_item_id, quantity_received").in("po_item_id", items.map((i: any) => i.po_item_id)), "receipts")
    : []
  const soIds = [...new Set(items.map((i: any) => i.source_so_id).filter(Boolean))]
  const sos = soIds.length ? must(await db.from("sales_orders").select("so_id, so_number").in("so_id", soIds), "sales orders") : []
  const products = new Map<number, string>()
  const pids = [...new Set(items.map((i: any) => i.product_id).filter(Boolean))]
  if (pids.length) for (const p of must(await db.from("products").select("product_id, product_name").in("product_id", pids), "products")) products.set(Number(p.product_id), p.product_name)
  const bills = must(await db.from("accounts_payable").select("invoice_number, amount, balance, due_date").eq("po_id", po.po_id), "supplier bills")
  const supplier = (await suppliersById(db, [po.supplier_id])).get(Number(po.supplier_id)) || ""
  return {
    po_number: po.po_number,
    supplier,
    status: po.status,
    total: num(po.total),
    closed: bills.length > 0,
    bills,
    lines: items.map((i: any) => ({
      item: i.outsourced_name || products.get(Number(i.product_id)) || i.item_name_snapshot || "-",
      quantity: num(i.quantity),
      unit_cost: num(i.unit_price),
      received: receipts.filter((r: any) => r.po_item_id === i.po_item_id).reduce((s: number, r: any) => s + num(r.quantity_received), 0),
      for_sales_order: sos.find((s: any) => s.so_id === i.source_so_id)?.so_number || null,
    })),
  }
}

async function partyBalance(db: Db, args: any, side: "customer" | "supplier") {
  const q = String(args?.name || "")
  const table = side === "customer" ? "customers" : "suppliers"
  const idCol = side === "customer" ? "customer_id" : "supplier_id"
  const nameCol = side === "customer" ? "customer_name" : "supplier_name"
  const parties = must(await db.from(table).select(`${idCol}, ${nameCol}`), table).filter((p: any) => matches(p[nameCol], q))
  if (!parties.length) return { error: `No ${side} matching "${q}"` }
  const ids = parties.slice(0, 5).map((p: any) => p[idCol])
  const invoices = must(
    await db.from(side === "customer" ? "accounts_receivable" : "accounts_payable").select(`invoice_number, ${idCol}, amount, balance, due_date, status`).in(idCol, ids),
    "invoices",
  )
  return parties.slice(0, 5).map((p: any) => {
    const left = (i: any) => num(i.balance ?? i.amount)
    const mine = invoices.filter((i: any) => i[idCol] === p[idCol] && left(i) > 0.009)
    return {
      name: p[nameCol],
      still_owed: money(mine.reduce((s: number, i: any) => s + left(i), 0)),
      overdue: money(mine.filter((i: any) => i.due_date && i.due_date < today()).reduce((s: number, i: any) => s + left(i), 0)),
      open_invoices: mine.slice(0, 20).map((i: any) => ({ number: i.invoice_number, amount: num(i.amount), still_owed: left(i), due: i.due_date })),
    }
  })
}

async function stockLookup(db: Db, args: any, ctx: ToolContext) {
  const q = String(args?.product || "")
  const products = must(await db.from("products").select("*"), "products").filter((p: any) => matches(`${p.product_name} ${p.sku || ""}`, q)).slice(0, 10)
  if (!products.length) return { error: `No product matching "${q}"` }
  const inv = must(await db.from("inventory").select("product_id, warehouse_id, quantity, reorder_point, is_returned").in("product_id", products.map((p: any) => p.product_id)), "inventory")
  const warehouses = new Map<number, string>(must(await db.from("warehouses").select("warehouse_id, warehouse_name"), "warehouses").map((w: any) => [Number(w.warehouse_id), w.warehouse_name]))
  return products.map((p: any) => ({
    product: p.product_name,
    sku: p.sku || null,
    selling_price: num(p.unit_price),
    ...(ctx.seesProfit ? { last_landed_cost: num(p.last_landed_cost) } : {}),
    on_hand: inv.filter((i: any) => i.product_id === p.product_id && !i.is_returned).map((i: any) => ({ warehouse: warehouses.get(Number(i.warehouse_id)) || i.warehouse_id, quantity: num(i.quantity), reorder_point: num(i.reorder_point) })),
  }))
}

async function ordersNeedingPo(db: Db) {
  const list = await loadSalesOrdersNeedingPo(db, await loadDismissed(db))
  return list.filter((o) => !o.hidden).map((o) => ({ so_number: o.so_number, customer: o.customer_name, items: o.items }))
}

// ---------------------------------------------------------------- proposals (nothing is written here)
export type Proposal =
  | { kind: "note"; title: string; target: "so" | "po" | "quotation"; id: number; number: string; text: string }
  | {
      kind: "purchase_order"
      title: string
      supplierId: number
      supplier: string
      soNumber: string | null
      lines: { name: string; quantity: number; unitCost: number; sourceSoId: number | null; sourceSoItemId: number | null }[]
      total: number
    }
  | {
      kind: "quotation"
      title: string
      customerId: number | null
      customer: string
      lines: { productId: number | null; name: string; quantity: number; unitPrice: number; itemType: "inventory" | "outsourced" }[]
      notes: string
      total: number
    }

async function proposeNote(db: Db, args: any): Promise<Proposal | { error: string }> {
  const target = args?.target === "po" ? "po" : args?.target === "quotation" ? "quotation" : args?.target === "so" ? "so" : null
  const text = String(args?.text || "").trim().slice(0, 4000)
  if (!target || !text) return { error: "Say which document (so, po or quotation), its number and the note text" }
  const n = norm(args?.number)
  const [table, idCol, numCol] =
    target === "so" ? ["sales_orders", "so_id", "so_number"] : target === "po" ? ["purchase_orders", "po_id", "po_number"] : ["sales_quotations", "id", "quotation_number"]
  const rows = must(await db.from(table).select(`${idCol}, ${numCol}`), table)
  const hit = rows.find((r: any) => norm(r[numCol]) === n) || rows.find((r: any) => n && norm(r[numCol]).endsWith(n))
  if (!hit) return { error: `No ${target} ${args?.number}` }
  return { kind: "note", title: `Add a note to ${hit[numCol]}`, target, id: Number(hit[idCol]), number: hit[numCol], text }
}

async function proposePurchaseOrder(db: Db, args: any): Promise<Proposal | { error: string }> {
  const suppliers = must(await db.from("suppliers").select("supplier_id, supplier_name"), "suppliers").filter((s: any) => matches(s.supplier_name, args?.supplier))
  if (suppliers.length !== 1) return { error: suppliers.length ? `Several suppliers match "${args?.supplier}": ${suppliers.map((s: any) => s.supplier_name).join(", ")}` : `No supplier matching "${args?.supplier}"` }
  const supplier = suppliers[0]
  const soId = args?.so_number ? await soIdFrom(db, args.so_number) : null
  if (args?.so_number && !soId) return { error: `No sales order ${args.so_number}` }
  const soItems = soId ? must(await db.from("sales_order_items").select("so_item_id, so_id, outsourced_name, item_type, quantity, cost_estimate").eq("so_id", soId), "SO lines") : []
  const soNumber = soId ? (must(await db.from("sales_orders").select("so_number").eq("so_id", soId), "SO"))[0]?.so_number || null : null
  const wanted = Array.isArray(args?.lines) ? args.lines : []
  if (!wanted.length) return { error: "Give at least one line (item, quantity, cost)" }
  const lines = []
  for (const w of wanted.slice(0, 50)) {
    const name = String(w?.item || "").trim()
    const quantity = num(w?.quantity)
    if (!name || !(quantity > 0)) return { error: `Each line needs an item and a quantity (got "${name}" × ${w?.quantity})` }
    const soLine = soItems.find((i: any) => i.item_type === "outsourced" && norm(i.outsourced_name) === norm(name)) || soItems.find((i: any) => i.item_type === "outsourced" && matches(i.outsourced_name, name))
    const unitCost = w?.unit_cost != null && num(w.unit_cost) >= 0 ? num(w.unit_cost) : num(soLine?.cost_estimate)
    lines.push({ name: soLine?.outsourced_name || name, quantity, unitCost, sourceSoId: soLine ? soId : null, sourceSoItemId: soLine ? Number(soLine.so_item_id) : null })
  }
  const total = money(lines.reduce((s, l) => s + l.quantity * l.unitCost, 0))
  return { kind: "purchase_order", title: `New purchase order to ${supplier.supplier_name}`, supplierId: Number(supplier.supplier_id), supplier: supplier.supplier_name, soNumber, lines, total }
}

async function proposeQuotation(db: Db, args: any): Promise<Proposal | { error: string }> {
  const customerName = String(args?.customer || "").trim()
  if (!customerName) return { error: "Say who the quotation is for" }
  const customers = must(await db.from("customers").select("customer_id, customer_name"), "customers").filter((c: any) => matches(c.customer_name, customerName))
  const customer = customers.length === 1 ? customers[0] : null
  const products = must(await db.from("products").select("product_id, product_name, unit_price"), "products")
  const wanted = Array.isArray(args?.lines) ? args.lines : []
  if (!wanted.length) return { error: "Give at least one line (product, quantity)" }
  const lines = []
  for (const w of wanted.slice(0, 50)) {
    const name = String(w?.product || "").trim()
    const quantity = num(w?.quantity)
    if (!name || !(quantity > 0)) return { error: `Each line needs a product and a quantity (got "${name}" × ${w?.quantity})` }
    const found = products.filter((p: any) => matches(p.product_name, name))
    const product = found.find((p: any) => norm(p.product_name) === norm(name)) || (found.length === 1 ? found[0] : null)
    const unitPrice = w?.unit_price != null && num(w.unit_price) >= 0 ? num(w.unit_price) : num(product?.unit_price)
    lines.push({ productId: product ? Number(product.product_id) : null, name: product?.product_name || name, quantity, unitPrice, itemType: product ? ("inventory" as const) : ("outsourced" as const) })
  }
  const total = money(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
  return {
    kind: "quotation",
    title: `New quotation for ${customer?.customer_name || customerName}`,
    customerId: customer ? Number(customer.customer_id) : null,
    customer: customer?.customer_name || customerName,
    lines,
    notes: String(args?.notes || "").slice(0, 2000),
    total,
  }
}

// ---------------------------------------------------------------- registry
export interface ToolContext {
  seesProfit: boolean
}
type Exec = (db: Db, args: any, ctx: ToolContext) => Promise<unknown>

const STRING = { type: "STRING" }
const NUMBER = { type: "NUMBER" }

export const LOOKUP_TOOLS: Record<string, { description: string; parameters?: any; run: Exec }> = {
  find_sales_orders: {
    description: "Search sales orders by number or customer name (Arabic or English). Empty query = latest orders.",
    parameters: { type: "OBJECT", properties: { query: STRING } },
    run: (db, a) => findSalesOrders(db, a),
  },
  order_overview: {
    description: "Everything about one sales order: money (paid / invoiced / delivered), each line from ordered to delivered, its delivery permits and purchase orders, what is left to do, latest events.",
    parameters: { type: "OBJECT", properties: { so_number: STRING }, required: ["so_number"] },
    run: (db, a, c) => orderOverview(db, a, c),
  },
  find_purchase_orders: {
    description: "Search purchase orders by number or supplier name. Shows status, total, closed (has a supplier bill) and what is still owed.",
    parameters: { type: "OBJECT", properties: { query: STRING } },
    run: (db, a) => findPurchaseOrders(db, a),
  },
  purchase_order_details: {
    description: "One purchase order's lines (item, quantity, cost, received, which sales order) and its bills.",
    parameters: { type: "OBJECT", properties: { po_number: STRING }, required: ["po_number"] },
    run: (db, a) => purchaseOrderDetails(db, a),
  },
  customer_balance: {
    description: "What a customer still owes us: open invoices and overdue amount.",
    parameters: { type: "OBJECT", properties: { name: STRING }, required: ["name"] },
    run: (db, a) => partyBalance(db, a, "customer"),
  },
  supplier_balance: {
    description: "What we still owe a supplier: open bills and overdue amount.",
    parameters: { type: "OBJECT", properties: { name: STRING }, required: ["name"] },
    run: (db, a) => partyBalance(db, a, "supplier"),
  },
  stock_lookup: {
    description: "Stock of a product per warehouse, reorder point and selling price.",
    parameters: { type: "OBJECT", properties: { product: STRING }, required: ["product"] },
    run: (db, a, c) => stockLookup(db, a, c),
  },
  orders_needing_po: {
    description: "Sales orders that still need a purchase order, with the items.",
    run: (db) => ordersNeedingPo(db),
  },
}

export const PROPOSAL_TOOLS: Record<string, { description: string; parameters: any; run: (db: Db, args: any) => Promise<Proposal | { error: string }> }> = {
  propose_note: {
    description: "Propose adding a note to a sales order (so), purchase order (po) or quotation. Shown to the user to confirm; nothing is saved until they confirm.",
    parameters: { type: "OBJECT", properties: { target: { type: "STRING", enum: ["so", "po", "quotation"] }, number: STRING, text: STRING }, required: ["target", "number", "text"] },
    run: proposeNote,
  },
  propose_purchase_order: {
    description:
      "Propose a new purchase order (it will be pending approval) to one supplier. When it is for a sales order, give so_number and use the item names of that order's outsourced lines so they are linked. unit_cost is the cost per unit (if left out, the cost written on the sales order line is used). Shown to the user to confirm.",
    parameters: {
      type: "OBJECT",
      properties: {
        supplier: STRING,
        so_number: STRING,
        lines: { type: "ARRAY", items: { type: "OBJECT", properties: { item: STRING, quantity: NUMBER, unit_cost: NUMBER }, required: ["item", "quantity"] } },
      },
      required: ["supplier", "lines"],
    },
    run: proposePurchaseOrder,
  },
  propose_quotation: {
    description: "Propose a new sales quotation for a customer (saved in Sales Quotations, waiting for approval). unit_price is the selling price; if left out, the product's selling price is used. Shown to the user to confirm.",
    parameters: {
      type: "OBJECT",
      properties: {
        customer: STRING,
        notes: STRING,
        lines: { type: "ARRAY", items: { type: "OBJECT", properties: { product: STRING, quantity: NUMBER, unit_price: NUMBER }, required: ["product", "quantity"] } },
      },
      required: ["customer", "lines"],
    },
    run: proposeQuotation,
  },
}

/** The tools in Gemini's format. */
export function geminiToolDeclarations() {
  const all = { ...LOOKUP_TOOLS, ...PROPOSAL_TOOLS }
  return [{ functionDeclarations: Object.entries(all).map(([name, t]) => ({ name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) })) }]
}

/** Runs one tool the model asked for: lookups return data; proposals return the card (never write). */
export async function runTool(db: Db, name: string, args: any, ctx: ToolContext): Promise<{ result: unknown; proposal?: Proposal }> {
  try {
    if (LOOKUP_TOOLS[name]) return { result: await LOOKUP_TOOLS[name].run(db, args || {}, ctx) }
    if (PROPOSAL_TOOLS[name]) {
      const out = await PROPOSAL_TOOLS[name].run(db, args || {})
      if ("error" in out) return { result: out }
      return { result: { shown_to_user_for_confirmation: true, summary: out.title }, proposal: out }
    }
    return { result: { error: `Unknown tool ${name}` } }
  } catch (error) {
    console.error("CEO chat tool", name, error)
    return { result: { error: "That lookup failed" } }
  }
}
