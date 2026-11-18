// Owner report 2026-11-18 (production, after the inventory tabs work):
//  A) Sold tab showed no cost and no supplier for outsourced lines (live facts reproduced below);
//  B) On hand must show only free stock: outsourced rows held for an open order belong on Pending;
//  C) a new quotation's "Add from inventory" must offer every free item (catalogue stock + free stored items), and
//     approving it must reserve a picked stored item like the sales order form does.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as costsRoute from "../../app/api/inventory/outsourced-costs/route"
import * as dpRoute from "../../app/api/delivery-permits/route"
import * as inventoryRoute from "../../app/api/inventory/route"
import * as pendingRoute from "../../app/api/inventory/pending/route"
import * as quotationRoute from "../../app/api/sales-quotations/route"
import * as approveRoute from "../../app/api/sales-quotations/approve/route"
import { soldLineCostAndSupplier } from "../sold-cost"
import { isOnHandRow } from "../inventory-stock-filter"
import { freeStockChoices, productFreeStock } from "../free-stock"
import { parseFromStock } from "../from-stock-line"
import { workflowSwitch } from "../workflow-switch"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")

// ------------------------------------------------------------------------------------------------ A) Sold tab
const ITEM = "لقمة بوجيهات 16"

function soldDb() {
  const db = new FakeDb({
    customers: [{ customer_id: 5, customer_name: "Customer A" }],
    suppliers: [{ supplier_id: 9, supplier_name: "مورد الأمر" }],
    sales_orders: [
      { so_id: 4, so_number: "SO-2026-507661", status: "delivered", customer_id: 5, total: 400 },
      { so_id: 6, so_number: "SO-2026-095894", status: "delivered", customer_id: 5, total: 100 },
    ],
    // the line was re-saved by an edit (new id 40); the PO line still points at the old line id 12
    sales_order_items: [
      { so_item_id: 40, so_id: 4, product_id: null, item_type: "outsourced", outsourced_name: ITEM, outsourced_description: null, supplier_id: null, quantity: 2, unit_price: 200 },
      { so_item_id: 60, so_id: 6, product_id: null, item_type: "stock", outsourced_name: "Old item", outsourced_description: "Supplier: X", supplier_id: null, quantity: 1, unit_price: 100 },
    ],
    purchase_orders: [{ po_id: 3, po_number: "PO-T-3", status: "received", supplier_id: 9, cost_finalized: true }],
    purchase_order_items: [
      { po_item_id: 7, po_id: 3, product_id: null, item_type: "outsourced", outsourced_name: ` ${ITEM.replace(" ", "  ")} `, source_so_id: 4, source_so_item_id: 12, quantity: 2, unit_price: 150, landed_cost: 330 },
    ],
    delivery_permits: [
      { permit_id: 1, permit_no: "DP-T-1", sales_order_id: 4, customer_id: 5, status: "APPROVED", created_at: "2026-11-10T10:00:00Z" },
      { permit_id: 2, permit_no: "DP-T-2", sales_order_id: 6, customer_id: 5, status: "SUBMITTED_SIGNED", created_at: "2026-11-01T10:00:00Z" },
    ],
    // live facts: no product, the item name in item_name_snapshot, the SUPPLIER name in outsourced_name
    delivery_permit_items: [
      { item_id: 11, permit_id: 1, product_id: null, item_name_snapshot: ITEM, outsourced_name: "مصطفي", supplier_id: null, quantity: 2, unit_price: 200, total: 400 },
      { item_id: 21, permit_id: 2, product_id: null, item_name_snapshot: "Old item", outsourced_name: "Old supplier", supplier_id: null, quantity: 1, unit_price: 100, total: 100 },
    ],
    delivery_permit_files: [],
    product_returns: [],
    return_items: [],
    inventory: [],
  })
  useDb(db)
  return db
}

test("A: Sold tab, live facts: cost from the PO line bought for the order (matched by order + item name), supplier from the PO", async () => {
  soldDb()
  const costsRes = await costsRoute.GET()
  assert.equal(costsRes.status, 200)
  const costs = (await costsRes.json()) as any[]
  const permits = await call(dpRoute.GET as any, "GET", undefined, "http://test.local/api/delivery-permits")
  assert.equal(permits.status, 200, JSON.stringify(permits.body))
  const dp1 = permits.body.find((p: Row) => p.id === "1")
  const item = dp1.items[0]
  assert.equal(item.itemNameSnapshot, ITEM)
  assert.equal(item.outsourcedName, "مصطفي", "the permit line's outsourced_name is the supplier")
  // the screen: no sales order loaded in the app context (so lines unknown), matched by the permit's order id
  const sold = soldLineCostAndSupplier({ item, soId: dp1.salesOrderId, soLines: [], costs })
  assert.equal(sold.unitCost, 165, "landed 330 / 2 (the PO cost is finalized)")
  assert.equal(sold.supplierName, "مورد الأمر", "the purchase order's supplier")

  // not finalized yet: the PO unit price
  const db = soldDb()
  db.tables.purchase_orders[0].cost_finalized = false
  const costs2 = (await (await costsRoute.GET()).json()) as any[]
  assert.equal(soldLineCostAndSupplier({ item, soId: "4", costs: costs2 }).unitCost, 150)
})

test("A: an order with no purchase order: cost unknown (—), supplier from the permit line / order line", async () => {
  soldDb()
  const costs = (await (await costsRoute.GET()).json()) as any[]
  const permits = await call(dpRoute.GET as any, "GET", undefined, "http://test.local/api/delivery-permits")
  const dp2 = permits.body.find((p: Row) => p.id === "2")
  const sold = soldLineCostAndSupplier({ item: dp2.items[0], soId: dp2.salesOrderId, costs })
  assert.equal(sold.unitCost, null)
  assert.equal(sold.supplierName, "Old supplier")
  // the order line's supplier wins over the permit's
  const withLine = soldLineCostAndSupplier({ item: dp2.items[0], soId: "6", costs, soLines: [{ productId: null, productName: "Old item", supplierName: "Line supplier" }] })
  assert.equal(withLine.supplierName, "Line supplier")
})

test("A: matching rules: item_name_snapshot first (never the permit's outsourced_name), whitespace tolerated, wrong order no match", () => {
  const costs = [{ soId: 4, soItemId: 40, name: ITEM, unitCost: 165, supplierName: "S" }]
  const base = { productId: null, itemNameSnapshot: `  ${ITEM.replace(" ", "   ")}`, productName: "مصطفي", outsourcedName: "مصطفي", supplierName: "مصطفي" }
  assert.equal(soldLineCostAndSupplier({ item: base, soId: 4, costs }).unitCost, 165)
  assert.equal(soldLineCostAndSupplier({ item: { ...base, itemNameSnapshot: ITEM.replace(/ /g, "") }, soId: 4, costs }).unitCost, 165, "spaces dropped")
  assert.equal(soldLineCostAndSupplier({ item: base, soId: 5, costs }).unitCost, null, "another order's line")
  // a renamed / removed order line: the PO line is still listed for its order under its own name
  const orphan = soldLineCostAndSupplier({ item: base, soId: 4, costs: [{ soId: 4, soItemId: 0, name: ITEM, unitCost: 99, supplierName: "P" }] })
  assert.deepEqual(orphan, { unitCost: 99, supplierName: "P" })
  // a catalogue product: stock value per unit (returned rows left out)
  const product = soldLineCostAndSupplier({
    item: { productId: "1", itemNameSnapshot: "وصلة سريعة" },
    soId: 4,
    costs: [],
    inventory: [
      { productId: "1", quantity: 10, unitCost: 20 },
      { productId: "1", quantity: 5, unitCost: 999, isReturned: true },
    ],
  })
  assert.equal(product.unitCost, 20)
})

test("A: the Sold tab uses the shared matcher with the permit's order id; Cost before Price, Supplier before Customer (table and cards)", () => {
  const src = read("components/modules/inventory-module.tsx")
  const fn = src.slice(src.indexOf("const soldCostAndSupplier"), src.indexOf("const soldItems"))
  assert.match(fn, /soldLineCostAndSupplier\(/)
  assert.match(fn, /soId: dp\?\.salesOrderId/)
  assert.match(src, /soldCostAndSupplier\(item, so, dp\)/)
  const sold = src.slice(src.indexOf('<TabsContent value="sold"'), src.indexOf('<TabsContent value="returns"'))
  const card = sold.slice(sold.indexOf("card={(item)"))
  const at = (s: string) => card.indexOf(s)
  assert.ok(at('t("inventory.sold-cost")') > 0 && at('t("inventory.sold-cost")') < at('t("field.unit-price")'), "card: cost before price")
  assert.ok(at('t("inventory.sold-supplier")') > 0, "card: supplier shown")
  // the lib never reads the permit's outsourced_name as the item name
  const lib = read("lib/sold-cost.ts")
  assert.match(lib, /const rawName = item\.itemNameSnapshot \|\| item\.productName \|\| ""/)
})

// ------------------------------------------------------------------------------------------------ B) On hand
function onHandDb() {
  const db = new FakeDb({
    customers: [{ customer_id: 5, customer_name: "Customer A" }],
    products: [{ product_id: 1, product_name: "وصلة سريعة", sku: "QC-1" }],
    sales_orders: [
      { so_id: 10, so_number: "SO-2026-331195", status: "accountant_approved", customer_id: 5 },
      { so_id: 4, so_number: "SO-2026-507661", status: "ready_for_delivery", customer_id: 5 },
      { so_id: 11, so_number: "SO-2026-919428", status: "pending_accountant", customer_id: 5 },
      { so_id: 12, so_number: "SO-2026-000001", status: "delivered", customer_id: 5 },
    ],
    sales_order_items: [
      { so_item_id: 100, so_id: 10, product_id: null, item_type: "outsourced", outsourced_name: "Item A", quantity: 2, unit_price: 50 },
      { so_item_id: 101, so_id: 4, product_id: null, item_type: "outsourced", outsourced_name: "Item B", quantity: 1, unit_price: 50 },
      { so_item_id: 102, so_id: 11, product_id: null, item_type: "outsourced", outsourced_name: "Item C", quantity: 3, unit_price: 50 },
    ],
    inventory: [
      { inventory_id: 1, product_id: 1, warehouse_id: 1, quantity: 10, unit_cost: 20, is_returned: false, is_outsourced: false, reorder_point: 2 },
      // held for open orders: "Received on" (current code), an older description, and no description / no flag
      { inventory_id: 2, product_id: null, warehouse_id: 1, quantity: 2, unit_cost: 30, is_outsourced: true, is_returned: false, outsourced_name: "Item A", outsourced_description: "Received on PO-1 for SO-2026-331195", so_number: "SO-2026-331195" },
      { inventory_id: 3, product_id: null, warehouse_id: 1, quantity: 1, unit_cost: 30, is_outsourced: true, is_returned: false, outsourced_name: "Item B", outsourced_description: "Outsourced item for order", so_number: "SO-2026-507661 " },
      { inventory_id: 4, product_id: null, warehouse_id: 1, quantity: 3, unit_cost: 30, is_outsourced: null, is_returned: false, outsourced_name: "Item C", outsourced_description: null, so_number: "SO-2026-919428" },
      // free: a customer return put into a warehouse, and an item of a delivered order
      { inventory_id: 5, product_id: null, warehouse_id: 1, quantity: 1, unit_cost: 40, is_outsourced: true, is_returned: true, outsourced_name: "Returned D", outsourced_description: "Returned from SO-2026-000001 — damaged", so_number: "SO-2026-000001" },
      { inventory_id: 6, product_id: null, warehouse_id: 1, quantity: 1, unit_cost: 40, is_outsourced: true, is_returned: false, outsourced_name: "Left E", outsourced_description: "Received on PO-2 for SO-2026-000001", so_number: "SO-2026-000001" },
    ],
    delivery_permits: [],
    delivery_permit_items: [],
    goods_receipt_lines: [],
    purchase_order_items: [],
    purchase_orders: [],
    suppliers: [],
  })
  useDb(db)
  return db
}

test("B: On hand = free stock only; outsourced rows held for open orders are on Pending (live data)", async () => {
  onHandDb()
  const rows = ((await (await inventoryRoute.GET()).json()) as any[]).map((r) => ({ ...r }))
  const onHand = rows.filter((r) => isOnHandRow(r)).map((r) => r.inventoryId).sort()
  assert.deepEqual(onHand, [1, 5, 6], "catalogue stock, the customer return, the delivered order's item")
  for (const id of [2, 3, 4]) {
    const r = rows.find((x) => x.inventoryId === id)
    assert.equal(r.purchasedFor, true, `row ${id} held for its open order`)
    assert.equal(r.available, 0, `row ${id}`)
  }
  const pending = (await (await pendingRoute.GET()).json()) as any[]
  const bySo = pending.map((p) => `${p.soNumber}:${p.name}:${p.quantity}`).sort()
  assert.deepEqual(bySo, ["SO-2026-331195:Item A:2", "SO-2026-507661:Item B:1", "SO-2026-919428:Item C:3"])
})

// ------------------------------------------------------------------------------------------------ C) quotation
test("C: free stock list = catalogue products with free stock + free stored items (by name, empty SKU, cost, qty)", async () => {
  onHandDb()
  const rows = ((await (await inventoryRoute.GET()).json()) as any[]).map((r) => ({ ...r, productId: r.productId }))
  const products = [
    { id: "1", productName: "وصلة سريعة", sku: "QC-1" },
    { id: "2", productName: "No stock", sku: "NS-2" },
  ]
  const choices = freeStockChoices(products, rows)
  assert.deepEqual(
    choices.map((c) => [c.id, c.name, c.sku, c.available]),
    [
      ["1", "وصلة سريعة", "QC-1", 10],
      ["stored-5", "Returned D", "", 1],
      ["stored-6", "Left E", "", 1],
    ],
  )
  assert.equal(choices.find((c) => c.id === "stored-5")!.unitCost, 40)
  assert.equal(freeStockChoices(products, rows, { includeOutOfStock: true }).at(-1)!.id, "2", "out of stock last")
  // a returned row of the product listed first (available 0) does not hide the product's free stock
  const withReturn = [{ productId: "1", quantity: 3, available: 0, isReturned: true }, ...rows]
  assert.equal(productFreeStock(withReturn, "1"), 10)
  assert.equal(productFreeStock([{ productId: "1", quantity: 4, available: null }, { productId: "1", quantity: 6 }], 1), 10, "hold unknown: summed")
})

test("C: the quotation form offers that list; the sales order form uses the same helper", () => {
  const q = read("components/modules/sales-quotation-module.tsx")
  assert.match(q, /freeStockChoices\(products as any\[\], inventory as any\[\], \{ includeOutOfStock: true \}\)/)
  assert.match(q, /products=\{inventoryChoices\.map/)
  assert.match(q, /from_inventory_id: item\.from_inventory_id \? Number\(item\.from_inventory_id\) : null/)
  assert.match(q, /if \(newWorkflow\) return productFreeStock\(inventory as any\[\], productId\)/)
  assert.match(read("components/modules/sales-order-module.tsx"), /isFreeStoredRow\(inv\)/)
  assert.match(read("scripts/sql/2026-11-18-quotation-from-stock.sql"), /add column if not exists from_inventory_id int/)
})

function quoteDb() {
  const db = new FakeDb({
    sales_quotations: [], sales_quotation_items: [], sales_orders: [], sales_order_items: [], delivery_permits: [],
    delivery_permit_items: [], suppliers: [{ supplier_id: 3, supplier_name: "Supp R" }], accounts_receivable: [], po_requests: [], po_request_items: [],
    customers: [{ customer_id: 5, customer_name: "Customer A" }],
    products: [{ product_id: 1, product_name: "وصلة سريعة", sku: "QC-1" }],
    inventory: [
      { inventory_id: 1, product_id: 1, warehouse_id: 1, quantity: 10, unit_cost: 20, is_returned: false, is_outsourced: false },
      { inventory_id: 5, product_id: null, warehouse_id: 1, quantity: 3, unit_cost: 40, is_outsourced: true, is_returned: true, outsourced_name: "Returned D", outsourced_description: "Returned from SO-OLD — damaged", supplier_name: "Supp R", so_number: "SO-OLD" },
    ],
    payment_schedules: [], workflow_events: [], idempotency_log: [],
  })
  db.rpcHandlers.generate_quotation_number = () => `Q-FS-${db.tables.sales_quotations.length + 1}`
  db.rpcHandlers.generate_so_number = () => `SO-FS-${db.tables.sales_orders.length + 1}`
  useDb(db)
  return db
}

test("C: a quotation with a free stored item: saved with its row; approval reserves the row like the sales order form", async () => {
  const before = workflowSwitch.newQuotationWorkflow
  workflowSwitch.newQuotationWorkflow = true
  try {
    const db = quoteDb()
    const created = await call(quotationRoute.POST as any, "POST", {
      customer_name: "Customer A",
      customer_id: 5,
      items: [
        { item_type: "inventory", product_id: 1, product_name: "وصلة سريعة", quantity: 2, unit_price: 30 },
        { item_type: "outsourced", product_id: null, product_name: "Returned D", quantity: 2, unit_price: 55, unit_cost: 40, supplier_name: "Supp R", from_inventory_id: 5 },
      ],
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const stored = db.tables.sales_quotation_items.find((r) => r.product_name === "Returned D")!
    assert.equal(stored.from_inventory_id, 5)
    assert.equal(db.tables.sales_quotation_items.find((r) => r.product_id === 1)!.from_inventory_id, null)

    const approved = await call(approveRoute.POST as any, "POST", { quotation_id: created.body.quotation.id })
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    const soNumber = approved.body.sales_order.so_number
    const line = db.tables.sales_order_items.find((r) => r.outsourced_name === "Returned D")!
    const marker = parseFromStock(line.outsourced_description)
    assert.ok(marker, "a from-stock line")
    assert.equal(marker!.pickedId, 5)
    const reserved = db.tables.inventory.find((r) => r.inventory_id === marker!.reservedId)!
    assert.equal(reserved.quantity, 2)
    assert.equal(reserved.so_number, soNumber)
    assert.equal(reserved.is_returned, false)
    assert.equal(db.tables.inventory.find((r) => r.inventory_id === 5)!.quantity, 1, "the rest stays free")
    assert.equal(line.product_id, null)
    assert.equal(line.unit_price, 55)
    assert.equal(line.cost_estimate, 40)

    // the free stock is gone for the next quotation: more than is free is refused, nothing is created
    const second = await call(quotationRoute.POST as any, "POST", {
      customer_name: "Customer A",
      customer_id: 5,
      items: [{ item_type: "outsourced", product_name: "Returned D", quantity: 2, unit_price: 55, unit_cost: 40, from_inventory_id: 5 }],
    })
    const orders = db.tables.sales_orders.length
    const refused = await call(approveRoute.POST as any, "POST", { quotation_id: second.body.quotation.id })
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(refused.body.code, "STORED_ITEM_SHORT")
    assert.equal(db.tables.sales_orders.length, orders)
  } finally {
    workflowSwitch.newQuotationWorkflow = before
  }
})
