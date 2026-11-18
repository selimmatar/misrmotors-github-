// Line order (owner report, 2026-11-17): quotation lines showed up scattered in the approval view. The lines must keep
// the order they were entered in from the form through approval, the sales order and its prints, the person can
// reorder them (drag or move up / down) and search them without losing that order.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as quotationRoute from "../../app/api/sales-quotations/route"
import * as approveRoute from "../../app/api/sales-quotations/approve/route"
import * as soRoute from "../../app/api/sales-orders/route"
import * as soPrintRoute from "../../app/api/sales-orders/print/route"
import {
  filterLines,
  followLineOrder,
  hasLineOrderColumn,
  moveLine,
  moveTarget,
  normalizeSearchText,
  sortLines,
  sortQuotationLines,
  sortSoLines,
} from "../line-order"
import { lineKey } from "../return-lines"
import { cleanAddressedTo, quoteAddressee } from "../quotations/addressed-to"
import * as quotationPdfRoute from "../../app/api/quotations/generate/route"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")

// ------------------------------------------------------------------------------------------------ pure functions
test("sortLines: by position, then id; rows without a position go last; input untouched", () => {
  const rows = [
    { id: 4, line_no: 2 },
    { id: 1, line_no: null },
    { id: 3, line_no: 1 },
    { id: 2, line_no: 2 },
  ]
  const before = JSON.stringify(rows)
  assert.deepEqual(sortLines(rows, "id", "line_no").map((r) => r.id), [3, 2, 4, 1])
  assert.equal(JSON.stringify(rows), before)
  assert.deepEqual(sortQuotationLines([{ id: 9, line_no: 3 }, { id: 8, line_no: 1 }, { id: 7, line_no: 2 }]).map((r) => r.id), [8, 7, 9])
  // sales order lines before the column exists: so_item_id order (the order they were inserted in)
  assert.deepEqual(sortSoLines([{ so_item_id: 12 }, { so_item_id: 10 }, { so_item_id: 11 }]).map((r) => r.so_item_id), [10, 11, 12])
  assert.deepEqual(sortSoLines([{ so_item_id: 10, line_order: 3 }, { so_item_id: 11, line_order: 1 }, { so_item_id: 12, line_order: 2 }]).map((r) => r.so_item_id), [11, 12, 10])
  assert.deepEqual(sortSoLines(null), [])
})

test("moveLine / moveTarget: drag and up / down moves; a search only skips hidden lines", () => {
  const list = ["A", "B", "C", "D", "E"]
  assert.deepEqual(moveLine(list, 0, 3), ["B", "C", "D", "A", "E"]) // dragged down onto D: lands after it
  assert.deepEqual(moveLine(list, 4, 1), ["A", "E", "B", "C", "D"]) // dragged up onto B: lands before it
  assert.deepEqual(moveLine(list, 2, 2), list)
  assert.deepEqual(moveLine(list, 9, 0), list)
  assert.deepEqual(list, ["A", "B", "C", "D", "E"], "input untouched")
  const all = [0, 1, 2, 3, 4]
  assert.equal(moveTarget(all, 2, -1), 1)
  assert.equal(moveTarget(all, 2, 1), 3)
  assert.equal(moveTarget(all, 0, -1), null)
  assert.equal(moveTarget(all, 4, 1), null)
  // only A, C, E shown: E moves up past the hidden D to C's place
  const shown = [0, 2, 4]
  assert.equal(moveTarget(shown, 4, -1), 2)
  assert.deepEqual(moveLine(list, 4, moveTarget(shown, 4, -1)!), ["A", "B", "E", "C", "D"])
  assert.equal(moveTarget(shown, 1, 1), null, "a hidden line has no target")
})

test("filterLines: name / SKU search keeps the order and loses no line", () => {
  const lines = [
    { name: "Hydraulic pump", sku: "HP-100" },
    { name: "مضخة مياه", sku: "WP-٢٠٠" },
    { name: "Pump seal kit", sku: "PS-7" },
    { name: "Filter", sku: null },
  ]
  const texts = (l: (typeof lines)[number]) => [l.name, l.sku]
  assert.deepEqual(filterLines(lines, "", texts), [0, 1, 2, 3])
  assert.deepEqual(filterLines(lines, "   ", texts), [0, 1, 2, 3])
  assert.deepEqual(filterLines(lines, "PUMP", texts), [0, 2], "case-insensitive, list order")
  assert.deepEqual(filterLines(lines, "hp-1", texts), [0], "SKU")
  assert.deepEqual(filterLines(lines, "wp-200", texts), [1], "Arabic-Indic digits match")
  assert.deepEqual(filterLines(lines, "مضخه", texts), [1], "teh marbuta / heh")
  assert.deepEqual(filterLines(lines, "pump kit", texts), [2], "every word must match")
  assert.deepEqual(filterLines(lines, "nothing", texts), [])
  assert.equal(lines.length, 4)
  assert.equal(normalizeSearchText("  أحمد  إبراهيم "), "احمد ابراهيم")
})

test("followLineOrder: permit / invoice lines follow the sales order's line order", () => {
  const soLines = [
    { so_item_id: 1, product_id: 7, outsourced_name: null, line_order: 2 },
    { so_item_id: 2, product_id: null, outsourced_name: "Install", line_order: 1 },
    { so_item_id: 3, product_id: 9, outsourced_name: null, line_order: 3 },
  ]
  const permitLines = [
    { item_id: 30, product_id: 9, item_name_snapshot: "Valve" },
    { item_id: 31, product_id: null, item_name_snapshot: "Unknown" },
    { item_id: 32, product_id: 7, item_name_snapshot: "Pump" },
    { item_id: 33, product_id: null, item_name_snapshot: "Install" },
  ]
  const ordered = followLineOrder(
    permitLines,
    sortSoLines(soLines),
    (r) => lineKey(r.product_id, r.item_name_snapshot),
    (l) => lineKey(l.product_id, l.outsourced_name),
    "item_id",
  )
  assert.deepEqual(ordered.map((r) => r.item_id), [33, 32, 30, 31])
})

// ------------------------------------------------------------------------------------------------ the whole flow
// The database returns rows in no set order: the fake shuffles the stored rows before each read to prove nothing
// depends on the physical order.
function scramble(db: FakeDb, table: string) {
  const rows = db.tables[table] || []
  rows.reverse()
  if (rows.length > 2) rows.push(rows.splice(1, 1)[0])
}

function flowDb() {
  const db = new FakeDb({
    sales_quotations: [], sales_quotation_items: [], sales_orders: [], sales_order_items: [], delivery_permits: [],
    delivery_permit_items: [], suppliers: [], accounts_receivable: [], po_requests: [], po_request_items: [],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }], products: [], inventory: [],
  })
  db.rpcHandlers.generate_quotation_number = () => `Q-LO-${db.tables.sales_quotations.length + 1}`
  db.rpcHandlers.generate_so_number = () => `SO-LO-${db.tables.sales_orders.length + 1}`
  useDb(db)
  return db
}
const line = (name: string, price = 100) => ({ item_type: "outsourced", product_name: name, quantity: 1, unit_price: price })
const getQuotation = (id: number) => call(quotationRoute.GET as any, "GET", undefined, `http://test.local/api/sales-quotations?id=${id}`)
const names = (items: Row[]) => items.map((i) => i.product_name)
const printOrder = async (soId: number) => {
  const res = await soPrintRoute.GET(new Request(`http://test.local/api/x?soId=${soId}`) as any)
  assert.equal(res.status, 200)
  const html = await res.text()
  return (wanted: string[]) => {
    const at = wanted.map((n) => html.indexOf(n))
    assert.ok(at.every((i) => i >= 0), `all printed: ${wanted}`)
    assert.deepEqual([...at].sort((a, b) => a - b), at, `printed in order ${wanted.join(", ")}`)
  }
}

test("order kept: create -> read -> reorder (save) -> approve -> sales order -> print", async () => {
  const db = flowDb()
  const entered = ["Line Alpha", "Line Bravo", "Line Charlie", "Line Delta", "Line Echo"]
  const created = await call(quotationRoute.POST as any, "POST", { customer_name: "Test Customer", customer_id: 5, items: entered.map((n) => line(n)) })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const qid = created.body.quotation.id
  assert.deepEqual(db.tables.sales_quotation_items.map((r) => r.line_no), [1, 2, 3, 4, 5])

  // read (the approval view loads the quotation this way)
  scramble(db, "sales_quotation_items")
  const read1 = await getQuotation(qid)
  assert.equal(read1.status, 200, JSON.stringify(read1.body))
  assert.deepEqual(names(read1.body.quotation.items), entered)

  // the person drags lines in the approval view and saves: the new order is stored as line_no
  const chosen = ["Line Charlie", "Line Alpha", "Line Echo", "Line Bravo", "Line Delta"]
  const byName = new Map(read1.body.quotation.items.map((i: Row) => [i.product_name, i]))
  const saved = await call(quotationRoute.PATCH as any, "PATCH", {
    quotation_id: qid, customer_id: 5, customer_name: "Test Customer", subtotal: 500, tax: 70, total: 570, net_total: 570,
    items: chosen.map((n) => byName.get(n)),
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  scramble(db, "sales_quotation_items")
  const read2 = await getQuotation(qid)
  assert.deepEqual(names(read2.body.quotation.items), chosen)
  assert.deepEqual(read2.body.quotation.items.map((i: Row) => i.line_no), [1, 2, 3, 4, 5])

  // approve -> sales order lines in the same order (inserted in that order, line_order written when the column exists)
  scramble(db, "sales_quotation_items")
  const approved = await call(approveRoute.POST as any, "POST", { quotation_id: qid })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  const soId = approved.body.sales_order.so_id
  const soLines = sortSoLines(db.tables.sales_order_items.filter((r) => r.so_id === soId))
  assert.deepEqual(soLines.map((r) => r.outsourced_name), chosen)
  assert.deepEqual(soLines.map((r) => r.line_order), [1, 2, 3, 4, 5])
  const byId = [...soLines].sort((a, b) => a.so_item_id - b.so_item_id)
  assert.deepEqual(byId.map((r) => r.outsourced_name), chosen, "so_item_id order is the same order (fallback)")

  // the sales order print follows it
  scramble(db, "sales_order_items")
  ;(await printOrder(soId))(chosen)

  // reorder on the sales order (edit dialog): saved as line_order, print follows
  const edited = [...soLines].reverse()
  const put = await call(soRoute.PUT as any, "PUT", {
    so_id: soId, customerId: "5",
    items: edited.map((r) => ({ id: String(r.so_item_id), productName: r.outsourced_name, quantity: 1, unitPrice: 100, total: 100, itemType: "outsourced" })),
  })
  assert.equal(put.status, 200, JSON.stringify(put.body))
  const afterPut = sortSoLines(db.tables.sales_order_items.filter((r) => r.so_id === soId))
  assert.deepEqual(afterPut.map((r) => r.outsourced_name), [...chosen].reverse())
  assert.deepEqual(afterPut.map((r) => r.so_item_id), edited.map((r) => r.so_item_id), "lines keep their ids")
  scramble(db, "sales_order_items")
  ;(await printOrder(soId))([...chosen].reverse())
})

// Before scripts/sql/2026-11-18-line-order.sql: selecting / writing line_order fails like a missing column.
function withoutLineOrderColumn(db: FakeDb) {
  const wrote: string[] = []
  const from = db.from.bind(db)
  ;(db as any).from = (table: string) => {
    const q: any = from(table)
    if (table !== "sales_order_items") return q
    const select = q.select.bind(q)
    const insert = q.insert.bind(q)
    const update = q.update.bind(q)
    const missing = { data: null, error: { code: "42703", message: 'column sales_order_items.line_order does not exist' } }
    q.select = (cols?: string, opts?: any) => {
      if (cols && /line_order/.test(cols)) {
        const failed: any = { limit: () => failed, then: (ok: any, bad: any) => Promise.resolve(missing).then(ok, bad) }
        return failed
      }
      return select(cols, opts)
    }
    const check = (payload: any) => {
      for (const row of Array.isArray(payload) ? payload : [payload]) if (row && "line_order" in row) wrote.push(table)
    }
    q.insert = (payload: any) => (check(payload), insert(payload))
    q.update = (payload: any) => (check(payload), update(payload))
    return q
  }
  return wrote
}

test("without the line_order column: conversion and edits work, the order is not saved (id order used)", async () => {
  const db = flowDb()
  const wrote = withoutLineOrderColumn(db)
  assert.equal(await hasLineOrderColumn(db), false)
  const entered = ["One", "Two", "Three"]
  const created = await call(quotationRoute.POST as any, "POST", { customer_name: "Test Customer", customer_id: 5, items: entered.map((n) => line(n)) })
  const approved = await call(approveRoute.POST as any, "POST", { quotation_id: created.body.quotation.id })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  const soId = approved.body.sales_order.so_id
  const rows = sortSoLines(db.tables.sales_order_items)
  assert.deepEqual(rows.map((r) => r.outsourced_name), entered)
  assert.ok(rows.every((r) => !("line_order" in r)))

  const put = await call(soRoute.PUT as any, "PUT", {
    so_id: soId, customerId: "5",
    items: [...rows].reverse().map((r) => ({ id: String(r.so_item_id), productName: r.outsourced_name, quantity: 2, unitPrice: 100, total: 200, itemType: "outsourced" })),
  })
  assert.equal(put.status, 200, JSON.stringify(put.body))
  assert.deepEqual(wrote, [], "line_order never written")
  assert.deepEqual(db.tables.sales_order_items.map((r) => r.quantity), [2, 2, 2], "the edit itself is saved")
  scramble(db, "sales_order_items")
  ;(await printOrder(soId))(entered)
})

test("with the column: a new sales order from the form stores line_order in the form's order", async () => {
  const db = flowDb()
  assert.equal(await hasLineOrderColumn(db), true)
  db.tables.inventory.push({ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 10, is_returned: false })
  const res = await call(soRoute.POST as any, "POST", {
    customerId: "5", status: "draft", orderDate: "2026-11-18", subtotal: 300, total: 342, paymentType: "cash",
    items: ["Zulu", "Yankee", "X-ray"].map((n) => ({ productId: "", productName: n, quantity: 1, unitPrice: 100, total: 100, itemCategory: "OUTSOURCED" })),
  })
  assert.ok(res.status < 300, JSON.stringify(res.body))
  const rows = sortSoLines(db.tables.sales_order_items)
  assert.deepEqual(rows.map((r) => r.outsourced_name), ["Zulu", "Yankee", "X-ray"])
  assert.deepEqual(rows.map((r) => r.line_order), [1, 2, 3])
})

// ------------------------------------------------------------------------------------------------ quote addressed to
test("addressed-to helpers: trimmed, optional, printed name falls back to the customer", () => {
  assert.equal(cleanAddressedTo("  Branch   East "), "Branch East")
  assert.equal(cleanAddressedTo("   "), null)
  assert.equal(cleanAddressedTo(undefined), null)
  assert.equal(cleanAddressedTo(42), null)
  assert.equal(cleanAddressedTo("x".repeat(300))!.length, 200)
  assert.equal(quoteAddressee({ customer_name: "Real Co", addressed_to: "Real Co - Alex branch" }), "Real Co - Alex branch")
  assert.equal(quoteAddressee({ customer_name: "Real Co", addressed_to: "  " }), "Real Co")
  assert.equal(quoteAddressee({ customer_name: "Real Co" }), "Real Co")
})

const pdfHtml = async (data: Row) => {
  const url = new URL(`http://test.local/api/quotations/generate?data=${encodeURIComponent(JSON.stringify(data))}&qn=Q-1`)
  const res = await quotationPdfRoute.GET(Object.assign(new Request(url), { nextUrl: url }) as any)
  assert.equal(res.status, 200)
  return res.text()
}

test("quote addressed to: saved on create / edit, shown on read, printed instead of the customer; the order keeps the customer", async () => {
  const db = flowDb()
  const created = await call(quotationRoute.POST as any, "POST", {
    customer_name: "Real Customer Co", customer_id: 5, addressed_to: "  Real Customer - Alex Branch ", items: [line("Pump")],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const qid = created.body.quotation.id
  assert.equal(db.tables.sales_quotations[0].addressed_to, "Real Customer - Alex Branch")
  assert.equal(db.tables.sales_quotations[0].customer_name, "Real Customer Co")
  const read1 = await getQuotation(qid)
  assert.equal(read1.body.quotation.addressed_to, "Real Customer - Alex Branch")

  // edited in the approval view
  const patch = (extra: Row) =>
    call(quotationRoute.PATCH as any, "PATCH", {
      quotation_id: qid, customer_id: 5, customer_name: "Real Customer Co", subtotal: 100, tax: 14, total: 114, net_total: 114,
      items: read1.body.quotation.items, ...extra,
    })
  assert.equal((await patch({ addressed_to: "Sub-brand X" })).status, 200)
  assert.equal(db.tables.sales_quotations[0].addressed_to, "Sub-brand X")
  assert.equal((await patch({})).status, 200)
  assert.equal(db.tables.sales_quotations[0].addressed_to, "Sub-brand X", "not sent: left alone")

  // the PDF prints the addressed-to name instead of the customer name; without it, the customer name
  const printed = await pdfHtml({ customer_name: "Real Customer Co", addressed_to: "Sub-brand X", items: [line("Pump")] })
  assert.match(printed, /Sub-brand X/)
  assert.doesNotMatch(printed, /Real Customer Co/)
  assert.match(await pdfHtml({ customer_name: "Real Customer Co", addressed_to: "", items: [line("Pump")] }), /Real Customer Co/)

  // converting: the sales order is the real customer's
  const approved = await call(approveRoute.POST as any, "POST", { quotation_id: qid })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  const so = db.tables.sales_orders.find((o) => o.so_id === approved.body.sales_order.so_id)!
  assert.equal(so.customer_id, 5)
  assert.ok(!("addressed_to" in so))

  assert.equal((await patch({ addressed_to: "" })).status, 409, "converted quotations are locked")
})

test("quote addressed to without the column: the quotation is saved without it, the customer name is printed", async () => {
  const db = flowDb()
  const from = db.from.bind(db)
  const wrote: Row[] = []
  ;(db as any).from = (table: string) => {
    const q: any = from(table)
    if (table !== "sales_quotations") return q
    const select = q.select.bind(q)
    const insert = q.insert.bind(q)
    const update = q.update.bind(q)
    q.select = (cols?: string, opts?: any) => {
      if (cols === "addressed_to") {
        const failed: any = { limit: () => failed, then: (ok: any, bad: any) => Promise.resolve({ data: null, error: { code: "42703", message: "no column" } }).then(ok, bad) }
        return failed
      }
      return select(cols, opts)
    }
    q.insert = (p: any) => (wrote.push(p), insert(p))
    q.update = (p: any) => (wrote.push(p), update(p))
    return q
  }
  const created = await call(quotationRoute.POST as any, "POST", { customer_name: "Real Customer Co", addressed_to: "Branch", items: [line("Pump")] })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const qid = created.body.quotation.id
  const saved = await call(quotationRoute.PATCH as any, "PATCH", {
    quotation_id: qid, customer_name: "Real Customer Co", subtotal: 100, tax: 14, total: 114, net_total: 114, items: [line("Pump")], addressed_to: "Branch 2",
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.ok(wrote.every((p) => !("addressed_to" in p)), "never written")
  assert.equal(quoteAddressee(db.tables.sales_quotations[0]), "Real Customer Co")
})

// ------------------------------------------------------------------------------------------------ wiring
test("reads are ordered; screens have drag, up / down buttons and the search box; SQL file is additive", () => {
  const quotationApi = read("app/api/sales-quotations/route.ts")
  assert.doesNotMatch(quotationApi, /items:sales_quotation_items\(\*\)/, "no unordered embedded items")
  assert.match(quotationApi, /\.order\("line_no", \{ ascending: true \}\)/)
  assert.match(read("app/api/sales-quotations/approve/route.ts"), /sortQuotationLines\(quotationItemRows\)/)
  assert.match(read("app/api/sales-orders/route.ts"), /sortSoLines\(order\.sales_order_items\)/)
  for (const f of ["app/api/delivery-permits/pdf/route.ts", "app/api/invoices/ar/[id]/pdf/route.ts", "app/api/invoices/ar/[id]/[invoiceId]/pdf/route.ts"])
    assert.match(read(f), /followLineOrder\(/, f)
  for (const f of [
    "components/modules/sales-quotation-module.tsx",
    "components/sales-quotation/approve-convert-quotation-dialog.tsx",
    "components/sales-order/edit-approved-order-dialog.tsx",
    "components/modules/sales-order-module.tsx",
  ]) {
    const src = read(f)
    assert.match(src, /<LineSearchBox /, f)
    assert.match(src, /<LineMoveControls /, f)
    assert.match(src, /\.visible\.map\(\(index\) =>/, f)
  }
  const controls = read("components/shared/line-order-controls.tsx")
  assert.match(controls, /draggable: true/)
  assert.match(controls, /aria-label=\{fill\(t\("lines\.move-up"\)/)
  assert.match(controls, /aria-label=\{fill\(t\("lines\.move-down"\)/)
  assert.doesNotMatch(read("package.json"), /dnd-kit|react-beautiful-dnd|sortablejs/)
  const sql = read("scripts/sql/2026-11-18-line-order.sql")
  assert.match(sql, /WRITTEN, NOT APPLIED/)
  assert.match(sql, /add column if not exists line_order int/)
  assert.match(sql, /alter table public.sales_quotations add column if not exists addressed_to text/)
  assert.match(sql, /drop trigger if exists/)
  assert.doesNotMatch(sql, /\bdrop (table|column)\b/i)
})
