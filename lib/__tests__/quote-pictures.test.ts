// Owner request 2026-11-24: send quotations with pictures. Each quotation line may carry a picture (an uploaded one, or
// the catalogue product's saved picture when "With picture" is ticked); the quotation print shows a thumbnail column
// only when a line has a picture (lib/quotations/line-picture.ts).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as quotationRoute from "../../app/api/sales-quotations/route"
import * as quotationPdfRoute from "../../app/api/quotations/generate/route"
import {
  cleanPictureUrl,
  hasPictureColumn,
  linePictureUrl,
  pictureCellHtml,
  pictureHeadHtml,
  productPictureOf,
  QUOTE_PICTURE_CSS,
} from "../quotations/line-picture"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")

const UPLOADED = "https://blob.example.com/quote-line-1.jpg"
const PRODUCT_OLD = "https://blob.example.com/product-1-old.jpg"
const PRODUCT_NEW = "https://blob.example.com/product-1-new.jpg"

function picturesDb() {
  const db = new FakeDb({
    sales_quotations: [], sales_quotation_items: [], sales_orders: [], sales_order_items: [], delivery_permits: [],
    delivery_permit_items: [], suppliers: [], accounts_receivable: [], po_requests: [], po_request_items: [],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    products: [
      { product_id: 1, product_name: "Pump P1", sku: "P1" },
      { product_id: 2, product_name: "Valve V2", sku: "V2" },
    ],
    product_images: [
      { image_id: 1, product_id: 1, image_url: PRODUCT_OLD, created_at: "2026-01-01T10:00:00Z" },
      { image_id: 2, product_id: 1, image_url: PRODUCT_NEW, created_at: "2026-06-01T10:00:00Z" },
    ],
    inventory: [],
  })
  db.rpcHandlers.generate_quotation_number = () => `Q-PIC-${db.tables.sales_quotations.length + 1}`
  useDb(db)
  return db
}

const stockLine = (productId: number, extra: Row = {}) => ({ item_type: "inventory", product_id: productId, product_name: `P${productId}`, quantity: 1, unit_price: 100, ...extra })
const outLine = (name: string, extra: Row = {}) => ({ item_type: "outsourced", product_name: name, quantity: 2, unit_price: 50, ...extra })
const getQuotation = (id: number) => call(quotationRoute.GET as any, "GET", undefined, `http://test.local/api/sales-quotations?id=${id}`)

// ------------------------------------------------------------------------------------------------ helpers

test("picture URLs: only http(s) or a same-site path are kept", () => {
  assert.equal(cleanPictureUrl(UPLOADED), UPLOADED)
  assert.equal(cleanPictureUrl("  /images/x.png "), "/images/x.png")
  assert.equal(cleanPictureUrl("javascript:alert(1)"), null)
  assert.equal(cleanPictureUrl("data:image/png;base64,AAA"), null)
  assert.equal(cleanPictureUrl("//evil.example.com/x.png"), null)
  assert.equal(cleanPictureUrl("https://x.example.com/a b.png"), null)
  assert.equal(cleanPictureUrl(""), null)
  assert.equal(cleanPictureUrl(42), null)
  assert.equal(cleanPictureUrl(`https://x.example.com/${"a".repeat(2100)}`), null)
})

test("a product's picture is its newest saved one; none = null", () => {
  assert.equal(productPictureOf([{ image_url: PRODUCT_OLD, created_at: "2026-01-01" }, { image_url: PRODUCT_NEW, created_at: "2026-06-01" }]), PRODUCT_NEW)
  assert.equal(productPictureOf([]), null)
  assert.equal(productPictureOf(null), null)
  assert.equal(productPictureOf([{ image_url: "javascript:x" }]), null)
  const pics = new Map([[1, PRODUCT_NEW]])
  assert.equal(linePictureUrl({ product_id: 1, with_product_picture: true }, pics), PRODUCT_NEW)
  assert.equal(linePictureUrl({ product_id: 2, with_product_picture: true, image_url: UPLOADED }, pics), UPLOADED, "no product picture: the uploaded one")
  assert.equal(linePictureUrl({ product_id: 1, image_url: UPLOADED }, pics), UPLOADED, "not ticked: the line's own")
  assert.equal(linePictureUrl({ product_id: 1 }, pics), null)
})

// ------------------------------------------------------------------------------------------------ API

test("a line picture is saved on create, read back, kept and changed on edit", async () => {
  const db = picturesDb()
  const created = await call(quotationRoute.POST as any, "POST", {
    customer_name: "Test Customer", customer_id: 5,
    items: [outLine("Gasket", { image_url: UPLOADED }), outLine("Bolt"), outLine("Hack", { image_url: "javascript:alert(1)" })],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.ok(!("pictures_not_saved" in created.body))
  const qid = created.body.quotation.id
  const byName = (n: string) => db.tables.sales_quotation_items.find((r) => r.product_name === n)!
  assert.equal(byName("Gasket").image_url, UPLOADED)
  assert.equal(byName("Bolt").image_url, null)
  assert.equal(byName("Hack").image_url, null, "an unsafe URL is not saved")

  const read1 = await getQuotation(qid)
  assert.deepEqual(read1.body.quotation.items.map((i: Row) => i.image_url), [UPLOADED, null, null])

  // edited (approve dialog): the picture travels with the line; another line gets one; the first is removed
  const saved = await call(quotationRoute.PATCH as any, "PATCH", {
    quotation_id: qid, customer_name: "Test Customer", subtotal: 300, tax: 42, total: 342, net_total: 342,
    items: [outLine("Gasket", { image_url: null }), outLine("Bolt", { image_url: "https://blob.example.com/bolt.jpg" })],
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  const read2 = await getQuotation(qid)
  assert.deepEqual(read2.body.quotation.items.map((i: Row) => [i.product_name, i.image_url]), [["Gasket", null], ["Bolt", "https://blob.example.com/bolt.jpg"]])
})

test("\"With picture\" saves the product's saved picture; a product without one keeps the uploaded picture", async () => {
  const db = picturesDb()
  const created = await call(quotationRoute.POST as any, "POST", {
    customer_name: "Test Customer",
    items: [
      stockLine(1, { with_product_picture: true, image_url: "https://blob.example.com/stale-client-copy.jpg" }),
      stockLine(2, { with_product_picture: true, image_url: UPLOADED }),
      stockLine(1),
    ],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const rows = db.tables.sales_quotation_items.sort((a, b) => a.line_no - b.line_no)
  assert.equal(rows[0].image_url, PRODUCT_NEW, "the server takes the product's newest saved picture")
  assert.equal(rows[1].image_url, UPLOADED, "no product picture: the line's own upload")
  assert.equal(rows[2].image_url, null, "not ticked: no picture")
  assert.ok(!("with_product_picture" in rows[0]), "the tick box is not a column")
})

test("before the SQL is applied: the quotation is saved without pictures and the answer says so", async () => {
  const db = picturesDb()
  const from = db.from.bind(db)
  const wrote: Row[] = []
  ;(db as any).from = (table: string) => {
    const q: any = from(table)
    if (table !== "sales_quotation_items") return q
    const select = q.select.bind(q)
    const insert = q.insert.bind(q)
    q.select = (cols?: string, opts?: any) => {
      if (cols === "image_url") {
        const failed: any = { limit: () => failed, then: (ok: any, bad: any) => Promise.resolve({ data: null, error: { code: "42703", message: "no column" } }).then(ok, bad) }
        return failed
      }
      return select(cols, opts)
    }
    q.insert = (p: any) => (wrote.push(...(Array.isArray(p) ? p : [p])), insert(p))
    return q
  }
  const created = await call(quotationRoute.POST as any, "POST", { customer_name: "Test Customer", items: [outLine("Gasket", { image_url: UPLOADED })] })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.pictures_not_saved, true)
  assert.ok(wrote.length > 0 && wrote.every((r) => !("image_url" in r)), "no picture column written")

  const plain = await call(quotationRoute.POST as any, "POST", { customer_name: "Test Customer", items: [outLine("Bolt")] })
  assert.equal(plain.status, 201)
  assert.ok(!("pictures_not_saved" in plain.body), "nothing to warn about without pictures")
})

// ------------------------------------------------------------------------------------------------ print

const pdfHtml = async (items: Row[]) => {
  const data = { customer_name: "Test Customer", items }
  const url = new URL(`http://test.local/api/quotations/generate?data=${encodeURIComponent(JSON.stringify(data))}&qn=Q-PIC-1`)
  const res = await quotationPdfRoute.GET(Object.assign(new Request(url), { nextUrl: url }) as any)
  assert.equal(res.status, 200)
  return res.text()
}
const rowCount = (html: string) => (html.match(/<tr><td class="pm-center">/g) || []).length

test("quotation PDF: no picture column at all when no line has a picture", async () => {
  const html = await pdfHtml([{ product_name: "Gasket", quantity: 1, unit_price: 10 }, { product_name: "Bolt", quantity: 2, unit_price: 5, image_url: "javascript:x" }])
  assert.ok(!html.includes("q-pic"), "no picture column, no picture styles")
  assert.ok(!html.includes("صورة"))
  assert.ok(!html.includes("<img class"))
})

test("quotation PDF: one picture column, one cell per row, escaped URL, names beside it", async () => {
  const tricky = `https://blob.example.com/a.jpg?x="><script>alert(1)</script>`
  const html = await pdfHtml([
    { product_name: "Gasket with a very long name that has to wrap beside the picture on an A4 page", quantity: 1, unit_price: 10, image_url: UPLOADED },
    { product_name: "Bolt", quantity: 2, unit_price: 5 },
    { product_name: "Hack", quantity: 1, unit_price: 1, image_url: tricky },
  ])
  assert.equal((html.match(/<th class="pm-center q-pic-col"/g) || []).length, 1, "one header cell")
  assert.equal((html.match(/<td class="q-pic-col">/g) || []).length, 3, "a cell on every row, also without a picture")
  assert.ok(html.includes(`<img class="q-pic" src="${UPLOADED}"`))
  assert.ok(!html.includes("<script>alert(1)"), "the URL is escaped")
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;") || !html.includes("a.jpg?x="), "escaped or dropped")
  assert.ok(html.includes("object-fit: contain"))
  // the picture sits between the line number and the name (RTL: number, picture, name from the right)
  const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"))
  assert.ok(head.indexOf("م</th>") < head.indexOf("q-pic-col") && head.indexOf("q-pic-col") < head.indexOf("اسم الصنف"))
  assert.match(html, /<html dir="rtl"/)
  assert.ok(html.includes("PRINT_ROWS") || html.includes("keepRowsWhole"), "rows still kept whole on paper")
})

test("quotation PDF: many lines, every row keeps its picture cell", async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ product_name: `Item ${i + 1}`, quantity: 1, unit_price: 1, ...(i % 3 === 0 ? { image_url: `https://blob.example.com/${i}.jpg` } : {}) }))
  const html = await pdfHtml(items)
  assert.equal(rowCount(html), 40)
  assert.equal((html.match(/<td class="q-pic-col">/g) || []).length, 40)
  assert.equal((html.match(/<img class="q-pic"/g) || []).length, 14)
  const single = await pdfHtml([{ product_name: "Only", quantity: 1, unit_price: 1, image_url: UPLOADED }])
  assert.equal((single.match(/<img class="q-pic"/g) || []).length, 1)
})

test("print helpers: header / cells only with the column; CSS sizes the thumbnail and keeps rows whole", () => {
  assert.equal(pictureHeadHtml(false), "")
  assert.equal(pictureCellHtml(false, UPLOADED), "")
  assert.equal(pictureCellHtml(true, null), `<td class="q-pic-col"></td>`)
  assert.equal(hasPictureColumn([{ image_url: null }, {}]), false)
  assert.equal(hasPictureColumn([{ image_url: UPLOADED }]), true)
  assert.match(QUOTE_PICTURE_CSS, /block-size: 68px/)
  assert.match(QUOTE_PICTURE_CSS, /border-radius: 6px/)
  assert.match(QUOTE_PICTURE_CSS, /tr:has\(\.q-pic\) \{ break-inside: avoid/)
})

test("screens: the form, the approve dialog and the preview carry the picture; the SQL is additive", () => {
  const form = read("components/modules/sales-quotation-module.tsx")
  assert.match(form, /<LinePictureControl/)
  assert.match(form, /with_product_picture: Boolean\(item\.with_product_picture && item\.product_id && !item\.from_inventory_id\)/)
  assert.match(form, /sq\.pictures-not-saved/)
  const dialog = read("components/sales-quotation/approve-convert-quotation-dialog.tsx")
  assert.match(dialog, /<LinePictureControl/)
  assert.match(dialog, /image_url: item\.imageUrl \|\| null/)
  assert.match(dialog, /pictureCellHtml\(showPictures, item\.imageUrl\)/)
  assert.match(read("components/quotation/quotation-preview-dialog.tsx"), /pictureCellHtml\(showPictures, item\.image_url\)/)
  const control = read("components/sales-quotation/line-picture-control.tsx")
  assert.match(control, /accept="image\/\*"/)
  assert.match(control, /shrinkPhoto\(picked/)
  assert.match(control, /fetch\("\/api\/upload"/)
  assert.match(control, /disabled=\{!productHasPicture\}/)
  const sql = read("scripts/sql/2026-11-25-quote-pictures.sql")
  assert.match(sql, /WRITTEN, NOT APPLIED/)
  assert.match(sql, /add column if not exists image_url text/)
  assert.ok(!/drop |delete |update /i.test(sql.replace(/--.*$/gm, "")), "additive only")
})
