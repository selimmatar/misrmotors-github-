// Owner screenshot (quotation PDF): in the Arabic (RTL) printouts the bidi algorithm reversed phone numbers -
// "+20 100 945 5019" printed as "5019 945 100 20+", "02-33039811" as "33039811-02". Every phone / fax / e-mail printed
// by an HTML/PDF route is now wrapped in an LTR isolate (<bdi dir="ltr">), still HTML-escaped.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { useDb } from "./route-harness"
import { ltrText } from "../html-escape"
import { ltrText as ltrFromPrintHtml } from "../print-html"
import { COMPANY_SETTINGS } from "../company-settings"
import { HOSTILE, hostile, ordinary, renderAll } from "./hardening-fixtures"
import * as soPrintRoute from "../../app/api/sales-orders/print/route"

const wrapped = (v: string) => `<bdi dir="ltr">${v}</bdi>`
const count = (s: string, sub: string) => s.split(sub).length - 1

/** Every occurrence of `value` in `html` sits inside an LTR isolate, and there is at least one. */
function assertIsolated(html: string, value: string, where: string) {
  const total = count(html, value)
  assert.ok(total > 0, `${where}: "${value}" not printed`)
  assert.equal(count(html, wrapped(value)), total, `${where}: "${value}" printed outside <bdi dir="ltr">`)
}

test("L1. ltrText escapes and wraps in an LTR isolate; print-html re-exports the same helper", () => {
  assert.equal(ltrText("+20 100 945 5019"), '<bdi dir="ltr">+20 100 945 5019</bdi>')
  assert.equal(ltrText(`<b>"a"&'</b>`), '<bdi dir="ltr">&lt;b&gt;&quot;a&quot;&amp;&#39;&lt;/b&gt;</bdi>')
  assert.equal(ltrText(null), '<bdi dir="ltr"></bdi>')
  assert.equal(ltrFromPrintHtml, ltrText)
})

// The phone / e-mail values each print route shows (from hardening-fixtures' canned data).
const PARTY: Record<string, string[]> = {
  dp: ["Phone-DP"],
  poRequest: ["Phone-0200", "s@example.com"],
  po: ["Phone-0300", "t@example.com"],
  ap: ["Phone-0400"],
  ap2: ["Phone-0400", "ap@example.com", "Phone-0211", "co@example.com"],
  ar: ["Phone-0111"],
  ar2: ["Phone-0500", "c@example.com"],
  quotation: ["Phone-0100", "c@example.com"],
  workOrder: ["Phone-0600"],
}
const WITH_COMPANY_HEADER = ["dp", "poRequest", "po", "ap", "ar", "quotation", "workOrder"]

test("L2. every PDF route prints company phone/fax/e-mail and party phones/e-mails inside <bdi dir=ltr>", async () => {
  const out = await renderAll(ordinary)
  for (const [key, values] of Object.entries(PARTY)) {
    assert.equal(out[key].status, 200, key)
    const html = out[key].html
    for (const v of values) assertIsolated(html, v, key)
    if (WITH_COMPANY_HEADER.includes(key)) {
      for (const v of [COMPANY_SETTINGS.phone, COMPANY_SETTINGS.fax, COMPANY_SETTINGS.email]) assertIsolated(html, v, key)
    }
  }
})

test("L3. hostile phone / e-mail values stay escaped inside the isolate", async () => {
  const out = await renderAll(hostile)
  for (const [key, values] of Object.entries(PARTY)) {
    const html = out[key].html
    assert.ok(!html.includes(HOSTILE), `${key}: raw hostile string leaked`)
    for (const v of values) assert.ok(html.includes(ltrText(v + HOSTILE)), `${key}: "${v}" not escaped inside the isolate`)
  }
})

test("L4. sales-order print: company header, customer phone/e-mail and delivery-contact phone are isolated", async () => {
  useDb(
    new FakeDb({
      sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "approved", order_date: "2026-10-01", total: 114, net_total: 114, subtotal: 100, discount_amount: 0, discount_type: "none", discount_value: 0, payment_type: "cash", payment_terms: "prepaid", notes: null, delivery_contact_name: "Receiver", delivery_contact_phone: "+20 111 222 3333" }],
      customers: [{ customer_id: 5, customer_name: "Test Customer", phone: "+20 100 945 5019", email: "buyer@example.com" }],
      sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 1, unit_price: 100, total: 100, item_type: "stock", outsourced_name: null }],
      products: [{ product_id: 7, product_name: "Pump A", sku: "A", last_landed_cost: 40 }],
      inventory: [],
    }),
  )
  const res = await soPrintRoute.GET(new Request("http://test.local/api/sales-orders/print?soId=1") as any)
  assert.equal(res.status, 200)
  const html = await res.text()
  for (const v of ["+20 100 945 5019", "buyer@example.com", "+20 111 222 3333", COMPANY_SETTINGS.phone, COMPANY_SETTINGS.fax, COMPANY_SETTINGS.email]) assertIsolated(html, v, "so")
})
