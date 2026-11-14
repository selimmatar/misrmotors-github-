// The 360 order overview (owner request, 2026-11-12): money bar, what is left, line steps, DPs & POs, timeline, profit.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import { buildSoOverview, soProfit } from "../so-overview"
import { RULES, ruleFor, allows } from "../auth/permissions"
import * as profitRoute from "../../app/api/sales-orders/overview/profit/route"
import * as overviewRoute from "../../app/api/sales-orders/overview/route"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

// SO 1 (7,400): 30 drills from stock (20 on signed DP 2, 2 returned), 2 forklifts 3 t bought on PO 1 and delivered
// (DP 1, invoiced and paid), 10 socket sets on PO 2 received not delivered (draft DP 3), 4 jacks on no PO, and a
// 5 t forklift on PO 1 not received yet.
function seed() {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "approved", fulfillment_status: "PARTIALLY_DELIVERED", total: 7400, subtotal: 7400, discount_amount: 0, created_at: "2026-11-02T10:00:00" }],
    customers: [{ customer_id: 5, customer_name: "Al Nour" }],
    products: [{ product_id: 7, product_name: "Drill", last_landed_cost: 60 }],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 30, unit_price: 100, total: 3000, item_type: "stock" },
      { so_item_id: 2, so_id: 1, product_id: null, outsourced_name: "Forklift 3 ton", quantity: 2, unit_price: 1000, total: 2000, item_type: "outsourced" },
      { so_item_id: 3, so_id: 1, product_id: null, outsourced_name: "Socket set", quantity: 10, unit_price: 50, total: 500, item_type: "outsourced" },
      { so_item_id: 4, so_id: 1, product_id: null, outsourced_name: "Jack", quantity: 4, unit_price: 100, total: 400, item_type: "outsourced" },
      { so_item_id: 5, so_id: 1, product_id: null, outsourced_name: "Forklift 5 ton", quantity: 1, unit_price: 1500, total: 1500, item_type: "outsourced" },
    ],
    delivery_permits: [
      { permit_id: 1, permit_no: "DP-1", sales_order_id: 1, status: "APPROVED", created_at: "2026-11-04T09:00:00", submitted_signed_at: "2026-11-05T09:00:00" },
      { permit_id: 2, permit_no: "DP-2", sales_order_id: 1, status: "SUBMITTED_SIGNED", created_at: "2026-11-08T09:00:00", submitted_signed_at: "2026-11-09T09:00:00" },
      { permit_id: 3, permit_no: "DP-3", sales_order_id: 1, status: "DRAFT", created_at: "2026-11-10T09:00:00" },
      { permit_id: 4, permit_no: "DP-X", sales_order_id: 1, status: "REJECTED", created_at: "2026-11-03T09:00:00" },
    ],
    delivery_permit_items: [
      { item_id: 1, permit_id: 1, product_id: null, item_name_snapshot: "Forklift 3 ton", quantity: 2, unit_price: 1000, total: 2000 },
      { item_id: 2, permit_id: 2, product_id: 7, item_name_snapshot: "Drill", quantity: 20, unit_price: 100, total: 2000 },
      { item_id: 3, permit_id: 3, product_id: null, item_name_snapshot: "Socket set", quantity: 10, unit_price: 50, total: 500 },
    ],
    product_returns: [{ return_id: 1, permit_id: "2", status: "approved", created_at: "2026-11-09T15:00:00+00:00" }],
    return_items: [{ return_item_id: 1, return_id: 1, product_id: 7, product_name: "Drill", returned_quantity: 2 }],
    purchase_orders: [
      { po_id: 1, po_number: "PO-1", supplier_id: 9, status: "approved", total: 2600, delivery_date: "2026-11-20", created_at: "2026-11-03T08:00:00" },
      { po_id: 2, po_number: "PO-2", supplier_id: 9, status: "received", total: 300, created_at: "2026-11-03T08:30:00" },
      { po_id: 3, po_number: "PO-OLD", supplier_id: 9, status: "cancelled", total: 99, created_at: "2026-11-02T08:30:00" },
    ],
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, source_so_item_id: 2, quantity: 2, unit_price: 700 },
      { po_item_id: 2, po_id: 2, source_so_item_id: 3, quantity: 10, unit_price: 30 },
      { po_item_id: 3, po_id: 1, source_so_item_id: 5, quantity: 1, unit_price: 1200 },
      { po_item_id: 4, po_id: 3, source_so_item_id: 4, quantity: 4, unit_price: 99 },
    ],
    goods_receipt_lines: [
      { line_id: 1, po_item_id: 1, quantity_received: 2 },
      { line_id: 2, po_item_id: 2, quantity_received: 10 },
    ],
    suppliers: [{ supplier_id: 9, supplier_name: "Mostafa" }],
    accounts_payable: [{ invoice_id: 50, po_id: 2, amount: 300, paid_amount: 300 }],
    supplier_credits: [{ credit_id: 1, used_in_po_id: 1, amount: 500, credit_type: "advance", status: "used" }],
    accounts_receivable: [{ invoice_id: 70, invoice_number: "INV-1", so_id: 1, amount: 2000, balance: 0, created_at: "2026-11-05T12:00:00" }],
    invoice_delivery_permits: [{ invoice_id: 70, permit_id: 1 }],
    customer_payments: [{ payment_id: 1, invoice_id: 70, amount: 2000, payment_date: "2026-11-06", payment_method: "bank_transfer" }],
    workflow_events: [
      { event_id: 1, entity_type: "SALES_ORDER", entity_id: 1, event_type: "NOTE", notes: "Customer wants the 5-ton by Sunday", performed_at: "2026-11-11T14:20:00" },
      { event_id: 2, entity_type: "PURCHASE_ORDER", entity_id: 1, event_type: "PO_ITEM_EXCHANGED", notes: "3 t → 5 t", performed_at: "2026-11-10T11:05:00" },
      { event_id: 3, entity_type: "SALES_ORDER", entity_id: 2, event_type: "NOTE", notes: "another order", performed_at: "2026-11-11T15:00:00" },
    ],
  })
}

test("O1. each line: steps, delivered net of returns, state and its documents", async () => {
  const ov = (await buildSoOverview(seed(), 1))!
  const by = Object.fromEntries(ov.lines.map((l) => [l.name, l]))
  assert.deepEqual(
    { src: by.Drill.source, onPo: by.Drill.onPo, del: by.Drill.delivered, ret: by.Drill.returned, state: by.Drill.state },
    { src: "stock", onPo: null, del: 18, ret: 2, state: "partial" },
  )
  assert.equal(by["Forklift 3 ton"].state, "delivered")
  assert.deepEqual(by["Forklift 3 ton"].dpNumbers, ["DP-1"])
  assert.deepEqual({ rec: by["Socket set"].received, state: by["Socket set"].state }, { rec: 10, state: "ready" })
  assert.deepEqual({ onPo: by.Jack.onPo, state: by.Jack.state }, { onPo: 0, state: "no_po" }) // the cancelled PO does not count
  assert.deepEqual({ onPo: by["Forklift 5 ton"].onPo, rec: by["Forklift 5 ton"].received, state: by["Forklift 5 ton"].state, pos: by["Forklift 5 ton"].poNumbers }, { onPo: 1, rec: 0, state: "waiting_supplier", pos: ["PO-1"] })
})

test("O2. the money bar adds up to the order total; every number once", async () => {
  const { money } = (await buildSoOverview(seed(), 1))!
  assert.deepEqual(money, { total: 7400, delivered: 3800, invoiced: 2000, paid: 2000, invoicedUnpaid: 0, deliveredNotInvoiced: 1800, notDelivered: 3600 })
  assert.equal(money.paid + money.invoicedUnpaid + money.deliveredNotInvoiced + money.notDelivered, money.total)
})

test("O3. what is left: missing PO, waiting supplier, ready, to deliver, unsigned DP, signed DP not invoiced", async () => {
  const { todo } = (await buildSoOverview(seed(), 1))!
  assert.deepEqual(todo, [
    { kind: "to_deliver", name: "Drill", quantity: 12 },
    { kind: "ready", name: "Socket set", quantity: 10 },
    { kind: "no_po", name: "Jack", quantity: 4 },
    { kind: "waiting_supplier", name: "Forklift 5 ton", quantity: 1, po: "PO-1", expected: "2026-11-20" },
    { kind: "not_invoiced", dp: "DP-2", value: 2000 },
    { kind: "draft_dp", dp: "DP-3" },
  ])
})

test("O4. DPs (rejected left out) and POs (cancelled left out) with paid, open/closed and exchanges", async () => {
  const ov = (await buildSoOverview(seed(), 1))!
  assert.deepEqual(ov.permits.map((p) => [p.number, p.invoiced, p.returned]), [["DP-1", "dp", 0], ["DP-2", null, 2], ["DP-3", null, 0]])
  assert.deepEqual(
    ov.pos.map((p) => ({ n: p.number, s: p.supplier, mine: p.forThisOrder, paid: p.paid, closed: p.closed, ex: p.exchanges })),
    [
      { n: "PO-1", s: "Mostafa", mine: 2600, paid: 500, closed: false, ex: 1 },
      { n: "PO-2", s: "Mostafa", mine: 300, paid: 300, closed: true, ex: 0 },
    ],
  )
})

test("O5. timeline newest first, notes of this order only, payments and returns included", async () => {
  const { timeline } = (await buildSoOverview(seed(), 1))!
  assert.deepEqual(timeline[0], { at: "2026-11-11T14:20:00", kind: "note", subject: "Customer wants the 5-ton by Sunday" })
  const kinds = timeline.map((e) => e.kind)
  for (const k of ["po_event", "returned", "dp_signed", "paid", "invoiced", "dp_created", "po_created", "so_created"]) assert.ok(kinds.includes(k as any), k)
  assert.equal(timeline.filter((e) => e.kind === "note").length, 1)
  assert.equal(timeline.at(-1)!.kind, "so_created")
})

test("O6. profit: PO cost of the order's lines plus stock at last landed cost; a stock item with no cost is flagged", async () => {
  const db = seed()
  assert.deepEqual(await soProfit(db, 1), { selling: 7400, poCost: 2900, stockCost: 1800, cost: 4700, profit: 2700, margin: 36.5, noCost: [] })
  db.tables.products[0].last_landed_cost = 0
  const p = (await soProfit(db, 1))!
  assert.deepEqual([p.stockCost, p.noCost], [0, ["Drill"]])
})

test("O7. a discounted / taxed order: delivered value scales to the order total", async () => {
  const db = seed()
  db.tables.sales_orders[0].total = 8436 // 7,400 + 14%
  const { money } = (await buildSoOverview(db, 1))!
  assert.equal(money.delivered, 4332) // 3,800 × 1.14
  assert.equal(money.paid + money.invoicedUnpaid + money.deliveredNotInvoiced + money.notDelivered, 8436)
})

test("O8. routes: overview for everyone who reads sales orders, profit for the CEO and admins only; unknown order 404", async () => {
  const profitRule = ruleFor("/api/sales-orders/overview/profit")!
  assert.equal(profitRule.prefix, "/api/sales-orders/overview/profit")
  assert.equal(allows(profitRule, "GET", ["sales-rep"]), false)
  assert.equal(allows(profitRule, "GET", ["accountant"]), false)
  assert.equal(allows(profitRule, "GET", ["ceo"]), true)
  assert.equal(allows(profitRule, "GET", ["admin"]), true)
  assert.equal(allows(ruleFor("/api/sales-orders/overview")!, "GET", ["sales-rep"]), true)
  assert.ok(RULES.length > 0)
  useDb(seed())
  const ok = await call(overviewRoute.GET as any, "GET", undefined, "http://test.local/api/x?soId=1")
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal((await call(overviewRoute.GET as any, "GET", undefined, "http://test.local/api/x?soId=99")).status, 404)
  assert.equal((await call(overviewRoute.GET as any, "GET", undefined, "http://test.local/api/x?soId=abc")).status, 400)
  assert.equal((await call(profitRoute.GET as any, "GET", undefined, "http://test.local/api/x?soId=1")).body.profit, 2700)
})

test("O9. the Overview button is on the sales order list and profit is only asked for by the CEO / admin", () => {
  assert.match(src("components/modules/sales-order-module.tsx"), /<OrderOverviewDialog/)
  const dialog = src("components/sales-order/order-overview-dialog.tsx")
  assert.match(dialog, /const PROFIT_ROLES: UserRole\[\] = \["ceo", "admin"\]/)
  assert.match(dialog, /if \(seesProfit\) \{\s*fetch\(`\/api\/sales-orders\/overview\/profit/)
})

test("O10. clicking a DP or PO in the overview opens that screen once, on that document", async () => {
  const { openDocument, takeDocumentFor } = await import("../open-document")
  const seen: string[] = []
  ;(globalThis as any).window = { dispatchEvent: (e: any) => seen.push(e.detail) }
  ;(globalThis as any).CustomEvent ||= class { type: string; detail: any; constructor(type: string, init: any) { this.type = type; this.detail = init?.detail } }
  openDocument("delivery-permits", "DP-2026-0002")
  assert.deepEqual(seen, ["delivery-permits"])
  assert.equal(takeDocumentFor("purchase-orders"), null) // another screen does not take it
  assert.equal(takeDocumentFor("delivery-permits"), "DP-2026-0002")
  assert.equal(takeDocumentFor("delivery-permits"), null) // only once
  openDocument("purchase-orders", "PO-1")
  assert.equal(takeDocumentFor("purchase-orders", Date.now() + 61_000), null) // too old
  const dialog = src("components/sales-order/order-overview-dialog.tsx")
  assert.match(dialog, /openDoc\("delivery-permits", p\.number\)/)
  assert.match(dialog, /openDoc\("purchase-orders", po\.number\)/)
  assert.match(src("components/modules/delivery-permits-module.tsx"), /takeDocumentFor\("delivery-permits"\)[\s\S]*setShowDetails\(true\)/)
  assert.match(src("components/modules/purchase-order-module.tsx"), /takeDocumentFor\("purchase-orders"\)[\s\S]*setSearchQuery\(asked\)/)
  delete (globalThis as any).window
})

test("O11. PO line status: not received / partly received / received (stock) / out for delivery / partly delivered / delivered", async () => {
  const { poLineStatuses } = await import("../po-line-status")
  const db = new FakeDb({
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, quantity: 4, source_so_id: null, source_so_item_id: null }, // stock, nothing received
      { po_item_id: 2, po_id: 1, quantity: 4, source_so_id: null, source_so_item_id: null }, // stock, 2 received
      { po_item_id: 3, po_id: 1, quantity: 3, source_so_id: null, source_so_item_id: null }, // stock, all received
      { po_item_id: 4, po_id: 1, quantity: 2, source_so_id: 1, source_so_item_id: 11 }, // A: received, out for delivery
      { po_item_id: 5, po_id: 1, quantity: 5, source_so_id: 1, source_so_item_id: 12 }, // B: 5 received, 3 delivered (4 signed - 1 returned)
      { po_item_id: 6, po_id: 1, quantity: 1, source_so_id: 1, source_so_item_id: 13 }, // C: delivered
      { po_item_id: 7, po_id: 1, quantity: 0, source_so_id: null, source_so_item_id: null }, // exchanged away: left out
    ],
    goods_receipt_lines: [
      { line_id: 1, po_item_id: 2, quantity_received: 2 },
      { line_id: 2, po_item_id: 3, quantity_received: 3 },
      { line_id: 3, po_item_id: 4, quantity_received: 2 },
      { line_id: 4, po_item_id: 5, quantity_received: 5 },
      { line_id: 5, po_item_id: 6, quantity_received: 1 },
    ],
    sales_order_items: [
      { so_item_id: 11, so_id: 1, product_id: null, outsourced_name: "A" },
      { so_item_id: 12, so_id: 1, product_id: null, outsourced_name: "B" },
      { so_item_id: 13, so_id: 1, product_id: null, outsourced_name: "C" },
    ],
    sales_orders: [{ so_id: 1, so_number: "SO-1" }],
    delivery_permits: [
      { permit_id: 1, sales_order_id: 1, status: "OUT_FOR_DELIVERY" },
      { permit_id: 2, sales_order_id: 1, status: "APPROVED" },
      { permit_id: 3, sales_order_id: 1, status: "REJECTED" },
    ],
    delivery_permit_items: [
      { item_id: 1, permit_id: 1, product_id: null, item_name_snapshot: "A", quantity: 2 },
      { item_id: 2, permit_id: 2, product_id: null, item_name_snapshot: "B", quantity: 4 },
      { item_id: 3, permit_id: 2, product_id: null, item_name_snapshot: "C", quantity: 1 },
      { item_id: 4, permit_id: 3, product_id: null, item_name_snapshot: "A", quantity: 2 },
    ],
    product_returns: [{ return_id: 1, permit_id: "2", status: "approved", created_at: "2026-11-10T00:00:00+00:00" }],
    return_items: [{ return_item_id: 1, return_id: 1, product_id: null, product_name: "B", returned_quantity: 1 }],
  })
  const s = await poLineStatuses(db, 1)
  assert.deepEqual(s.map((l) => [l.poItemId, l.state]), [
    [1, "not_received"],
    [2, "partly_received"],
    [3, "received"],
    [4, "out_for_delivery"],
    [5, "partly_delivered"],
    [6, "delivered"],
  ])
  assert.deepEqual([s[4].delivered, s[4].received, s[4].soNumber, s[2].delivered], [3, 5, "SO-1", null])
  assert.match(src("components/modules/purchase-order-module.tsx"), /<PoLineStatusBadge status=\{lineStatuses\?\.get\(String\(item\.id\)\)\} \/>/)
})
