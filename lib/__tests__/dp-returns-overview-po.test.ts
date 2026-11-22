// Four owner requests (2026-11-22):
//  P  delivery-permit prints show returned / not received lines as not delivered, and their totals leave them out;
//  O  order overview: what is on unsigned permits is not "ready, Create DP"; an "Out for delivery" column; a returned
//     unit needs a PO unless it was exchanged with the supplier;
//  B  a supplier bill with a payment is never deleted or replaced by reopen; return to supplier on a closed / billed
//     PO gives a supplier credit; re-closing after a reopen keeps the bill's date;
//  W  every permit goes through warehouse preparation before shipping, except lines straight from the supplier.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import { cannedDb, nreq } from "./hardening-fixtures"
import * as dpPdf from "../../app/api/delivery-permits/pdf/route"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as closeRoute from "../../app/api/purchase-orders/close/route"
import * as reopenRoute from "../../app/api/purchase-orders/reopen/route"
import * as returnRoute from "../../app/api/purchase-orders/return-to-supplier/route"
import { permitPrintLines } from "../dp-print-lines"
import { dpInvoiceEtaLines } from "../invoicing"
import { buildSoOverview } from "../so-overview"
import { billHasPayments, removePoBills, returnSplit } from "../po-bill"
import { allowedDpActions, isAllowedDpTransition, lineRoute, preparationRefusal } from "../dp-transitions"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

// ------------------------------------------------------------------------------------------------ P. prints
test("P1. a reprint of a permit with returns marks them not delivered (AR + EN), partly returned shows both, total excludes them", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any
  try {
    useDb(
      cannedDb({
        delivery_permits: [{ permit_id: 1, permit_no: "DP-3555", created_at: "2026-11-20T09:00:00Z", sales_order_id: 1, sales_orders: { so_number: "SO-2026-860593" }, customers: { customer_name: "BYD" } }],
        delivery_permit_items: [
          { item_id: 1, permit_id: 1, product_id: null, quantity: 3, item_name_snapshot: "Pump A", sku_snapshot: null },
          { item_id: 2, permit_id: 1, product_id: null, quantity: 4, item_name_snapshot: "Valve", sku_snapshot: null },
          { item_id: 3, permit_id: 1, product_id: null, quantity: 2, item_name_snapshot: "Belt", sku_snapshot: null },
        ],
        sales_order_items: [],
        product_returns: [{ return_id: 1, permit_id: "1", status: "pending_warehouse", created_at: "2026-11-20T12:00:00Z" }],
        return_items: [
          { return_id: 1, product_id: null, product_name: "Pump A", returned_quantity: 3 },
          { return_id: 1, product_id: null, product_name: "Valve", returned_quantity: 1 },
        ],
      }),
    )
    const res = await dpPdf.GET(nreq("http://test.local/api/delivery-permits/pdf?permitId=1"))
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.match(html, /لم يتم التسليم \/ Not delivered \(3\)/, "the fully returned line")
    assert.match(html, /<s>3<\/s>/)
    assert.match(html, /لم يتم التسليم \/ Not delivered: 1<\/span><div>تم التسليم \/ Delivered: 3/, "the partly returned line")
    assert.match(html, /<td class="pm-num">5<\/td><td colspan="3">إجمالي المُسلَّم \/ Total delivered · لم يتم التسليم \/ Not delivered: 4/)
  } finally {
    globalThis.fetch = realFetch
  }
  // the pure split, and every reprint path uses this one route
  assert.deepEqual(permitPrintLines([{ key: "n:A", quantity: 3 }, { key: "n:A", quantity: 2 }], new Map([["n:A", 4]])), {
    lines: [{ quantity: 3, delivered: 0, notDelivered: 3 }, { quantity: 2, delivered: 1, notDelivered: 1 }],
    deliveredTotal: 1,
    notDeliveredTotal: 4,
  })
  for (const f of ["components/delivery-permit/delivery-permit-card.tsx", "components/delivery-permit/permit-preview-dialog.tsx", "components/modules/shipping-module.tsx", "components/modules/warehouse-delivery-module.tsx", "components/modules/delivery-permits-module.tsx"])
    assert.match(src(f), /\/api\/delivery-permits\/pdf\?permitId=/, f)
})

test("P2. invoicing a permit bills only what was not returned", () => {
  const state: any = {
    permits: [{ permit_id: 1, items: [{ product_id: null, item_name_snapshot: "Pump A", quantity: 3, unit_price: 100, total: 300 }, { product_id: null, item_name_snapshot: "Valve", quantity: 4, unit_price: 50, total: 200 }] }],
    returns: [
      { return_id: 1, permit_id: 1, key: "n:Pump A", quantity: 3, created_at: "2026-11-20T12:00:00Z" },
      { return_id: 1, permit_id: 1, key: "n:Valve", quantity: 1, created_at: "2026-11-20T12:00:00Z" },
    ],
  }
  assert.deepEqual(dpInvoiceEtaLines(state, [1]).map((l) => [l.name, l.quantity]), [["Pump A", 0], ["Valve", 3]])
})

// ------------------------------------------------------------------------------------------------ O. overview
// SO-2026-860593: 4 + 4 ordered (outsourced, on PO 1), 4 + 4 received, permits 3555 / 3556 out for delivery.
function liveOrder(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-2026-860593", customer_id: 5, status: "approved", total: 8000, subtotal: 8000, discount_amount: 0 }],
    customers: [{ customer_id: 5, customer_name: "BYD" }],
    products: [],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: null, outsourced_name: "Charger", quantity: 4, unit_price: 1000, total: 4000, item_type: "outsourced" },
      { so_item_id: 2, so_id: 1, product_id: null, outsourced_name: "Cable", quantity: 4, unit_price: 1000, total: 4000, item_type: "outsourced" },
    ],
    delivery_permits: [
      { permit_id: 3555, permit_no: "3555", sales_order_id: 1, status: "OUT_FOR_DELIVERY", created_at: "2026-11-20T09:00:00" },
      { permit_id: 3556, permit_no: "3556", sales_order_id: 1, status: "OUT_FOR_DELIVERY", created_at: "2026-11-20T09:05:00" },
    ],
    delivery_permit_items: [
      { item_id: 1, permit_id: 3555, product_id: null, item_name_snapshot: "Charger", quantity: 4, unit_price: 1000, total: 4000 },
      { item_id: 2, permit_id: 3556, product_id: null, item_name_snapshot: "Cable", quantity: 4, unit_price: 1000, total: 4000 },
    ],
    product_returns: [],
    return_items: [],
    purchase_orders: [{ po_id: 1, po_number: "PO-1", supplier_id: 9, status: "received", total: 6000 }],
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, source_so_item_id: 1, quantity: 4, unit_price: 700 },
      { po_item_id: 2, po_id: 1, source_so_item_id: 2, quantity: 4, unit_price: 800 },
    ],
    goods_receipt_lines: [
      { line_id: 1, po_item_id: 1, quantity_received: 4 },
      { line_id: 2, po_item_id: 2, quantity_received: 4 },
    ],
    suppliers: [{ supplier_id: 9, supplier_name: "Safety House" }],
    accounts_payable: [], supplier_credits: [], accounts_receivable: [], invoice_delivery_permits: [], customer_payments: [], workflow_events: [],
    ...extra,
  })
}

test("O1. live SO-2026-860593: received and already on open permits -> no 'ready, Create DP'; Out for delivery column", async () => {
  const ov = (await buildSoOverview(liveOrder(), 1))!
  assert.deepEqual(ov.todo.filter((t) => t.kind === "ready"), [])
  assert.deepEqual(ov.lines.map((l) => [l.name, l.outForDelivery, l.onOpenDp, l.state]), [["Charger", 4, 4, "out_for_delivery"], ["Cable", 4, 4, "out_for_delivery"]])
  // only the remainder: 2 of the 4 chargers on a draft permit -> 2 ready
  const db = liveOrder()
  db.tables.delivery_permit_items[0].quantity = 2
  db.tables.delivery_permits[0].status = "DRAFT"
  const two = (await buildSoOverview(db, 1))!
  assert.deepEqual(two.todo.filter((t) => t.kind === "ready"), [{ kind: "ready", name: "Charger", quantity: 2 }])
  assert.deepEqual([two.lines[0].outForDelivery, two.lines[0].onOpenDp], [0, 2])
  const dialog = src("components/sales-order/order-overview-dialog.tsx")
  assert.ok(dialog.indexOf('t("ov.step-received")}</th>') < dialog.indexOf('t("ov.out-for-delivery")}</th>'), "column right after Received")
  assert.ok(dialog.indexOf('t("ov.out-for-delivery")}</th>') < dialog.indexOf('t("ov.step-delivered")}</th>'))
})

test("O2. a returned unit: not delivered, needs a PO (no 'ready'); exchanged with the same supplier -> waiting in Goods Receipt", async () => {
  // permit 3555 signed with 4 chargers, the driver brought 1 back
  const ret = { product_returns: [{ return_id: 1, permit_id: "3555", status: "pending_warehouse", created_at: "2026-11-20T12:00:00+00:00" }], return_items: [{ return_item_id: 1, return_id: 1, product_id: null, product_name: "Charger", returned_quantity: 1 }] }
  const db = liveOrder(ret)
  db.tables.delivery_permits[0].status = "SUBMITTED_SIGNED"
  const ov = (await buildSoOverview(db, 1))!
  const charger = ov.lines[0]
  assert.deepEqual([charger.delivered, charger.returned, charger.state], [3, 1, "no_po"])
  assert.deepEqual(ov.todo.filter((t: any) => t.name === "Charger"), [{ kind: "no_po", name: "Charger", quantity: 1 }])
  // the same, still out for delivery (returned before signing)
  const out = liveOrder(ret)
  const o = (await buildSoOverview(out, 1))!
  assert.deepEqual([o.lines[0].outForDelivery, o.lines[0].state], [3, "no_po"])
  assert.deepEqual(o.todo.filter((t: any) => t.name === "Charger").map((t) => t.kind), ["no_po"])
  // exchanged on PO 1 (lib/po-exchange.ts): the old line goes down to 3, the new one waits to be received
  const ex = liveOrder(ret)
  ex.tables.delivery_permits[0].status = "SUBMITTED_SIGNED"
  ex.tables.purchase_order_items[0].quantity = 3
  ex.tables.purchase_order_items.push({ po_item_id: 3, po_id: 1, source_so_item_id: 1, quantity: 1, unit_price: 700 })
  const e = (await buildSoOverview(ex, 1))!
  assert.equal(e.lines[0].state, "waiting_supplier")
  assert.deepEqual(e.todo.filter((t: any) => t.name === "Charger").map((t) => [t.kind, (t as any).quantity]), [["waiting_supplier", 1]])
  // returned to the supplier instead (the PO line went down to 3): a new PO is needed
  const rs = liveOrder(ret)
  rs.tables.delivery_permits[0].status = "SUBMITTED_SIGNED"
  rs.tables.purchase_order_items[0].quantity = 3
  assert.deepEqual((await buildSoOverview(rs, 1))!.todo.filter((t: any) => t.name === "Charger"), [{ kind: "no_po", name: "Charger", quantity: 1 }])
})

// ------------------------------------------------------------------------------------------------ B. supplier bills
// PO-2026-154158 (Safety House): closed, bill APINV-PO-2026-154158 46,426.50 marked paid.
const SH = "PO-2026-154158"
function safetyHouse(bill: Row = {}) {
  const db = new FakeDb({
    suppliers: [{ supplier_id: 1, supplier_name: "Safety House" }],
    products: [],
    purchase_orders: [{ po_id: 1, po_number: SH, supplier_id: 1, status: "received", total: 46426.5, tax_amount: 5701.5, payment_type: "cash", order_date: "2026-11-01" }],
    purchase_order_items: [
      { po_item_id: 7, po_id: 1, product_id: null, outsourced_name: "Helmet", item_name_snapshot: "Helmet", quantity: 10, unit_price: 3250, total: 32500, item_type: "outsourced" },
      { po_item_id: 8, po_id: 1, product_id: null, outsourced_name: "Gloves", item_name_snapshot: "Gloves", quantity: 25, unit_price: 329, total: 8225, item_type: "outsourced" },
    ],
    accounts_payable: [{ invoice_id: 50, invoice_number: `APINV-${SH}`, po_id: 1, supplier_id: 1, amount: 46426.5, paid_amount: 46426.5, status: "paid", months_paid: 0, invoice_date: "2026-11-05", due_date: "2026-11-05", ...bill }],
    ap_invoice_lines: [], supplier_payments: [], payment_schedules: [], supplier_credits: [],
    goods_receipts: [], goods_receipt_lines: [
      { line_id: 1, receipt_id: 1, po_item_id: 7, quantity_received: 10 },
      { line_id: 2, receipt_id: 1, po_item_id: 8, quantity_received: 25 },
    ],
    sales_order_items: [], balance_entries: [], workflow_events: [], users: [], inventory: [], inventory_transactions: [],
  })
  useDb(db)
  return db
}

test("B1. live case: a bill marked paid (no payment rows) is never deleted by reopen; it stays exactly as it was", async () => {
  const db = safetyHouse()
  const before = JSON.stringify(db.tables.accounts_payable)
  const r = await call(reopenRoute.POST as any, "POST", { id: "1" })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "PO_PAID")
  assert.equal(JSON.stringify(db.tables.accounts_payable), before, "same id, number, date, amount and paid amount")
  // every way money can be on a bill counts; what the bill took off itself (credits / advances) does not
  const bill = (x: Row) => ({ invoice_id: 50, invoice_number: "APINV-X", paid_amount: 0, status: "pending", months_paid: 0, ...x })
  assert.equal(await billHasPayments(db, [bill({ paid_amount: 10 })]), true)
  assert.equal(await billHasPayments(db, [bill({ status: "partially_paid" })]), true)
  assert.equal(await billHasPayments(db, [bill({ status: "pending" })]), false)
  db.tables.supplier_payments.push({ payment_id: 1, invoice_id: 50, amount: 100, reference_number: "APINV-X-CREDIT", payment_method: "supplier_credit" })
  assert.equal(await billHasPayments(db, [bill({ paid_amount: 100, status: "partially_paid" })]), false, "only its own credit")
  assert.equal(await billHasPayments(db, [bill({ paid_amount: 150, status: "partially_paid" })]), true, "50 paid on top")
  // removePoBills refuses a paid bill whoever calls it
  await assert.rejects(() => removePoBills(db, [db.tables.accounts_payable[0]]), /payment/)
  assert.equal(db.tables.accounts_payable.length, 1)
})

test("B2. return to supplier on the CLOSED paid PO: a supplier credit, the bill and PO lines unchanged; no second bill", async () => {
  const db = safetyHouse()
  const bills = JSON.stringify(db.tables.accounts_payable)
  const lines = JSON.stringify(db.tables.purchase_order_items)
  const r = await call(returnRoute.POST as any, "POST", { id: "1", items: [{ fromItemId: "7", quantity: 2, warehouseId: null, reason: "damaged" }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.creditTotal, 6500)
  assert.equal(JSON.stringify(db.tables.accounts_payable), bills)
  assert.equal(JSON.stringify(db.tables.purchase_order_items), lines)
  assert.deepEqual(db.tables.supplier_credits.map((c) => [c.supplier_id, c.amount, c.credit_type, c.invoice_id, c.status]), [[1, 6500, "return", 50, "active"]])
  assert.equal((await call(closeRoute.POST as any, "POST", { id: "1" })).body.code, "PO_ALREADY_CLOSED", "re-closing makes no other bill")
  assert.equal(db.tables.accounts_payable.length, 1)
  // the split: an open PO lowers only the unbilled part
  assert.deepEqual([...returnSplit([{ id: 7, taken: 3, quantity: 10, billed: 8 }], false)], [[7, { lower: 2, credit: 1 }]])
  assert.deepEqual([...returnSplit([{ id: 7, taken: 3, quantity: 10, billed: 8 }], true)], [[7, { lower: 0, credit: 3 }]])
  assert.match(src("components/purchase-order/po-open-actions.tsx"), /const canReturn = canEdit \|\| \(may && closed/)
})

test("B3. an UNPAID closing bill removed by reopen comes back on re-close with the same number, invoice date and due date", async () => {
  const db = safetyHouse({ paid_amount: 0, status: "pending", invoice_date: "2026-11-05", due_date: "2026-12-05" })
  const r = await call(reopenRoute.POST as any, "POST", { id: "1" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.accounts_payable.length, 0)
  const ev = db.tables.workflow_events.find((e) => e.event_type === "PO_REOPENED")!
  assert.deepEqual(JSON.parse(ev.new_value).removedBill, { invoiceNumber: `APINV-${SH}`, invoiceDate: "2026-11-05", dueDate: "2026-12-05", supplierInvoiceNumber: null })
  const c = await call(closeRoute.POST as any, "POST", { id: "1" })
  assert.equal(c.status, 200, JSON.stringify(c.body))
  assert.deepEqual(db.tables.accounts_payable.map((b) => [b.invoice_number, b.invoice_date, b.due_date, b.paid_amount]), [[`APINV-${SH}`, "2026-11-05", "2026-12-05", 0]])
})

// ------------------------------------------------------------------------------------------------ W. preparation
const dpPut = (action: string, extra: Row = {}) => call(dpRoute.PUT, "PUT", { permitId: "1", action, ...extra })
function permitDb(status: string, line: Row, extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-BYD-1", customer_id: 5, status: "ready_for_delivery", fulfillment_status: "PENDING", total: 0 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: line.product_id ?? null, outsourced_name: line.product_id ? null : line.item_name_snapshot, quantity: 4, item_type: line.product_id ? "stock" : "outsourced" }],
    delivery_permits: [{ permit_id: 1, permit_no: "3554", sales_order_id: 1, customer_id: 5, status }],
    delivery_permit_items: [{ item_id: 1, permit_id: 1, quantity: 4, warehouse_id: null, ...line }],
    inventory: [], goods_receipt_lines: [], inventory_transactions: [], idempotency_log: [], workflow_events: [],
    ...extra,
  })
  useDb(db)
  return db
}
const st = (db: FakeDb) => db.tables.delivery_permits[0].status

test("W1. a permit with warehouse lines: printed -> cannot ship or be ready until the warehouse allocated it", async () => {
  const db = permitDb("DRAFT", { product_id: 7, item_name_snapshot: "Drill" }, { inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 10, is_returned: false }] })
  assert.equal((await dpPut("MARK_PRINTED")).status, 200, "printing a draft is still allowed")
  const ship = await dpPut("MARK_OUT_FOR_DELIVERY")
  assert.equal(ship.status, 409)
  assert.equal(ship.body.code, "DP_NOT_PREPARED")
  assert.match(ship.body.errorAr, /المخزن/)
  assert.equal((await dpPut("MARK_READY_FOR_PICKUP")).body.code, "DP_NOT_PREPARED")
  assert.equal(st(db), "PRINTED")
  assert.equal((await dpPut("ALLOCATE_WAREHOUSES")).status, 200, "allocation works from PRINTED")
  assert.equal((await dpPut("MARK_OUT_FOR_DELIVERY")).body.code, "DP_INVALID_TRANSITION")
  assert.equal((await dpPut("MARK_READY_FOR_PICKUP")).status, 200)
  assert.equal((await dpPut("MARK_OUT_FOR_DELIVERY", { driverName: "D" })).status, 200)
  assert.equal(st(db), "OUT_FOR_DELIVERY")
})

test("W2. outsourced straight from the supplier skips the warehouse; one stored in our warehouse does not", async () => {
  const direct = permitDb("DRAFT", { product_id: null, item_name_snapshot: "BYD Charger" })
  assert.equal((await dpPut("MARK_OUT_FOR_DELIVERY", { driverName: "D" })).status, 200, "direct from supplier")
  assert.equal(st(direct), "OUT_FOR_DELIVERY")
  permitDb("PRINTED", { product_id: null, item_name_snapshot: "BYD Charger" }, { inventory: [{ inventory_id: 9, is_outsourced: true, is_returned: false, so_number: "SO-BYD-1", outsourced_name: "byd  charger", quantity: 4 }] })
  assert.equal((await dpPut("MARK_OUT_FOR_DELIVERY")).body.code, "DP_NOT_PREPARED", "held in our inventory for the order")
  permitDb("PRINTED", { product_id: null, item_name_snapshot: "BYD Charger" }, { goods_receipt_lines: [{ line_id: 1, source_so_item_id: 1, outsourced_name: "BYD Charger", warehouse_id: 2, quantity_received: 4 }] })
  assert.equal((await dpPut("MARK_OUT_FOR_DELIVERY")).body.code, "DP_NOT_PREPARED", "received into a warehouse")
  // pure rules and the screens
  assert.equal(lineRoute({ product_id: 7 }, new Set()), "warehouse")
  assert.equal(lineRoute({ product_id: null, item_name_snapshot: "X" }, new Set()), "direct")
  assert.equal(preparationRefusal({ status: "PRINTED", allocated_at: "2026-11-20" }, "MARK_READY_FOR_PICKUP", true), null, "printed after allocation")
  assert.deepEqual(allowedDpActions({ status: "PRINTED" }, true), ["ALLOCATE_WAREHOUSES", "REJECT"])
  assert.ok(allowedDpActions({ status: "PRINTED" }, false).includes("MARK_OUT_FOR_DELIVERY"))
  assert.equal(isAllowedDpTransition("PRINTED", "ALLOCATE_WAREHOUSES"), true)
  assert.match(src("components/modules/warehouse-delivery-module.tsx"), /const draftPermits = permits\.filter\(\(p\) => p\.status === "DRAFT" \|\| printedUnprepared\(p\)\)/)
  assert.match(src("components/delivery-permit/delivery-permit-card.tsx"), /t\("permit\.direct-from-supplier"\)/)
  assert.match(src("components/modules/shipping-module.tsx"), /p\.nextActions\.includes\("MARK_OUT_FOR_DELIVERY"\)/)
})

test("W3. live BYD permits already out without allocation: signing still takes the outsourced stock stored for the order", async () => {
  const db = permitDb("OUT_FOR_DELIVERY", { product_id: null, item_name_snapshot: "BYD Charger" }, {
    inventory: [{ inventory_id: 9, is_outsourced: true, is_returned: false, so_number: "SO-BYD-1", outsourced_name: "BYD Charger", warehouse_id: 2, quantity: 4 }],
  })
  const r = await dpPut("MARK_SUBMITTED_SIGNED")
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.inventory[0].quantity, 0)
  assert.equal((await dpPut("APPROVE")).status, 200)
  assert.equal(db.tables.inventory[0].quantity, 0, "never taken twice")
})

test("W4. GET tells the screens where each line comes from and what may happen next", async () => {
  permitDb("PRINTED", { product_id: null, item_name_snapshot: "BYD Charger" })
  const r = await call(dpRoute.GET as any, "GET", undefined, "http://test.local/api/delivery-permits")
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const p = r.body[0]
  assert.deepEqual([p.needsPreparation, p.directFromSupplier, p.items[0].deliveryRoute], [false, true, "direct"])
  assert.ok(p.nextActions.includes("MARK_OUT_FOR_DELIVERY"))
})
