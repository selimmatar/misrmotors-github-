// Hardening tests (input validation only, no auth/RLS/schema change):
//  1. DELETE handlers refuse a missing / blank / non-integer id and delete nothing; a valid id still deletes exactly that row.
//  2. POST /api/upload accepts only the file types the UI uploads (415) and at most 10 MB (413).
//  3. The HTML print routes escape every DB / user supplied string; ordinary data renders byte-identically to the
//     output recorded from the code before the change (lib/__tests__/fixtures/hardening/*.html).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { blobCalls, call, useDb } from "./route-harness"
import { escapeHtml } from "../html-escape"
import { escapeHtml as escapeFromPrintHtml } from "../print-html"
import { parsePositiveId } from "../parse-id"
import { HOSTILE, hostile, normalise, nreq, ordinary, renderAll, type Text, cannedDb } from "./hardening-fixtures"
import * as customersRoute from "../../app/api/customers/route"
import * as suppliersRoute from "../../app/api/suppliers/route"
import * as productsRoute from "../../app/api/products/route"
import * as inventoryRoute from "../../app/api/inventory/route"
import * as apRoute from "../../app/api/accounts-payable/route"
import * as arRoute from "../../app/api/accounts-receivable/route"
import * as balanceRoute from "../../app/api/balance/route"
import * as soRoute from "../../app/api/sales-orders/route"
import * as poRoute from "../../app/api/purchase-orders/route"
import * as uploadRoute from "../../app/api/upload/route"
import * as poPdf from "../../app/api/purchase-orders/pdf/route"
import * as apPdf from "../../app/api/invoices/ap/[id]/pdf/route"
import * as arPdf from "../../app/api/invoices/ar/[id]/pdf/route"
import * as dpPdf from "../../app/api/delivery-permits/pdf/route"
import * as poReqPdf from "../../app/api/po-requests/pdf/route"
import * as quotationGen from "../../app/api/quotations/generate/route"
import * as workOrderPdf from "../../app/api/maintenance/work-orders/[id]/pdf/route"

// The print routes try to inline the logo with fetch(); never touch the network in tests.
globalThis.fetch = (async () => new Response("", { status: 404 })) as any

const del = (handler: (req: any) => Promise<Response>, query: string) => call(handler, "DELETE", undefined, `http://test.local/api/x${query}`)
const data = (snapshot: Record<string, Row[]>) => Object.fromEntries(Object.entries(snapshot).filter(([, rows]) => rows.length > 0))
const BAD_IDS = ["", "?id=", "?id=%20", "?id=abc", "?id=0", "?id=-1", "?id=1.5", "?id=1abc", "?id=1%3BDROP", "?id=99999999999999999999", "?other=1"]

// ---------------------------------------------------------------- helpers

test("H1. escapeHtml escapes & < > \" ' and treats null/undefined as empty; print-html re-exports the same function", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>&'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;")
  assert.equal(escapeHtml(null), "")
  assert.equal(escapeHtml(undefined), "")
  assert.equal(escapeHtml(12.5), "12.5")
  assert.equal(escapeHtml("مضخة 3.5 - SO-1/2"), "مضخة 3.5 - SO-1/2") // Arabic text, digits and separators are untouched
  assert.equal(escapeFromPrintHtml, escapeHtml)
})

test("H2. parsePositiveId accepts only plain positive integers", () => {
  for (const ok of ["1", "42", " 7 ", "000123"]) assert.ok(parsePositiveId(ok) !== null, ok)
  assert.equal(parsePositiveId("42"), 42)
  for (const bad of [null, undefined, "", " ", "abc", "0", "-1", "1.5", "1abc", "1e3", "0x10", "1;2", "99999999999999999999"]) assert.equal(parsePositiveId(bad as any), null, String(bad))
})

// ---------------------------------------------------------------- DELETE handlers

const simple: { name: string; route: any; table: string; pk: string }[] = [
  { name: "customers", route: customersRoute, table: "customers", pk: "customer_id" },
  { name: "suppliers", route: suppliersRoute, table: "suppliers", pk: "supplier_id" },
  { name: "products", route: productsRoute, table: "products", pk: "product_id" },
  { name: "inventory", route: inventoryRoute, table: "inventory", pk: "inventory_id" },
  { name: "accounts-payable", route: apRoute, table: "accounts_payable", pk: "invoice_id" },
  { name: "accounts-receivable", route: arRoute, table: "accounts_receivable", pk: "invoice_id" },
]

for (const { name, route, table, pk } of simple) {
  test(`D1. DELETE /api/${name}: a missing, blank or non-integer id returns 400 and deletes nothing`, async () => {
    for (const q of BAD_IDS) {
      const db = new FakeDb({ [table]: [{ [pk]: 1 }, { [pk]: 2 }, { [pk]: 3 }] })
      useDb(db)
      const r = await del(route.DELETE, q)
      assert.equal(r.status, 400, `${name} ${q}`)
      assert.ok(r.body.error, q)
      assert.equal(db.tables[table].length, 3, `${name} ${q} must not delete`)
    }
  })

  test(`D2. DELETE /api/${name}?id=2 still deletes exactly that row and returns { success: true }`, async () => {
    const db = new FakeDb({ [table]: [{ [pk]: 1 }, { [pk]: 2 }, { [pk]: 3 }] })
    useDb(db)
    const r = await del(route.DELETE, "?id=2")
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { success: true })
    assert.deepEqual(db.tables[table].map((x) => x[pk]), [1, 3])
  })
}

test("D3. DELETE /api/balance never deletes: it used to wipe every balance entry with no filter", async () => {
  for (const q of ["", "?id=1"]) {
    const db = new FakeDb({ balance_entries: [{ entry_id: 1 }, { entry_id: 2 }] })
    useDb(db)
    const r = await del(balanceRoute.DELETE as any, q)
    assert.equal(r.status, 400)
    assert.equal(db.tables.balance_entries.length, 2)
  }
})

test("D4. DELETE /api/sales-orders: validates the id, 404 for an unknown order (nothing deleted), deletes by so_id", async () => {
  const seed = () =>
    new FakeDb({
      sales_orders: [{ so_id: 1, so_number: "SO-1" }, { so_id: 2, so_number: "SO-2" }],
      sales_order_items: [{ so_item_id: 1, so_id: 1 }, { so_item_id: 2, so_id: 1 }, { so_item_id: 3, so_id: 2 }],
    })
  for (const q of BAD_IDS) {
    const db = seed()
    useDb(db)
    assert.equal((await del(soRoute.DELETE, q)).status, 400, q)
    assert.equal(db.tables.sales_orders.length, 2)
    assert.equal(db.tables.sales_order_items.length, 3)
  }
  let db = seed()
  useDb(db)
  const missing = await del(soRoute.DELETE, "?id=99")
  assert.equal(missing.status, 404)
  assert.equal(db.tables.sales_orders.length, 2)
  assert.equal(db.tables.sales_order_items.length, 3, "line items of other orders are untouched")

  db = seed()
  useDb(db)
  const ok = await del(soRoute.DELETE, "?id=1")
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { success: true })
  assert.deepEqual(db.tables.sales_orders.map((r) => r.so_id), [2])
  assert.deepEqual(db.tables.sales_order_items.map((r) => r.so_item_id), [3])

  db = seed()
  db.failOn["sales_order_items:delete"] = "boom"
  useDb(db)
  const failed = await del(soRoute.DELETE, "?id=1")
  assert.equal(failed.status, 500)
  assert.equal(db.tables.sales_orders.length, 2, "the order is kept when its lines could not be deleted")
})

test("D5. DELETE /api/purchase-orders: validates the id, 404 for an unknown order (nothing deleted), deletes by po_id", async () => {
  const seed = () =>
    new FakeDb({
      purchase_orders: [{ po_id: 1, po_number: "PO-1" }, { po_id: 2, po_number: "PO-2" }],
      purchase_order_items: [{ po_item_id: 1, po_id: 1 }, { po_item_id: 2, po_id: 2 }, { po_item_id: 3, po_id: 2 }],
    })
  for (const q of BAD_IDS) {
    const db = seed()
    useDb(db)
    assert.equal((await del(poRoute.DELETE, q)).status, 400, q)
    assert.equal(db.tables.purchase_orders.length, 2)
    assert.equal(db.tables.purchase_order_items.length, 3)
  }
  let db = seed()
  useDb(db)
  assert.equal((await del(poRoute.DELETE, "?id=99")).status, 404)
  assert.equal(db.tables.purchase_orders.length, 2)
  assert.equal(db.tables.purchase_order_items.length, 3)

  db = seed()
  useDb(db)
  const ok = await del(poRoute.DELETE, "?id=2")
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { success: true })
  assert.deepEqual(db.tables.purchase_orders.map((r) => r.po_id), [1])
  assert.deepEqual(db.tables.purchase_order_items.map((r) => r.po_item_id), [1])

  db = seed()
  db.failOn["purchase_order_items:delete"] = "boom"
  useDb(db)
  assert.equal((await del(poRoute.DELETE, "?id=2")).status, 500)
  assert.equal(db.tables.purchase_orders.length, 2)
})

// ---------------------------------------------------------------- upload

const upload = async (file: File | null, extra: Record<string, string> = {}) => {
  const form = new FormData()
  if (file) form.append("file", file)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  const res = await uploadRoute.POST(new Request("http://test.local/api/upload", { method: "POST", body: form }))
  return { status: res.status, body: (await res.json()) as any }
}
const fileOf = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type })

test("U1. upload accepts the file types the UI uploads and keeps the { url } response", async () => {
  for (const [name, type] of [
    ["receipt.pdf", "application/pdf"],
    ["photo.jpg", "image/jpeg"],
    ["photo.JPEG", "image/jpeg"],
    ["scan.png", "image/png"],
    ["pic.webp", "image/webp"],
    ["pic.gif", "image/gif"],
    ["camera.heic", "image/heic"],
    ["terms.doc", "application/msword"],
    ["terms.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["no-mime.pdf", ""],
    ["generic.pdf", "application/octet-stream"],
  ] as const) {
    blobCalls.length = 0
    const r = await upload(fileOf(name, type), { folder: "payment-receipts" })
    assert.equal(r.status, 200, name)
    assert.deepEqual(Object.keys(r.body), ["url"], name)
    assert.match(r.body.url, /^https:\/\/blob\.test\/\d+-/)
    assert.equal(blobCalls.length, 1)
  }
})

test("U2. upload rejects other types with 415 and stores nothing", async () => {
  for (const [name, type] of [
    ["page.html", "text/html"],
    ["image.svg", "image/svg+xml"],
    ["tool.exe", "application/x-msdownload"],
    ["script.js", "text/javascript"],
    ["noextension", "application/pdf"],
    ["disguised.pdf", "text/html"], // extension says PDF, browser says HTML
    ["disguised.html", "application/pdf"],
    ["archive.zip", "application/zip"],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["constructor", ""],
    ["a.toString", ""],
  ] as const) {
    blobCalls.length = 0
    const r = await upload(fileOf(name, type))
    assert.equal(r.status, 415, name)
    assert.match(r.body.error, /Unsupported file type/)
    assert.equal(blobCalls.length, 0, name)
  }
})

test("U3. upload: 10 MB limit (413), exactly 10 MB is accepted, missing file is 400", async () => {
  blobCalls.length = 0
  assert.equal((await upload(fileOf("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1))).status, 413)
  assert.equal(blobCalls.length, 0)
  assert.equal((await upload(fileOf("max.pdf", "application/pdf", 10 * 1024 * 1024))).status, 200)
  assert.equal((await upload(null)).status, 400)
})

// ---------------------------------------------------------------- print routes: escaping

// The runner exports HARDENING_GOLDEN_DIR (the source tree); the compiled tests live in a temp output directory.
const GOLDEN = process.env.HARDENING_GOLDEN_DIR || path.resolve(process.cwd(), "lib/__tests__/fixtures/hardening")

const KEYS = ["dp", "poRequest", "po", "ap", "ap2", "ar", "ar2", "quotation", "workOrder"]

test("E1. ordinary data renders byte-identically to the output recorded before the escaping change", async () => {
  const out = await renderAll(ordinary)
  for (const key of KEYS) {
    assert.equal(out[key].status, 200, key)
    const golden = fs.readFileSync(path.join(GOLDEN, key + ".html"), "utf8")
    assert.equal(normalise(out[key].html), golden, `${key} differs from the pre-change output`)
  }
})

test("E2. hostile strings in every field are escaped in every print route", async () => {
  const labels: string[] = []
  const recording: Text = (l) => (labels.push(l), l)
  const plain = await renderAll(recording)
  const plainByKey = plain
  const out = await renderAll(hostile)
  const escapedHostile = escapeHtml(HOSTILE)
  for (const key of KEYS) {
    const html = out[key].html
    assert.equal(out[key].status, 200, key)
    assert.ok(!html.includes('<b id="PWN">'), `${key}: raw markup leaked`)
    assert.ok(!html.includes(HOSTILE), `${key}: raw hostile string leaked`)
    assert.ok(html.includes(escapedHostile), `${key}: nothing was escaped?`)
    // every field that is displayed in the ordinary output is displayed escaped in the hostile output
    for (const label of new Set(labels)) {
      if (!plainByKey[key].html.includes(label)) continue // not a field this route prints
      assert.ok(html.includes(escapeHtml(label + HOSTILE)), `${key}: field "${label}" is not escaped`)
    }
  }
})

test("E3. file names in Content-Disposition headers cannot carry quotes or markup", async () => {
  useDb(cannedDb({ products: [], purchase_orders: [{ po_id: 1, po_number: `P"O<1>`, status: "approved", suppliers: {} }], maintenance_work_orders: [{ work_order_number: `W"O<1>`, created_at: "2026-10-06T10:00:00Z", status: "pending" }] }))
  const qn = encodeURIComponent(`QT"<x>`)
  const data = encodeURIComponent(JSON.stringify({ customer_name: "c", items: [{ product_id: 1, product_name: "p", quantity: 1, unit_price: 1 }] }))
  const q = await quotationGen.GET(nreq(`http://test.local/x?qn=${qn}&data=${data}`))
  assert.match(q.headers.get("content-disposition") || "", /^inline; filename="[A-Za-z0-9._-]*"$/)
  const p = await poPdf.GET(nreq("http://test.local/x?poId=1"))
  assert.match(p.headers.get("content-disposition") || "", /^inline; filename="[A-Za-z0-9._-]*"$/)
  const w = await workOrderPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) })
  assert.match(w.headers.get("content-disposition") || "", /^inline; filename="[A-Za-z0-9._-]*"$/)
})

test("E4. not-found / error pages escape the id and the database message that they echo", async () => {
  const bad = encodeURIComponent('9<b id="PWN">&')
  const nothing = cannedDb({})
  useDb(nothing)
  const pages: string[] = []
  pages.push(await (await poPdf.GET(nreq(`http://test.local/x?poId=${bad}`))).text())
  pages.push(await (await dpPdf.GET(nreq(`http://test.local/x?permit_id=${bad}`))).text())
  pages.push(await (await poReqPdf.GET(nreq(`http://test.local/x?requestId=${bad}`))).text())
  pages.push(await (await apPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: decodeURIComponent(bad) }) })).text())
  pages.push(await (await arPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: decodeURIComponent(bad) }) })).text())
  for (const [i, html] of pages.entries()) {
    assert.ok(!html.includes('<b id="PWN">'), `page ${i} leaked raw markup`)
  }
  assert.ok(pages[0].includes("PO ID: 9&lt;b id=&quot;PWN&quot;&gt;&amp;"))
  assert.ok(pages[3].includes("Invoice ID: 9&lt;b id=&quot;PWN&quot;&gt;&amp;"))
  assert.ok(pages[4].includes("Invoice ID: 9&lt;b id=&quot;PWN&quot;&gt;&amp;"))
})

test("D6. DELETE sales order / purchase order with dependent records returns 409 and deletes nothing", async () => {
  let db = new FakeDb({
    sales_orders: [{ so_id: 1 }], sales_order_items: [{ so_item_id: 1, so_id: 1 }],
    delivery_permits: [{ permit_id: 1, sales_order_id: 1 }], accounts_receivable: [], purchase_order_items: [],
  })
  useDb(db)
  assert.equal((await del(soRoute.DELETE, "?id=1")).status, 409)
  assert.equal(db.tables.sales_orders.length, 1)
  assert.equal(db.tables.sales_order_items.length, 1, "lines are kept")

  db = new FakeDb({
    purchase_orders: [{ po_id: 1 }], purchase_order_items: [{ po_item_id: 1, po_id: 1 }],
    goods_receipts: [{ receipt_id: 1, po_id: 1 }], accounts_payable: [],
  })
  useDb(db)
  assert.equal((await del(poRoute.DELETE, "?id=1")).status, 409)
  assert.equal(db.tables.purchase_orders.length, 1)
  assert.equal(db.tables.purchase_order_items.length, 1)
})
