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
  assert.match(s, /docTitle\(\{ titleAr: "أمر شراء" \}\)/)
  assert.doesNotMatch(s, /Quotation Request|quotation request|طلب عرض أسعار/)
  assert.doesNotMatch(s, /po\.status !== "pending" \?/)
  assert.match(s, /تكلفة الوحدة</)
  assert.doesNotMatch(s, / \/ [A-Z][a-z]+/) // Arabic only
  assert.match(s, /pm-totals/)
  assert.doesNotMatch(s, /customer/i)
})
