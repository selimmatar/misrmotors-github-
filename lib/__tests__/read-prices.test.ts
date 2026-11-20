// Hand-written prices on the printed price request (owner request, 2026-10-29): the PR print has a price box per
// row; a photo of the filled sheet is read row by row and fills the "Quote received" screen for a person to check.
// The reader is never called for real here: a local stand-in answers on ANTHROPIC_BASE_URL (and the backup's base URL).
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
import { photosToPdf } from "../photos-to-pdf"
import { brandsByItem, codesByItem, nameWithBrand, parseWrittenPrice, pricesByItem, sameRequestNumber, sortRequestItems, toEnglishDigits } from "../po-requests/read-prices"
import { applyChosenCost, sameItemIgnoringBrand, supplierOffers } from "../po-requests/apply-costs"
import * as poRequestsRoute from "../../app/api/po-requests/route"
import * as readRoute from "../../app/api/po-requests/read-prices/route"
import * as prPdf from "../../app/api/po-requests/pdf/route"
import * as itemsRoute from "../../app/api/quotations/read-items/route"
import { parseQuantity, photoItems } from "../quotations/read-items"

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
  const before = Object.fromEntries(AI_ENV.map((name) => [name, process.env[name]]))
  for (const name of AI_ENV) delete process.env[name]
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.CLAUDE_API_KEY = "test-key"
  try {
    await fn(seen)
  } finally {
    for (const name of AI_ENV) {
      if (before[name] === undefined) delete process.env[name]
      else process.env[name] = before[name]
    }
    await new Promise((r) => server.close(r))
  }
}
// Every AI setting is cleared for each stand-in so a real key in the environment is never used.
const AI_ENV = ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_MODEL", "grokAPI", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODEL", "XAI_API_KEY", "XAI_BASE_URL", "XAI_MODEL"]
const CLAUDE_URL = "/v1/messages"
const claudeAnswer = (text: string) => ({ status: 200, json: { type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn" } })
const message = (sheet: unknown) => claudeAnswer(JSON.stringify(sheet))
const overloaded = { status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }
const rateLimited = { status: 429, json: { type: "error", error: { type: "rate_limit_error", message: "rate limit" } } }
const badKey = { status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }
/** Runs `fn` with no Claude key (inside withReader, which restores it). */
async function withoutClaude(fn: () => Promise<void>) {
  delete process.env.CLAUDE_API_KEY
  await fn()
}
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
      assert.deepEqual(r.body, { prices: { 11: 1250 }, brands: {}, codes: {}, read: 1, total: 2, request_number_matches: true })
      const sent = seen[0].body
      assert.equal(seen.length, 1)
      assert.equal(seen[0].url, CLAUDE_URL)
      assert.equal(seen[0].headers["x-api-key"], "test-key")
      assert.equal(seen[0].headers["anthropic-version"], "2023-06-01")
      assert.equal(sent.model, "claude-sonnet-5-5")
      const parts = sent.messages[0].content
      assert.deepEqual(parts[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } })
      assert.match(parts[1].text, /1\. Valve \(× 4\)\n2\. Pump \(× 2 pcs\)/)
      assert.match(sent.system, /Answer with JSON only/)
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
      assert.deepEqual(r.body, { prices: { 12: 80 }, brands: {}, codes: {}, read: 1, total: 2, request_number_matches: false })
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
    () => badKey,
    async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 503)
      assert.match(r.body.error, /API key was rejected/)
      assert.match(r.body.detail, /authentication_error/)
    },
  )
  await withReader(
    () => rateLimited,
    async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 429)
      assert.match(r.body.error, /free photo-reading limit/)
    },
  )
  await withReader(() => claudeAnswer(""), async () => assert.equal((await read(PHOTO)).status, 422))
  await withReader(() => claudeAnswer("not json"), async () => assert.equal((await read(PHOTO)).status, 422))
  await withReader(() => message({}), async () =>
    withoutClaude(async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 503)
      assert.match(r.body.error, /CLAUDE_API_KEY/)
    }),
  )
})

test("reader route: when Claude is busy, the backup reads the same photo", async () => {
  mkDb()
  await withReader(
    (s) => (isGroq(s) ? groqAnswer({ request_number: null, rows: [{ row: 1, written: "50" }] }) : overloaded),
    async (seen) =>
      withGroq(async () => {
        const r = await read(PHOTO)
        assert.equal(r.status, 200, JSON.stringify(r.body))
        assert.deepEqual(r.body.prices, { 11: 50 })
        assert.deepEqual(seen.map((s) => s.url), [CLAUDE_URL, "/openai/v1/chat/completions"])
        assert.equal(seen[1].body.messages[0].content, seen[0].body.system, "same instructions sent to the backup")
      }),
  )
  // Both over their limit: the limit message, after two tries.
  await withReader(() => rateLimited, async (seen) =>
    withGroq(async () => {
      assert.equal((await read(PHOTO)).status, 429)
      assert.equal(seen.length, 2)
    }),
  )
  // No backup key: Claude alone, one try.
  await withReader(() => overloaded, async (seen) => {
    assert.equal((await read(PHOTO)).status, 502)
    assert.equal(seen.length, 1)
  })
  // CLAUDE_MODEL in Vercel replaces the Claude model.
  await withReader(() => message({ request_number: null, rows: [] }), async (seen) => {
    process.env.CLAUDE_MODEL = "claude-custom"
    await read(PHOTO)
    assert.equal(seen[0].body.model, "claude-custom")
  })
})

test("backup reader: an xAI key in grokAPI uses Grok; any other key uses Groq", async () => {
  mkDb()
  await withReader(
    (s) => (s.url === "/v1/chat/completions" ? groqAnswer({ request_number: null, rows: [{ row: 2, written: "9" }] }) : overloaded),
    async (seen) => {
      process.env.XAI_BASE_URL = process.env.ANTHROPIC_BASE_URL
      process.env.grokAPI = "xai-test-key"
      const r = await read(PHOTO)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual(r.body.prices, { 12: 9 })
      const grok = seen.find((s) => s.url === "/v1/chat/completions")!
      assert.equal(grok.headers.authorization, "Bearer xai-test-key")
      assert.equal(grok.body.model, "grok-4.3")
    },
  )
})

test("CEO assistant: Claude first, the backup when Claude cannot answer", () => {
  const chat = src("app/api/ai/ceo-chat/route.ts")
  assert.match(chat, /await askClaude\(/)
  assert.match(chat, /await askBackup\(/)
  assert.doesNotMatch(chat, /gemini/i)
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
    assert.match(html, /سعر الوحدة<\/th>/)
    assert.doesNotMatch(html, /Unit Price|Linked|مرتبط بـ/)
    // columns: row, name, quantity, code box, brand box, notes, price box
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])
    assert.deepEqual(heads, ["م", "اسم الصنف", "الكمية", "الكود", "الماركة", "ملاحظات", "سعر الوحدة"])
    assert.equal(html.match(/<div class="pm-price-box"><\/div>/g)?.length, 6, "a code, a brand and a price box per row")
    assert.ok(html.indexOf("First item") < html.indexOf("Second item"), "row 1 is the lowest item id")
    assert.match(html, /اكتب الكود والماركة وسعر الوحدة \(بالأرقام فقط\) داخل المربعات لكل صنف</)
  } finally {
    globalThis.fetch = realFetch
  }
})

test("Quote received screen: photo button fills and highlights prices, same row order, saves only on Save", () => {
  const dialog = src("components/po-requests/quote-received-dialog.tsx")
  assert.match(dialog, /const items = sortRequestItems\(request\.po_request_items \|\| \[\]\)/)
  assert.match(dialog, /postPhotoRead\("\/api\/po-requests\/read-prices"/)
  assert.match(dialog, /accept="image\/\*"/)
  assert.match(dialog, /t\("chain\.photo-check"\)/)
  const handlePhoto = dialog.slice(dialog.indexOf("const handlePhoto"), dialog.indexOf("const handleExcel"))
  assert.doesNotMatch(handlePhoto, /\/api\/po-requests"/, "reading a photo does not save the PR")
  assert.doesNotMatch(handlePhoto, /\/api\/documents\/upload/, "the photo is uploaded only on Save")
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["chain.read-photo", "chain.photo-check", "chain.photo-read-result", "chain.photo-wrong-request", "chain.photos-failed"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in English and Arabic`)
  }
})

// ---------------------------------------------------------- item list photo on the quotation (owner, 2026-10-29)
test("item photo: quantities in Arabic or English digits; missing or unreadable become 1; unreadable names skipped", () => {
  const cases: [string | null, number][] = [
    ["4", 4], ["٤", 4], ["4 pcs", 4], ["x4", 4], ["١٢", 12], ["1,000", 1000], ["2.5", 2.5], ["12,5", 12.5],
    ["", 1], [null, 1], ["0", 1], ["-", 1], ["abc", 1],
  ]
  for (const [written, expected] of cases) assert.equal(parseQuantity(written), expected, String(written))
  assert.deepEqual(
    photoItems([
      { name: "  Oil   Filter X200 ", quantity: "٣" },
      { name: "فلتر زيت", quantity: null },
      { name: null, quantity: "5" },
      { name: "  ", quantity: "2" },
    ]),
    { items: [{ productName: "Oil Filter X200", quantity: 3 }, { productName: "فلتر زيت", quantity: 1 }], skipped: 2 },
  )
})

const readItems = (body: unknown) => call(itemsRoute.POST as any, "POST", body)
const LIST_PHOTO = { image: "aGVsbG8=", media_type: "image/jpeg" }

test("item photo route: name and quantity per row come back, nothing is saved", async () => {
  const db = new FakeDb({})
  useDb(db)
  await withReader(
    () => message({ rows: [{ name: "Pump P-10", quantity: "٢" }, { name: null, quantity: "1" }, { name: "Valve", quantity: null }] }),
    async (seen) => {
      const r = await readItems(LIST_PHOTO)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual(r.body, { items: [{ productName: "Pump P-10", quantity: 2 }, { productName: "Valve", quantity: 1 }], skipped: 1 })
      const sent = seen[0].body
      assert.equal(seen[0].url, CLAUDE_URL)
      assert.deepEqual(sent.messages[0].content[0].source, { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" })
      assert.match(sent.system, /table or plain lines/)
      assert.match(sent.system, /"name"[\s\S]*"quantity"/)
      assert.deepEqual(db.tables, {}, "nothing written")
    },
  )
})

test("item photo route: bad input, busy main model, limit, unreadable answer, missing key", async () => {
  useDb(new FakeDb({}))
  for (const bad of [{}, { ...LIST_PHOTO, media_type: "application/pdf" }, { ...LIST_PHOTO, image: "" }]) {
    assert.equal((await readItems(bad)).status, 400, JSON.stringify(bad))
  }
  await withReader(
    (s) => (isGroq(s) ? groqAnswer({ rows: [{ name: "Hose", quantity: "3" }] }) : overloaded),
    async (seen) =>
      withGroq(async () => {
        const r = await readItems(LIST_PHOTO)
        assert.equal(r.status, 200, JSON.stringify(r.body))
        assert.deepEqual(r.body.items, [{ productName: "Hose", quantity: 3 }])
        assert.equal(seen.length, 2)
      }),
  )
  await withReader(() => rateLimited, async () => {
    const r = await readItems(LIST_PHOTO)
    assert.equal(r.status, 429)
    assert.match(r.body.error, /add the items by hand/)
  })
  await withReader(() => claudeAnswer("not json"), async () => assert.equal((await readItems(LIST_PHOTO)).status, 422))
  await withReader(() => message({}), async () =>
    withoutClaude(async () => assert.equal((await readItems(LIST_PHOTO)).status, 503)),
  )
})

test("item photo button sits next to Import Excel and adds rows like the Excel import", () => {
  const sq = src("components/modules/sales-quotation-module.tsx")
  const excel = sq.indexOf('{t("sq.import-excel")}')
  const photo = sq.indexOf('t("sq.read-items-photo")')
  assert.ok(excel > 0 && photo > excel && photo - excel < 800, "photo button right after Import Excel")
  assert.match(sq, /postPhotoRead\("\/api\/quotations\/read-items"/)
  assert.match(sq, /shrinkPhoto\(one, "items-photo"\)/)
  assert.match(sq, /setItems\(\(prev\) => \[\.\.\.prev, \.\.\.newItems\]\)/, "added to the rows already there")
  assert.match(sq, /p\.productName\?\.toLowerCase\(\) === name \|\| p\.sku\?\.toLowerCase\(\) === name/)
  assert.match(src("components/po-requests/quote-received-dialog.tsx"), /import \{ shrinkPhoto \} from "@\/lib\/shrink-photo"/)
})

// ------------------------------------------------- brand box on the printed PR (owner, 2026-10-29)
test("brand: read per row, trimmed; empty boxes and rows not on the request are left out", () => {
  const items = [{ item_id: 12 }, { item_id: 10 }]
  assert.deepEqual(
    brandsByItem(items, [
      { row: 1, written: "100", brand: "  Bosch  " },
      { row: 2, written: null, brand: "" },
      { row: 3, written: null, brand: "Mann" },
    ]),
    { 10: "Bosch" },
  )
  assert.equal(nameWithBrand("Filter ", " Bosch"), "Filter – Bosch")
  assert.equal(nameWithBrand("Filter – Bosch", "bosch"), "Filter – Bosch", "never added twice")
  assert.equal(nameWithBrand(nameWithBrand("Filter", "Bosch"), "0451"), "Filter – Bosch – 0451", "brand then code")
  assert.deepEqual(codesByItem([{ item_id: 11 }, { item_id: 12 }], [{ row: 2, written: null, code: " AB 12 " }, { row: 5, written: null, code: "X" }]), { 12: "AB 12" })
})

test("reader route: the brand comes back per item next to the price; nothing is saved", async () => {
  const db = mkDb()
  await withReader(
    () => message({ request_number: "PR-2026-005", rows: [{ row: 1, written: "50", brand: "SKF", code: " 6204-2RS " }, { row: 2, written: "70", brand: null, code: "" }] }),
    async (seen) => {
      const r = await read(PHOTO)
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.deepEqual(r.body.brands, { 11: "SKF" })
      assert.deepEqual(r.body.codes, { 11: "6204-2RS" })
      const system = seen[0].body.system
      assert.match(system, /"code"/, "the reader is asked for the code")
      assert.match(system, /الكود/)
      assert.deepEqual(r.body.prices, { 11: 50, 12: 70 })
      assert.match(system, /"brand"/, "the reader is asked for the brand")
      assert.match(system, /الماركة/)
      assert.ok(db.tables.po_request_items.every((i) => i.product_name === "Pump" || i.product_name === "Valve"), "no name changed")
    },
  )
})

test("Save: a ticked brand becomes part of the item name; an unticked one is not kept", async () => {
  const db = mkDb()
  const put = (body: unknown) => call(poRequestsRoute.PUT as any, "PUT", body)
  const r = await put({ request_id: 5, status: "quoted", items: [{ item_id: 11, unit_price: 50, product_name: "Valve – SKF" }, { item_id: 12, unit_price: 70 }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const byId = Object.fromEntries(db.tables.po_request_items.map((i) => [i.item_id, i]))
  assert.deepEqual([byId[11].product_name, byId[11].unit_price], ["Valve – SKF", 50])
  assert.deepEqual([byId[12].product_name, byId[12].unit_price], ["Pump", 70])
  assert.equal((await put({ request_id: 5, status: "quoted", items: [{ item_id: 11, unit_price: 5, product_name: "  " }] })).status, 400)
  assert.equal((await put({ request_id: 5, status: "quoted", items: [{ item_id: 11, unit_price: 5, product_name: "x".repeat(301) }] })).status, 400)

  const dialog = src("components/po-requests/quote-received-dialog.tsx")
  assert.match(dialog, /const NAME_BOXES: NameBox\[\] = \["brand", "code"\]/)
  assert.match(dialog, /t\(`chain\.add-\$\{box\}-to-name`\)/)
  assert.match(dialog, /NAME_BOXES\.some\(\(box\) => ticked\(box, i\.item_id\)\) \? \{ product_name: newName\(i\) \}/)
  assert.match(dialog, /code: \{ \.\.\.prev\.code, \.\.\.\(body\.codes \|\| \{\}\) \}/)
  const i18n = src("lib/i18n-context.tsx")
  for (const key of ["chain.brand", "chain.add-brand-to-name", "chain.code", "chain.add-code-to-name"]) assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in English and Arabic`)
})

test("a branded PR item still gives its price to the quotation line, and the line takes the branded name", () => {
  const lines = [{ lineNo: 1, outsourced: true, productName: "Filter", unitCost: null, unitPrice: 0 }]
  const offers = supplierOffers(lines, [
    { request_id: 1, request_number: "PR-1", status: "quoted", supplier_id: 2, suppliers: { supplier_name: "A" }, po_request_items: [{ quotation_line_no: 1, product_name: "Filter – Bosch", unit_price: 90 }] },
    { request_id: 2, request_number: "PR-2", status: "quoted", supplier_id: 3, suppliers: { supplier_name: "B" }, po_request_items: [{ quotation_line_no: 1, product_name: "Filter", unit_price: 80 }] },
    { request_id: 3, request_number: "PR-3", status: "quoted", supplier_id: 4, po_request_items: [{ quotation_line_no: 1, product_name: "Pump – Bosch", unit_price: 10 }] },
  ])
  assert.deepEqual(offers[1].map((o) => [o.requestNumber, o.productName]), [["PR-2", "Filter"], ["PR-1", "Filter – Bosch"]])
  const branded = applyChosenCost(lines[0], offers[1][1])
  assert.deepEqual([branded.productName, branded.unitCost], ["Filter – Bosch", 90])
  // Switching back to the unbranded offer drops the brand again.
  const back = applyChosenCost(branded, supplierOffers([{ ...branded, lineNo: 1 }], [{ request_id: 2, request_number: "PR-2", status: "quoted", po_request_items: [{ quotation_line_no: 1, product_name: "Filter", unit_price: 80 }] }])[1][0])
  assert.equal(back.productName, "Filter")
  assert.equal(sameItemIgnoringBrand("Filter – Bosch", "filter"), true)
  assert.equal(sameItemIgnoringBrand("Filter – Bosch", "Pump – Bosch"), false)
})

// ------------------------------------------------- rows never split across pages, also on iPhone (owner, 2026-10-29)
test("prints: every item table gets the no-split row script", () => {
  const theme = src("lib/print/print-theme.ts")
  assert.match(theme, /\.pm-rows tr \{ display: grid;[^}]*break-inside: avoid/)
  assert.match(theme, /export const PRINT_ROWS_SCRIPT/)
  // cells must fill their grid column, or a column's own width (e.g. width: 38%) shrinks it and breaks the heading line
  assert.match(theme, /\.pm-rows th, \.pm-rows td \{ inline-size: auto !important;/)
  for (const file of [
    "app/api/delivery-permits/pdf/route.ts",
    "app/api/po-requests/pdf/route.ts",
    "app/api/quotations/generate/route.ts",
    "app/api/purchase-orders/pdf/route.ts",
    "app/api/invoices/ap/[id]/pdf/route.ts",
    "app/api/invoices/ar/[id]/pdf/route.ts",
    "app/api/maintenance/work-orders/[id]/pdf/route.ts",
    "lib/so-print-html.ts",
    "lib/missing-items-html.ts",
  ]) {
    assert.match(src(file), /\$\{PRINT_ROWS_SCRIPT\}\s*<\/body>/, file)
  }
})

test("several photos at once: the price request and the quotation pickers take many photos and read each in turn", () => {
  const dialog = src("components/po-requests/quote-received-dialog.tsx")
  assert.match(dialog, /<input ref=\{photoRef\} type="file" accept="image\/\*" multiple /)
  assert.match(dialog, /const picked = Array\.from\(event\.target\.files \|\| \[\]\)/)
  assert.match(dialog, /for \(const \[index, one\] of picked\.entries\(\)\)/)
  assert.match(dialog, /postPhotoRead\("\/api\/po-requests\/read-prices"/)
  assert.match(dialog, /chain\.photos-failed-which/)
  const sq = src("components/modules/sales-quotation-module.tsx")
  assert.match(sq, /<input ref=\{photoInputRef\} type="file" accept="image\/\*" multiple /)
  const handle = sq.slice(sq.indexOf("const handleItemsPhoto"), sq.indexOf("const addItem"))
  assert.match(handle, /for \(const \[index, one\] of picked\.entries\(\)\)/)
  assert.match(handle, /postPhotoRead\("\/api\/quotations\/read-items"/)
  assert.match(handle, /chain\.photos-failed-which/)
  assert.match(handle, /read\.push\(\.\.\.body\.items\)/)
})

test("pop-ups never run past the bottom of a phone screen: they scroll inside", () => {
  assert.match(src("components/ui/dialog.tsx"), /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/)
})

test("all photos are saved: several become one PDF with one page per photo; one photo stays a photo", () => {
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])
  const pdf = photosToPdf([{ jpeg: jpeg(1), width: 2000, height: 1500 }, { jpeg: jpeg(2), width: 1500, height: 2000 }, { jpeg: jpeg(3), width: 100, height: 100 }])
  const text = Buffer.from(pdf).toString("latin1")
  assert.ok(text.startsWith("%PDF-1.4"))
  assert.ok(text.trimEnd().endsWith("%%EOF"))
  assert.match(text, /\/Type \/Pages \/Kids \[3 0 R 6 0 R 9 0 R\] \/Count 3/)
  assert.equal(text.split("/Filter /DCTDecode").length - 1, 3, "each photo is on its own page")
  assert.match(text, /\/MediaBox \[0 0 595 446\.25\]/, "a wide photo fits the A4 width")
  assert.match(text, /\/MediaBox \[0 0 595 793\.33\]/, "a tall photo keeps its shape")
  // every xref offset points at its object
  const xref = Number(text.match(/startxref\n(\d+)/)![1])
  const offsets = text.slice(xref).split("\n").slice(3, 3 + 11).map((l) => Number(l.slice(0, 10)))
  offsets.forEach((at, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, at), `object ${i + 1} at its xref offset`))
  const dialog = src("components/po-requests/quote-received-dialog.tsx")
  assert.match(dialog, /const attachment = file \|\| \(await photosFile\(\)\)/)
  assert.match(dialog, /if \(photos\.length === 1\) return photos\[0\]\.file/)
  assert.match(dialog, /new File\(\[photosToPdf\(pages\)\], `price-photos-\$\{Date\.now\(\)\}\.pdf`, \{ type: "application\/pdf" \}\)/)
  const handlePhoto = dialog.slice(dialog.indexOf("const handlePhoto"), dialog.indexOf("const handleExcel"))
  assert.ok(handlePhoto.indexOf("setPhotos(") < handlePhoto.indexOf('postPhotoRead("/api/po-requests/read-prices"'), "a photo is kept even when reading it fails")
})

// ------------------------------------------------- the backup reader (Groq here; Grok with an xai- key), owner 2026-11-21
const groqAnswer = (sheet: unknown) => ({ status: 200, json: { choices: [{ message: { role: "assistant", content: JSON.stringify(sheet) } }] } })
function isGroq(s: Seen) {
  return s.url === "/openai/v1/chat/completions"
}
/** Adds a Groq backup key on the stand-in (inside withReader, which restores everything). */
async function withGroq(fn: () => Promise<void>, withClaudeKey = true) {
  process.env.GROQ_BASE_URL = process.env.ANTHROPIC_BASE_URL
  process.env.GROQ_API_KEY = "groq-test-key"
  if (!withClaudeKey) delete process.env.CLAUDE_API_KEY
  await fn()
}
const limit = rateLimited

test("backup reader: when Claude is over its limit, the backup reads the photo (same rows, photo sent as an image)", async () => {
  mkDb()
  await withReader(
    (s) => (isGroq(s) ? groqAnswer({ request_number: "PR-2026-005", rows: [{ row: 2, written: "75", brand: "SKF", code: null }] }) : limit),
    async (seen) =>
      withGroq(async () => {
        const r = await read(PHOTO)
        assert.equal(r.status, 200, JSON.stringify(r.body))
        assert.deepEqual(r.body.prices, { 12: 75 })
        assert.deepEqual(r.body.brands, { 12: "SKF" })
        const groq = seen.filter(isGroq)
        assert.equal(groq.length, 1)
        assert.equal(groq[0].headers.authorization, "Bearer groq-test-key")
        assert.equal(groq[0].body.model, "qwen/qwen3.8-27b")
        assert.deepEqual(groq[0].body.response_format, { type: "json_object" })
        assert.equal(groq[0].body.temperature, 0)
        const user = groq[0].body.messages.find((m: any) => m.role === "user")
        assert.match(user.content[0].text, /1\. Valve \(× 4\)/)
        assert.deepEqual(user.content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,aGVsbG8=" } })
      }),
  )
})

test("backup reader: works alone with only a Groq key; thinking text and code fences around the answer are ignored", async () => {
  mkDb()
  await withReader(
    (s) => ({ status: 200, json: { choices: [{ message: { content: "<think>looking</think>\n```json\n" + JSON.stringify({ request_number: null, rows: [{ row: 1, written: "10" }] }) + "\n```" } }] } }),
    async (seen) =>
      withGroq(async () => {
        const r = await read(PHOTO)
        assert.equal(r.status, 200, JSON.stringify(r.body))
        assert.deepEqual(r.body.prices, { 11: 10 })
        assert.ok(seen.every(isGroq), "Claude not called without its key")
      }, false),
  )
})

test("backup reader: both at their limit gives the limit message; a rejected Groq key says so; nothing set up says which keys", async () => {
  mkDb()
  await withReader(() => limit, async () =>
    withGroq(async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 429)
      assert.match(r.body.error, /free photo-reading limit/)
    }),
  )
  await withReader((s) => (isGroq(s) ? { status: 401, json: { error: { message: "Invalid API Key" } } } : limit), async () =>
    withGroq(async () => assert.equal((await read(PHOTO)).status, 429)),
  )
  await withReader(() => ({ status: 401, json: { error: { message: "Invalid API Key" } } }), async () =>
    withGroq(async () => assert.equal((await read(PHOTO)).status, 503), false),
  )
  await withReader(() => limit, async () =>
    withoutClaude(async () => {
      const r = await read(PHOTO)
      assert.equal(r.status, 503)
      assert.match(r.body.error, /CLAUDE_API_KEY or the grokAPI backup key/)
    }),
  )
})

test("backup reader: the item photo on quotations also falls back to Groq", async () => {
  await withReader(
    (s) => (isGroq(s) ? groqAnswer({ rows: [{ name: "Filter", quantity: "٣" }] }) : limit),
    async () =>
      withGroq(async () => {
        const r = await call(itemsRoute.POST as any, "POST", { image: "aGVsbG8=", media_type: "image/jpeg" })
        assert.equal(r.status, 200, JSON.stringify(r.body))
        assert.deepEqual(r.body.items, [{ productName: "Filter", quantity: 3 }])
      }),
  )
})

test("several photos: a busy answer waits and tries that photo once more; photo numbers are listed", async () => {
  const { postPhotoRead, photoNumbers, RETRY_STATUSES } = await import("../photo-retry")
  assert.deepEqual(RETRY_STATUSES, [429, 502, 503, 504])
  const realFetch = globalThis.fetch
  const answers = [429, 200]
  const waits: number[] = []
  globalThis.fetch = (async () => new Response("{}", { status: answers.shift() ?? 500 })) as any
  try {
    const r = await postPhotoRead("/x", { a: 1 }, async (ms) => void waits.push(ms))
    assert.equal(r.status, 200)
    assert.deepEqual(waits, [15000])
    answers.push(400)
    assert.equal((await postPhotoRead("/x", {}, async (ms) => void waits.push(ms))).status, 400, "bad photo: no retry")
    assert.equal(waits.length, 1)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(photoNumbers([1]), "2")
  assert.equal(photoNumbers([0, 2]), "1, 3")
})
