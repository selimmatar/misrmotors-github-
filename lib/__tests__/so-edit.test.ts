// Tests for editing a sales order after a return (Batch 2): the order stays editable, the returned item and its
// history stay linked, a replacement item is added to the SAME order and flows through delivery and invoicing.
// Run together with returns.test.ts (see the command at the top of that file).
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { createReturn, processReturn, restockReturnedItem } from "../returns"
import { createDpInvoices, createSoInvoice, round2 } from "../invoicing"
import { reopenIfNotFullyDelivered, validateSoEdit } from "../so-edit"
import { isSOFullyDelivered, lineDeliveryStates } from "../delivery-status"

// SO 1: 10 x Pump A (product 7 @ 10,000), delivered on DP 1 (APPROVED); the customer returns 2.
function baseDb(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [
      { so_id: 1, so_number: "SO-T-1", customer_id: 5, status: "delivered", fulfillment_status: "DELIVERED", total: 114000, subtotal: 100000, discount_amount: 0, payment_type: "bank_transfer", payment_terms: "prepaid", installments: 1 },
    ],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }, { customer_id: 6, customer_name: "Other" }],
    warehouses: [{ warehouse_id: 1 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, outsourced_name: null, quantity: 10, unit_price: 10000, total: 100000, item_type: "stock" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-T-1", sales_order_id: 1, customer_id: 5, status: "APPROVED" }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 7, item_name_snapshot: "Pump A", sku_snapshot: "A", quantity: 10, unit_price: 10000, total: 100000, supplier_id: null, outsourced_name: null }],
    inventory: [{ inventory_id: 100, product_id: 7, warehouse_id: 1, is_returned: false, quantity: 5, unit_cost: 5000, reorder_point: 10 }],
    invoice_delivery_permits: [],
    accounts_receivable: [],
    ...extra,
  })
}
let k = 0
async function returnTwoPumps(db: FakeDb, qty = 2) {
  const res = await createReturn(db, { permitId: 1, idempotencyKey: `so-edit-key-${++k}-abcdef`, items: [{ productId: 7, productName: "Pump A", quantityReturned: qty, reason: "wrong_item", condition: "good" }] })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body.returnId as number
}
// what the edit dialog sends
const lineA = (quantity: number, extra: Row = {}) => ({ id: "1", productId: "7", productName: "Pump A", quantity, unitPrice: 10000, total: quantity * 10000, itemType: "stock", ...extra })
const lineB = (quantity: number) => ({ productId: "8", productName: "Pump B", quantity, unitPrice: 12000, total: quantity * 12000, itemType: "stock" })

// Mirrors what PUT /api/sales-orders does with a validated edit (diff by line id, then totals, then re-open).
async function applyEdit(db: FakeDb, items: any[]) {
  const existing = db.tables.sales_order_items.map((r) => r.so_item_id)
  for (const item of items) {
    const row = { so_id: 1, product_id: Number(item.productId), outsourced_name: null, quantity: item.quantity, unit_price: item.unitPrice, total: item.total, item_type: "stock" }
    if (item.id && existing.includes(Number(item.id))) await db.from("sales_order_items").update(row).eq("so_item_id", Number(item.id))
    else await db.from("sales_order_items").insert(row)
  }
  const subtotal = items.reduce((s, i) => s + i.total, 0)
  await db.from("sales_orders").update({ subtotal, total: round2(subtotal * 1.14) }).eq("so_id", 1)
  return reopenIfNotFullyDelivered(db, 1)
}
const addDp2ForB = (db: FakeDb, status = "APPROVED") => {
  db.tables.delivery_permits.push({ permit_id: 2, permit_no: "DP-T-2", sales_order_id: 1, customer_id: 5, status })
  db.tables.delivery_permit_items.push({ item_id: 21, permit_id: 2, product_id: 8, item_name_snapshot: "Pump B", sku_snapshot: "B", quantity: 2, unit_price: 12000, total: 24000, supplier_id: null, outsourced_name: null })
}

test("E1. the order stays editable after a return: a replacement can be added and the returned line can be lowered to what is kept", async () => {
  const db = baseDb()
  await returnTwoPumps(db)
  assert.deepEqual(await validateSoEdit(db, 1, { customerId: "5", items: [lineA(10), lineB(2)] }), { ok: true }) // keep A, add B
  assert.deepEqual(await validateSoEdit(db, 1, { customerId: "5", items: [lineA(8), lineB(2)] }), { ok: true }) // A lowered to the 8 kept
  assert.deepEqual(await validateSoEdit(db, 1, { items: [lineA(12), lineB(2)] }), { ok: true }) // or raised
})

test("E2. edits that would destroy history are refused: below what is kept, removing / changing a delivered line, changing the customer", async () => {
  const db = baseDb()
  await returnTwoPumps(db)
  const below = await validateSoEdit(db, 1, { items: [lineA(7), lineB(2)] })
  assert.equal(below.ok, false)
  assert.match((below as any).error, /8 are kept by the customer \(delivered 10, returned 2\)/)
  const removed = await validateSoEdit(db, 1, { items: [lineB(2)] }) // A line dropped
  assert.equal(removed.ok, false)
  assert.match((removed as any).error, /cannot be removed/)
  const overwritten = await validateSoEdit(db, 1, { items: [{ ...lineA(10), productId: "8", productName: "Pump B" }] }) // A overwritten by B
  assert.equal(overwritten.ok, false)
  assert.match((overwritten as any).error, /cannot be turned into a different item/)
  const customer = await validateSoEdit(db, 1, { customerId: "6", items: [lineA(10)] })
  assert.equal(customer.ok, false)
  assert.match((customer as any).error, /customer .* cannot be changed/)
})

test("E2. a fully returned line may drop to 0 but stays on the order", async () => {
  const db = baseDb()
  await returnTwoPumps(db, 10)
  assert.deepEqual(await validateSoEdit(db, 1, { items: [lineA(0), lineB(10)] }), { ok: true })
  assert.equal((await validateSoEdit(db, 1, { items: [lineB(10)] })).ok, false) // but cannot disappear
})

test("E2. an order with no delivery permit yet keeps the ordinary free editing", async () => {
  const db = baseDb({ delivery_permits: [], delivery_permit_items: [] })
  assert.deepEqual(await validateSoEdit(db, 1, { customerId: "6", items: [lineB(3)] }), { ok: true })
})

test("E3. exchange on the SAME order: original line, return and permit history stay linked and unchanged", async () => {
  const db = baseDb()
  const returnId = await returnTwoPumps(db)
  const history = () =>
    JSON.stringify({
      returns: db.tables.product_returns,
      returnItems: db.tables.return_items,
      permits: db.tables.delivery_permits.filter((p) => p.permit_id === 1),
      permitItems: db.tables.delivery_permit_items.filter((i) => i.permit_id === 1),
      lineA: db.tables.sales_order_items.find((r) => r.so_item_id === 1)!.product_id,
    })
  const before = history()
  assert.equal((await validateSoEdit(db, 1, { items: [lineA(8), lineB(2)] })).ok, true)
  assert.equal(await applyEdit(db, [lineA(8), lineB(2)]), true) // re-opened: B is still to be delivered
  assert.equal(history(), before) // return, permit and the Pump A line identity are untouched
  assert.equal(db.tables.sales_order_items.length, 2) // same order, one new line - no new SO
  assert.equal(db.tables.sales_orders.length, 1)
  assert.equal(db.tables.product_returns.find((r) => r.return_id === returnId)!.so_id, 1)
  const order = db.tables.sales_orders[0]
  assert.deepEqual([order.status, order.fulfillment_status], ["ready_for_delivery", "PARTIALLY_DELIVERED"])
})

test("E4. the replacement flows through delivery: the order is delivered again once B is delivered", async () => {
  const db = baseDb()
  await returnTwoPumps(db)
  await applyEdit(db, [lineA(8), lineB(2)])
  assert.equal(await isSOFullyDelivered(db, 1), false) // B not delivered yet
  addDp2ForB(db)
  assert.equal(await isSOFullyDelivered(db, 1), true) // A: 10 delivered - 2 returned = 8 kept; B: 2
})

test("E4. if the returned line is NOT lowered, the returned units stay owed (order not fully delivered)", async () => {
  const db = baseDb()
  await returnTwoPumps(db)
  await applyEdit(db, [lineA(10), lineB(2)])
  addDp2ForB(db)
  assert.equal(await isSOFullyDelivered(db, 1), false) // 8 of 10 Pump A kept
})

test("E5. the replacement flows through invoicing: per-DP invoices bill the kept A and the new B, nothing more", async () => {
  const db = baseDb()
  await returnTwoPumps(db)
  await applyEdit(db, [lineA(8), lineB(2)])
  addDp2ForB(db)
  const a = await createDpInvoices(db, [1])
  assert.equal(a.status, 200, JSON.stringify(a.body))
  assert.equal(a.body.invoices[0].amount, round2(8 * 10000 * 1.14)) // 91,200: the 2 returned pumps are not billed
  const b = await createDpInvoices(db, [2])
  assert.equal(b.status, 200, JSON.stringify(b.body))
  assert.equal(b.body.invoices[0].amount, round2(2 * 12000 * 1.14)) // 27,360: the replacement
  assert.equal(db.tables.accounts_receivable.length, 2)
})

test("E5. both ways of editing give the same whole-order invoice: 8 x A + 2 x B, never the returned pumps", async () => {
  const expected = round2((8 * 10000 + 2 * 12000) * 1.14) // 118,560
  for (const items of [[lineA(8), lineB(2)], [lineA(10), lineB(2)]]) {
    const db = baseDb()
    await returnTwoPumps(db)
    await applyEdit(db, items)
    addDp2ForB(db)
    const res = await createSoInvoice(db, 1)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.amount, expected, JSON.stringify(items.map((i) => i.quantity)))
  }
})

test("E5. an invoice issued BEFORE the return is never changed; billing the replacement on top waits for a credit decision", async () => {
  for (const items of [[lineA(8), lineB(2)], [lineA(10), lineB(2)]]) {
    const db = baseDb()
    assert.equal((await createDpInvoices(db, [1])).body.invoices[0].amount, 114000) // billed in full, before the return
    await returnTwoPumps(db)
    await applyEdit(db, items)
    addDp2ForB(db)
    assert.equal(db.tables.accounts_receivable[0].amount, 114000) // never changed retroactively
    // The 2 returned pumps were already billed and no credit note exists (finance is deferred), so billing the
    // replacement on top would charge the customer twice: it is refused rather than guessed.
    const replacement = await createDpInvoices(db, [2])
    assert.equal(replacement.status, 409, JSON.stringify(items.map((i) => i.quantity)))
    assert.match(replacement.body.error, /would exceed sales order/)
    assert.equal(db.tables.accounts_receivable.length, 1)
  }
})

test("E6. inventory: the returned pumps go to the holding row and can be restocked once; the replacement is a separate item", async () => {
  const db = baseDb()
  const returnId = await returnTwoPumps(db)
  const assignments = db.tables.return_items.filter((i) => i.return_id === returnId).map((i) => ({ returnItemId: i.return_item_id, warehouseId: 1 }))
  assert.equal((await processReturn(db, { returnId, status: "completed", warehouseAssignments: assignments })).status, 200)
  await applyEdit(db, [lineA(8), lineB(2)])
  const holding = db.tables.inventory.find((r) => r.is_returned)!
  assert.equal(holding.quantity, 2)
  assert.equal(db.tables.inventory.find((r) => r.inventory_id === 100)!.quantity, 5) // sellable stock not touched by the return
  assert.equal((await restockReturnedItem(db, { inventoryId: holding.inventory_id })).status, 200)
  assert.equal((await restockReturnedItem(db, { inventoryId: holding.inventory_id })).status, 404)
  assert.equal(db.tables.inventory.find((r) => r.inventory_id === 100)!.quantity, 7)
  assert.equal(db.tables.inventory.filter((r) => r.product_id === 8).length, 0) // nothing invented for B
})

test("E7. an order that is still fully delivered after the edit is not re-opened", async () => {
  const db = baseDb()
  await returnTwoPumps(db)
  assert.equal(await applyEdit(db, [lineA(8)]), false) // lowered to what is kept: nothing owed
  assert.equal(db.tables.sales_orders[0].status, "delivered")
})

test("5b. lineDeliveryStates: delivered / partial / not delivered, net of returns, shared keys used in order", () => {
  const lines = [
    { key: "p:1", quantity: 10 },
    { key: "p:2", quantity: 4 },
    { key: "n:Crane", quantity: 1 },
    { key: "p:1", quantity: 5 },
  ]
  // p:1 has 12 confirmed (after returns), p:2 has 4, the outsourced Crane has none
  const r = lineDeliveryStates(lines, new Map([["p:1", 12], ["p:2", 4]]))
  assert.deepEqual(r.map((x) => x.state), ["delivered", "delivered", "not_delivered", "partial"])
  assert.deepEqual(r.map((x) => x.deliveredQuantity), [10, 4, 0, 2])
  // a return that brings the net below the order reopens the line
  assert.equal(lineDeliveryStates([{ key: "p:2", quantity: 4 }], new Map([["p:2", 3]]))[0].state, "partial")
  // negative net (more returned than delivered) never counts as delivered
  assert.equal(lineDeliveryStates([{ key: "p:2", quantity: 4 }], new Map([["p:2", -1]]))[0].state, "not_delivered")
})
