// One invoice line per item (owner report, 2026-11-24): an invoice built from several delivery permits went to the
// e-invoice portal with "air pump EG-100060455-P47 qty 1 @ 18,900" three times. The same item (same product, or the
// same trimmed name for an outsourced line) at the same unit price, item code and unit type is now ONE line with the
// summed quantity, at the first one's position; returns are netted per permit first. See lib/merge-lines.ts.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { cannedDb, nreq } from "./hardening-fixtures"
import { useDb } from "./route-harness"
import { mergeKey, mergeSameLines, mergePrintItems } from "../merge-lines"
import { vatPerLine } from "../vat-lines"
import { buildInvoiceDocument } from "../eta/document"
import { buildEtaPreview } from "../eta/preview"
import { lineKey } from "../return-lines"
import {
  createDpInvoices, dpInvoiceEtaLines, evaluateAfterInsert, evaluateDpInvoice, loadSoInvoicingState, wholeOrderEtaLines, type SoInvoicingState,
} from "../invoicing"
import * as arPdf from "../../app/api/invoices/ar/[id]/pdf/route"
import * as arPdf2 from "../../app/api/invoices/ar/[id]/[invoiceId]/pdf/route"

const PUMP = 1
const LIFT = 2
// three permits: one pump and one car lift each (the third in the other order)
function threeDpDb(opts: { pump?: number; lift?: number; invoices?: Row[]; links?: Row[]; goLive?: string; returns?: { permit: number; product: number; qty: number; at: string }[] } = {}) {
  const pump = opts.pump ?? 18900
  const lift = opts.lift ?? 52000
  const dp = (permit: number, order: number[]) =>
    order.map((pid, i) => ({
      item_id: permit * 10 + i, permit_id: permit, product_id: pid, item_name_snapshot: pid === PUMP ? "air pump" : "car lift P13",
      quantity: 1, unit_price: pid === PUMP ? pump : lift, total: pid === PUMP ? pump : lift,
    }))
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-M-1", customer_id: 5, total: Math.round(3 * (pump + lift) * 114) / 100, subtotal: 3 * (pump + lift), discount_amount: 0, payment_type: "cash" }],
    customers: [{ customer_id: 5, customer_name: "C" }],
    sales_order_items: [
      { item_id: 1, so_id: 1, product_id: PUMP, outsourced_name: null, quantity: 3, unit_price: pump, total: 3 * pump },
      { item_id: 2, so_id: 1, product_id: LIFT, outsourced_name: null, quantity: 3, unit_price: lift, total: 3 * lift },
    ],
    products: [
      { product_id: PUMP, product_name: "air pump", eta_code_id: null, eta_unit_type: null },
      { product_id: LIFT, product_name: "car lift P13", eta_code_id: null, eta_unit_type: null },
    ],
    delivery_permits: [1, 2, 3].map((id) => ({ permit_id: id, permit_no: `DP-M-${id}`, sales_order_id: 1, status: "APPROVED" })),
    delivery_permit_items: [...dp(1, [PUMP, LIFT]), ...dp(2, [PUMP, LIFT]), ...dp(3, [LIFT, PUMP])],
    product_returns: (opts.returns || []).map((r, i) => ({ return_id: i + 1, permit_id: String(r.permit), status: "APPROVED", created_at: r.at })),
    return_items: (opts.returns || []).map((r, i) => ({ return_id: i + 1, product_id: r.product, product_name: null, returned_quantity: r.qty })),
    invoice_delivery_permits: opts.links || [],
    accounts_receivable: opts.invoices || [],
    // the fake database stamps new rows in 2026-10: a go-live before that makes them e-invoices, as they are today
    company_settings: [{ setting_key: "eta_go_live_at", setting_value: opts.goLive ?? "2026-01-01T00:00:00Z" }],
  })
}

const doc = (preview: any) =>
  buildInvoiceDocument(
    { ...preview, lines: preview.lines.map((l: any) => ({ ...l, itemCode: "EG-100060455-P47" })) },
    { eta_rin: "100060455", eta_activity_code: "4510" } as any,
    "2026-11-24T10:00:00Z",
  ) as any

test("M1. 3 permits each with 1 x the same item -> one e-invoice line, quantity 3; stored amount, preview and document agree", async () => {
  const db = threeDpDb()
  const state = await loadSoInvoicingState(db, 1)
  assert.deepEqual(
    dpInvoiceEtaLines(state!, [1, 2, 3]).map((l) => [l.name, l.quantity, l.unitPrice]),
    [["air pump", 3, 18900], ["car lift P13", 3, 52000]],
  )
  const res = await createDpInvoices(db, [1, 2, 3])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const inv = db.tables.accounts_receivable[0]
  assert.equal(inv.amount, vatPerLine([{ quantity: 3, unitPrice: 18900 }, { quantity: 3, unitPrice: 52000 }]).total)
  const preview = await buildEtaPreview(db, inv.invoice_id)
  assert.deepEqual(preview!.lines.map((l) => [l.name, l.quantity, l.unitPrice]), [["air pump", 3, 18900], ["car lift P13", 3, 52000]])
  assert.equal(preview!.totals.total, inv.amount)
  assert.ok(!preview!.missing.includes("amount_mismatch"))
  const d = doc(preview)
  assert.equal(d.invoiceLines.length, 2)
  assert.deepEqual(d.invoiceLines.map((l: any) => [l.quantity, l.unitValue.amountEGP, l.internalCode]), [[3, 18900, "1"], [3, 52000, "2"]])
  assert.equal(d.totalAmount, inv.amount)
})

test("M2. lines that differ in price (or code / unit) stay separate; first-occurrence order is kept; names are trimmed", () => {
  const state: SoInvoicingState = {
    so: { so_id: 1, total: 0, subtotal: 0, discount_amount: 0 },
    soItems: [{ product_id: PUMP, outsourced_name: null, quantity: 3, unit_price: 18900 }, { product_id: null, outsourced_name: "install", quantity: 2, unit_price: 500 }],
    permits: [
      { permit_id: 1, status: "APPROVED", items: [{ product_id: PUMP, item_name_snapshot: "air pump", quantity: 1, unit_price: 18900 }, { product_id: null, item_name_snapshot: "install", quantity: 1, unit_price: 500 }] },
      { permit_id: 2, status: "APPROVED", items: [{ product_id: PUMP, item_name_snapshot: "air pump", quantity: 1, unit_price: 18000 }] },
      { permit_id: 3, status: "APPROVED", items: [{ product_id: null, item_name_snapshot: " install ", quantity: 1, unit_price: 500 }, { product_id: PUMP, item_name_snapshot: "air pump", quantity: 1, unit_price: 18900 }] },
    ],
    invoices: [],
    returns: [],
  }
  assert.deepEqual(
    dpInvoiceEtaLines(state, [1, 2, 3]).map((l) => [l.name, l.quantity, l.unitPrice]),
    [["air pump", 2, 18900], ["install", 2, 500], ["air pump", 1, 18000]],
  )
  // a whole-order invoice merges the same way
  const dup = { ...state, soItems: [...state.soItems, { product_id: PUMP, outsourced_name: null, quantity: 1, unit_price: 18900 }], permits: [] }
  assert.deepEqual(wholeOrderEtaLines(dup).map((l) => [l.quantity, l.unitPrice]), [[4, 18900], [2, 500]])
  // the key: product, else trimmed name; price; item code; unit
  const k = (o: any) => mergeKey({ productId: PUMP, name: "x", unitPrice: 18900, ...o })
  assert.equal(k({}), k({ name: "other name", unitPrice: 18900.000000001 }))
  assert.notEqual(k({}), k({ unitPrice: 18900.01 }))
  assert.notEqual(k({ itemCode: "EG-1" }), k({ itemCode: "EG-2" }))
  assert.notEqual(k({ unit: "EA" }), k({ unit: "KGM" }))
  assert.equal(mergeKey({ productId: null, name: " a ", unitPrice: 1 }), mergeKey({ productId: null, name: "a", unitPrice: 1 }))
  assert.equal(mergeKey({ productId: null, name: "  ", unitPrice: 1 }), null)
  assert.deepEqual(mergeSameLines([1, 2, 1, 3, 1], (n) => String(n), () => 1, (a) => a + 10), [21, 2, 3])
})

test("M3. returns are netted per permit, then the same item is merged", async () => {
  // one pump returned from permit 2 before invoicing: 2 pumps billed on one line; a fully returned line adds nothing
  const db = threeDpDb({ returns: [{ permit: 2, product: PUMP, qty: 1, at: "2026-10-01T00:00:00Z" }, { permit: 3, product: LIFT, qty: 1, at: "2026-10-01T00:00:00Z" }] })
  const state = await loadSoInvoicingState(db, 1)
  assert.equal(state!.returns.length, 2)
  assert.equal(state!.returns[0].key, lineKey(PUMP, null))
  assert.deepEqual(dpInvoiceEtaLines(state!, [1, 2, 3]).map((l) => [l.name, l.quantity]), [["air pump", 2], ["car lift P13", 2]])
  const res = await createDpInvoices(db, [1, 2, 3])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const inv = db.tables.accounts_receivable[0]
  assert.equal(inv.amount, vatPerLine([{ quantity: 2, unitPrice: 18900 }, { quantity: 2, unitPrice: 52000 }]).total)
  const preview = await buildEtaPreview(db, inv.invoice_id)
  assert.deepEqual(preview!.lines.map((l) => l.quantity), [2, 2])
  assert.ok(!preview!.missing.includes("amount_mismatch"))
})

test("M4. an invoice stored before lines were merged (VAT rounded on each permit line) still passes the amount check", async () => {
  // 10.05 x 1 three times: 3 x 11.46 = 34.38 per permit line; 30.15 merged gives 34.37
  const unmerged = vatPerLine([1, 2, 3].map(() => ({ quantity: 1, unitPrice: 10.05 }))).total
  const merged = vatPerLine([{ quantity: 3, unitPrice: 10.05 }]).total
  assert.deepEqual([unmerged, merged], [34.38, 34.37])
  const old = { invoice_id: 7, invoice_number: "INV-OLD", so_id: 1, customer_id: 5, amount: unmerged, created_at: "2026-11-23T10:00:00Z" }
  const db = threeDpDb({
    pump: 10.05, lift: 0,
    invoices: [old],
    links: [1, 2, 3].map((p) => ({ invoice_id: 7, permit_id: p })),
  })
  db.tables.delivery_permit_items = db.tables.delivery_permit_items.filter((r: any) => r.product_id === PUMP)
  db.tables.sales_order_items = db.tables.sales_order_items.filter((r: any) => r.product_id === PUMP)
  const preview = await buildEtaPreview(db, 7)
  assert.equal(preview!.handledManually, false)
  assert.ok(!preview!.missing.includes("amount_mismatch"), JSON.stringify(preview!.missing))
  // its own (unmerged) lines are sent, so the portal total is exactly the stored amount
  assert.equal(preview!.totals.total, 34.38)
  assert.deepEqual(preview!.lines.map((l) => l.quantity), [1, 1, 1])
  assert.equal(doc(preview).totalAmount, 34.38)
  // the over-invoicing re-checks still accept it (the slack counts every permit line)
  const state = await loadSoInvoicingState(db, 1)
  assert.ok(evaluateAfterInsert(state!, 7).ok)

  // the same invoice created now stores the merged value and sends one line
  const fresh = threeDpDb({ pump: 10.05, lift: 0 })
  fresh.tables.delivery_permit_items = fresh.tables.delivery_permit_items.filter((r: any) => r.product_id === PUMP)
  fresh.tables.sales_order_items = fresh.tables.sales_order_items.filter((r: any) => r.product_id === PUMP)
  const fState = await loadSoInvoicingState(fresh, 1)
  assert.equal((evaluateDpInvoice(fState!, [1, 2, 3]) as any).newValue, 34.37)
  assert.equal((await createDpInvoices(fresh, [1, 2, 3])).status, 200)
  const inv = fresh.tables.accounts_receivable[0]
  assert.equal(inv.amount, 34.37)
  const p2 = await buildEtaPreview(fresh, inv.invoice_id)
  assert.deepEqual(p2!.lines.map((l) => l.quantity), [3])
  assert.ok(!p2!.missing.includes("amount_mismatch"))
})

async function printAr(amount: number, route: "ar" | "ar2" = "ar") {
  const item = (pid: number) => ({ product_id: pid, quantity: 1, unit_price: pid === PUMP ? 10.05 : 52000, total: pid === PUMP ? 10.05 : 52000, item_name_snapshot: pid === PUMP ? "air pump" : "car lift P13" })
  const permits = [[PUMP, LIFT], [PUMP, LIFT], [LIFT, PUMP]].map((order, i) => ({
    permit_id: i + 1, permit_no: `DP-M-${i + 1}`, status: "APPROVED",
    delivery_permit_items: order.map((pid, j) => ({ item_id: (i + 1) * 10 + j, ...item(pid) })),
  }))
  const products = (pid: number) => ({ product_name: pid === PUMP ? "air pump" : "car lift P13", sku: "" })
  useDb(
    cannedDb({
      accounts_receivable: [
        {
          invoice_id: 1, invoice_number: "INV-M-1", invoice_date: "2026-11-24", created_at: "2026-11-24T10:00:00Z", amount, so_id: 1,
          customers: { customer_name: "C", address: "A", city: "B" },
          sales_orders: {
            so_id: 1, so_number: "SO-M-1", subtotal: 3 * (10.05 + 52000), discount_amount: 0,
            sales_order_items: [PUMP, LIFT].map((pid) => ({ product_id: pid, quantity: 3, unit_price: item(pid).unit_price, total: 3 * item(pid).unit_price, item_type: "stock", outsourced_name: null, products: products(pid) })),
          },
        },
      ],
      invoice_delivery_permits: permits.map((p) => ({ permit_id: p.permit_id, delivery_permits: p })),
      delivery_permit_items: permits.flatMap((p) => p.delivery_permit_items.map((r) => ({ ...r, permit_id: p.permit_id, products: products(r.product_id) }))),
      sales_order_items: [],
      company_settings: [],
    }),
  )
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any
  try {
    const res = route === "ar"
      ? await arPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) })
      : await arPdf2.GET(nreq("http://test.local/x") as any, { params: Promise.resolve({ invoiceId: "1" }) })
    return await res.text()
  } finally {
    globalThis.fetch = realFetch
  }
}

test("M5. the AR invoice prints show one row per item with the summed quantity", async () => {
  const merged = vatPerLine([{ quantity: 3, unitPrice: 10.05 }, { quantity: 3, unitPrice: 52000 }]).total
  const html = await printAr(merged)
  assert.equal((html.match(/air pump/g) || []).length, 1, "one pump row")
  assert.equal((html.match(/car lift P13/g) || []).length, 1, "one lift row")
  assert.ok(/<td class="center pm-center">3<\/td>\s*<td>air pump<\/td>/.test(html))
  // an invoice stored from the unmerged permit lines keeps printing them (its total is exactly what was stored)
  const unmerged = vatPerLine([...[1, 2, 3].map(() => ({ quantity: 1, unitPrice: 10.05 })), ...[1, 2, 3].map(() => ({ quantity: 1, unitPrice: 52000 }))]).total
  assert.notEqual(unmerged, merged)
  const old = await printAr(unmerged)
  assert.equal((old.match(/air pump/g) || []).length, 3)
  // the English print merges too
  const html2 = await printAr(merged, "ar2")
  assert.equal((html2.match(/<div class="item-name">air pump<\/div>/g) || []).length, 1, html2.slice(0, 0))
  assert.ok(/air pump<\/div>[\s\S]*?<td class="pm-num">3<\/td>/.test(html2))
  // rows of a sent document are never merged
  assert.equal(mergePrintItems([{ eta_line: true, quantity: 1 }, { eta_line: true, quantity: 1 }] as any[], () => 1, () => "x").length, 2)
})
