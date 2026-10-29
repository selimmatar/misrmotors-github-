// Quotation -> PR -> SO -> PO (owner request, 2026-10-28): the sales rep's conversion approves the order, sent
// quotations hold stock, price requests (PRs) link quotation / SO / PO. Every behaviour is also checked with the
// workflow switch off (lib/workflow-switch.ts), which must be the workflow from before this change.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as approveRoute from "../../app/api/sales-quotations/approve/route"
import * as inventoryRoute from "../../app/api/inventory/route"
import * as availabilityRoute from "../../app/api/sales-quotations/availability/route"
import * as poRequestsRoute from "../../app/api/po-requests/route"
import * as poRoute from "../../app/api/purchase-orders/route"
import { applyChosenCost, markupFrom, priceWithMarkup, supplierOffers } from "../po-requests/apply-costs"
import { readItemRows } from "../excel/read-item-rows"
import { loadChain, chainText } from "../po-requests/chain"
import * as chainRoute from "../../app/api/chain/route"
import * as quotationPdfRoute from "../../app/api/quotations/generate/route"
import { stockShortfall } from "../quotation-shortfall"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { workflowSwitch } from "../workflow-switch"
import { computeQuotationHolds, isQuotationHolding, quotationValidUntil, loadAvailability, loadHoldSplit } from "../stock-hold"
import { hideIdleApprovals, groupItems } from "../nav-groups"
import { approvalStepLabelKey } from "../approval-steps"
import { ROLE_MODULES } from "../../components/layout/nav-config"

const TODAY = new Date().toISOString().slice(0, 10)
const withSwitch = async (on: boolean, fn: () => Promise<void> | void) => {
  const before = workflowSwitch.newQuotationWorkflow
  workflowSwitch.newQuotationWorkflow = on
  try {
    await fn()
  } finally {
    workflowSwitch.newQuotationWorkflow = before
  }
}

const quotation = (id: number, over: Row = {}): Row => ({
  id, quotation_number: `Q-${id}`, status: "sent", customer_id: 5, subtotal: 500, total: 570, net_total: 570,
  payment_type: "cash", payment_details: {}, order_date: TODAY, validity_days: 30, ...over,
})
const qline = (id: number, quotation_id: number, product_id: number | null, quantity: number, item_type = "inventory"): Row => ({
  id, quotation_id, line_no: id, product_id, product_name: product_id ? `Product ${product_id}` : "Service", quantity, unit_price: 100, item_type,
})

function mk(seed: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    sales_quotations: [], sales_quotation_items: [], sales_orders: [], sales_order_items: [], delivery_permits: [],
    delivery_permit_items: [], suppliers: [], accounts_receivable: [], po_requests: [], po_request_items: [],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 10, unit_cost: 50, is_returned: false }],
    ...seed,
  })
  // The approve route reads the quotation with its items embedded.
  for (const q of db.tables.sales_quotations) q.items = db.tables.sales_quotation_items.filter((l) => l.quotation_id === q.id)
  db.rpcHandlers.generate_so_number = () => `SO-NEW-${db.tables.sales_orders.length + 1}`
  useDb(db)
  return db
}
const convert = (id: number) => call(approveRoute.POST as any, "POST", { quotation_id: id })

// ------------------------------------------------------------------------------------------- conversion = approval
test("conversion creates an approved sales order (new workflow)", async () => {
  await withSwitch(true, async () => {
    const db = mk({ sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 2)] })
    const r = await convert(1)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(db.tables.sales_orders[0].status, "accountant_approved")
    assert.match(r.body.message, /created and approved/)
  })
})

test("switch off: conversion waits for the accountant (old behaviour)", async () => {
  await withSwitch(false, async () => {
    const db = mk({ sales_quotations: [quotation(1, { payment_type: "hybrid", payment_details: { downPaymentAmount: 100 } })], sales_quotation_items: [qline(1, 1, 7, 2)] })
    const r = await convert(1)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(db.tables.sales_orders[0].status, "pending_accountant")
    assert.equal(db.tables.accounts_receivable.length, 0)
  })
})

test("new workflow: a quotation with missing stock converts; the response names what is missing", async () => {
  await withSwitch(true, async () => {
    // 10 on hand, 8 held by an approved order -> 2 free; the quotation asks for 5 (3 missing).
    const db = mk({
      sales_quotations: [quotation(1)],
      sales_quotation_items: [qline(1, 1, 7, 5)],
      sales_orders: [{ so_id: 40, so_number: "SO-OLD", status: "accountant_approved" }],
      sales_order_items: [{ so_item_id: 1, so_id: 40, product_id: 7, quantity: 8, item_type: "stock" }],
    })
    const r = await convert(1)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const so = db.tables.sales_orders.find((o) => o.parent_quotation_id === 1)!
    assert.equal(so.status, "accountant_approved")
    assert.deepEqual(r.body.missing, [{ productId: 7, name: "Product 7", requested: 5, available: 2, missing: 3 }])
    // Free stock never shows below zero for the next order.
    assert.equal((await loadAvailability(db, [7])).get(7)!.available, 0)
  })
})

test("new workflow: enough stock -> no missing list", async () => {
  await withSwitch(true, async () => {
    mk({ sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 5)] })
    const r = await convert(1)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.missing, [])
  })
})

test("switch off: a quotation with missing stock is still refused (old rule)", async () => {
  await withSwitch(false, async () => {
    const db = mk({ sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 15)] })
    const r = await convert(1)
    assert.equal(r.status, 400, JSON.stringify(r.body))
    assert.match(r.body.error, /^Insufficient inventory for Product 7\. Requested: 15, Available: 10$/)
    assert.equal(db.tables.sales_orders.length, 0)
  })
})

test("hybrid conversion creates the down-payment invoice", async () => {
  await withSwitch(true, async () => {
    const db = mk({
      sales_quotations: [quotation(1, { payment_type: "hybrid", payment_details: { downPaymentAmount: 150, remainingAmount: 420 } })],
      sales_quotation_items: [qline(1, 1, 7, 2)],
    })
    const r = await convert(1)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const so = db.tables.sales_orders[0]
    assert.equal(db.tables.accounts_receivable.length, 1)
    const inv = db.tables.accounts_receivable[0]
    assert.equal(inv.invoice_number, `INV-${so.so_number}-DP`)
    assert.equal(inv.amount, 150)
    assert.equal(inv.so_id, so.so_id)
    assert.equal(inv.customer_id, 5)
    assert.equal(inv.payment_terms, "down_payment")
  })
})

test("cash conversion creates no invoice", async () => {
  await withSwitch(true, async () => {
    const db = mk({ sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 2)] })
    assert.equal((await convert(1)).status, 200)
    assert.equal(db.tables.accounts_receivable.length, 0)
  })
})

test("conversion links the quotation's price requests to the new sales order", async () => {
  await withSwitch(true, async () => {
    const db = mk({
      sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 2)],
      po_requests: [{ request_id: 3, sales_quotation_id: 1, so_id: null, status: "quoted" }, { request_id: 4, sales_quotation_id: 2, so_id: null, status: "pending" }],
    })
    assert.equal((await convert(1)).status, 200)
    assert.equal(db.tables.po_requests[0].so_id, db.tables.sales_orders[0].so_id)
    assert.equal(db.tables.po_requests[1].so_id, null)
  })
})

test("no PR link on rollback: a failed item insert leaves the PR unlinked", async () => {
  await withSwitch(true, async () => {
    const db = mk({
      sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 2)],
      po_requests: [{ request_id: 3, sales_quotation_id: 1, so_id: null, status: "quoted" }],
    })
    db.failOn["sales_order_items:insert"] = "boom"
    const r = await convert(1)
    assert.equal(r.status, 500)
    assert.equal(db.tables.sales_orders.length, 0)
    assert.equal(db.tables.po_requests[0].so_id, null)
  })
})

// ------------------------------------------------------------------------------------------- accountant menu
test("accountant menu: no approve-sales-orders while nothing waits (new workflow)", () => {
  const items = hideIdleApprovals(ROLE_MODULES.accountant, {}, true)
  assert.deepEqual(groupItems(items)[1].items.map((i) => i.id), ["sales-orders", "customers", "delivery-permits"])
})

test("accountant menu: approve-sales-orders shows while an older order waits", () => {
  const items = hideIdleApprovals(ROLE_MODULES.accountant, { "approve-sales-orders": 2 }, true)
  assert.ok(items.some((i) => i.id === "approve-sales-orders"))
})

test("switch off: accountant menu unchanged (old behaviour)", () => {
  assert.deepEqual(hideIdleApprovals(ROLE_MODULES.accountant, {}, false).map((i) => i.id), ROLE_MODULES.accountant.map((i) => i.id))
})

test("approval tracker: first step is 'Approved' in the new workflow, 'Accountant' with the switch off", async () => {
  await withSwitch(true, () => assert.equal(approvalStepLabelKey("accountant"), "approval.approved"))
  await withSwitch(false, () => assert.equal(approvalStepLabelKey("accountant"), "approval.accountant"))
  assert.equal(approvalStepLabelKey("warehouse"), "approval.warehouse")
})

// ------------------------------------------------------------------------------------------- quotation hold
test("validity: order_date + validity_days, inclusive", () => {
  assert.equal(quotationValidUntil({ id: 1, status: "sent", order_date: "2026-10-01", validity_days: 30 }), "2026-10-31")
  assert.equal(isQuotationHolding({ id: 1, status: "sent", order_date: "2026-10-01", validity_days: 30 }, new Set(), "2026-10-31"), true)
  assert.equal(isQuotationHolding({ id: 1, status: "sent", order_date: "2026-10-01", validity_days: 30 }, new Set(), "2026-11-01"), false)
  assert.equal(isQuotationHolding({ id: 1, status: "sent", order_date: "2026-10-01", validity_days: 30 }, new Set([1]), "2026-10-02"), false)
})

const holds = (over: Partial<Parameters<typeof computeQuotationHolds>[0]> = {}) =>
  computeQuotationHolds({
    quotations: [{ id: 1, status: "sent", order_date: TODAY, validity_days: 30 }],
    lines: [{ quotation_id: 1, item_type: "inventory", product_id: 7, quantity: 4 }],
    free: new Map([[7, 10]]), convertedIds: new Set(), today: TODAY, ...over,
  })

test("sent quotation holds its stock lines", () => {
  assert.equal(holds().byProduct.get(7), 4)
})

test("outsourced lines are not held", () => {
  assert.equal(holds({ lines: [{ quotation_id: 1, item_type: "outsourced", product_id: null, quantity: 4 }] }).byProduct.size, 0)
})

test("rejected and expired quotations hold nothing", () => {
  assert.equal(holds({ quotations: [{ id: 1, status: "rejected", order_date: TODAY, validity_days: 30 }] }).byProduct.size, 0)
  assert.equal(holds({ quotations: [{ id: 1, status: "sent", order_date: "2020-01-01", validity_days: 30 }] }).byProduct.size, 0)
})

test("deleted quotation not counted (its row is gone)", () => {
  assert.equal(holds({ quotations: [] }).byProduct.size, 0)
})

test("checking a quotation leaves out only its own share; it keeps its place in line", () => {
  const h = holds({
    quotations: [{ id: 1, status: "sent", order_date: TODAY, validity_days: 30 }, { id: 2, status: "sent", order_date: TODAY, validity_days: 30 }],
    lines: [{ quotation_id: 1, product_id: 7, quantity: 8 }, { quotation_id: 2, product_id: 7, quantity: 5 }],
    excludeQuotationId: 1,
  })
  assert.equal(h.byProduct.get(7), 2)
})

test("a quotation holds only what is free; oldest first, the newer one is short", () => {
  const h = holds({
    quotations: [{ id: 2, status: "sent", order_date: TODAY, validity_days: 30 }, { id: 1, status: "sent", order_date: TODAY, validity_days: 30 }],
    lines: [{ quotation_id: 1, product_id: 7, quantity: 5 }, { quotation_id: 2, product_id: 7, quantity: 5 }],
    free: new Map([[7, 5]]),
  })
  assert.equal(h.byProduct.get(7), 5)
  assert.deepEqual(h.byQuotation.get(1)!.get(7), { requested: 5, held: 5 })
  assert.deepEqual(h.byQuotation.get(2)!.get(7), { requested: 5, held: 0 })
})

const holdSeed = () => ({
  sales_quotations: [quotation(1)],
  sales_quotation_items: [qline(1, 1, 7, 4), qline(2, 1, null, 1, "outsourced")],
  sales_orders: [{ so_id: 40, so_number: "SO-OLD", status: "accountant_approved", parent_quotation_id: null }],
  sales_order_items: [{ so_item_id: 1, so_id: 40, product_id: 7, quantity: 2, item_type: "stock" }],
})

test("warehouse: Hold shows orders + quotations, with the quotation part", async () => {
  await withSwitch(true, async () => {
    mk(holdSeed())
    const r = await call(inventoryRoute.GET as any, "GET", undefined, "http://test.local/api/inventory")
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const row = (Array.isArray(r.body) ? r.body : r.body.inventory || r.body.data).find((x: any) => x.productId === "7")
    assert.equal(row.onHold, 6)
    assert.equal(row.onHoldByQuotations, 4)
    assert.equal(row.available, 4)
  })
})

test("switch off: quotations hold nothing (old behaviour)", async () => {
  await withSwitch(false, async () => {
    const db = mk(holdSeed())
    const split = await loadHoldSplit(db)
    assert.equal(split.total.get(7), 2)
    assert.equal(split.quotations.byProduct.size, 0)
  })
})

test("converted quotation holds nothing: its sales order holds instead (no double count)", async () => {
  await withSwitch(true, async () => {
    const db = mk({ sales_quotations: [quotation(1)], sales_quotation_items: [qline(1, 1, 7, 4)] })
    assert.equal((await loadHoldSplit(db)).total.get(7), 4)
    assert.equal((await convert(1)).status, 200)
    const split = await loadHoldSplit(db)
    assert.equal(split.total.get(7), 4)
    assert.equal(split.quotations.byProduct.size, 0)
  })
})

test("second quotation sees reduced availability; conversion excludes its own hold", async () => {
  await withSwitch(true, async () => {
    const db = mk({
      sales_quotations: [quotation(1), quotation(2)],
      sales_quotation_items: [qline(1, 1, 7, 8), qline(2, 2, 7, 5)],
    })
    // quotation 1 (older) holds 8 of the 10; quotation 2 asks for 5 and only 2 are left for it
    assert.equal((await loadAvailability(db, [7], { excludeQuotationId: 2 })).get(7)!.available, 2)
    // checking quotation 1 itself: the newer quotation 2 cannot take its place in line (it holds only 2)
    assert.equal((await loadAvailability(db, [7], { excludeQuotationId: 1 })).get(7)!.available, 8)
    // quotation 2 still converts (new workflow) and its order waits for the 3 it is short
    const r2 = await convert(2)
    assert.equal(r2.status, 200, JSON.stringify(r2.body))
    assert.deepEqual(r2.body.missing.map((m: Row) => [m.available, m.missing]), [[2, 3]])
    assert.equal((await convert(1)).status, 200)
  })
})

// ------------------------------------------------------------------------------------------- "N missing"
test("stockShortfall: missing part only, nothing while free is unknown", () => {
  assert.equal(stockShortfall(5, 3), 2)
  assert.equal(stockShortfall(2, 3), 0)
  assert.equal(stockShortfall(5, null), 0)
  assert.equal(stockShortfall(5, -1), 5)
})

test("availability route: leaves the asking quotation's own hold out", async () => {
  await withSwitch(true, async () => {
    mk({ sales_quotations: [quotation(1), quotation(2)], sales_quotation_items: [qline(1, 1, 7, 8), qline(2, 2, 7, 5)] })
    const url = (q: string) => `http://test.local/api/sales-quotations/availability?${q}`
    assert.deepEqual((await call(availabilityRoute.GET as any, "GET", undefined, url("product_ids=7&quotation_id=2"))).body, { availability: { "7": 2 } })
    assert.deepEqual((await call(availabilityRoute.GET as any, "GET", undefined, url("product_ids=7&quotation_id=1"))).body, { availability: { "7": 8 } })
    assert.equal((await call(availabilityRoute.GET as any, "GET", undefined, url("product_ids=7&quotation_id=abc"))).status, 400)
  })
})

test("new quotation screen: asking for more than is free is allowed only in the new workflow", () => {
  const src = readFileSync(join(process.env.REPO_ROOT || process.cwd(), "components/modules/sales-quotation-module.tsx"), "utf8")
  assert.match(src, /const outOfStockItem = newWorkflow \? undefined :/)
  assert.match(src, /if \(!newWorkflow && stockLimit !== null/)
  assert.match(src, /<StockShortfallNote free=\{stockLimit\} requested=\{item.quantity\} \/>/)
})

test("Request price from supplier is on the quotation screen before saving, not on the waiting-quotations list", () => {
  const read = (f: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), f), "utf8")
  const create = read("components/modules/sales-quotation-module.tsx")
  // Always shown under Save & Generate PDF, not only in the box that appears after saving
  assert.match(create, /\{newWorkflow && \(\s*<div className="space-y-1 pt-2">\s*<RequestPriceButton prepare=\{prepareRequestPrice\}/)
  assert.doesNotMatch(create, /savedQuotation && savedPdfUrl && \([\s\S]{0,800}<RequestPriceButton/)
  // Not saved yet: the click saves it first (same checks as Save); saved already: the same quotation is used
  assert.match(create, /if \(savedQuotation\) \{\s*return \{ quotation: \{ id: savedQuotation.id/)
  assert.match(create, /if \(!validateQuotation\(\)\) return null/)
  // Printing afterwards reuses that quotation while nothing changed, instead of saving a second one
  assert.match(create, /savedFormRef.current === formSnapshot\(\)/)
  assert.match(create, /lineNo: index \+ 1,/)
  // The list only approves or rejects; prices are asked from the quotation itself (create screen or its edit window)
  assert.doesNotMatch(read("components/modules/approve-sales-quotations-module.tsx"), /RequestPriceButton/)
  const button = read("components/sales-quotation/request-price-button.tsx")
  assert.match(button, /stockShortfall\(l.quantity, free\[String\(l.productId\)\]\)/)
})

test("quotation PDF: lines without a product id do not ask the database for product 'undefined'", async () => {
  const db = mk({ products: [{ product_id: 7, product_name: "Pump 7", unit_price: 100 }] })
  const asked: any[][] = []
  const from = db.from.bind(db)
  db.from = ((table: string) => {
    const q: any = from(table)
    const inFn = q.in.bind(q)
    q.in = (c: string, vs: any[]) => { asked.push(vs); return inFn(c, vs) }
    return q
  }) as any
  useDb(db)
  const pdf = (items: any[]) => {
    const data = encodeURIComponent(JSON.stringify({ customer_name: "Dummy", items }))
    const url = new URL(`http://test.local/api/quotations/generate?data=${data}&qn=QT-T-1`)
    return quotationPdfRoute.GET(Object.assign(new Request(url), { nextUrl: url }) as any)
  }
  const res = await pdf([{ product_name: "Bought-in pump", quantity: 1, unit_price: 50 }])
  assert.equal(res.status, 200)
  assert.deepEqual(asked, [])
  const res2 = await pdf([{ product_id: 7, quantity: 2 }, { product_name: "Bought-in pump", quantity: 1, unit_price: 50 }])
  assert.equal(res2.status, 200)
  assert.deepEqual(asked, [[7]])
  assert.match(await res2.text(), /Pump 7/)
})

// ------------------------------------------------------------------------------------------- price requests (PR)
const prDb = (seed: Record<string, Row[]> = {}) => {
  const db = mk({ purchase_orders: [], purchase_order_items: [], sales_order_items: [], ...seed })
  let n = 0
  db.rpcHandlers.generate_po_request_number = () => `PR-T-${++n}`
  db.rpcHandlers.generate_po_number = () => `PO-T-${++n}`
  return db
}
const prItem = (over: Row = {}): Row => ({ product_id: null, product_name: "Pump", quantity: 2, unit: "unit", ...over })
const postPr = (body: Row) => call(poRequestsRoute.POST as any, "POST", { supplier_id: 3, items: [prItem()], ...body })
const putPr = (body: Row) => call(poRequestsRoute.PUT as any, "PUT", body)

test("PR from a quotation keeps the quotation, its line numbers and (once converted) the sales order", async () => {
  const db = prDb({ sales_quotations: [quotation(1)], sales_orders: [{ so_id: 40, so_number: "SO-40", parent_quotation_id: 1 }] })
  const r = await postPr({ sales_quotation_id: 1, items: [prItem({ quotation_line_no: 2 })] })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const pr = db.tables.po_requests[0]
  assert.equal(pr.sales_quotation_id, 1)
  assert.equal(pr.so_id, 40)
  assert.equal(pr.status, "pending")
  assert.equal(db.tables.po_request_items[0].quotation_line_no, 2)
})

test("PR without a quotation works as before; a missing or bad quotation is refused", async () => {
  const db = prDb()
  assert.equal((await postPr({})).status, 201)
  assert.equal(db.tables.po_requests[0].sales_quotation_id, undefined)
  assert.equal(db.tables.po_request_items[0].quotation_line_no ?? null, null)
  assert.equal((await postPr({ sales_quotation_id: 99 })).status, 404)
  assert.equal((await postPr({ sales_quotation_id: "x" })).status, 400)
})

test("Quote received: saves the supplier prices and marks the PR quoted", async () => {
  const db = prDb({
    po_requests: [{ request_id: 5, request_number: "PR-5", supplier_id: 3, status: "pending" }],
    po_request_items: [{ item_id: 8, request_id: 5, product_name: "Pump", quantity: 2, unit_price: null }],
  })
  const r = await putPr({ request_id: 5, status: "quoted", items: [{ item_id: 8, unit_price: 120 }], supplier_quote_file_url: "https://f/q.pdf" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.po_request_items[0].unit_price, 120)
  assert.equal(db.tables.po_requests[0].status, "quoted")
  assert.equal(db.tables.po_requests[0].supplier_quote_file_url, "https://f/q.pdf")
  assert.equal((await putPr({ request_id: 5, status: "quoted", items: [{ item_id: 8, unit_price: -1 }] })).status, 400)
  assert.equal((await putPr({ request_id: 5, status: "converted" })).status, 400)
})

test("a used (converted) PR cannot be changed", async () => {
  const db = prDb({ po_requests: [{ request_id: 5, request_number: "PR-5", supplier_id: 3, status: "converted" }] })
  assert.equal((await putPr({ request_id: 5, status: "pending" })).status, 409)
  assert.equal(db.tables.po_requests[0].status, "converted")
})

test("Supplier costs: every price request's prices are listed per outsourced line, cheapest first; stock, removed and cancelled left out", () => {
  const lines = [
    { lineNo: 1, outsourced: false, productName: "Oil", unitCost: null, unitPrice: 50 },
    { lineNo: 2, outsourced: true, productName: "Pump ", unitCost: null, unitPrice: 300 },
    { lineNo: 3, outsourced: true, productName: "Gauge", unitCost: null, unitPrice: 0 },
  ]
  const offers = supplierOffers(lines, [
    {
      request_id: 7, request_number: "PR-7", status: "quoted", supplier_id: 4, suppliers: { supplier_name: "APAC " },
      po_request_items: [
        { quotation_line_no: 1, product_name: "Oil", unit_price: 10 },
        { quotation_line_no: 2, product_name: "pump", unit_price: 220 },
        { quotation_line_no: 9, product_name: "Valve", unit_price: 5 },
        { quotation_line_no: 3, product_name: "Gauge", unit_price: null },
      ],
    },
    {
      request_id: 8, request_number: "PR-8", status: "converted", supplier_id: 3, suppliers: { supplier_name: "SMG" },
      po_request_items: [{ quotation_line_no: 2, product_name: "Pump", unit_price: "200" }, { quotation_line_no: 3, product_name: "gauge", unit_price: 30 }],
    },
    { request_id: 9, request_number: "PR-9", status: "cancelled", supplier_id: 5, po_request_items: [{ quotation_line_no: 2, product_name: "Pump", unit_price: 1 }] },
  ])
  assert.deepEqual(Object.keys(offers), ["2", "3"])
  assert.deepEqual(offers[2].map((o) => [o.requestNumber, o.supplierName, o.supplierId, o.price]), [["PR-8", "SMG", "3", 200], ["PR-7", "APAC", "4", 220]])
  assert.deepEqual(offers[3].map((o) => o.requestNumber), ["PR-8"])
})

test("Supplier costs: the chosen price becomes the cost and the supplier goes on the line; price follows the markup", () => {
  const offer = { requestId: 8, requestNumber: "PR-8", supplierId: "3", supplierName: "SMG", price: 200 }
  // Already costed: markup kept, price follows the new cost.
  const a = applyChosenCost({ lineNo: 2, outsourced: true, productName: "Pump", unitCost: 250, unitPrice: 300, markup: 20, supplierId: "4", supplierName: "APAC" }, offer)
  assert.deepEqual([a.unitCost, a.unitPrice, a.markup, a.supplierId, a.supplierName], [200, 240, 20, "3", "SMG"])
  // Priced but never costed: the sales rep's price stays, the markup shows what it means.
  const b = applyChosenCost({ lineNo: 2, outsourced: true, productName: "Pump", unitCost: null, unitPrice: 300, markup: 0 }, offer)
  assert.deepEqual([b.unitCost, b.unitPrice, b.markup], [200, 300, 50])
  // Not priced yet: price = cost.
  const c = applyChosenCost({ lineNo: 2, outsourced: true, productName: "Pump", unitCost: null, unitPrice: 0, markup: 0 }, offer)
  assert.deepEqual([c.unitCost, c.unitPrice], [200, 200])
  assert.equal(priceWithMarkup(1000, 20), 1200)
  assert.equal(priceWithMarkup(333.33, 15), 383.33)
  assert.equal(markupFrom(1000, 1200), 20)
  assert.equal(markupFrom(null, 1200), 0)
  assert.equal(markupFrom(1000, 0), 0)
})

test("quotation edit window: cost and markup fields, markup for all items, choose supplier costs", () => {
  const src = readFileSync(join(process.env.REPO_ROOT || process.cwd(), "components/sales-quotation/approve-convert-quotation-dialog.tsx"), "utf8")
  assert.match(src, /t\("chain.cost"\)/)
  assert.match(src, /t\("so.markup"\)/)
  assert.match(src, /t\("chain.markup-all"\)/)
  assert.match(src, /onClick=\{openChooseCosts\}/)
  assert.match(src, /unit_cost: item.itemType === "outsourced" \? item.unitCost \?\? null : null/)
  assert.doesNotMatch(src, /chain\.use-costs/)
})

test("Excel rows: empty names dropped, quantity defaults to 1", () => {
  const rows = readItemRows([{ "Product Name": "Pump", Quantity: 3, "Unit Price": 10 }, { "Product Name": "  " }, { "Product Name": "Valve" }] as any)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].quantity, 3)
  assert.equal(rows[1].quantity, 1)
})

// ------------------------------------------------------------------------------------------- PR on the PO
const postPo = (body: Row) =>
  call(poRoute.POST as any, "POST", {
    supplier_id: 3, status: "pending", payment_terms: "cash", payment_type: "cash",
    items: [{ productName: "Pump", quantity: 2, unitPrice: 100, total: 200, itemType: "outsourced" }], ...body,
  })
const openPr = (status = "quoted", over: Row = {}): Row => ({ request_id: 5, request_number: "PR-5", supplier_id: 3, status, ...over })

test("a PO saved with its PR keeps the link and marks the PR converted", async () => {
  const db = prDb({ po_requests: [openPr()] })
  const r = await postPo({ po_request_id: "5" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_orders[0].po_request_id, 5)
  assert.equal(db.tables.po_requests[0].status, "converted")
})

test("a PO cannot use another supplier's PR or a used one", async () => {
  const db = prDb({ po_requests: [openPr()] })
  assert.equal((await postPo({ supplier_id: 4, po_request_id: 5 })).status, 400)
  db.tables.po_requests[0].status = "converted"
  assert.equal((await postPo({ po_request_id: 5 })).status, 409)
  assert.equal((await postPo({ po_request_id: 77 })).status, 404)
  assert.equal(db.tables.purchase_orders.length, 0)
})

test("a PO without a PR is unchanged", async () => {
  const db = prDb({ po_requests: [openPr("pending")] })
  assert.equal((await postPo({})).status, 200)
  assert.equal(db.tables.purchase_orders[0].po_request_id, undefined)
  assert.equal(db.tables.po_requests[0].status, "pending")
})

test("PO list shows the PR number", async () => {
  prDb({ po_requests: [openPr()] })
  await postPo({ po_request_id: 5 })
  const list = await call(poRoute.GET as any, "GET")
  assert.equal(list.status, 200, JSON.stringify(list.body))
  const rows = Array.isArray(list.body) ? list.body : list.body.data || list.body.orders
  assert.equal(rows[0].poRequestNumber, "PR-5")
  assert.equal(rows[0].poRequestSoId, undefined) // PR not yet tied to a sales order
})

test("a bought-in PO line sent with only its product name keeps that name (not 'Outsourced Item')", async () => {
  prDb({ po_requests: [] })
  await postPo({ items: [{ productName: "Custom VFD panel", quantity: 1, unitPrice: 2100, total: 2100, itemType: "outsourced" }] })
  const list = await call(poRoute.GET as any, "GET")
  const rows = Array.isArray(list.body) ? list.body : list.body.data || list.body.orders
  assert.equal(rows[0].items[0].productName, "Custom VFD panel")
  assert.equal(rows[0].items[0].outsourcedName, "Custom VFD panel")
})

test("PO list carries the PR's sales order for the 'For sales order' column", async () => {
  prDb({ po_requests: [openPr("pending", { so_id: 40 })] })
  await postPo({ po_request_id: 5 })
  const list = await call(poRoute.GET as any, "GET")
  const rows = Array.isArray(list.body) ? list.body : list.body.data || list.body.orders
  assert.equal(rows[0].poRequestSoId, "40")
})

// ------------------------------------------------------------------------------------------- the chain line
const chainDb = () =>
  prDb({
    sales_quotations: [quotation(31, { quotation_number: "Q-0031" }), quotation(32, { quotation_number: "Q-0032" })],
    sales_orders: [{ so_id: 45, so_number: "SO-0045", parent_quotation_id: 31 }],
    po_requests: [
      { request_id: 7, request_number: "PR-0007", supplier_id: 3, status: "converted", sales_quotation_id: 31, so_id: 45 },
      { request_id: 8, request_number: "PR-0008", supplier_id: 3, status: "pending", sales_quotation_id: 32, so_id: null },
      { request_id: 9, request_number: "PR-0009", supplier_id: 3, status: "converted", sales_quotation_id: null, so_id: null },
    ],
    purchase_orders: [
      { po_id: 28, po_number: "PO-0028", supplier_id: 3, po_request_id: 7 },
      { po_id: 29, po_number: "PO-0029", supplier_id: 3, po_request_id: 9 },
      { po_id: 30, po_number: "PO-0030", supplier_id: 3 },
    ],
  })

test("chain: the same line from the quotation, the PR, the sales order and the PO", async () => {
  const db = chainDb()
  for (const start of [{ quotationId: 31 }, { prId: 7 }, { soId: 45 }, { poId: 28 }] as const) {
    assert.equal(chainText(await loadChain(db, start)), "Q-0031 → PR-0007 → SO-0045 → PO-0028", JSON.stringify(start))
  }
})

test("chain: links that do not exist are left out; a lone document shows nothing", async () => {
  const db = chainDb()
  assert.equal(chainText(await loadChain(db, { quotationId: 32 })), "Q-0032 → PR-0008")
  assert.equal(chainText(await loadChain(db, { poId: 29 })), "PR-0009 → PO-0029")
  assert.equal(chainText(await loadChain(db, { poId: 30 })), "")
  assert.equal(chainText(await loadChain(db, { quotationId: 99 })), "")
})

test("chain route: needs one valid id", async () => {
  chainDb()
  const url = (q: string) => `http://test.local/api/chain?${q}`
  const ok = await call(chainRoute.GET as any, "GET", undefined, url("so_id=45"))
  assert.equal(ok.status, 200)
  assert.equal(ok.body.quotation.number, "Q-0031")
  assert.equal((await call(chainRoute.GET as any, "GET", undefined, url("po_id=x"))).status, 400)
  assert.equal((await call(chainRoute.GET as any, "GET", undefined, url(""))).status, 400)
})

// ------------------------------------------------------------------------------------------- no CEO approval of POs
const withPoAuto = async (on: boolean, fn: () => Promise<void>) => {
  const before = workflowSwitch.poAutoApprove
  workflowSwitch.poAutoApprove = on
  try {
    await fn()
  } finally {
    workflowSwitch.poAutoApprove = before
  }
}

test("a new PO is approved when saved and gets its supplier invoice (no CEO step)", async () => {
  await withPoAuto(true, async () => {
    const db = prDb({ po_requests: [openPr()], accounts_payable: [], supplier_payments: [] })
    const r = await postPo({ po_request_id: 5, created_by: "Mona" })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.autoApproved, true)
    assert.equal(r.body.status, "approved")
    const po = db.tables.purchase_orders[0]
    assert.equal(po.status, "approved")
    assert.ok(po.approved_at)
    assert.equal(po.approved_by, "Mona")
    assert.equal(db.tables.accounts_payable.length, 1)
    assert.equal(db.tables.accounts_payable[0].invoice_number, `APINV-${po.po_number}`)
    assert.equal(db.tables.accounts_payable[0].amount, po.total)
    assert.equal(db.tables.po_requests[0].status, "converted")
  })
})

test("a draft PO is not approved", async () => {
  await withPoAuto(true, async () => {
    const db = prDb({ accounts_payable: [] })
    const r = await postPo({ status: "draft" })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(db.tables.purchase_orders[0].status, "draft")
    assert.equal(db.tables.accounts_payable.length, 0)
  })
})

test("supplier invoice fails: the PO is kept as pending for the CEO/admin to approve", async () => {
  await withPoAuto(true, async () => {
    const db = prDb({ accounts_payable: [] })
    db.failOn["accounts_payable:insert"] = "boom"
    const r = await postPo({})
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.autoApproved, false)
    const po = db.tables.purchase_orders[0]
    assert.equal(po.status, "pending")
    assert.equal(po.approved_at, null)
    assert.equal(db.tables.accounts_payable.length, 0)
  })
})

test("switch off: a new PO waits as pending for the CEO (old behaviour)", async () => {
  await withPoAuto(false, async () => {
    const db = prDb({ accounts_payable: [] })
    const r = await postPo({})
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.autoApproved, undefined)
    assert.equal(db.tables.purchase_orders[0].status, "pending")
    assert.equal(db.tables.accounts_payable.length, 0)
  })
})
