// Independent-review fixes after Batches 4D-4G:
//  1 reject/backward moves of an APPROVED delivery permit -> 409 DP_ALREADY_APPROVED
//  2 stock hold ignores returns
//  3 supplier credit = item cost (no VAT / billing ratio) (po.total / item total)
//  4 write-off without credit (explicit flag)
//  5 PUT purchase-orders keeps item_type, .in() chunking, stale 'processing' stock claim
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as poRoute from "../../app/api/purchase-orders/route"
import { computeHeldByProduct, loadAvailability, loadHeldByProduct, IN_CHUNK_SIZE } from "../stock-hold"
import { removeReturnedItem } from "../returns"

const dpPut = (permitId: number, action: string, extra: Row = {}) => call(dpRoute.PUT, "PUT", { permitId: String(permitId), action, ...extra })
const permit = (permit_id: number, status: string): Row => ({ permit_id, permit_no: `DP-T-${permit_id}`, sales_order_id: 1, customer_id: 5, status })
const inv = (inventory_id: number, product_id: number, quantity: number, is_returned = false): Row => ({ inventory_id, product_id, warehouse_id: 1, quantity, is_returned, unit_cost: 50 })

function dpDb(permits: Row[], extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "ready_for_delivery", fulfillment_status: "PENDING", total: 0 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, item_type: "stock" }],
    delivery_permits: permits,
    delivery_permit_items: [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "Product 7", quantity: 6, warehouse_id: 1 }],
    inventory: [inv(1, 7, 20)],
    inventory_transactions: [], idempotency_log: [], workflow_events: [], ...extra,
  })
  useDb(db)
  return db
}
const status = (db: FakeDb, id = 1) => db.tables.delivery_permits.find((p) => p.permit_id === id)!.status

// ---------------------------------------------------------------------------------------------------------
// 1. APPROVED permit cannot move backwards
// ---------------------------------------------------------------------------------------------------------
test("1. REJECT on an APPROVED permit -> 409 DP_ALREADY_APPROVED; status, stock and events untouched", async () => {
  const db = dpDb([permit(1, "APPROVED")])
  const r = await dpPut(1, "REJECT", { rejectionReason: "oops" })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "DP_ALREADY_APPROVED")
  assert.equal(status(db), "APPROVED")
  assert.equal(db.tables.inventory[0].quantity, 20)
  assert.equal(db.tables.workflow_events.length, 0)
})

test("1. every other status-setting action is refused on an APPROVED permit; UPDATE_DETAILS and a repeat APPROVE are not", async () => {
  for (const action of ["ALLOCATE_WAREHOUSES", "MARK_READY_FOR_PICKUP", "MARK_PRINTED", "MARK_OUT_FOR_DELIVERY", "MARK_SUBMITTED_SIGNED"]) {
    const db = dpDb([permit(1, "APPROVED")])
    const r = await dpPut(1, action)
    assert.equal(r.status, 409, action)
    assert.equal(r.body.code, "DP_ALREADY_APPROVED", action)
    assert.equal(status(db), "APPROVED", action)
  }
  const db = dpDb([permit(1, "APPROVED")])
  assert.equal((await dpPut(1, "UPDATE_DETAILS", { recipientName: "Ali" })).status, 200)
  assert.equal(status(db), "APPROVED")
  assert.equal((await dpPut(1, "APPROVE")).status, 200)
  assert.equal(db.tables.inventory[0].quantity, 20, "a repeat APPROVE of an old APPROVED permit deducts nothing")
})

test("1. other transitions are untouched: SUBMITTED_SIGNED can still be REJECTED, READY_FOR_SHIPMENT can still be printed", async () => {
  const db = dpDb([permit(1, "SUBMITTED_SIGNED")])
  const r = await dpPut(1, "REJECT", { rejectionReason: "wrong qty" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(status(db), "REJECTED")
  const db2 = dpDb([permit(1, "READY_FOR_SHIPMENT")])
  assert.equal((await dpPut(1, "MARK_PRINTED")).status, 200)
  assert.equal(status(db2), "PRINTED")
})

// ---------------------------------------------------------------------------------------------------------
// 2. hold ignores returns
// ---------------------------------------------------------------------------------------------------------
test("2. hold ignores returns: 10 ordered, 4 delivered (APPROVED), 1 returned -> held 6 (was 7); the returned unit is not on-hand", async () => {
  const input = {
    orders: [{ so_id: 1, status: "accountant_approved" }],
    lines: [{ so_id: 1, item_type: "stock", product_id: 7, quantity: 10 }],
    permits: [{ permit_id: 1, sales_order_id: 1, status: "APPROVED" }],
    permitItems: [{ permit_id: 1, product_id: 7, quantity: 4 }],
    // a legacy caller still passing returns changes nothing
    returns: [{ return_id: 1, permit_id: 1, key: "p:7", quantity: 1, created_at: null }],
  } as any
  assert.equal(computeHeldByProduct(input).get(7), 6)

  const db = new FakeDb({
    sales_orders: [{ so_id: 1, status: "accountant_approved" }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 10, item_type: "stock" }],
    delivery_permits: [permit(1, "APPROVED")],
    delivery_permit_items: [{ item_id: 1, permit_id: 1, product_id: 7, quantity: 4 }],
    product_returns: [{ return_id: 1, permit_id: 1, status: "received" }],
    return_items: [{ return_item_id: 1, return_id: 1, product_id: 7, quantity: 1, condition: "good" }],
    inventory: [inv(1, 7, 16), inv(2, 7, 1, true)], // 20 - 4 delivered; the returned unit sits in an is_returned row
  })
  const a = (await loadAvailability(db, [7])).get(7)!
  assert.deepEqual(a, { onHand: 16, held: 6, available: 10 })
})

// ---------------------------------------------------------------------------------------------------------
// 3. credit = item cost (no VAT / billing ratio)
// ---------------------------------------------------------------------------------------------------------
function creditDb(po: Row, itemTotals: number[], extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [], sales_order_items: [],
    suppliers: [{ supplier_id: 3, supplier_name: "Mostafa Co" }],
    purchase_orders: [{ po_id: 10, po_number: "PO-T-10", supplier_id: 3, ...po }],
    purchase_order_items: itemTotals.map((total, i) => ({ po_item_id: 100 + i, po_id: 10, total })),
    goods_receipts: [{ receipt_id: 1, grn_number: "GRN-T-1", po_id: 10 }],
    goods_receipt_lines: [{ line_id: 1, receipt_id: 1, po_item_id: 100, product_id: 7, item_type: "stock", quantity_received: 5, unit_cost: 2000, source_so_item_id: null }],
    accounts_payable: [{ invoice_id: 5, invoice_number: "APINV-PO-T-10", po_id: 10 }],
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, is_returned: true, quantity: 2, unit_cost: 1, so_number: null }],
    inventory_batches: [], supplier_credits: [], ...extra,
  })
}
const credits = (db: FakeDb) => db.tables.supplier_credits

test("3. credit = qty x receipt cost, no VAT: 2 x 2000 = 4000 even when the PO total carries VAT (total 11400, items 10000)", async () => {
  const db = creditDb({ total: 11400, tax_amount: 1400 }, [10000])
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(credits(db)[0].amount, 4000)
  assert.match(credits(db)[0].notes, /received cost 2000 x 2 = 4000/)
})

test("3. finalized-tax PO (tax_amount overwritten with landed tax 777): credit is still the item cost, 4000", async () => {
  const db = creditDb({ total: 11400, tax_amount: 777, cost_finalized: true }, [10000])
  assert.equal((await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })).status, 200)
  assert.equal(credits(db)[0].amount, 4000)
})

test("3. PO whose total equals its items gets the same item-cost credit: 2 x 2000 = 4000", async () => {
  const db = creditDb({ total: 10000, tax_amount: 1400 }, [10000])
  assert.equal((await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })).status, 200)
  assert.equal(credits(db)[0].amount, 4000)
})

// ---------------------------------------------------------------------------------------------------------
// 4. write-off without credit
// ---------------------------------------------------------------------------------------------------------
const orphanDb = () =>
  new FakeDb({
    sales_orders: [], sales_order_items: [], suppliers: [], purchase_orders: [], purchase_order_items: [], goods_receipts: [], goods_receipt_lines: [],
    accounts_payable: [], inventory_batches: [], supplier_credits: [],
    inventory: [{ inventory_id: 5, product_id: 99, warehouse_id: 1, is_returned: true, quantity: 3, unit_cost: 0, so_number: null }],
  })

test("4. without the flag: unresolved supplier / zero cost still 409 and nothing is deleted", async () => {
  const db = orphanDb()
  assert.equal((await removeReturnedItem(db, { inventoryId: 5, productName: "Mystery" })).body.code, "CREDIT_SUPPLIER_UNRESOLVED")
  assert.equal((await removeReturnedItem(db, { inventoryId: 5, productName: "Mystery", supplierNameId: 3 })).body.code, "CREDIT_AMOUNT_ZERO")
  assert.equal(db.tables.inventory.length, 1)
})

test("4. writeOffWithoutCredit:true deletes the row once, creates NO credit, answers credit:null", async () => {
  const db = orphanDb()
  const res = await removeReturnedItem(db, { inventoryId: 5, productName: "Mystery", writeOffWithoutCredit: true })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.credit, null)
  assert.equal(db.tables.inventory.length, 0)
  assert.equal(db.tables.supplier_credits.length, 0)
  const again = await removeReturnedItem(db, { inventoryId: 5, productName: "Mystery", writeOffWithoutCredit: true })
  assert.equal(again.status, 404, "the row is gone: a repeat cannot write it off twice")
})

test("4. concurrent flagged requests write off exactly once", async () => {
  for (let run = 0; run < 10; run++) {
    const db = orphanDb()
    const results = await Promise.all(Array.from({ length: 4 }, () => removeReturnedItem(db, { inventoryId: 5, writeOffWithoutCredit: true })))
    assert.equal(results.filter((r) => r.status === 200).length, 1, `run ${run}`)
    assert.equal(db.tables.supplier_credits.length, 0)
  }
})

test("4. a resolvable item still gets its credit when the flag is absent (credit object in the answer)", async () => {
  const db = creditDb({ total: 10000 }, [10000])
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  assert.equal(res.status, 200)
  assert.equal(res.body.credit.amount, 4000)
})

// ---------------------------------------------------------------------------------------------------------
// 5a. PUT purchase-orders keeps item_type
// ---------------------------------------------------------------------------------------------------------
test("5a. PUT items without item_type: an outsourced line stays outsourced (by po_item id, by SO line, by name); a new line defaults to stock", async () => {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "draft", total: 100, payment_type: "cash" }],
    purchase_order_items: [
      { po_item_id: 1, po_id: 1, item_type: "outsourced", product_id: null, outsourced_name: "Gun", source_so_item_id: 28, quantity: 1 },
      { po_item_id: 2, po_id: 1, item_type: "outsourced", product_id: null, outsourced_name: "Lathe", source_so_item_id: null, quantity: 1 },
      { po_item_id: 3, po_id: 1, item_type: "outsourced", product_id: null, outsourced_name: "Jig", source_so_item_id: null, quantity: 1 },
    ],
    sales_order_items: [{ so_item_id: 28, so_id: 1, quantity: 5 }],
    accounts_payable: [],
  })
  useDb(db)
  const r = await call(poRoute.PUT, "PUT", {
    id: "1",
    items: [
      { id: 3, productName: "Jig", quantity: 1, unitPrice: 10, total: 10 }, // by po_item id
      { productName: "Gun", sourceSoItemId: "28", quantity: 2, unitPrice: 10, total: 20 }, // by SO line
      { productName: "Lathe", outsourcedName: "lathe ", quantity: 1, unitPrice: 10, total: 10 }, // by name
      { productId: 7, productName: "Pump", quantity: 1, unitPrice: 10, total: 10 }, // new line
    ],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const rows = db.tables.purchase_order_items.filter((i) => i.po_id === 1)
  assert.deepEqual(rows.map((i) => i.item_type), ["outsourced", "outsourced", "outsourced", "stock"])
  assert.equal(rows[0].product_id, null)
  assert.equal(rows[3].product_id, 7)
})

test("5a. an explicit item_type in the request still wins", async () => {
  const db = new FakeDb({
    purchase_orders: [{ po_id: 1, po_number: "PO-T-1", supplier_id: 1, status: "draft", total: 100, payment_type: "cash" }],
    purchase_order_items: [{ po_item_id: 1, po_id: 1, item_type: "outsourced", outsourced_name: "Gun", quantity: 1 }],
    accounts_payable: [],
  })
  useDb(db)
  await call(poRoute.PUT, "PUT", { id: "1", items: [{ id: 1, itemType: "stock", productId: 7, quantity: 1, unitPrice: 1, total: 1 }] })
  assert.equal(db.tables.purchase_order_items[0].item_type, "stock")
})

// ---------------------------------------------------------------------------------------------------------
// 5b. .in() chunking
// ---------------------------------------------------------------------------------------------------------
function spyIn(db: FakeDb) {
  const sizes: number[] = []
  const original = db.from.bind(db)
  ;(db as any).from = (table: string) => {
    const q: any = original(table)
    const originalIn = q.in.bind(q)
    q.in = (col: string, vs: any[]) => {
      sizes.push(vs.length)
      return originalIn(col, vs)
    }
    return q
  }
  return sizes
}

test("5b. 250 holding orders: every .in() list is <= 100 ids and the answer is unchanged", async () => {
  const n = 250
  const db = new FakeDb({
    sales_orders: Array.from({ length: n }, (_, i) => ({ so_id: i + 1, status: "accountant_approved" })),
    sales_order_items: Array.from({ length: n }, (_, i) => ({ so_item_id: i + 1, so_id: i + 1, product_id: 7, quantity: 2, item_type: "stock" })),
    delivery_permits: Array.from({ length: n }, (_, i) => ({ permit_id: i + 1, sales_order_id: i + 1, status: "APPROVED" })),
    delivery_permit_items: Array.from({ length: n }, (_, i) => ({ item_id: i + 1, permit_id: i + 1, product_id: 7, quantity: i % 2 })), // odd ids deliver 1
    inventory: [inv(1, 7, 1000)],
  })
  db.jitter = false
  const sizes = spyIn(db)
  const held = await loadHeldByProduct(db)
  assert.equal(held.get(7), 250 * 2 - 125) // 125 permits delivered 1 each
  assert.ok(sizes.length > 0 && Math.max(...sizes) <= IN_CHUNK_SIZE, `max in() size ${Math.max(...sizes)}`)
  assert.ok(sizes.filter((s) => s === 100).length >= 2, "ids were actually split")
  const a = await loadAvailability(db, Array.from({ length: 130 }, (_, i) => i + 1)) // 130 product ids
  assert.equal(a.get(7)!.onHand, 1000)
  assert.ok(Math.max(...sizes) <= IN_CHUNK_SIZE)
})

// ---------------------------------------------------------------------------------------------------------
// 5c. stale 'processing' stock claim
// ---------------------------------------------------------------------------------------------------------
const claimRow = (ageMs: number): Row => ({
  id: 1, operation_type: "dp_stock_deduct", idempotency_key: "dp_stock_deduct_1", entity_type: "delivery_permits", entity_id: 1,
  status: "processing", created_at: new Date(Date.now() - ageMs).toISOString(),
})

test("5c. a 'processing' claim older than 2 minutes is taken over: stock deducted once, claim completed", async () => {
  const db = dpDb([permit(1, "SUBMITTED_SIGNED")], { idempotency_log: [claimRow(3 * 60_000)] })
  const r = await dpPut(1, "APPROVE")
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(status(db), "APPROVED")
  assert.equal(db.tables.inventory[0].quantity, 14)
  const claim = db.tables.idempotency_log.find((l) => l.operation_type === "dp_stock_deduct")!
  assert.equal(claim.status, "completed")
  assert.equal(db.tables.idempotency_log.filter((l) => l.operation_type === "dp_stock_deduct").length, 1)
})

test("5c. a fresh 'processing' claim (30 s) still blocks: 409, nothing deducted, permit not approved", async () => {
  const db = dpDb([permit(1, "SUBMITTED_SIGNED")], { idempotency_log: [claimRow(30_000)] })
  const r = await dpPut(1, "APPROVE")
  assert.equal(r.status, 409)
  assert.equal(status(db), "SUBMITTED_SIGNED")
  assert.equal(db.tables.inventory[0].quantity, 20)
})

test("5c. concurrent takeover of one stale claim deducts exactly once", async () => {
  for (let run = 0; run < 10; run++) {
    const db = dpDb([permit(1, "SUBMITTED_SIGNED")], { idempotency_log: [claimRow(5 * 60_000)] })
    await Promise.all([dpPut(1, "APPROVE"), dpPut(1, "APPROVE"), dpPut(1, "APPROVE")])
    assert.equal(db.tables.inventory[0].quantity, 14, `run ${run}`)
  }
})
