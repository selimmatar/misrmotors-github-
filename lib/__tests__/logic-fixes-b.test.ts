// Logic fixes B (REAL route handlers on the in-memory FakeDb):
//   A. PO POST/PUT: server decides the initial status and the total; item-insert failure rolls the header back;
//      PUT writes only whitelisted columns.
//   B. finalize-cost pushes the landed cost into this PO's inventory batches and inventory.unit_cost; receipts after
//      a finalize use the landed cost.
//   C. quotation -> SO conversion checks stock availability like SO POST.
//   D. payment-schedule PUT: no AR overpayment, compare-and-set on collected_amount, idempotent "pay in full" path.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as poRoute from "../../app/api/purchase-orders/route"
import * as finalizeRoute from "../../app/api/purchase-orders/finalize-cost/route"
import * as grnRoute from "../../app/api/goods-receipts/route"
import * as approveRoute from "../../app/api/sales-quotations/approve/route"
import * as scheduleRoute from "../../app/api/payment-schedules/route"

// =============================================================================================== A. purchase orders
function poDb(seed: Record<string, Row[]> = {}) {
  const db = new FakeDb({ sales_order_items: [], purchase_orders: [], purchase_order_items: [], accounts_payable: [], ...seed })
  let n = 0
  db.rpcHandlers.generate_po_number = () => `PO-GEN-${++n}`
  useDb(db)
  return db
}
const poItem = (quantity: number, unitPrice: number, extra: Row = {}): Row => ({
  productId: 5, productName: "Part", quantity, unitPrice, total: 1, itemType: "stock", ...extra,
})
const postPo = (body: Row) => call(poRoute.POST, "POST", { supplier_id: 1, payment_terms: "cash", payment_type: "cash", ...body })
const putPo = (body: Row) => call(poRoute.PUT, "PUT", body)

test("A1. POST: a PO sent as 'approved' is created 'pending' with no approval/finalize fields", async () => {
  const db = poDb()
  const r = await postPo({
    status: "approved", approved_by: 9, approved_at: "2026-01-01T00:00:00Z", cost_finalized: true,
    rejection_reason: "x", items: [poItem(1, 10)],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.tables.purchase_orders[0]
  assert.equal(row.status, "pending")
  assert.equal(r.body.status, "pending")
  assert.equal(row.approved_by ?? null, null)
  assert.equal(row.approved_at ?? null, null)
  assert.equal(row.cost_finalized ?? null, null)
  assert.equal(row.rejection_reason ?? null, null)
  assert.equal(db.tables.accounts_payable.length, 0)
})

test("A2. POST: the UI's 'pending' (and 'Pending' / missing / 'draft') still work", async () => {
  for (const [sent, stored] of [["pending", "pending"], ["Pending", "pending"], [undefined, "pending"], ["draft", "draft"], ["received", "pending"]]) {
    const db = poDb()
    const r = await postPo({ status: sent, items: [poItem(1, 10)] })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(db.tables.purchase_orders[0].status, stored, String(sent))
  }
})

test("A3. POST: total and line totals are recomputed from the items (qty x unit price + 14% VAT when VAT is on)", async () => {
  const db = poDb()
  const r = await postPo({ total: 1, tax_amount: 9999, items: [poItem(2, 100), poItem(1, 50)] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.tables.purchase_orders[0]
  assert.deepEqual(db.tables.purchase_order_items.map((i) => i.total), [200, 50])
  assert.equal(Number(row.tax_amount), 35)
  assert.equal(Number(row.total), 285)
  assert.equal(Number(r.body.total), 285)
  // VAT off in the UI -> tax_amount 0 / null
  const db2 = poDb()
  await postPo({ total: 999, tax_amount: 0, items: [poItem(3, 33.33)] })
  assert.equal(Number(db2.tables.purchase_orders[0].total), 99.99)
  assert.equal(Number(db2.tables.purchase_orders[0].tax_amount || 0), 0)
})

test("A4. POST: an item-insert failure deletes the new header and answers 500", async () => {
  const db = poDb()
  db.failOn["purchase_order_items:insert"] = "items down"
  const r = await postPo({ items: [poItem(1, 10)] })
  assert.equal(r.status, 500)
  assert.equal(db.tables.purchase_orders.length, 0)
})

const storedPo = (extra: Row = {}): Row => ({
  po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "pending", total: 228, tax_amount: 28, payment_type: "cash",
  approved_at: null, rejection_reason: null, cost_finalized: false, ...extra,
})
const storedLines = (): Row[] => [{ po_item_id: 1, po_id: 1, product_id: 5, quantity: 2, unit_price: 100, total: 200, item_type: "stock" }]

test("A5. PUT approve: a stale client total is ignored; the AP invoice uses the stored total", async () => {
  const db = poDb({ purchase_orders: [storedPo()], purchase_order_items: storedLines() })
  const r = await putPo({ id: "1", status: "approved", total: 99999, payment_type: "cash", notes: "" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(Number(db.tables.purchase_orders[0].total), 228)
  assert.equal(Number(db.tables.accounts_payable[0].amount), 228)
})

test("A6. PUT items: the total is recomputed from the new items (VAT, which the stored PO has, re-applied at 14%)", async () => {
  const db = poDb({ purchase_orders: [storedPo()], purchase_order_items: storedLines() })
  const r = await putPo({ id: 1, total: 5, items: [{ id: 1, productId: 5, quantity: 3, unitPrice: 100, total: 1 }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.purchase_order_items[0].total, 300)
  assert.equal(Number(db.tables.purchase_orders[0].tax_amount), 42)
  assert.equal(Number(db.tables.purchase_orders[0].total), 342)
  // a PO without VAT stays without VAT
  const db2 = poDb({ purchase_orders: [storedPo({ tax_amount: null, total: 200 })], purchase_order_items: storedLines() })
  assert.equal((await putPo({ id: 1, items: [{ id: 1, productId: 5, quantity: 3, unitPrice: 100 }] })).status, 200)
  assert.equal(Number(db2.tables.purchase_orders[0].total), 300)
  assert.equal(db2.tables.purchase_orders[0].tax_amount, null)
})

test("A7. PUT: columns outside the whitelist are not written", async () => {
  const db = poDb({ purchase_orders: [storedPo()], purchase_order_items: storedLines() })
  const r = await putPo({
    id: 1, status: "rejected", rejectionReason: "too dear",
    cost_finalized: true, costFinalized: true, po_number: "HACK", supplier_id: 99, approved_at: "2000-01-01", approvedAt: "2000-01-01",
    tax_amount: 1, taxAmount: 1, other_costs: 5, po_id: 77, bogus_column: 1,
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.tables.purchase_orders[0]
  assert.equal(row.status, "rejected")
  assert.equal(row.rejection_reason, "too dear")
  assert.equal(row.cost_finalized, false)
  assert.equal(row.po_number, "PO-T-1")
  assert.equal(row.supplier_id, 1)
  assert.equal(row.approved_at, null)
  assert.equal(row.tax_amount, 28)
  assert.equal(row.po_id, 1)
  assert.equal("bogus_column" in row, false)
  assert.equal("other_costs" in row, false)
})

// =============================================================================================== B. landed cost
function costDb(opts: { orderedQty?: number; inventory?: Row[]; batches?: Row[] } = {}) {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "approved", total: 1140, cost_finalized: false }],
    purchase_order_items: [{ po_item_id: 1, po_id: 1, product_id: 7, quantity: opts.orderedQty ?? 10, unit_price: 100, total: 100 * (opts.orderedQty ?? 10), item_type: "stock" }],
    goods_receipts: [], goods_receipt_lines: [],
    inventory: opts.inventory ?? [],
    inventory_batches: opts.batches ?? [],
    sales_orders: [], sales_order_items: [], idempotency_log: [],
  })
  useDb(db)
  return db
}
let grnKey = 0
const receive = (qty: number) =>
  call(grnRoute.POST, "POST", {
    poId: 1, receivedBy: 1, idempotencyKey: `lfb-key-${++grnKey}-${Math.random().toString(36).slice(2, 8)}`,
    lines: [{ poItemId: 1, quantityReceived: qty, warehouseId: 1, unitCost: 100 }],
  })
const finalizeCost = (body: Row) => call(finalizeRoute.POST, "POST", { poId: 1, taxAmount: 0, otherCosts: 0, ...body })
const inv7 = (db: FakeDb) => db.tables.inventory.find((r) => r.product_id === 7 && r.warehouse_id === 1 && r.is_returned === false)!

test("B1. finalize writes the landed cost to THIS PO's batches and to inventory.unit_cost; other rows untouched", async () => {
  const otherBatch = { batch_id: 50, product_id: 7, po_id: 99, quantity_received: 10, quantity_available: 10, unit_cost: 80, landed_cost_per_unit: 80, warehouse_id: 1, batch_sequence: 1 }
  const otherProduct = { inventory_id: 60, product_id: 8, warehouse_id: 1, quantity: 5, unit_cost: 40, is_returned: false }
  const db = costDb({
    inventory: [{ inventory_id: 61, product_id: 7, warehouse_id: 1, quantity: 10, unit_cost: 80, is_returned: false }, otherProduct],
    batches: [otherBatch],
  })
  assert.equal((await receive(10)).status, 200)
  assert.equal(inv7(db).unit_cost, 90) // (10*80 + 10*100) / 20
  const r = await finalizeCost({ taxAmount: 100, otherCosts: 40 }) // overhead 140 over 10 units = 14 / unit
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const mine = db.tables.inventory_batches.filter((b) => b.po_id === 1)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].unit_cost, 100) // raw receipt cost kept
  assert.equal(mine[0].landed_cost_per_unit, 114)
  assert.deepEqual(db.tables.inventory_batches.find((b) => b.batch_id === 50), otherBatch)
  assert.equal(inv7(db).unit_cost, 97) // (20*90 + 10*14) / 20
  assert.equal(inv7(db).quantity, 20)
  assert.deepEqual(db.tables.inventory.find((r) => r.inventory_id === 60), otherProduct)
})

test("B2. a receipt AFTER finalize (partially received PO) uses the finalized landed cost", async () => {
  const db = costDb({ orderedQty: 10 })
  assert.equal((await receive(4)).status, 200)
  assert.equal((await finalizeCost({ taxAmount: 140 })).status, 200) // 14 / ordered unit
  assert.equal(inv7(db).unit_cost, 114)
  assert.equal((await receive(6)).status, 200)
  const batches = db.tables.inventory_batches.filter((b) => b.po_id === 1)
  assert.deepEqual(batches.map((b) => b.landed_cost_per_unit), [114, 114])
  assert.deepEqual(batches.map((b) => b.unit_cost), [100, 100])
  assert.equal(inv7(db).quantity, 10)
  assert.equal(inv7(db).unit_cost, 114)
})

test("B3. a finalize that fails after the batches were updated puts batches and inventory back", async () => {
  const db = costDb()
  assert.equal((await receive(10)).status, 200)
  const before = JSON.stringify({ b: db.tables.inventory_batches, i: db.tables.inventory })
  db.failOn["purchase_orders:update"] = "header down"
  db.failAfter["purchase_orders:update"] = 1 // the claim succeeds, the header write fails
  const r = await finalizeCost({ taxAmount: 140 })
  assert.equal(r.status, 500)
  assert.equal(JSON.stringify({ b: db.tables.inventory_batches, i: db.tables.inventory }), before)
  assert.equal(db.tables.purchase_orders[0].cost_finalized, false)
})

// =============================================================================================== C. quotation -> SO
function quoteDb(onHand: number, seed: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    sales_quotations: [{
      id: 1, status: "pending", customer_id: 5, subtotal: 500, total: 570, payment_type: "cash", payment_details: {},
      items: [
        { id: 1, line_no: 1, product_id: 7, product_name: "Pump", quantity: 5, unit_price: 100, item_type: "stock" },
        { id: 2, line_no: 2, product_id: null, product_name: "Service", quantity: 1, unit_price: 50, item_type: "outsourced" },
      ],
    }],
    sales_orders: [], sales_order_items: [], delivery_permits: [], delivery_permit_items: [], suppliers: [],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: onHand, unit_cost: 50, is_returned: false }],
    ...seed,
  })
  db.rpcHandlers.generate_so_number = () => "SO-NEW-1"
  useDb(db)
  return db
}
const convert = () => call(approveRoute.POST as any, "POST", { quotation_id: 1 })

test("C1. converting a quotation with too little stock is refused with SO POST's 400 shape; nothing created", async () => {
  const db = quoteDb(3)
  const r = await convert()
  assert.equal(r.status, 400, JSON.stringify(r.body))
  assert.match(r.body.error, /^Insufficient inventory for Pump\. Requested: 5, Available: 3$/)
  assert.equal(db.tables.sales_orders.length, 0)
  assert.equal(db.tables.sales_order_items.length, 0)
})

test("C2. stock held by an approved sales order is not available to the conversion", async () => {
  const db = quoteDb(10, {
    sales_orders: [{ so_id: 40, so_number: "SO-OLD", status: "accountant_approved" }],
    sales_order_items: [{ so_item_id: 1, so_id: 40, product_id: 7, quantity: 8, item_type: "stock" }],
  })
  const r = await convert()
  assert.equal(r.status, 400, JSON.stringify(r.body))
  assert.match(r.body.error, /Available: 2/)
  assert.equal(db.tables.sales_orders.length, 1)
})

test("C3. enough stock: the conversion still works", async () => {
  const db = quoteDb(5)
  const r = await convert()
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.sales_orders.length, 1)
  assert.equal(db.tables.sales_order_items.length, 2)
})

// =============================================================================================== D. payment schedules
function schedDb(invoice: Row = {}, schedules?: Row[]) {
  const db = new FakeDb({
    payment_schedules: schedules ?? [{ schedule_id: 1, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" }],
    accounts_receivable: [{ invoice_id: 5, amount: 300, collected_amount: 0, months_paid: 0, status: "pending", ...invoice }],
    idempotency_log: [],
  })
  useDb(db)
  return db
}
const putSched = (body: Row) => call(scheduleRoute.PUT, "PUT", body)
const ar = (db: FakeDb) => db.tables.accounts_receivable[0]

test("D1. a partial payment that would overpay the invoice is refused with 400; nothing written", async () => {
  const db = schedDb({ collected_amount: 250 })
  const r = await putSched({ scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" })
  assert.equal(r.status, 400, JSON.stringify(r.body))
  assert.match(r.body.error, /overpa|exceed/i)
  assert.equal(ar(db).collected_amount, 250)
  assert.equal(db.tables.payment_schedules[0].paid_amount, 0)
  assert.equal(db.tables.payment_schedules[0].status, "pending")
})

test("D2. the full-payment path (no paidAmount) refuses an overpayment too", async () => {
  const db = schedDb({ collected_amount: 250 })
  const r = await putSched({ scheduleId: "1" })
  assert.equal(r.status, 400, JSON.stringify(r.body))
  assert.match(r.body.error, /overpa|exceed/i)
  assert.equal(ar(db).collected_amount, 250)
  assert.equal(db.tables.payment_schedules[0].paid_amount, 0)
})

test("D3. the full-payment path is idempotent: a repeat is a duplicate and is not counted twice", async () => {
  const db = schedDb()
  const first = await putSched({ scheduleId: "1" })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const again = await putSched({ scheduleId: "1" })
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.equal(again.body.isDuplicate, true)
  assert.equal(ar(db).collected_amount, 100)
  assert.equal(db.tables.payment_schedules[0].paid_amount, 100)
  assert.ok(db.tables.idempotency_log.some((l) => l.operation_type === "payment" && l.status === "completed"))
})

test("D4. the partial path's key is deterministic (no clock): the same request without a date is a duplicate", async () => {
  const db = schedDb({}, [{ schedule_id: 1, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" }])
  const a = await putSched({ scheduleId: "1", paidAmount: 40, invoiceId: 5 })
  assert.equal(a.status, 200, JSON.stringify(a.body))
  await new Promise((r) => setTimeout(r, 5))
  const b = await putSched({ scheduleId: "1", paidAmount: 40, invoiceId: 5 })
  assert.equal(b.status, 200, JSON.stringify(b.body))
  assert.equal(b.body.isDuplicate, true)
  assert.equal(ar(db).collected_amount, 40)
})

test("D5. concurrent payments of two schedules on one invoice: no lost update (compare-and-set)", async () => {
  for (let round = 0; round < 15; round++) {
    const db = schedDb({}, [
      { schedule_id: 1, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" },
      { schedule_id: 2, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" },
    ])
    const rs = await Promise.all([putSched({ scheduleId: "1" }), putSched({ scheduleId: "2" })])
    for (const r of rs) assert.ok([200, 409].includes(r.status), JSON.stringify(r.body))
    const paid = db.tables.payment_schedules.reduce((s, x) => s + (Number(x.paid_amount) || 0), 0)
    assert.equal(ar(db).collected_amount, paid, `round ${round}: invoice matches the schedules`)
    assert.equal(rs.filter((r) => r.status === 200).length * 100, paid, `round ${round}`)
  }
})

test("D6. concurrent payments that together would overpay: the invoice never exceeds its total", async () => {
  for (let round = 0; round < 15; round++) {
    const db = schedDb({ collected_amount: 150 }, [
      { schedule_id: 1, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" },
      { schedule_id: 2, invoice_id: 5, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" },
    ])
    const rs = await Promise.all([
      putSched({ scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" }),
      putSched({ scheduleId: "2", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" }),
    ])
    assert.equal(rs.filter((r) => r.status === 200).length, 1, `round ${round}: ${JSON.stringify(rs)}`)
    for (const r of rs) if (r.status !== 200) assert.ok([400, 409].includes(r.status), JSON.stringify(r.body))
    assert.equal(ar(db).collected_amount, 250, `round ${round}`)
    const paid = db.tables.payment_schedules.reduce((s, x) => s + (Number(x.paid_amount) || 0), 0)
    assert.equal(paid, 100, `round ${round}: the refused schedule was put back`)
  }
})
