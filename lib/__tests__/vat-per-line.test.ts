// VAT per invoice line (owner, 2026-11-22: "make sure all invoices have tax calculated row by row"): every new invoice
// stores the sum of its per-line totals (line net after discount x 14 %, rounded per line), go-live or not; the e-invoice
// document totals and the amount check use the same lines; prints keep their layout and print the per-line sums (or the
// stored amount when an older invoice differs). See lib/vat-lines.ts.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { cannedDb, nreq } from "./hardening-fixtures"
import { useDb } from "./route-harness"
import { pricedPerLine, vatLine, vatPerLine, vatPrintTotals, VAT_PER_LINE_FROM } from "../vat-lines"
import { etaLines } from "../eta/totals"
import { buildInvoiceDocument } from "../eta/document"
import { buildEtaPreview } from "../eta/preview"
import {
  computeInvoiceAmount, createDpInvoices, createSoInvoice, createStandaloneMinv, dpInvoiceEtaLines, evaluateDpInvoice, loadSoInvoicingState,
  orderDiscountRate, wholeOrderEtaLines,
} from "../invoicing"
import { createQuickMaintenanceInvoice, quickTotals } from "../maintenance-quick-invoice"
import { moneyCell } from "../print-html"
import * as arPdf from "../../app/api/invoices/ar/[id]/pdf/route"

// 0.35 / 1.15 / 2.05 with a 10 % order discount: per line 0.04 + 0.14 + 0.26 = 0.44 VAT, 3.62 in all;
// the earlier rule (discount and VAT once on the total) gives 3.64.
const PRICES = [0.35, 1.15, 2.05]
const GROSS = 3.55
const DISCOUNT = 0.355 // 10 %
const LINES = PRICES.map((p, i) => ({ name: `item ${i}`, quantity: 1, unitPrice: p }))

function orderDb(opts: { goLive?: string; invoices?: Row[]; links?: Row[] } = {}) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-V-1", customer_id: 5, total: 3.64, subtotal: GROSS, discount_amount: DISCOUNT, payment_type: "cash" }],
    customers: [{ customer_id: 5, customer_name: "C" }],
    sales_order_items: PRICES.map((p, i) => ({ so_id: 1, product_id: 100 + i, outsourced_name: null, quantity: 1, unit_price: p, total: p })),
    delivery_permits: [{ permit_id: 1, permit_no: "DP-V-1", sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: PRICES.map((p, i) => ({ item_id: i + 1, permit_id: 1, product_id: 100 + i, item_name_snapshot: `item ${i}`, quantity: 1, unit_price: p, total: p })),
    invoice_delivery_permits: opts.links || [],
    accounts_receivable: opts.invoices || [],
    ...(opts.goLive ? { company_settings: [{ setting_key: "eta_go_live_at", setting_value: opts.goLive }] } : {}),
  })
}

test("V1. one shared rule: line net after discount x 14 % rounded per line; VAT = sum of line VATs; total = nets + VATs", () => {
  const rate = DISCOUNT / GROSS
  const priced = vatPerLine(LINES, rate)
  assert.deepEqual(priced.lines.map((l) => [l.net, l.vat, l.gross]), [[0.31, 0.04, 0.35], [1.03, 0.14, 1.17], [1.84, 0.26, 2.1]])
  assert.equal(priced.vat, 0.44)
  assert.equal(priced.net, 3.18)
  assert.equal(priced.total, 3.62)
  assert.equal(priced.total, Math.round((priced.net + priced.vat) * 100) / 100)
  assert.equal(priced.total, Math.round(priced.lines.reduce((s, l) => s + l.gross, 0) * 100) / 100)
  // VAT on the total would differ by 2 piasters
  assert.equal(computeInvoiceAmount(GROSS, GROSS, DISCOUNT), 3.64)
  // the e-invoice lines are the same function under the portal's names
  const eta = etaLines(LINES, rate)
  assert.deepEqual(eta.totals, { sales: priced.sales, discount: priced.discount, net: priced.net, vat: priced.vat, total: priced.total })
  assert.deepEqual(eta.lines.map((l) => [l.netTotal, l.vat, l.total]), priced.lines.map((l) => [l.net, l.vat, l.gross]))
  // a line with nothing to bill is a 0 line (prints stay index-aligned); bad numbers count as 0
  assert.deepEqual(vatLine({ quantity: 0, unitPrice: 5 }), { quantity: 0, unitPrice: 5, sales: 0, discount: 0, net: 0, vat: 0, gross: 0 })
  assert.equal(vatPerLine([{ quantity: 1, unitPrice: 100 }], Number.NaN).total, 114)
})

test("V2. the invoice date rule: per line from VAT_PER_LINE_FROM (or after the go-live); earlier invoices keep theirs", () => {
  assert.equal(pricedPerLine(VAT_PER_LINE_FROM), true)
  assert.equal(pricedPerLine(new Date().toISOString()), true, "an invoice created now")
  assert.equal(pricedPerLine("2026-11-01T00:00:00Z"), false)
  assert.equal(pricedPerLine("2026-11-01T00:00:00Z", "2026-10-01T00:00:00Z"), true, "after the go-live")
  assert.equal(pricedPerLine(null), false)
  assert.equal(pricedPerLine("not a date"), false)
})

test("V3. a delivery-permit invoice stores the sum of the per-line totals (no go-live set)", async () => {
  const db = orderDb()
  const state = await loadSoInvoicingState(db, 1)
  const verdict = evaluateDpInvoice(state!, [1])
  assert.ok(verdict.ok)
  assert.equal((verdict as any).newValue, 3.62)
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const stored = db.tables.accounts_receivable[0].amount
  assert.equal(stored, 3.62)
  const lines = dpInvoiceEtaLines(state!, [1])
  assert.equal(stored, vatPerLine(lines, orderDiscountRate(state!.soItems, state!.so.subtotal, state!.so.discount_amount)).total)
})

test("V4. a whole-order invoice stores the per-line total, not the order's VAT-on-total figure", async () => {
  const db = orderDb()
  db.tables.delivery_permits = []
  db.tables.delivery_permit_items = []
  const res = await createSoInvoice(db, 1)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(db.tables.accounts_receivable[0].amount, 3.62)
  const state = await loadSoInvoicingState(db, 1)
  assert.equal(vatPerLine(wholeOrderEtaLines(state!), DISCOUNT / GROSS).total, 3.62)
})

test("V5. the e-invoice preview, its amount check and the document totals equal the stored amount", async () => {
  for (const goLive of [undefined, "2026-01-01T00:00:00Z"]) {
    const db = orderDb({ goLive })
    assert.equal((await createDpInvoices(db, [1])).status, 200)
    const stored = db.tables.accounts_receivable[0].amount
    const preview = await buildEtaPreview(db, db.tables.accounts_receivable[0].invoice_id)
    assert.ok(preview)
    assert.equal(preview!.totals.total, stored, `goLive=${goLive}`)
    assert.equal(preview!.totals.vat, 0.44)
    assert.ok(!preview!.missing.includes("amount_mismatch"), `goLive=${goLive}`)
    const doc = buildInvoiceDocument(
      { ...preview!, lines: preview!.lines.map((l) => ({ ...l, itemCode: "EG-123456789-1" })) },
      { eta_rin: "123456789", eta_activity_code: "4510" } as any,
      "2026-11-22T10:00:00Z",
    ) as any
    assert.equal(doc.totalAmount, stored)
    assert.equal(doc.taxTotals[0].amount, 0.44)
    const lineVats = doc.invoiceLines.map((l: any) => l.taxableItems[0].amount)
    assert.equal(Math.round(lineVats.reduce((s: number, v: number) => s + v, 0) * 100) / 100, doc.taxTotals[0].amount)
  }
})

test("V6. MINV / quick maintenance invoice: the stored amount is the per-line total", async () => {
  const lines = [
    { name: "a", quantity: 1, unitPrice: 10.05 },
    { name: "b", quantity: 1, unitPrice: 10.12 },
    { name: "c", quantity: 1, unitPrice: 10.19 },
  ]
  assert.deepEqual(quickTotals(lines), { net: 30.36, vat: 4.26, total: 34.62 }) // VAT on the total: 4.25 / 34.61
  const db = new FakeDb({ customers: [{ customer_id: 6, customer_name: "M" }], accounts_receivable: [], ar_invoice_lines: [] })
  db.jitter = false
  const quick = await createQuickMaintenanceInvoice(db, { customerId: 6, lines })
  assert.equal(quick.status, 200, JSON.stringify(quick.body))
  assert.equal(db.tables.accounts_receivable[0].amount, 34.62)
  // createStandaloneMinv prices its own lines: the caller cannot store a different amount
  const made = await createStandaloneMinv(db, { customerId: 6, lines: LINES.map((l) => ({ description: l.name, quantity: l.quantity, unitPrice: l.unitPrice })) })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  assert.equal(Number(made.body.amount), vatPerLine(LINES).total)
})

test("V7. prints keep their layout and show the per-line VAT sums; an older invoice prints its stored amount", async () => {
  const printAr = async (createdAt: string, amount: number) => {
    useDb(
      cannedDb({
        accounts_receivable: [
          {
            invoice_id: 1, invoice_number: "INV-V-1", invoice_date: "2026-11-22", created_at: createdAt, amount, so_id: 1,
            customers: { customer_name: "C", address: "A", city: "B" },
            sales_orders: {
              so_id: 1, so_number: "SO-V-1", subtotal: GROSS, discount_amount: DISCOUNT,
              sales_order_items: PRICES.map((p, i) => ({ product_id: 100 + i, quantity: 1, unit_price: p, total: p, item_type: "stock", outsourced_name: null, products: { product_name: `item ${i}` } })),
            },
          },
        ],
        invoice_delivery_permits: [
          {
            permit_id: 1,
            delivery_permits: {
              permit_id: 1, permit_no: "DP-V-1", status: "APPROVED",
              delivery_permit_items: PRICES.map((p, i) => ({ product_id: 100 + i, quantity: 1, unit_price: p, total: p, item_name_snapshot: `item ${i}` })),
            },
          },
        ],
      }),
    )
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("", { status: 404 })) as any
    try {
      return await (await arPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) })).text()
    } finally {
      globalThis.fetch = realFetch
    }
  }
  // new invoice (stored 3.62): subtotal, VAT and total are the per-line sums
  const html = await printAr("2026-11-22T10:00:00Z", 3.62)
  assert.ok(html.includes(`المجموع الفرعي</td>\n        ${moneyCell(3.18)}`), "subtotal = sum of line nets")
  assert.ok(html.includes(`(14%)</td>\n        ${moneyCell(0.44)}`), "VAT = sum of line VATs")
  assert.ok(html.includes(`إجمالي الفاتورة</td>\n        ${moneyCell(3.62)}`), "total = stored = per-line sum")
  // the layout is unchanged: four columns, no VAT column per row
  assert.equal((html.match(/<th[ >]/g) || []).length, 4)
  assert.ok(html.includes(`<td colspan="3" class="pm-num">المجموع الفرعي</td>`))

  // an invoice stored under the earlier rule (3.64, VAT on the total) still prints 3.64 - never silently changed
  const old = await printAr("2026-11-01T10:00:00Z", 3.64)
  assert.ok(old.includes(`إجمالي الفاتورة</td>\n        ${moneyCell(3.64)}`), "old total = stored")
  const split = vatPrintTotals(LINES, DISCOUNT / GROSS, 3.64)
  assert.equal(split.storedDiffers, true)
  assert.equal(split.difference, 0.02)
  assert.equal(Math.round((split.subtotalBeforeVat + split.vatAmount) * 100) / 100, 3.64)
  assert.ok(old.includes(`(14%)</td>\n        ${moneyCell(split.vatAmount)}`))
  // the earlier rule on the same net keeps its old before-VAT figure (30.36 -> 34.61 prints 30.36 + 4.25)
  const same = vatPrintTotals([{ quantity: 1, unitPrice: 10.05 }, { quantity: 1, unitPrice: 10.12 }, { quantity: 1, unitPrice: 10.19 }], 0, 34.61)
  assert.deepEqual([same.subtotalBeforeVat, same.vatAmount, same.totalWithVat, same.storedDiffers], [30.36, 4.25, 34.61, true])
})

test("V8. orders to invoice: the value shown is what the invoice then stores", async () => {
  const { ordersToInvoice } = await import("../ready-to-invoice")
  const db = orderDb()
  for (const t of ["products", "product_returns", "return_items", "purchase_order_items", "purchase_orders", "goods_receipt_lines", "customer_payments", "accounts_payable", "supplier_credits", "suppliers", "workflow_events"]) {
    db.tables[t] ||= []
  }
  const list = await ordersToInvoice(db)
  assert.equal(list.length, 1)
  assert.equal(list[0].value, 3.62)
  assert.equal(list[0].toInvoice[0].value, 3.62)
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  assert.equal(db.tables.accounts_receivable[0].amount, list[0].value)
})
