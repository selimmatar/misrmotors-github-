// Approved decisions:
//  1. Revenue KPI also counts sales orders in status ready_for_delivery (every other KPI definition unchanged).
//  2. Invoices are strictly per APPROVED delivery permit: create-from-dps answers 409 DP_NOT_APPROVED before creating
//     anything; create-from-so is retired (410).
//  3. Every upload route applies the same extension + MIME allowlist and size cap as /api/upload (lib/upload-allowlist.ts).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { blobCalls, call, useDb } from "./route-harness"
import { getSalesMetrics, REVENUE_STATUSES } from "../metrics/index"
import { ALLOWED_UPLOAD_TYPES, checkUpload } from "../upload-allowlist"
import * as fromDps from "../../app/api/accounts-receivable/create-from-dps/route"
import * as fromSo from "../../app/api/accounts-receivable/create-from-so/route"
import * as uploadRoute from "../../app/api/upload/route"
import * as documentsUpload from "../../app/api/documents/upload/route"
import * as dpUpload from "../../app/api/delivery-permits/upload/route"
import * as supplierQuoteUpload from "../../app/api/sales-quotations/supplier-quotes/upload/route"
import * as productImages from "../../app/api/product-images/route"
import * as soAttachments from "../../app/api/sales-orders/attachments/route"
import * as quotationRequest from "../../app/api/sales-orders/quotation-request/route"
import * as poRequests from "../../app/api/sales-orders/po-requests/route"

// ---------------------------------------------------------------------------------------------------------
// 1. Revenue KPI
// ---------------------------------------------------------------------------------------------------------
const so = (so_id: number, status: string, net_total: number, order_date = "2026-10-01"): Row => ({
  so_id,
  status,
  net_total,
  total: net_total,
  customer_id: 1,
  order_date,
})

test("D1. revenue counts accountant_approved, ready_for_delivery, shipped and delivered only", async () => {
  useDb(
    new FakeDb({
      sales_orders: [
        so(1, "accountant_approved", 100),
        so(2, "ready_for_delivery", 200),
        so(3, "shipped", 300),
        so(4, "delivered", 400),
        so(5, "pending", 500),
        so(6, "pending_accountant", 600),
        so(7, "cancelled", 700),
        so(8, "draft", 800),
        so(9, "approved_quotation", 900),
      ],
    }),
  )
  const m = await getSalesMetrics()
  // before the change: 100 + 300 + 400 = 800; now the ready_for_delivery order (200) is included
  assert.equal(m.totalRevenue, 1000)
  assert.equal(m.completedOrders, 4)
  assert.equal(m.averageOrderValue, 250)
  assert.equal(m.totalOrders, 9)
  assert.equal(m.pendingOrders, 2) // unchanged definition: pending + pending_accountant
  assert.deepEqual(REVENUE_STATUSES, ["accountant_approved", "ready_for_delivery", "shipped", "delivered"])
  assert.match(m._query || "", /'accountant_approved', 'ready_for_delivery', 'shipped', 'delivered'/)
})

test("D2. monthly revenue and the date filter include ready_for_delivery orders", async () => {
  useDb(
    new FakeDb({
      sales_orders: [so(1, "ready_for_delivery", 200, "2026-09-15"), so(2, "delivered", 400, "2026-10-02"), so(3, "ready_for_delivery", 50, "2026-08-01")],
    }),
  )
  const all = await getSalesMetrics()
  assert.deepEqual(all.monthlyRevenue, [
    { month: "2026-08", revenue: 50 },
    { month: "2026-09", revenue: 200 },
    { month: "2026-10", revenue: 400 },
  ])
  const sept = await getSalesMetrics({ from: new Date("2026-09-01"), to: new Date("2026-09-30") })
  assert.equal(sept.totalRevenue, 200)
})

// ---------------------------------------------------------------------------------------------------------
// 2. Invoices strictly from APPROVED delivery permits
// ---------------------------------------------------------------------------------------------------------
const dp = (permit_id: number, status: string): Row => ({ permit_id, permit_no: `DP-T-${permit_id}`, sales_order_id: 1, status })
function invoicingDb(statuses: Record<number, string>) {
  const db = new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-T-1", customer_id: 5, total: 1140000, net_total: 1140000, subtotal: 1000000, discount_amount: 0, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 1 },
    ],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    sales_order_items: [{ so_id: 1, product_id: 7, outsourced_name: null, quantity: 100 }],
    delivery_permits: Object.entries(statuses).map(([id, status]) => dp(Number(id), status)),
    delivery_permit_items: Object.keys(statuses).map((id) => ({ permit_id: Number(id), product_id: 7, item_name_snapshot: "Pump", quantity: 10, unit_price: 10000, total: 100000 })),
    invoice_delivery_permits: [],
    accounts_receivable: [],
  })
  useDb(db)
  return db
}

test("D3. create-from-dps answers 409 DP_NOT_APPROVED listing the permits, and creates nothing", async () => {
  for (const status of ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "SUBMITTED_SIGNED", "REJECTED"]) {
    const db = invoicingDb({ 1: "APPROVED", 2: status })
    const before = db.snapshot()
    const r = await call(fromDps.POST, "POST", { permit_ids: [1, 2] })
    assert.equal(r.status, 409, status)
    assert.equal(r.body.code, "DP_NOT_APPROVED")
    assert.deepEqual(r.body.permits, [{ permit_id: 2, permit_no: "DP-T-2", status }])
    assert.match(r.body.error, /Only APPROVED delivery permits can be invoiced/)
    assert.deepEqual(db.snapshot(), before, `${status}: nothing written`) // the approved permit 1 is not invoiced either
  }
})

test("D4. create-from-dps lists every non-approved permit; all-approved still invoices (amount unchanged)", async () => {
  const db = invoicingDb({ 1: "DRAFT", 2: "PRINTED", 3: "APPROVED" })
  const r = await call(fromDps.POST, "POST", { permit_ids: [1, 2, 3] })
  assert.equal(r.status, 409)
  assert.deepEqual(r.body.permits.map((p: any) => p.permit_id), [1, 2])
  assert.equal(db.tables.accounts_receivable.length, 0)

  const ok = invoicingDb({ 1: "APPROVED", 3: "APPROVED" })
  const done = await call(fromDps.POST, "POST", { permit_ids: [1, 3] })
  assert.equal(done.status, 200, JSON.stringify(done.body))
  assert.equal(done.body.invoices[0].amount, 228000) // 20 x 10,000 x 1.14, same formula as before
  assert.equal(ok.tables.accounts_receivable.length, 1)
})

test("D5. create-from-dps still answers 404 for an unknown permit and 400 for bad input", async () => {
  invoicingDb({ 1: "APPROVED" })
  assert.equal((await call(fromDps.POST, "POST", { permit_ids: [1, 99] })).status, 404)
  assert.equal((await call(fromDps.POST, "POST", { permit_ids: [] })).status, 400)
  assert.equal((await call(fromDps.POST, "POST", { permit_ids: ["x"] })).status, 400)
})

test("D6. create-from-so is retired: 410 with a clear message, nothing is read or written", async () => {
  const db = invoicingDb({ 1: "APPROVED" })
  const before = db.snapshot()
  const r = await call(fromSo.POST, "POST", { so_id: 1 })
  assert.equal(r.status, 410)
  assert.equal(r.body.code, "CREATE_FROM_SO_RETIRED")
  assert.match(r.body.error, /approved delivery permits/)
  assert.deepEqual(db.snapshot(), before)
  assert.equal(Object.keys(db.calls).length, 0)
})

// ---------------------------------------------------------------------------------------------------------
// 3. Upload allowlist on every upload route
// ---------------------------------------------------------------------------------------------------------
const fileOf = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type })
function formOf(file: File | null, extra: Record<string, string> = {}) {
  const form = new FormData()
  if (file) form.append("file", file)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return form
}
async function post(handler: (req: any) => Promise<Response>, file: File | null, extra: Record<string, string> = {}) {
  const res = await handler(new Request("http://test.local/api/x", { method: "POST", body: formOf(file, extra) }))
  let body: any = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

// route -> handler + the other form fields it needs to get past its own validation
const ROUTES: Record<string, { handler: (req: any) => Promise<Response>; extra: Record<string, string> }> = {
  "/api/upload": { handler: uploadRoute.POST, extra: {} },
  "/api/documents/upload": { handler: documentsUpload.POST, extra: { quotation_id: "1" } },
  "/api/delivery-permits/upload": { handler: dpUpload.POST, extra: { permitId: "1" } },
  "/api/sales-quotations/supplier-quotes/upload": { handler: supplierQuoteUpload.POST, extra: { sales_quotation_id: "1", supplier_name: "Acme" } },
  "/api/product-images": { handler: productImages.POST, extra: { productId: "1" } },
  "/api/sales-orders/attachments": { handler: soAttachments.POST, extra: { soId: "1" } },
  "/api/sales-orders/quotation-request": { handler: quotationRequest.POST, extra: { soId: "1" } },
  "/api/sales-orders/po-requests": { handler: poRequests.POST, extra: { soId: "1", manualNumber: "POR-T-1" } },
}

test("D7. pure rule: same allowlist as /api/upload (jpg alias kept), 10 MB cap", () => {
  assert.deepEqual(Object.keys(ALLOWED_UPLOAD_TYPES).sort(), ["doc", "docx", "gif", "heic", "heif", "jpeg", "jpg", "pdf", "png", "webp"])
  assert.equal(checkUpload(fileOf("a.jpg", "image/jpg")), null) // the alias some browsers send
  assert.equal(checkUpload(fileOf("a.PDF", "")), null)
  assert.equal(checkUpload(fileOf("a.pdf", "application/octet-stream")), null)
  assert.equal(checkUpload(fileOf("a.svg", "image/svg+xml"))?.status, 415)
  assert.equal(checkUpload(fileOf("a.pdf", "text/html"))?.status, 415)
  assert.equal(checkUpload(fileOf("max.pdf", "application/pdf", 10 * 1024 * 1024)), null)
  assert.deepEqual(checkUpload(fileOf("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1)), { status: 413, error: "File too large. Maximum size is 10MB" })
  // per-route option: an extra type / a smaller cap
  assert.equal(checkUpload(fileOf("a.xlsx", "application/vnd.ms-excel"), { extraTypes: { xlsx: ["application/vnd.ms-excel"] } }), null)
  assert.equal(checkUpload(fileOf("a.pdf", "application/pdf", 2000), { maxBytes: 1024 })?.status, 413)
})

test("D8. every upload route refuses disallowed types (415) and oversize files (413) before storing or writing anything", async () => {
  for (const [route, { handler, extra }] of Object.entries(ROUTES)) {
    for (const [name, type] of [
      ["page.html", "text/html"],
      ["image.svg", "image/svg+xml"],
      ["tool.exe", "application/x-msdownload"],
      ["disguised.pdf", "text/html"],
      ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["noextension", "application/pdf"],
    ] as const) {
      const db = new FakeDb({})
      useDb(db)
      blobCalls.length = 0
      const r = await post(handler, fileOf(name, type), extra)
      assert.equal(r.status, 415, `${route} ${name}`)
      assert.match(r.body.error, /Unsupported file type/, route)
      assert.equal(blobCalls.length, 0, `${route} ${name}: nothing stored`)
      assert.equal(Object.keys(db.calls).length, 0, `${route} ${name}: no database access`)
    }
    useDb(new FakeDb({}))
    blobCalls.length = 0
    const big = await post(handler, fileOf("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1), extra)
    assert.equal(big.status, 413, route)
    assert.equal(blobCalls.length, 0, route)
  }
})

test("D9. every upload route lets an allowed file past the check (exactly 10 MB, jpg alias, no MIME)", async () => {
  for (const [route, { handler, extra }] of Object.entries(ROUTES)) {
    if (route === "/api/documents/upload") continue // stores to Supabase Storage, covered by the pure rule + D8
    for (const [name, type, size] of [
      ["ok.pdf", "application/pdf", 100],
      ["photo.jpg", "image/jpg", 100],
      ["scan.PNG", "image/png", 100],
      ["nomime.pdf", "", 100],
      ["max.pdf", "application/pdf", 10 * 1024 * 1024],
    ] as const) {
      useDb(new FakeDb({}))
      blobCalls.length = 0
      const r = await post(handler, fileOf(name, type, size), extra)
      assert.notEqual(r.status, 413, `${route} ${name}`)
      assert.notEqual(r.status, 415, `${route} ${name}`)
      assert.equal(blobCalls.length, 1, `${route} ${name}: reached the storage step`)
    }
  }
})

test("D10. documents/upload: allowed file passes the check (reaches storage), disallowed does not", async () => {
  const db = new FakeDb({ sales_orders: [{ so_id: 1 }] })
  useDb(db)
  // The FakeDb has no storage client, so an allowed file fails later with 500 - the point is it is not 415/413.
  const ok = await post(documentsUpload.POST, fileOf("approval.pdf", "application/pdf"), { quotation_id: "1" })
  assert.notEqual(ok.status, 415)
  assert.notEqual(ok.status, 413)
  const bad = await post(documentsUpload.POST, fileOf("approval.html", "text/html"), { quotation_id: "1" })
  assert.equal(bad.status, 415)
  assert.equal(db.tables.sales_orders[0].approval_document_url, undefined)
})

test("D11. a missing file is still 400 on the routes that check it first", async () => {
  for (const route of ["/api/upload", "/api/documents/upload", "/api/delivery-permits/upload", "/api/product-images", "/api/sales-orders/attachments", "/api/sales-orders/quotation-request"]) {
    useDb(new FakeDb({}))
    const r = await post(ROUTES[route].handler, null, ROUTES[route].extra)
    assert.equal(r.status, 400, route)
  }
})
