// Tests for supplier credits raised by the returned-item write-off (Batch 4G, no-schema part): receipt cost + VAT,
// cap at the received value, refusal before anything is deleted, links/refs, duplicate guard, undo after the claim.
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { removeReturnedItem } from "../returns"

const HIST_CREDIT = { credit_id: 1, supplier_id: 3, amount: 4000, credit_type: "return", reference_type: "inventory", reference_id: null, invoice_id: null, status: "active" }

// PO 10 (supplier 3, 14% VAT, one AP row): 5 x Pump (product 7) @ 2000 on GRN-T-1, outsourced "Silicon Gun" 5 @ 2000 for SO 1.
// PO 20 (supplier 3, no VAT, two AP rows): 4 x Valve (product 8) @ 100.
function seed(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1" }],
    sales_order_items: [{ so_item_id: 28, so_id: 1 }],
    suppliers: [{ supplier_id: 3, supplier_name: "Mostafa Co" }, { supplier_id: 4, supplier_name: "Other" }],
    purchase_orders: [
      { po_id: 10, po_number: "PO-T-10", supplier_id: 3, total: 22800, tax_amount: 2800 },
      { po_id: 20, po_number: "PO-T-20", supplier_id: 3, total: 400, tax_amount: null },
    ],
    purchase_order_items: [
      { po_item_id: 100, po_id: 10, total: 10000 },
      { po_item_id: 101, po_id: 10, total: 10000 },
      { po_item_id: 200, po_id: 20, total: 400 },
    ],
    goods_receipts: [
      { receipt_id: 1, grn_number: "GRN-T-1", po_id: 10 },
      { receipt_id: 2, grn_number: "GRN-T-2", po_id: 20 },
    ],
    goods_receipt_lines: [
      { line_id: 1, receipt_id: 1, po_item_id: 100, product_id: 7, item_type: "stock", quantity_received: 5, unit_cost: 2000, source_so_item_id: null },
      { line_id: 2, receipt_id: 1, po_item_id: 101, product_id: null, outsourced_name: "Silicon Gun ", item_type: "outsourced", quantity_received: 5, unit_cost: 2000, source_so_item_id: 28 },
      { line_id: 3, receipt_id: 2, po_item_id: 200, product_id: 8, item_type: "stock", quantity_received: 4, unit_cost: 100, source_so_item_id: null },
    ],
    accounts_payable: [
      { invoice_id: 5, invoice_number: "APINV-PO-T-10", po_id: 10 },
      { invoice_id: 6, invoice_number: "APINV-PO-T-20", po_id: 20 },
      { invoice_id: 7, invoice_number: "INV-PO-T-20", po_id: 20 },
    ],
    inventory: [
      { inventory_id: 1, product_id: 7, warehouse_id: 1, is_returned: true, quantity: 2, unit_cost: 1, so_number: "SO-T-1", supplier_name: null },
      { inventory_id: 2, product_id: null, warehouse_id: 1, is_returned: true, quantity: 2, unit_cost: 1, is_outsourced: true, outsourced_name: "silicon gun", so_number: "SO-T-1" },
      { inventory_id: 3, product_id: 8, warehouse_id: 1, is_returned: true, quantity: 3, unit_cost: 1, so_number: null },
      { inventory_id: 4, product_id: 7, warehouse_id: 2, is_returned: true, quantity: 9, unit_cost: 1, so_number: null },
      { inventory_id: 5, product_id: 99, warehouse_id: 1, is_returned: true, quantity: 3, unit_cost: 0, so_number: null },
    ],
    inventory_batches: [],
    supplier_credits: [HIST_CREDIT],
    ...extra,
  })
}
const newCredits = (db: FakeDb) => db.tables.supplier_credits.filter((c) => c.credit_id > 1)
const holding = (db: FakeDb, id: number) => db.tables.inventory.find((r) => r.inventory_id === id)

test("supplier-credits: credit uses the receipt cost plus 14% VAT (PO with tax), supplier from the PO", async () => {
  const db = seed()
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump", unitCost: 1, quantity: 9999 })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const [c] = newCredits(db)
  assert.equal(c.supplier_id, 3)
  assert.equal(c.amount, 4560) // 2 x 2000 x 1.14 (before: 2 x browser/batch cost, no VAT)
  assert.equal(holding(db, 1), undefined)
})

test("supplier-credits: PO without tax gets no VAT; several AP rows -> invoice_id left null and noted", async () => {
  const db = seed()
  assert.equal((await removeReturnedItem(db, { inventoryId: 3, productName: "Valve" })).status, 200)
  const [c] = newCredits(db)
  assert.equal(c.amount, 300) // 3 x 100
  assert.equal(c.invoice_id, null)
  assert.match(c.notes, /2 payable rows/)
  assert.match(c.description, /PO PO-T-20/)
})

test("supplier-credits: invoice_id linked when exactly one AP row exists; description carries PO/GRN/SO", async () => {
  const db = seed()
  await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  const [c] = newCredits(db)
  assert.equal(c.invoice_id, 5)
  assert.equal(c.reference_type, "inventory")
  assert.equal(c.reference_id, 1)
  assert.equal(c.status, "active")
  for (const part of ["PO PO-T-10", "GRN GRN-T-1", "SO SO-T-1"]) assert.ok(c.description.includes(part), c.description)
})

test("supplier-credits: outsourced item matched by name and the SO's lines", async () => {
  const db = seed()
  const res = await removeReturnedItem(db, { inventoryId: 2, productName: "Silicon Gun" })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(newCredits(db)[0].amount, 4560)
})

test("supplier-credits: capped at the original received line value", async () => {
  const db = seed()
  const res = await removeReturnedItem(db, { inventoryId: 4, productName: "Pump" }) // 9 held, only 5 were received
  assert.equal(res.status, 200)
  const [c] = newCredits(db)
  assert.equal(c.amount, round(5 * 2000 * 1.14)) // 11400, not 9 x 2000 x 1.14
  assert.match(c.notes, /capped/)
})
const round = (n: number) => Math.round(n * 100) / 100

test("supplier-credits: explicit supplier that never received the item falls back to the old cost path", async () => {
  const db = seed()
  db.tables.inventory_batches.push({ batch_id: 1, product_id: 7, unit_cost: 1500, received_date: "2026-01-01" })
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump", supplierNameId: 4 })
  assert.equal(res.status, 200)
  const [c] = newCredits(db)
  assert.equal(c.supplier_id, 4)
  assert.equal(c.amount, 3000) // 2 x last batch cost, no VAT, no PO link
  assert.equal(c.invoice_id, null)
})

test("supplier-credits: unresolved supplier or zero amount -> 409 and nothing deleted", async () => {
  const db = seed()
  const noSupplier = await removeReturnedItem(db, { inventoryId: 5, productName: "Mystery" })
  assert.equal(noSupplier.status, 409)
  assert.equal(noSupplier.body.code, "CREDIT_SUPPLIER_UNRESOLVED")
  const zero = await removeReturnedItem(db, { inventoryId: 5, productName: "Mystery", supplierNameId: 3 })
  assert.equal(zero.status, 409)
  assert.equal(zero.body.code, "CREDIT_AMOUNT_ZERO")
  assert.ok(holding(db, 5), "holding row must still exist")
  assert.equal(newCredits(db).length, 0)
})

test("supplier-credits: double click / concurrent requests create exactly one credit", async () => {
  for (let run = 0; run < 20; run++) {
    const db = seed()
    const results = await Promise.all(Array.from({ length: 5 }, () => removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })))
    assert.equal(results.filter((r) => r.status === 200).length, 1, `run ${run}`)
    assert.equal(newCredits(db).length, 1, `run ${run}`)
  }
})

test("supplier-credits: an active credit for the same reference is refused with CREDIT_DUPLICATE; reference_id null is not guarded", async () => {
  const db = seed({ supplier_credits: [HIST_CREDIT, { credit_id: 2, supplier_id: 3, amount: 1, reference_type: "inventory", reference_id: 1, status: "active" }] })
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  assert.equal(res.status, 409)
  assert.equal(res.body.code, "CREDIT_DUPLICATE")
  assert.ok(holding(db, 1), "nothing deleted")
  assert.equal(db.tables.supplier_credits.length, 2)
})

test("supplier-credits: a failure after the claim restores the holding row and leaves no credit", async () => {
  const db = seed()
  db.failOn["supplier_credits:insert"] = "boom"
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  assert.equal(res.status, 500)
  assert.deepEqual([holding(db, 1)!.is_returned, holding(db, 1)!.quantity], [true, 2])
  assert.equal(newCredits(db).length, 0)
  delete db.failOn["supplier_credits:insert"]
  assert.equal((await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })).status, 200)
  assert.equal(newCredits(db).length, 1)
})

test("supplier-credits: batch-settle failure after the credit insert drops that credit and restores the row", async () => {
  const db = seed({ inventory_batches: [{ batch_id: 1, product_id: 7, warehouse_id: 1, is_returned: true, po_number: "RET-1", quantity_available: 2 }] })
  db.failOn["inventory_batches:update"] = "boom"
  const res = await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  assert.equal(res.status, 500)
  assert.ok(holding(db, 1))
  assert.equal(newCredits(db).length, 0)
})

test("supplier-credits: existing credit 1 and AP/payment tables are untouched", async () => {
  const db = seed({ supplier_payments: [], balance_entries: [] })
  const before = JSON.stringify([db.tables.accounts_payable, db.tables.supplier_payments, db.tables.balance_entries, db.tables.supplier_credits.find((c) => c.credit_id === 1)])
  await removeReturnedItem(db, { inventoryId: 1, productName: "Pump" })
  const after = JSON.stringify([db.tables.accounts_payable, db.tables.supplier_payments, db.tables.balance_entries, db.tables.supplier_credits.find((c) => c.credit_id === 1)])
  assert.equal(after, before)
})
