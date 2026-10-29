// Hand-written prices on the printed price request (owner request, 2026-10-29): the PR print has a price box per
// row; a photo of the filled sheet is read row by row and fills the "Quote received" screen for a person to check.
// The reader is never called for real here: a local stand-in answers on GEMINI_BASE_URL.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import { cannedDb, nreq } from "./hardening-fixtures"
import { parseWrittenPrice, pricesByItem, sameRequestNumber, sortRequestItems, toEnglishDigits } from "../po-requests/read-prices"
import * as readRoute from "../../app/api/po-requests/read-prices/route"
import * as prPdf from "../../app/api/po-requests/pdf/route"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

test("written prices: Arabic and English digits, thousands, decimal comma, currency, '/-'", () => {
  const cases: [string | null, number | null][] = [
    ["١٢٥٠", 1250],
    ["1250", 1250],
    ["1,250", 1250],
    ["١٬٢٥٠٫٥٠", 1250.5],
    ["١٢٥٠٫٧٥", 1250.75],
    ["12,5", 12.5],
    ["1.250.000", 1250000],
    ["1,250.50", 1250.5],
    ["1250/-", 1250],
    ["350 ج.م", 350],
    ["12.50 جنيه", 12.5],
    ["EGP 99", 99],
    ["۴۵۰", 450],
    ["15/50", null], // ambiguous: left for a person
    ["1,25,0", null],
    ["", null],
    [null, null],
    ["-", null],
    ["0", null],
    ["abc", null],
  ]
  for (const [written, expected] of cases) assert.equal(parseWrittenPrice(written), expected, String(written))
  assert.equal(toEnglishDigits("PR-٢٠٢٦-٠٠٥"), "PR-2026-005")
  assert.ok(sameRequestNumber("PR-٢٠٢٦-٠٠٥", "pr 2026 005"))
  assert.ok(!sameRequestNumber("PR-2026-006", "PR-2026-005"))
  assert.ok(!sameRequestNumber(null, "PR-2026-005"))
})

test("rows map to items in the printed order (by item id); empty, unreadable and extra rows are skipped", () => {
  const items = [{ item_id: 30 }, { item_id: 10 }, { item_id: 20 }]
  assert.deepEqual(sortRequestItems(items).map((i) => i.item_id), [10, 20, 30])
  assert.deepEqual(items.map((i) => i.item_id), [30, 10, 20], "input not changed")
  const prices = pricesByItem(items, [
    { row: 1, written: "١٠٠" },
    { row: 2, written: null },
    { row: 3, written: "15/50" },
    { row: 4, written: "999" },
    { row: 0, written: "5" },
  ])
  assert.deepEqual(prices, { 10: 100 })
})

// ------------------------------------------------------------------------------- the reader route (stand-in API)
type Seen = { body: any; headers: http.IncomingHttpHeaders; url: string }
async function withReader(reply: (seen: Seen) => { status: number; json: any }, fn: (seen: Seen[]) => Promise<void>) {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const s = { body: JSON.parse(raw || "{}"), headers: req.headers, url: req.url || "" }
      seen.push(s)
      const out = reply(s)
      res.writeHead(out.status, { "content-type": "application/json" })
      res.end(JSON.stringify(out.json))
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const before = { url: process.env.GEMINI_BASE_URL, key: process.env.GEMINI_API_KEY }
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.GEMINI_API_KEY = "test-key"
  try {
    await fn(seen)
  } finally {
    if (before.url === undefined) delete process.env.GEMINI_BASE_URL
    else process.env.GEMINI_BASE_URL = before.url
    if (before.key === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = before.key
    await new Promise((r) => server.close(r))
  }
}
const message = (sheet: unknown) => ({
  status: 200,
  json: {
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(sheet) }] }, finishReason: "STOP" }],
  },
})
function mkDb() {
  const db = new FakeDb({
    po_requests: [{ request_id: 5, request_number: "PR-2026-005", status: "pending" }],
    po_request_items: [
      { item_id: 12, request_id: 5, product_name: "Pump", quantity: 2, unit: "pcs", unit_price: null },
      { item_id: 11, request_id: 5, product_name: "Valve", quantity: 4, unit: null, unit_price: null },
    ],
  })
  db.tables.po_requests[0].po_request_items = db.tables.po_request_items
  useDb(db)
  return db
}
const read = (body: unknown) => call(readRoute.POST as any, "POST", body)
const PHOTO = { request_id: 5, image: "aGVsbG8=", media_type: "image/jpeg" }

test("reader route: prices come back per item (row 1 = lowest item id), nothing is saved", async () => {
  const db = mkDb()
  await withReader(
    () => message({ request_number: "PR-٢٠٢٦-٠٠٥", rows: [{ row: 1, written: "١٬٢٥٠" }, { row: 2, written: null }] }),
    async (seen) => {
      const r = await read(PHOTO)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual(r.body, { prices: { 11: 1250 }, read: 1, total: 2, request_number_matches: true })
      const sent = seen[0].body
      assert.equal(seen[0].headers["x-goog-api-key"], "test-key")
      assert.match(seen[0].url, /^\/v1beta\/models\/gemini-3\.8-flash:generateContent$/)
      const parts = sent.contents[0].parts
      assert.deepEqual(parts[0].inline_data, { mime_type: "image/jpeg", data: "aGVsbG8=" })
      assert.match(parts[1].text, /1\. Valve \(× 4\)\n2\. Pump \(× 2 pcs\)/)
      assert.equal(sent.generationConfig.responseMimeType, "application/json")
      assert.equal(sent.generationConfig.temperature, 0)
      assert.ok(db.tables.po_request_items.every((i) => i.unit_price === null), "no price saved")
    },
  )
})

test("reader route: a photo of another request is flagged", async () => {
  mkDb()
  await withReader(
    () => message({ request_number: "PR-2026-009", rows: [{ row: 2, written: "80" }] }),
    async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 200)
      assert.deepEqual(r.body, { prices: { 12: 80 }, read: 1, total: 2, request_number_matches: false })
    },
  )
})

test("reader route: bad input, missing key, rejected key, free limit, blocked", async () => {
  mkDb()
  for (const bad of [{}, { ...PHOTO, request_id: "abc" }, { ...PHOTO, media_type: "application/pdf" }, { ...PHOTO, image: "" }]) {
    assert.equal((await read(bad)).status, 400, JSON.stringify(bad))
  }
  await withReader(() => ({ status: 200, json: {} }), async () => {
    assert.equal((await read({ ...PHOTO, request_id: 99 })).status, 404)
  })
  await withReader(
    () => ({ status: 400, json: { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid", details: [{ reason: "API_KEY_INVALID" }] } } }),
    async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 503)
      assert.match(r.body.error, /API key was rejected/)
    },
  )
  await withReader(
    () => ({ status: 429, json: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } } }),
    async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 429)
      assert.match(r.body.error, /free photo-reading limit/)
    },
  )
  await withReader(
    () => ({ status: 200, json: { promptFeedback: { blockReason: "SAFETY" } } }),
    async () => assert.equal((await read(PHOTO)).status, 422),
  )
  await withReader(
    () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: "not json" }] } }] } }),
    async () => assert.equal((await read(PHOTO)).status, 422),
  )
  const before = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  const r = await read(PHOTO)
  if (before !== undefined) process.env.GEMINI_API_KEY = before
  assert.equal(r.status, 503)
  assert.match(r.body.error, /GEMINI_API_KEY/)
})

// ------------------------------------------------------------------------------------------------- the print
test("PR print: a unit-price box on every row, rows in item-id order, numbers-only note", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any
  try {
    useDb(
      cannedDb({
        po_requests: [
          {
            request_id: 1, request_number: "PR-1", request_date: "2026-10-02", created_at: "2026-10-02T00:00:00Z", status: "pending",
            suppliers: { supplier_name: "S" },
            po_request_items: [
              { item_id: 9, quantity: 1, product_name: "Second item" },
              { item_id: 3, quantity: 2, product_name: "First item" },
            ],
          },
        ],
      }),
    )
    const html = await (await prPdf.GET(nreq("http://test.local/api/po-requests/pdf?requestId=1"))).text()
    assert.match(html, /سعر الوحدة \/ Unit Price<\/th>/)
    assert.equal(html.match(/<div class="pm-price-box"><\/div>/g)?.length, 2)
    assert.ok(html.indexOf("First item") < html.indexOf("Second item"), "row 1 is the lowest item id")
    assert.match(html, /Write the unit price in numbers only, one per box/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test("Quote received screen: photo button fills and highlights prices, same row order, saves only on Save", () => {
  const dialog = src("components/po-requests/quote-received-dialog.tsx")
  assert.match(dialog, /const items = sortRequestItems\(request\.po_request_items \|\| \[\]\)/)
  assert.match(dialog, /fetch\("\/api\/po-requests\/read-prices"/)
  assert.match(dialog, /accept="image\/\*"/)
  assert.match(dialog, /t\("chain\.photo-check"\)/)
  const handlePhoto = dialog.slice(dialog.indexOf("const handlePhoto"), dialog.indexOf("const handleExcel"))
  assert.doesNotMatch(handlePhoto, /\/api\/po-requests"/, "reading a photo does not save the PR")
  assert.doesNotMatch(handlePhoto, /\/api\/documents\/upload/, "the photo is uploaded only on Save")
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["chain.read-photo", "chain.photo-check", "chain.photo-read-result", "chain.photo-wrong-request"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in English and Arabic`)
  }
})
