// The customer's PO number (owner request 2026-11-25): optional, typed at approval or in the e-invoice window,
// sent to the tax portal as purchaseOrderReference only when given, locked once the invoice is on the portal.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { useDb } from "./route-harness"
import { buildInvoiceDocument } from "../eta/document"
import { buildEtaPreview, joinCustomerPos } from "../eta/preview"
import { cleanCustomerPo, saveCustomerPo } from "../eta/customer-po"
import { toEtaJson } from "../eta/serialize"
import { createDpInvoices } from "../invoicing"
import * as poRoute from "../../app/api/eta/customer-po/route"

const REPO = process.env.REPO_ROOT || process.cwd()

function db(customerPo?: string | null) {
  return new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-1", customer_id: 5, total: 114, subtotal: 100, discount_amount: 0, payment_type: "cash", ...(customerPo !== undefined ? { customer_po: customerPo } : {}) },
      { so_id: 2, so_number: "SO-2", customer_id: 5, total: 114, subtotal: 100, discount_amount: 0, payment_type: "cash", customer_po: "OTHER" },
    ],
    customers: [{ customer_id: 5, customer_name: "C" }],
    sales_order_items: [{ item_id: 1, so_id: 1, product_id: 1, outsourced_name: null, quantity: 1, unit_price: 100, total: 100 }],
    products: [{ product_id: 1, product_name: "air pump", eta_code_id: null, eta_unit_type: null }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-1", sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 10, permit_id: 1, product_id: 1, item_name_snapshot: "air pump", quantity: 1, unit_price: 100, total: 100 }],
    product_returns: [],
    return_items: [],
    invoice_delivery_permits: [],
    accounts_receivable: [],
    eta_documents: [],
    company_settings: [{ setting_key: "eta_go_live_at", setting_value: "2026-01-01T00:00:00Z" }],
  })
}

const doc = (preview: any) =>
  buildInvoiceDocument(
    { ...preview, lines: preview.lines.map((l: any) => ({ ...l, itemCode: "EG-100060455-P47" })) },
    { eta_rin: "100060455", eta_activity_code: "4510" } as any,
    "2026-11-25T10:00:00Z",
  ) as any

async function invoiced(customerPo?: string | null) {
  const d = db(customerPo)
  const res = await createDpInvoices(d, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return { d, invoiceId: d.tables.accounts_receivable[0].invoice_id }
}

test("PO1. a PO number on the sales order -> the portal document's purchaseOrderReference, right after internalID", async () => {
  const { d, invoiceId } = await invoiced("4500012345")
  const preview = await buildEtaPreview(d, invoiceId)
  assert.deepEqual(preview!.orders, [{ soId: 1, soNumber: "SO-1", customerPo: "4500012345" }])
  assert.equal(preview!.customerPo, "4500012345")
  const json = toEtaJson(doc(preview))
  assert.match(json, /"internalID":"[^"]+","purchaseOrderReference":"4500012345","invoiceLines"/)
})

test("PO2. optional: no PO (empty, or a database without the column yet) -> no purchaseOrderReference at all", async () => {
  for (const po of [null, "", undefined]) {
    const { d, invoiceId } = await invoiced(po)
    const preview = await buildEtaPreview(d, invoiceId)
    assert.equal(preview!.customerPo, "")
    assert.ok(!("purchaseOrderReference" in doc(preview)))
    assert.ok(!toEtaJson(doc(preview)).includes("purchaseOrder"))
  }
  assert.equal(joinCustomerPos(["A", " ", "A", "B"]), "A, B")
})

test("PO3. the e-invoice window saves it on the invoice's own sales order; cleared with empty; locked once on the portal", async () => {
  const { d, invoiceId } = await invoiced()
  assert.deepEqual(await saveCustomerPo(d, invoiceId, 1, "  PO  77 "), { ok: true, value: "PO 77" })
  assert.equal(d.tables.sales_orders[0].customer_po, "PO 77")
  assert.equal((await buildEtaPreview(d, invoiceId))!.customerPo, "PO 77")
  // not this invoice's order
  assert.equal(((await saveCustomerPo(d, invoiceId, 2, "X")) as any).code, "NOT_INVOICE_ORDER")
  assert.equal(d.tables.sales_orders[1].customer_po, "OTHER")
  // too long
  assert.equal(((await saveCustomerPo(d, invoiceId, 1, "9".repeat(101))) as any).code, "INVALID")
  // cleared
  assert.deepEqual(await saveCustomerPo(d, invoiceId, 1, ""), { ok: true, value: "" })
  assert.equal(d.tables.sales_orders[0].customer_po, null)
  // on the portal (waiting to be signed / sent / valid): refused, nothing changes
  d.tables.eta_documents.push({ doc_id: 1, invoice_id: invoiceId, document_type: "I", environment: "real", status: "valid" })
  assert.equal(((await saveCustomerPo(d, invoiceId, 1, "LATE")) as any).code, "ETA_LIVE")
  assert.equal(d.tables.sales_orders[0].customer_po, null)
  // the route
  useDb(d)
  const r = await poRoute.POST(new Request("http://t/api/eta/customer-po", { method: "POST", body: JSON.stringify({ invoiceId, soId: 1, customerPo: "LATE" }) }))
  assert.equal(r.status, 409)
  assert.equal((await poRoute.POST(new Request("http://t/api/eta/customer-po", { method: "POST", body: JSON.stringify({ invoiceId }) }))).status, 400)
})

test("PO4. typed at approval (optional), shown on the order, editable in the e-invoice window", () => {
  assert.deepEqual(cleanCustomerPo(undefined), { ok: true, value: "" })
  assert.deepEqual(cleanCustomerPo(4500012345), { ok: true, value: "4500012345" })
  assert.equal(cleanCustomerPo({}).ok, false)
  const approve = readFileSync(join(REPO, "app/api/sales-quotations/approve/route.ts"), "utf8")
  assert.match(approve, /cleanCustomerPo\(body\.customerPo\)/)
  assert.match(approve, /customer_po: customerPo\.value/)
  const dialog = readFileSync(join(REPO, "components/sales-quotation/approve-convert-quotation-dialog.tsx"), "utf8")
  assert.match(dialog, /id="so-customer-po"/)
  assert.match(dialog, /customerPo: customerPo\.trim\(\) \|\| null/)
  assert.ok(!/approvalDocument && customerPo|!customerPo/.test(dialog), "approval never requires it")
  const module = readFileSync(join(REPO, "components/modules/sales-order-module.tsx"), "utf8")
  assert.match(module, /selectedOrder\.customerPo/)
  const eta = readFileSync(join(REPO, "components/accounting/eta-preview-dialog.tsx"), "utf8")
  assert.match(eta, /<CustomerPoFields /)
  assert.match(eta, /"\/api\/eta\/customer-po"/)
  const sql = readFileSync(join(REPO, "scripts/sql/2026-11-25-customer-po.sql"), "utf8")
  assert.match(sql, /ADD COLUMN IF NOT EXISTS customer_po text;/)
})

test("PO5. invoiceCustomerPo: the invoice's orders' PO numbers, \"\" when none or on a failed read", async () => {
  const { invoiceCustomerPo } = await import("../eta/customer-po")
  const { d, invoiceId } = await invoiced("4500012345")
  assert.equal(await invoiceCustomerPo(d, { invoice_id: invoiceId, so_id: null }), "4500012345")
  const empty = await invoiced(null)
  assert.equal(await invoiceCustomerPo(empty.d, { invoice_id: empty.invoiceId, so_id: null }), "")
  const broken = { from: () => { throw new Error("down") } }
  assert.equal(await invoiceCustomerPo(broken, { invoice_id: 1, so_id: 1 }), "")
})

test("PO6. the customer e-mail shows the PO number only when given", async () => {
  const { buildInvoiceEmail } = await import("../eta/invoice-email")
  const base = { customerName: "Acme", invoiceNumber: "INV-1", date: "01/01/2026", total: 1000, uuid: "U", invoiceUrl: "https://x/i", salesOrders: [], permits: [] }
  const withPo = buildInvoiceEmail({ ...base, customerPo: "4500012345" })
  assert.match(withPo.html, /Your PO No\./)
  assert.match(withPo.html, /4500012345/)
  assert.match(withPo.text, /4500012345/)
  const without = buildInvoiceEmail(base)
  assert.doesNotMatch(without.html, /Your PO No\./)
  assert.doesNotMatch(without.text, /PO No\./)
})

test("PO7. both printed invoices show the customer's PO number when given", () => {
  for (const f of ["app/api/invoices/ar/[id]/pdf/route.ts", "app/api/invoices/ar/[id]/[invoiceId]/pdf/route.ts"]) {
    const src = readFileSync(join(REPO, f), "utf8")
    assert.match(src, /invoiceCustomerPo\(/, f)
    assert.match(src, /customerPo\s*\?/, f)
  }
})
