// Supabase connection fixes:
//  D. Approval documents: POST /api/documents/upload stores the file in Vercel Blob (the Supabase "documents" bucket
//     does not exist, so files were silently replaced by a "document://" placeholder), never writes to sales_orders
//     (it used the QUOTATION id as an so_id), and GET /api/sales-orders returns approvalDocumentUrl so the order
//     details can show the document.
//  L. GET /api/lost-sales?view=summary|top-items: the report_lost_sales_summary / report_top_lost_items views were
//     dropped, so the rows are now computed from lost_sales.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { blobCalls, call, useDb } from "./route-harness"
import * as docUpload from "../../app/api/documents/upload/route"
import * as soRoute from "../../app/api/sales-orders/route"
import * as lostSales from "../../app/api/lost-sales/route"
import { approvalDocumentState } from "../approval-document"

const uploadDoc = async (fields: Record<string, string | File>) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const res = await docUpload.POST(new Request("http://test.local/api/documents/upload", { method: "POST", body: form }) as any)
  return { status: res.status, body: (await res.json()) as any }
}
const pdf = (name = "signed po.pdf") => new File([new Uint8Array(50)], name, { type: "application/pdf" })

test("D1. approval upload stores the file in Blob and returns its real URL", async () => {
  useDb(new FakeDb({ sales_orders: [] }))
  blobCalls.length = 0
  const r = await uploadDoc({ file: pdf(), quotation_id: "7", document_type: "approval" })
  assert.equal(r.status, 200)
  assert.equal(r.body.success, true)
  assert.match(r.body.url, /^https:\/\/blob\.test\/approval-documents\/7\/\d+-signed_po\.pdf$/)
  assert.equal(r.body.filename, r.body.url.replace("https://blob.test/", ""))
  assert.equal(blobCalls.length, 1)
  assert.equal(blobCalls[0].contentType, "application/pdf")
  assert.equal(blobCalls[0].size, 50)
  assert.ok(!r.body.url.startsWith("document://"))
})

test("D2. approval upload does not touch sales_orders (the quotation id is not an so_id)", async () => {
  const db = new FakeDb({ sales_orders: [{ so_id: 7, so_number: "SO-7", approval_document_url: null }] })
  useDb(db)
  const r = await uploadDoc({ file: pdf(), quotation_id: "7" })
  assert.equal(r.status, 200)
  assert.equal(db.tables.sales_orders[0].approval_document_url, null)
})

test("D3. approval upload keeps the allow-list and the missing-file 400", async () => {
  useDb(new FakeDb({}))
  blobCalls.length = 0
  assert.equal((await uploadDoc({ quotation_id: "1" })).status, 400)
  const bad = await uploadDoc({ file: new File([new Uint8Array(5)], "x.exe", { type: "application/x-msdownload" }), quotation_id: "1" })
  assert.equal(bad.status, 415)
  assert.equal(blobCalls.length, 0)
})

test("D4. GET /api/sales-orders returns approvalDocumentUrl", async () => {
  useDb(
    new FakeDb({
      sales_orders: [
        { so_id: 1, so_number: "SO-1", customer_id: null, status: "pending_accountant", total: 10, created_at: "2026-10-01", approval_document_url: "https://blob.test/a.pdf" },
        { so_id: 2, so_number: "SO-2", customer_id: null, status: "approved", total: 10, created_at: "2026-10-02", approval_document_url: null },
      ],
      sales_order_items: [],
      delivery_permits: [],
    }),
  )
  const r = await call(soRoute.GET as any, "GET")
  assert.equal(r.status, 200)
  const byNumber = new Map(r.body.map((o: any) => [o.soNumber, o]))
  assert.equal((byNumber.get("SO-1") as any).approvalDocumentUrl, "https://blob.test/a.pdf")
  assert.equal((byNumber.get("SO-2") as any).approvalDocumentUrl, null)
})

test("D5. approvalDocumentState: real link, lost placeholder, none", () => {
  assert.deepEqual(approvalDocumentState("https://blob.test/a.pdf"), { kind: "link", href: "https://blob.test/a.pdf" })
  assert.deepEqual(approvalDocumentState("document://approval/5_1.pdf"), { kind: "missing" })
  assert.deepEqual(approvalDocumentState(null), { kind: "none" })
  assert.deepEqual(approvalDocumentState(""), { kind: "none" })
  assert.deepEqual(approvalDocumentState("javascript:alert(1)"), { kind: "none" })
})

const lostRows = () => [
  { lost_sale_id: 1, requested_item_name: "Pump A", customer_name: "Ali", customer_email: "ali@x.com", requested_quantity: 2, request_date: "2026-09-03T10:00:00" },
  { lost_sale_id: 2, requested_item_name: "Pump A", customer_name: "Mona", customer_email: null, requested_quantity: 1, request_date: "2026-09-20T10:00:00" },
  { lost_sale_id: 3, requested_item_name: "Valve B", customer_name: "Ali", customer_email: "ali@x.com", requested_quantity: 5, request_date: "2026-10-01T09:00:00" },
  { lost_sale_id: 4, requested_item_name: "Pump A", customer_name: null, customer_email: null, requested_quantity: null, request_date: "2026-10-05T09:00:00" },
]

test("L1. lost-sales summary is computed per month from lost_sales", async () => {
  useDb(new FakeDb({ lost_sales: lostRows() }))
  const r = await call(lostSales.GET as any, "GET", undefined, "http://test.local/api/lost-sales?view=summary")
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, [
    { month: "2026-10-01", total_requests: 2, unique_customers: 1, unique_items: 2, total_quantity_requested: 5, total_quantity: 5 },
    { month: "2026-09-01", total_requests: 2, unique_customers: 2, unique_items: 1, total_quantity_requested: 3, total_quantity: 3 },
  ])
})

test("L2. lost-sales summary applies startDate / endDate to request_date", async () => {
  useDb(new FakeDb({ lost_sales: lostRows() }))
  const r = await call(lostSales.GET as any, "GET", undefined, "http://test.local/api/lost-sales?view=summary&startDate=2026-09-10&endDate=2026-10-02")
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.map((m: any) => [m.month, m.total_requests]), [["2026-10-01", 1], ["2026-09-01", 1]])
})

test("L3. lost-sales top-items ranks products by request count", async () => {
  useDb(new FakeDb({ lost_sales: lostRows() }))
  const r = await call(lostSales.GET as any, "GET", undefined, "http://test.local/api/lost-sales?view=top-items")
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, [
    {
      product_name: "Pump A",
      requested_item_name: "Pump A",
      request_count: 3,
      total_quantity_requested: 3,
      unique_customers: 2,
      first_request_date: "2026-09-03T10:00:00",
      last_request_date: "2026-10-05T09:00:00",
      last_requested: "2026-10-05T09:00:00",
    },
    {
      product_name: "Valve B",
      requested_item_name: "Valve B",
      request_count: 1,
      total_quantity_requested: 5,
      unique_customers: 1,
      first_request_date: "2026-10-01T09:00:00",
      last_request_date: "2026-10-01T09:00:00",
      last_requested: "2026-10-01T09:00:00",
    },
  ])
})

test("L4. lost-sales detail list is unchanged", async () => {
  useDb(new FakeDb({ lost_sales: lostRows() }))
  const r = await call(lostSales.GET as any, "GET", undefined, "http://test.local/api/lost-sales?view=detail")
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.map((x: any) => x.lost_sale_id), [4, 3, 2, 1])
})
