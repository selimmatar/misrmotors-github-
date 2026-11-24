// Two owner requests about delivery permits (2026-11-24):
//  A  the printed permit has a "لم يُستلم" tick box and a "الكمية المستلمة" box per line; the signed upload is read for
//     them, the shipping user confirms each line, and only confirmed lines become returns (the existing return flow);
//     a failed reading shows every line unticked ("could not read - tick manually").
//  B  a signed permit rejected because of a wrong / unclear upload goes back to shipping ("re-upload needed"), and an
//     already REJECTED permit that is not invoiced can be sent back (DP-2026-0005); an invoiced one cannot.
// The reader is never called for real: a local stand-in answers on ANTHROPIC_BASE_URL.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import { nreq } from "./hardening-fixtures"
import * as dpPdf from "../../app/api/delivery-permits/pdf/route"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as readRoute from "../../app/api/delivery-permits/read-signed/route"
import * as notReceivedRoute from "../../app/api/delivery-permits/not-received/route"
import { confirmationFromReadings, notReceivedReturnBody, parseReceived, unreadConfirmation, type SignedLine } from "../dp-not-received"
import { DP_ACTION_FROM, isAllowedDpTransition, needsReupload } from "../dp-transitions"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

// ------------------------------------------------------------------------------------------------ fixtures
function dpDb(status: string, extra: Record<string, Row[]> = {}, permitExtra: Row = {}) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-NR-1", customer_id: 5, status: "ready_for_delivery", fulfillment_status: "OUT_FOR_DELIVERY", total: 0 }],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: 7, quantity: 5, item_type: "stock", unit_price: 100, total: 500 },
      { so_item_id: 2, so_id: 1, product_id: 8, quantity: 3, item_type: "stock", unit_price: 50, total: 150 },
    ],
    customers: [{ customer_id: 5, customer_name: "BYD" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-2026-0005", sales_order_id: 1, customer_id: 5, status, created_at: "2026-11-20T09:00:00Z", ...permitExtra }],
    delivery_permit_items: [
      { item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "Pump", sku_snapshot: "P-7", quantity: 5, unit_price: 100, total: 500, warehouse_id: 1 },
      { item_id: 2, permit_id: 1, product_id: 8, item_name_snapshot: "Valve", sku_snapshot: "V-8", quantity: 3, unit_price: 50, total: 150, warehouse_id: 1 },
    ],
    inventory: [
      { inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 50, is_returned: false, unit_cost: 5 },
      { inventory_id: 2, product_id: 8, warehouse_id: 1, quantity: 30, is_returned: false, unit_cost: 5 },
    ],
    inventory_transactions: [], idempotency_log: [], workflow_events: [], users: [{ user_id: 3 }],
    product_returns: [], return_items: [], suppliers: [], invoice_delivery_permits: [], accounts_receivable: [],
    ...extra,
  })
  useDb(db)
  return db
}
const put = (action: string, extra: Row = {}) => call(dpRoute.PUT, "PUT", { permitId: "1", action, ...extra })
const st = (db: FakeDb) => db.tables.delivery_permits[0].status
const onHand = (db: FakeDb) => db.tables.inventory.map((r) => r.quantity)
const LINES: SignedLine[] = [
  { itemId: 1, productId: 7, name: "Pump", sku: "P-7", quantity: 5, returnable: 5 },
  { itemId: 2, productId: 8, name: "Valve", sku: "V-8", quantity: 3, returnable: 3 },
]

// ------------------------------------------------------------------------------------------------ the stand-in reader
const AI_ENV = ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_MODEL", "grokAPI", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODEL", "XAI_API_KEY", "XAI_BASE_URL", "XAI_MODEL"]
async function withReader(reply: (body: any) => { status: number; json: any }, fn: (seen: any[]) => Promise<void>, withKey = true) {
  const seen: any[] = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const body = JSON.parse(raw || "{}")
      seen.push(body)
      const out = reply(body)
      res.writeHead(out.status, { "content-type": "application/json" })
      res.end(JSON.stringify(out.json))
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const before = Object.fromEntries(AI_ENV.map((name) => [name, process.env[name]]))
  for (const name of AI_ENV) delete process.env[name]
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  if (withKey) process.env.CLAUDE_API_KEY = "test-key"
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
const claudeSays = (sheet: unknown) => ({ status: 200, json: { type: "message", role: "assistant", content: [{ type: "text", text: JSON.stringify(sheet) }], stop_reason: "end_turn" } })
const overloaded = { status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }
const PHOTO = { image: "aGVsbG8=", media_type: "image/jpeg" }
const readSigned = (images: unknown[] = [PHOTO]) => call(readRoute.POST as any, "POST", { permit_id: 1, images })
const confirm = (lines: unknown[], key = "nr-test-key-1") => call(notReceivedRoute.POST as any, "POST", { permitId: 1, idempotencyKey: key, lines })

// ------------------------------------------------------------------------------------------------ A. print
test("A1. the printed permit has a 'لم يُستلم' tick box and a 'الكمية المستلمة' box on every line; old columns stay", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any
  try {
    dpDb("OUT_FOR_DELIVERY")
    const res = await dpPdf.GET(nreq("http://test.local/api/delivery-permits/pdf?permitId=1"))
    const html = await res.text()
    assert.equal(res.status, 200)
    for (const head of ["مسلسل", "عدد", "البيان", "رقم الصنف", "ملاحظات"]) assert.ok(html.includes(`>${head}</th>`), head)
    assert.match(html, /<th class="pm-nr"[^>]*>لم يُستلم<\/th>/)
    assert.match(html, /<th class="pm-nr"[^>]*>الكمية المستلمة<\/th>/)
    assert.equal(html.split('<span class="pm-tick"></span>').length - 1, 2, "one tick box per line")
    assert.equal(html.split('<span class="pm-recv"></span>').length - 1, 2, "one received box per line")
    assert.ok(html.indexOf("Pump") < html.indexOf("Valve"), "printed in the order lines are numbered for the reader")
    assert.match(html, /<html dir="rtl" lang="ar">/)
  } finally {
    globalThis.fetch = realFetch
  }
})

// ------------------------------------------------------------------------------------------------ A. reading (pure)
test("A2. reading -> confirmation: a ticked box returns the line, a lower received quantity returns the difference", () => {
  const c = confirmationFromReadings(LINES, [{ rows: [{ row: 1, not_received: true }, { row: 2, not_received: false, received_quantity: "٢" }] }], "claude")
  assert.equal(c.read, true)
  assert.equal(c.note, null)
  assert.deepEqual(c.rows.map((r) => [r.itemId, r.notReceived, r.returnQuantity, r.receivedQuantity, r.fromReader]), [
    [1, true, 5, null, true],
    [2, true, 1, 2, true],
  ])
  // several pages: a mark on any page counts; never more than is still returnable
  const pages = confirmationFromReadings([{ ...LINES[0], returnable: 2 }, LINES[1]], [{ rows: [{ row: 2, not_received: false }] }, { rows: [{ row: 1, not_received: true }] }])
  assert.deepEqual(pages.rows.map((r) => [r.notReceived, r.returnQuantity]), [[true, 2], [false, 0]])
  // a received quantity equal to the printed one, or unreadable, is not a return
  const full = confirmationFromReadings(LINES, [{ rows: [{ row: 1, received_quantity: 5 }, { row: 2, received_quantity: "3/2" }] }])
  assert.deepEqual(full.rows.map((r) => r.notReceived), [false, false])
  assert.equal(parseReceived("١٫٥"), 1.5)
  assert.equal(parseReceived("abc"), null)
})

test("A3. reader failure: every line unticked with the note 'could not read - tick manually'", () => {
  for (const c of [unreadConfirmation(LINES), confirmationFromReadings(LINES, [null, null]), confirmationFromReadings(LINES, [{ rows: "x" as any }])]) {
    assert.equal(c.read, false)
    assert.match(c.note || "", /tick manually/)
    assert.match(c.noteAr || "", /علّم يدويًا/)
    assert.deepEqual(c.rows.map((r) => [r.notReceived, r.returnQuantity]), [[false, 0], [false, 0]])
  }
})

test("A4. only confirmed lines go into the return body (existing return flow fields)", () => {
  const built = notReceivedReturnBody(1, "nr-key-123", LINES, [
    { itemId: 1, notReceived: true, quantity: 2 },
    { itemId: 2, notReceived: false, quantity: 3 },
    { itemId: 99, notReceived: true, quantity: 1 },
  ])!
  assert.equal(built.body.permitId, 1)
  assert.equal(built.body.idempotencyKey, "nr-key-123")
  assert.deepEqual(built.body.items.map((i: any) => [i.permitItemId, i.productId, i.quantityReturned, i.reason, i.condition]), [[1, 7, 2, "customer_refused", "good"]])
  assert.equal(notReceivedReturnBody(1, "nr-key-123", LINES, [{ itemId: 1, notReceived: false, quantity: 5 }]), null)
  assert.equal(notReceivedReturnBody(1, "nr-key-123", LINES, [{ itemId: 1, notReceived: true, quantity: 0 }]), null)
})

// ------------------------------------------------------------------------------------------------ A. routes end to end
test("A5. upload read -> confirmation -> only the confirmed lines become a return through the existing flow", async () => {
  const db = dpDb("OUT_FOR_DELIVERY")
  await withReader(
    () => claudeSays({ permit_no: "DP-2026-0005", rows: [{ row: 1, not_received: true }, { row: 2, not_received: true }] }),
    async (seen) => {
      const r = await readSigned()
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.read, true)
      assert.deepEqual(r.body.rows.map((x: any) => [x.itemId, x.notReceived, x.returnQuantity]), [[1, true, 5], [2, true, 3]])
      assert.equal(seen.length, 1, "one reading per photo")
      assert.match(JSON.stringify(seen[0]), /1\. Pump/)
      assert.match(JSON.stringify(seen[0]), /لم يُستلم/)
      assert.equal(db.tables.product_returns.length, 0, "reading saves nothing")
    },
  )
  // the shipping user un-ticks the Valve and lowers the Pump to 2, then confirms with the check mark
  const c = await confirm([{ itemId: 1, notReceived: true, quantity: 2 }, { itemId: 2, notReceived: false, quantity: 3 }])
  assert.equal(c.status, 200, JSON.stringify(c.body))
  assert.equal(c.body.success, true)
  assert.equal(c.body.lines, 1)
  assert.equal(db.tables.product_returns.length, 1)
  const ret = db.tables.product_returns[0]
  assert.deepEqual([ret.permit_id, ret.status, ret.so_id], ["1", "pending_warehouse", 1])
  assert.deepEqual(db.tables.return_items.map((i) => [i.product_id, i.returned_quantity, i.return_reason]), [[7, 2, "customer_refused"]])
  assert.equal(db.tables.delivery_permit_items[0].received_quantity, 3, "optional copy of the received quantity")
  assert.ok(db.tables.workflow_events.some((e) => e.event_type === "NOT_RECEIVED_CONFIRMED"))
  // the same confirmation sent twice records it once
  const again = await confirm([{ itemId: 1, notReceived: true, quantity: 2 }])
  assert.equal(again.body.isDuplicate, true)
  assert.equal(db.tables.product_returns.length, 1)
  // nothing confirmed -> nothing saved
  const none = await confirm([{ itemId: 2, notReceived: false, quantity: 3 }], "nr-test-key-2")
  assert.equal(none.status, 200)
  assert.equal(none.body.returnId, null)
  assert.equal(db.tables.product_returns.length, 1)
  // downstream: the reprint shows the confirmed line as not delivered
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any
  try {
    const html = await (await dpPdf.GET(nreq("http://test.local/api/delivery-permits/pdf?permitId=1"))).text()
    assert.match(html, /لم يتم التسليم \/ Not delivered: 2/)
  } finally {
    globalThis.fetch = realFetch
  }
  // and a later read offers only what is still returnable
  const later = await readSigned([])
  assert.deepEqual(later.body.rows.map((x: any) => x.returnable), [3, 3])
})

test("A6. reader failure paths: busy reader, no key, or no photo (a PDF) -> 200, every line unticked with the note", async () => {
  const db = dpDb("OUT_FOR_DELIVERY")
  await withReader(
    () => overloaded,
    async () => {
      const r = await readSigned()
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.read, false)
      assert.match(r.body.note, /tick manually/)
      assert.deepEqual(r.body.rows.map((x: any) => [x.notReceived, x.returnQuantity]), [[false, 0], [false, 0]])
    },
  )
  await withReader(() => claudeSays("not json at all"), async () => {
    const r = await readSigned()
    assert.equal(r.body.read, false)
  })
  await withReader(() => overloaded, async (seen) => {
    const r = await readSigned()
    assert.equal(r.body.read, false)
    assert.equal(seen.length, 0, "no key: the reader is not called")
  }, false)
  const noPhoto = await readSigned([{ image: "JVBERi0=", media_type: "application/pdf" }])
  assert.equal(noPhoto.status, 200)
  assert.equal(noPhoto.body.read, false)
  assert.equal(db.tables.product_returns.length, 0)
  assert.equal((await call(readRoute.POST as any, "POST", { permit_id: 99, images: [] })).status, 404)
})

// ------------------------------------------------------------------------------------------------ B. send back to shipping
test("B1. transition table: send back from a signed or rejected permit only", () => {
  assert.deepEqual([...DP_ACTION_FROM.SEND_BACK_TO_SHIPPING], ["SUBMITTED_SIGNED", "REJECTED"])
  for (const s of ["DRAFT", "PRINTED", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "APPROVED"]) assert.equal(isAllowedDpTransition(s, "SEND_BACK_TO_SHIPPING"), false, s)
  assert.equal(needsReupload({ status: "OUT_FOR_DELIVERY", rejection_reason: "wrong photo" }), true)
  assert.equal(needsReupload({ status: "OUT_FOR_DELIVERY", rejection_reason: null }), false)
  assert.equal(needsReupload({ status: "REJECTED", rejection_reason: "x" }), false)
  assert.equal(needsReupload({ status: "OUT_FOR_DELIVERY", rejection_reason: "x", needs_reupload: false }), false)
})

test("B2. reject as wrong upload: back to shipping (re-upload needed, reason shown), stock held again; re-upload goes to approval", async () => {
  const db = dpDb("OUT_FOR_DELIVERY")
  assert.equal((await put("MARK_SUBMITTED_SIGNED")).status, 200)
  assert.deepEqual(onHand(db), [45, 27], "stock left at signing")

  assert.equal((await put("SEND_BACK_TO_SHIPPING", {})).status, 400, "a reason is required")
  const back = await put("SEND_BACK_TO_SHIPPING", { reason: "wrong photo uploaded" })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  assert.equal(st(db), "OUT_FOR_DELIVERY")
  assert.equal(db.tables.delivery_permits[0].rejection_reason, "wrong photo uploaded")
  assert.equal(db.tables.delivery_permit_items.length, 2, "lines kept")
  assert.deepEqual(onHand(db), [50, 30], "out for delivery again: the stock is held, not out")
  const ev = db.tables.workflow_events.find((e) => e.event_type === "SENT_BACK_TO_SHIPPING")!
  assert.deepEqual([ev.old_value, ev.new_value], ["SUBMITTED_SIGNED", "OUT_FOR_DELIVERY"])
  assert.match(ev.notes, /wrong photo uploaded/)

  // the shipping list shows it, marked "re-upload needed" with the reason
  const list = await call(dpRoute.GET as any, "GET", undefined, "http://test.local/api/delivery-permits")
  const row = list.body.find((p: any) => p.id === "1")
  assert.deepEqual([row.status, row.needsReupload, row.reuploadReason], ["OUT_FOR_DELIVERY", true, "wrong photo uploaded"])
  assert.ok(row.nextActions.includes("MARK_SUBMITTED_SIGNED"))

  // re-upload -> signed again (approval again), stock out once more, no longer "re-upload needed"
  const resigned = await put("MARK_SUBMITTED_SIGNED")
  assert.equal(resigned.status, 200, JSON.stringify(resigned.body))
  assert.equal(st(db), "SUBMITTED_SIGNED")
  assert.equal(db.tables.delivery_permits[0].rejection_reason, null)
  assert.deepEqual(onHand(db), [45, 27])
  assert.equal((await put("APPROVE")).status, 200)
  assert.equal(st(db), "APPROVED")
  assert.deepEqual(onHand(db), [45, 27], "approval never takes it twice")
})

test("B3. 'Reject permit' (the delivery itself) still rejects", async () => {
  const db = dpDb("OUT_FOR_DELIVERY")
  await put("MARK_SUBMITTED_SIGNED")
  const r = await put("REJECT", { rejectionReason: "customer refused the goods" })
  assert.equal(r.status, 200)
  assert.equal(st(db), "REJECTED")
  assert.deepEqual(onHand(db), [50, 30])
})

test("B4. an already REJECTED permit that is not invoiced can be sent back (DP-2026-0005); stock is taken once at the new signing", async () => {
  const db = dpDb("OUT_FOR_DELIVERY")
  await put("MARK_SUBMITTED_SIGNED")
  await put("REJECT", { rejectionReason: "wrong photo" })
  assert.equal(st(db), "REJECTED")
  assert.deepEqual(onHand(db), [50, 30])

  const back = await put("SEND_BACK_TO_SHIPPING", { reason: "wrong photo - upload the signed permit again" })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  assert.equal(st(db), "OUT_FOR_DELIVERY")
  assert.ok(db.tables.workflow_events.some((e) => e.event_type === "SENT_BACK_TO_SHIPPING" && e.old_value === "REJECTED"))
  assert.equal(db.tables.sales_orders[0].fulfillment_status, "OUT_FOR_DELIVERY")

  assert.equal((await put("MARK_SUBMITTED_SIGNED")).status, 200)
  assert.deepEqual(onHand(db), [45, 27], "the new signing takes the stock again")
  // rejecting again puts back exactly what is out (not both signings)
  assert.equal((await put("REJECT", { rejectionReason: "refused" })).status, 200)
  assert.deepEqual(onHand(db), [50, 30])
})

test("B5. an invoiced REJECTED permit cannot be sent back; only accountant / CEO / admin may send back", async () => {
  const db = dpDb("REJECTED", { invoice_delivery_permits: [{ invoice_id: 9, permit_id: 1 }] })
  const r = await put("SEND_BACK_TO_SHIPPING", { reason: "wrong photo" })
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.code, "DP_INVOICED")
  assert.equal(st(db), "REJECTED")
  assert.equal(db.tables.workflow_events.length, 0)

  const db2 = dpDb("REJECTED", { accounts_receivable: [{ invoice_id: 4, source_delivery_permit_id: 1 }] })
  assert.equal((await put("SEND_BACK_TO_SHIPPING", { reason: "x" })).body.code, "DP_INVOICED")
  assert.equal(st(db2), "REJECTED")

  const db3 = dpDb("REJECTED")
  const asRole = (roles: string) =>
    dpRoute.PUT(
      new Request("http://test.local/api", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-mm-roles": roles, "x-mm-user-id": "3" },
        body: JSON.stringify({ permitId: "1", action: "SEND_BACK_TO_SHIPPING", reason: "wrong photo" }),
      }) as any,
    )
  assert.equal((await asRole("shipment")).status, 403)
  assert.equal(st(db3), "REJECTED")
  assert.equal((await asRole("accountant")).status, 200)
  assert.equal(st(db3), "OUT_FOR_DELIVERY")

  // an approved permit is never sent back
  const db4 = dpDb("APPROVED")
  assert.equal((await put("SEND_BACK_TO_SHIPPING", { reason: "x" })).status, 409)
  assert.equal(st(db4), "APPROVED")
})

// ------------------------------------------------------------------------------------------------ screens
test("S1. screens: two reject choices, send back on rejected permits, the confirmation step before completing an upload", () => {
  const controls = src("components/delivery-permit/approve-reject-controls.tsx")
  assert.match(controls, /t\("permit\.send-back-to-shipping"\)/)
  assert.match(controls, /t\("permit\.reject-permit-goods"\)/)
  const card = src("components/delivery-permit/delivery-permit-card.tsx")
  assert.match(card, /onSendBack=\{handleSendBack\}/)
  assert.match(card, /SEND_BACK_TO_SHIPPING/)
  assert.match(card, /<NotReceivedDialog/)
  assert.match(card, /permit\.needsReupload/)
  const module = src("components/modules/delivery-permits-module.tsx")
  assert.match(module, /<SendBackToShippingButton/)
  assert.match(module, /onSendBack=\{\(reason\) => reviewAction\("SEND_BACK_TO_SHIPPING"/)
  const shipping = src("components/modules/shipping-module.tsx")
  assert.match(shipping, /<NotReceivedDialog/)
  assert.match(shipping, /recordNotReceived\(permit\.id, lines/)
  assert.match(shipping, /permit\.needsReupload/)
  assert.match(shipping, /openReturnDialog\(permit\)/, "the manual way stays")
  const dialog = src("components/delivery-permit/not-received-dialog.tsx")
  assert.match(dialog, /\/api\/delivery-permits\/read-signed/)
  assert.match(dialog, /\/api\/delivery-permits\/not-received/)
  assert.match(dialog, /t\("dp-nr\.could-not-read"\)/)
  const sql = src("scripts/sql/2026-11-26-dp-not-received.sql")
  assert.match(sql, /WRITTEN, NOT APPLIED/)
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\bupdate\b/i)
})

test("S2. i18n: every new key in English and Arabic, before eta.go-live-started", () => {
  const i18n = src("lib/i18n-context.tsx")
  const keys = [
    "permit.send-back-to-shipping", "permit.send-back-short", "permit.reject-permit-goods", "permit.reject-choice", "permit.send-back-title",
    "permit.send-back-description", "permit.send-back-placeholder", "permit.reupload-needed", "permit.reupload-reason",
    "dp-nr.title", "dp-nr.description", "dp-nr.reading", "dp-nr.read-ok", "dp-nr.could-not-read", "dp-nr.returned", "dp-nr.quantity",
    "dp-nr.of", "dp-nr.marked", "dp-nr.received-written", "dp-nr.confirm", "dp-nr.returns-done", "dp-nr.returns-failed",
  ]
  const firstGoLive = i18n.indexOf('"eta.go-live-started"')
  const secondGoLive = i18n.indexOf('"eta.go-live-started"', firstGoLive + 1)
  for (const k of keys) {
    assert.equal(i18n.split(`"${k}":`).length - 1, 2, `${k} in English and Arabic`)
    const en = i18n.indexOf(`"${k}":`)
    const ar = i18n.indexOf(`"${k}":`, en + 1)
    assert.ok(en < firstGoLive && ar > firstGoLive && ar < secondGoLive, `${k} before eta.go-live-started`)
  }
})
