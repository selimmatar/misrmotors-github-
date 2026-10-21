// The quotation PDF ignored the discount: the screen said (200 - 20) x 1.14 = 205.20 but the PDF printed 200 x 1.14 =
// 228.00. The PDF now receives the quotation's discount and prints the same totals as the saved quotation.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { useDb } from "./route-harness"
import { cannedDb, nreq } from "./hardening-fixtures"
import * as quotationGen from "../../app/api/quotations/generate/route"

globalThis.fetch = (async () => new Response("", { status: 404 })) as any

async function pdf(extra: Record<string, unknown>) {
  useDb(cannedDb({ products: [] }))
  const data = encodeURIComponent(JSON.stringify({ customer_name: "c", items: [{ product_name: "Pump", quantity: 2, unit_price: 100 }], ...extra }))
  return (await quotationGen.GET(nreq(`http://test.local/x?qn=QT-1&data=${data}`))).text()
}

test("D1. a fixed discount is printed and taken off before VAT", async () => {
  const html = await pdf({ discount_type: "fixed", discount_value: 20, discount_amount: 20 })
  assert.match(html, /الخصم/)
  assert.match(html, /20\.00 جنيه/)
  assert.match(html, /180\.00 جنيه/) // after discount
  assert.match(html, /25\.20 جنيه/) // VAT on 180
  assert.match(html, /205\.20 جنيه/)
  assert.doesNotMatch(html, /228\.00/)
})

test("D2. a percentage discount works the same way", async () => {
  const html = await pdf({ discount_type: "percentage", discount_value: 10 })
  assert.match(html, /180\.00 جنيه/)
  assert.match(html, /205\.20 جنيه/)
})

test("D3. no discount: no discount line, totals unchanged", async () => {
  const html = await pdf({ discount_type: "none", discount_value: 0, discount_amount: 0 })
  assert.doesNotMatch(html, /الخصم/)
  assert.match(html, /228\.00 جنيه/)
})

test("D4. the quotation screen sends its discount to the PDF", () => {
  const src = fs.readFileSync(path.join(process.env.REPO_ROOT || ".", "components/modules/sales-quotation-module.tsx"), "utf8")
  const block = src.slice(src.indexOf("const quotationData = {"), src.indexOf("const queryString"))
  for (const key of ["discount_type", "discount_value", "discount_amount"]) assert.match(block, new RegExp(`\\b${key}\\b`), key)
})
