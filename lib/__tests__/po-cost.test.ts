// Cost carries quotation -> sales order -> purchase order; the PO print is always a priced Purchase Order.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (f: string) => fs.readFileSync(path.join(process.env.REPO_ROOT || process.cwd(), f), "utf8")

test("quotation saves the outsourced cost and approval copies it onto the sales order line", () => {
  assert.match(read("components/modules/sales-quotation-module.tsx"), /unit_cost: item\.item_type === "outsourced"/)
  const api = read("app/api/sales-quotations/route.ts")
  assert.equal(api.match(/unit_cost: item\.unit_cost \?\? null/g)?.length, 2)
  assert.match(read("app/api/sales-quotations/approve/route.ts"), /cost_estimate: isOutsourced \? item\.unit_cost \?\? null : null/)
})

test("sales order saves and returns the line cost", () => {
  assert.match(read("components/modules/sales-order-module.tsx"), /costEstimate: Number\.parseFloat\(item\.costPrice/)
  const api = read("app/api/sales-orders/route.ts")
  assert.match(api, /cost_estimate: isOutsourced \? item\.costEstimate \?\? null : null/)
  assert.match(api, /costEstimate: item\.cost_estimate === null \|\| item\.cost_estimate === undefined \? null : Number\(item\.cost_estimate\)/)
})

test("PO from a sales order prefills Cost per unit and shows the SO number and customer", () => {
  const s = read("components/modules/purchase-order-module.tsx")
  assert.match(s, /unitPrice: item\.costEstimate != null \? String\(item\.costEstimate\) : ""/)
  assert.match(s, /placeholder=\{t\("po\.cost-per-unit"\)\}/)
  assert.doesNotMatch(s, /placeholder=\{t\("field\.unit-price"\)\}/)
  assert.match(s, /getLinkedSalesOrders\(order\) \|\| "-"/)
  assert.match(s, /t\("po\.for-sales-order"\)/)
  assert.match(s, /so\.customerName/)
})

test("PO print is a Purchase Order with costs at every status, and never names the customer", () => {
  const s = read("app/api/purchase-orders/pdf/route.ts")
  assert.match(s, /docTitle\(\{ titleAr: L\.title \}\)/)
  assert.match(s, /title: "أمر شراء",/)
  assert.doesNotMatch(s, /Quotation Request|quotation request|طلب عرض أسعار/)
  assert.doesNotMatch(s, /po\.status !== "pending" \?/)
  assert.match(s, /colCost: "تكلفة الوحدة",/)
  assert.doesNotMatch(s, / \/ [A-Z][a-z]+/) // one language per print, never "عربي / English" labels
  assert.match(s, /pm-totals/)
  assert.doesNotMatch(s, /customer/i)
})

test("PO print in the language picked: Arabic by default, English with lang=en", async () => {
  const { useDb } = await import("./route-harness")
  const route = await import("../../app/api/purchase-orders/pdf/route")
  const { cannedDb, nreq } = await import("./hardening-fixtures")
  const db = () =>
    cannedDb({
      purchase_orders: [{ po_id: 1, po_number: "PO-1", status: "approved", payment_type: "cash", currency: "EGP", suppliers: { supplier_name: "Acme" } }],
      purchase_order_items: [{ po_id: 1, quantity: 2, unit_price: 10, total_price: 20, products: { product_name: "Pump", sku: "P1", unit: "pc" } }],
    })
  useDb(db())
  const ar = await (await route.GET(nreq("http://test.local/x?poId=1"))).text()
  assert.match(ar, /<html dir="rtl" lang="ar">/)
  assert.match(ar, /أمر شراء/)
  assert.match(ar, />معتمد</)
  assert.match(ar, />نقدي</)
  useDb(db())
  const en = await (await route.GET(nreq("http://test.local/x?poId=1&lang=en"))).text()
  assert.match(en, /<html dir="ltr" lang="en">/)
  assert.match(en, /<div class="doc-title">Purchase Order<\/div>/)
  assert.match(en, />Unit cost<\/th>/)
  assert.match(en, />Approved</)
  assert.match(en, />Cash</)
  assert.match(en, /212 Sudan St\./)
  assert.match(en, /\.print-btn \{ position: fixed; top: 15px; right: 15px;/, "the print button keeps clear of the letterhead")
  // nothing Arabic left in the English print except the company's Arabic name in the letterhead
  const leftover = en.replace(/شركة مصر للمحركات/g, "").match(/[\u0600-\u06FF]+/g)
  assert.equal(leftover, null, `Arabic left in the English PO: ${leftover}`)
  const ui = read("components/modules/purchase-order-module.tsx")
  assert.match(ui, /\/api\/purchase-orders\/pdf\?poId=\$\{order\.id\}&lang=\$\{lang\}/)
  assert.match(ui, /t\(lang === "ar" \? "po\.print-arabic" : "po\.print-english"\)/)
})

test("PO print has no Linked line and has a Terms and Conditions box typed before printing", () => {
  const s = read("app/api/purchase-orders/pdf/route.ts")
  assert.doesNotMatch(s, /chainTextForPrint|linkedTo|Linked to|مرتبط بـ/)
  assert.match(s, /termsTitle: "الشروط والأحكام"/)
  assert.match(s, /termsTitle: "Terms and Conditions"/)
  assert.match(s, /<div id="po-terms" class="po-terms-box" contenteditable="true"/)
  // an empty box is not printed
  assert.match(s, /@media print \{ \.po-terms:has\(\.po-terms-box:empty\) \{ display: none; \} \}/)
})

test("new PO: the delivery date can be changed", () => {
  const ui = read("components/modules/purchase-order-module.tsx")
  assert.match(ui, /value=\{formData\.dueDate\}\s*onChange=\{\(e\) => setFormData\(\{ \.\.\.formData, dueDate: e\.target\.value \}\)\}/)
})
