// Batch 3: Missing Items data. Every scenario loads through the real loader against the in-memory FakeDb.
//   Ordered / Delivered / Returned / Net delivered / Missing / PO ordered / Received / Unit cost
// Several tests are built to catch quantities being multiplied by many-to-many joins (multiple POs x GRNs x DPs x returns).
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb, type Row } from "./fake-db"
import { loadMissingItems, type MissingItemRow } from "../missing-items"

interface World {
  lines?: Row[]
  products?: Row[]
  inventory?: Row[]
  permits?: Row[]
  dpItems?: Row[]
  returns?: { header: Row; items: Row[] }[]
  poItems?: Row[]
  pos?: Row[]
  grn?: Row[]
}
const stockLine = (so_item_id: number, product_id: number, quantity: number, unit_price = 5000): Row => ({ so_item_id, so_id: 1, product_id, quantity, unit_price, total: quantity * unit_price, item_type: "stock", outsourced_name: null, outsourced_description: null })
const outLine = (so_item_id: number, name: string, quantity: number, unit_price = 5000, supplier = "SMG"): Row => ({ so_item_id, so_id: 1, product_id: null, quantity, unit_price, total: quantity * unit_price, item_type: "outsourced", outsourced_name: name, outsourced_description: `Supplier: ${supplier}` })
const dp = (permit_id: number, status: string): Row => ({ permit_id, sales_order_id: 1, status })
const dpi = (permit_id: number, quantity: number, product_id: number | null = 7, name = "Pump"): Row => ({ permit_id, product_id, item_name_snapshot: name, quantity })
const ret = (return_id: number, permit: number, qty: number, product_id: number | null = 7, name = "Pump", status = "pending_warehouse") => ({
  header: { return_id, permit_id: String(permit), status, created_at: "2026-10-01T00:00:00Z" },
  items: [{ return_item_id: return_id, return_id, product_id, product_name: name, returned_quantity: qty }],
})
const po = (po_id: number, status = "approved"): Row => ({ po_id, po_number: `PO-${po_id}`, status })
const poi = (po_item_id: number, po_id: number, source_so_item_id: number, quantity: number, landed_cost = 0, unit_price = 0): Row => ({ po_item_id, po_id, source_so_item_id, quantity, landed_cost, unit_price })
const grn = (line_id: number, quantity_received: number, source_so_item_id: number | null, po_item_id: number | null = null): Row => ({ line_id, receipt_id: 1, source_so_item_id, po_item_id, quantity_received })

function db(w: World = {}) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-T-1", order_date: "2026-10-01", delivery_date: null, status: "ready_for_delivery", customer_id: 5 }],
    customers: [{ customer_id: 5, customer_name: "Test Customer" }],
    sales_order_items: w.lines ?? [stockLine(1, 7, 10)],
    products: w.products ?? [{ product_id: 7, product_name: "Pump", sku: "P-7", last_landed_cost: null }],
    inventory: w.inventory ?? [],
    delivery_permits: w.permits ?? [],
    delivery_permit_items: w.dpItems ?? [],
    product_returns: (w.returns ?? []).map((r) => r.header),
    return_items: (w.returns ?? []).flatMap((r) => r.items),
    purchase_order_items: w.poItems ?? [],
    purchase_orders: w.pos ?? [],
    goods_receipt_lines: w.grn ?? [],
  })
}
async function rows(w: World = {}): Promise<MissingItemRow[]> {
  const report = await loadMissingItems(db(w), 1)
  assert.ok(report)
  return report.rows
}
const only = async (w: World = {}) => (await rows(w))[0]

test("M1. simple SO, nothing happened yet: everything is missing, no PO, cost n/a", async () => {
  const r = await only()
  assert.deepEqual([r.ordered, r.delivered, r.returned, r.netDelivered, r.missing, r.poOrdered, r.received], [10, 0, 0, 0, 10, 0, 0])
  assert.equal(r.unitCost, null)
  assert.equal(r.procurementStatus, "Stock Item — No PO Needed")
})

test("M2. one PO", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 4)], pos: [po(1)], poItems: [poi(1, 1, 1, 4)] })
  assert.equal(r.poOrdered, 4)
  assert.match(r.procurementStatus, /^Ordered 4\/4 — PO-1 \(4, approved\)/)
  assert.equal(r.missing, 4) // procurement never changes Missing
})

test("M3. multiple POs on one SO line are summed, not just detected", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1), po(2)], poItems: [poi(1, 1, 1, 4), poi(2, 2, 1, 5)] })
  assert.equal(r.poOrdered, 9)
  assert.match(r.procurementStatus, /^Partially ordered 9\/10/)
  assert.deepEqual(r.poLabels, ["PO-1 (4, approved)", "PO-2 (5, approved)"])
})

test("M4. partial PO (less than ordered) is reported as partial", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1)], poItems: [poi(1, 1, 1, 3)] })
  assert.equal(r.poOrdered, 3)
  assert.match(r.procurementStatus, /^Partially ordered 3\/10/)
})

test("M5. a rejected PO does not count; it asks for a reorder", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1, "rejected")], poItems: [poi(1, 1, 1, 10)] })
  assert.equal(r.poOrdered, 0)
  assert.match(r.procurementStatus, /^Rejected PO — Needs Reorder/)
  const mixed = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1, "rejected"), po(2)], poItems: [poi(1, 1, 1, 10), poi(2, 2, 1, 6)] })
  assert.equal(mixed.poOrdered, 6)
  assert.deepEqual(mixed.rejectedPoLabels, ["PO-1 (10, rejected)"])
})

test("M6. GRN received quantity", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1, "received")], poItems: [poi(1, 1, 1, 10)], grn: [grn(1, 10, 1, 1)] })
  assert.equal(r.received, 10)
})

test("M7. partial GRN", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1)], poItems: [poi(1, 1, 1, 10)], grn: [grn(1, 4, 1, 1)] })
  assert.deepEqual([r.poOrdered, r.received], [10, 4])
})

test("M8. a DRAFT delivery permit does not count as delivered", async () => {
  const r = await only({ permits: [dp(1, "DRAFT")], dpItems: [dpi(1, 10)] })
  assert.deepEqual([r.delivered, r.missing, r.inProgress], [0, 10, 0])
})

test("M9. a REJECTED delivery permit does not count as delivered", async () => {
  const r = await only({ permits: [dp(1, "REJECTED")], dpItems: [dpi(1, 10)] })
  assert.deepEqual([r.delivered, r.missing, r.inProgress], [0, 10, 0])
})

test("M10. valid delivered permits count; OUT_FOR_DELIVERY is its own column; other live permits are only noted", async () => {
  const r = await only({ permits: [dp(1, "APPROVED"), dp(2, "SUBMITTED_SIGNED"), dp(3, "OUT_FOR_DELIVERY"), dp(4, "READY_FOR_PICKUP")], dpItems: [dpi(1, 3), dpi(2, 2), dpi(3, 1), dpi(4, 2)] })
  assert.deepEqual([r.delivered, r.netDelivered, r.outForDelivery, r.missing, r.inProgress], [5, 5, 1, 4, 2])
})

test("M11. returns reduce net delivered and bring the quantity back to Missing", async () => {
  const r = await only({ permits: [dp(1, "APPROVED")], dpItems: [dpi(1, 10)], returns: [ret(1, 1, 3)] })
  assert.deepEqual([r.delivered, r.returned, r.netDelivered, r.missing], [10, 3, 7, 3])
})

test("M12. multiple returns add up; a rejected return releases its quantity", async () => {
  const r = await only({ permits: [dp(1, "APPROVED")], dpItems: [dpi(1, 10)], returns: [ret(1, 1, 2), ret(2, 1, 3), ret(3, 1, 4, 7, "Pump", "rejected")] })
  assert.deepEqual([r.returned, r.netDelivered, r.missing], [5, 5, 5])
})

test("M13. outsourced item: matched by name on the delivery permit", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 4)], permits: [dp(1, "APPROVED")], dpItems: [dpi(1, 4, null, "Borescope")] })
  assert.deepEqual([r.delivered, r.missing, r.isOutsourced, r.supplierName], [4, 0, true, "SMG"])
})

test("M14. outsourced item with a PO: the PO is matched by source_so_item_id", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 4), outLine(2, "Other", 2)], pos: [po(1)], poItems: [poi(1, 1, 1, 4)] })
  assert.equal(r.poOrdered, 4)
  const all = await rows({ lines: [outLine(1, "Borescope", 4), outLine(2, "Other", 2)], pos: [po(1)], poItems: [poi(1, 1, 1, 4)] })
  assert.equal(all[1].poOrdered, 0)
})

test("M15. outsourced item without a PO", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 4)] })
  assert.equal(r.procurementStatus, "Not Ordered — Needs PO")
  assert.equal(r.unitCost, null)
})

test("M16. item with no cost anywhere is n/a - and the selling price is never used", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 4, 99999)], pos: [po(1)], poItems: [poi(1, 1, 1, 4, 0)] })
  assert.equal(r.unitCost, null)
  assert.equal(r.costSource, null)
  const stock = await only({ lines: [stockLine(1, 7, 4, 123456)] })
  assert.equal(stock.unitCost, null)
})

test("M17. cost priority: PO landed cost > product last_landed_cost > inventory > n/a", async () => {
  const products = [{ product_id: 7, product_name: "Pump", sku: "P-7", last_landed_cost: 800 }]
  const inventory = [{ product_id: 7, quantity: 5, unit_cost: 700, is_returned: false }]
  // 1. a PO landed cost wins (landed_cost is the LINE total: 4 units, 4,000 -> 1,000 each)
  const withPo = await only({ lines: [{ ...stockLine(1, 7, 4), }], products, inventory, pos: [po(1)], poItems: [poi(1, 1, 1, 4, 4000)] })
  assert.deepEqual([withPo.unitCost, withPo.costSource], [1000, "po"])
  // 2. no PO landed cost -> product
  const withProduct = await only({ products, inventory })
  assert.deepEqual([withProduct.unitCost, withProduct.costSource], [800, "product"])
  // 3. no product cost -> inventory (returned stock rows are ignored)
  const withInv = await only({ inventory: [{ product_id: 7, quantity: 5, unit_cost: 700, is_returned: false }, { product_id: 7, quantity: 9, unit_cost: 1, is_returned: true }] })
  assert.deepEqual([withInv.unitCost, withInv.costSource], [700, "inventory"])
  // 4. a rejected PO's cost is not used
  const rejected = await only({ products, pos: [po(1, "rejected")], poItems: [poi(1, 1, 1, 4, 4000)] })
  assert.equal(rejected.costSource, "product")
})

test("M17b. several PO lines: quantity-weighted unit cost, costs are never summed", async () => {
  // 2 units @ 100 each (line total 200) + 8 units @ 200 each (line total 1,600) -> 1,800 / 10 = 180 per unit
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1), po(2)], poItems: [poi(1, 1, 1, 2, 200), poi(2, 2, 1, 8, 1600)] })
  assert.deepEqual([r.unitCost, r.costSource], [180, "po"])
  // a PO line with no landed cost yet is ignored, not treated as free: 8 units @ 200 only
  const partial = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1), po(2)], poItems: [poi(1, 1, 1, 2, 0), poi(2, 2, 1, 8, 1600)] })
  assert.equal(partial.unitCost, 200)
})

test("M17c. inventory cost is weighted by on-hand quantity across warehouses", async () => {
  const r = await only({ inventory: [{ product_id: 7, quantity: 1, unit_cost: 100, is_returned: false }, { product_id: 7, quantity: 3, unit_cost: 200, is_returned: false }] })
  assert.equal(r.unitCost, 175)
})

test("M18. zero selling price and zero quantities are handled", async () => {
  const r = await rows({ lines: [stockLine(1, 7, 3, 0), stockLine(2, 8, 0)], products: [{ product_id: 7, product_name: "A", sku: "A", last_landed_cost: null }, { product_id: 8, product_name: "B", sku: "B", last_landed_cost: null }] })
  assert.equal(r[0].missing, 3)
  assert.deepEqual([r[1].ordered, r[1].missing], [0, 0])
})

test("M19. NO JOIN MULTIPLICATION: 3 POs x 3 GRNs x 3 DPs x 2 returns on one line stay exact", async () => {
  const r = await only({
    lines: [outLine(1, "Borescope", 12)],
    pos: [po(1), po(2), po(3)],
    poItems: [poi(1, 1, 1, 4, 400), poi(2, 2, 1, 4, 800), poi(3, 3, 1, 4, 1200)],
    grn: [grn(1, 4, 1, 1), grn(2, 3, 1, 2), grn(3, 2, null, 3)], // the last one links only through its PO line
    permits: [dp(1, "APPROVED"), dp(2, "APPROVED"), dp(3, "SUBMITTED_SIGNED")],
    dpItems: [dpi(1, 3, null, "Borescope"), dpi(2, 3, null, "Borescope"), dpi(3, 3, null, "Borescope")],
    returns: [ret(1, 1, 1, null, "Borescope"), ret(2, 2, 2, null, "Borescope")],
  })
  assert.equal(r.poOrdered, 12) // 4 + 4 + 4, not 12 x anything
  assert.equal(r.received, 9) // 4 + 3 + 2
  assert.equal(r.delivered, 9)
  assert.equal(r.returned, 3)
  assert.equal(r.netDelivered, 6)
  assert.equal(r.missing, 6)
  assert.equal(r.unitCost, 200) // (400 + 800 + 1200) / 12
})

test("M19b. a GRN line reachable both ways (source_so_item_id AND po_item_id) is counted once", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 5)], pos: [po(1)], poItems: [poi(1, 1, 1, 5)], grn: [grn(1, 5, 1, 1)] })
  assert.equal(r.received, 5)
})

test("M19c. two SO lines for the same product share the delivered total once, not twice", async () => {
  const r = await rows({ lines: [stockLine(1, 7, 4), stockLine(2, 7, 6)], permits: [dp(1, "APPROVED")], dpItems: [dpi(1, 7)], returns: [ret(1, 1, 1)] })
  assert.deepEqual([r[0].delivered, r[1].delivered], [4, 3]) // 7 handed out in order: 4 then 3
  assert.equal(r[0].delivered + r[1].delivered, 7)
  assert.equal(r[0].returned + r[1].returned, 1)
  assert.equal(r[0].missing + r[1].missing, 4) // 10 ordered - 6 kept
})

test("M20. multiple DPs + returns; a return filed against an OUT_FOR_DELIVERY permit comes off Out for Delivery, not off Delivered", async () => {
  const r = await only({
    permits: [dp(1, "APPROVED"), dp(2, "SUBMITTED_SIGNED"), dp(3, "OUT_FOR_DELIVERY")],
    dpItems: [dpi(1, 4), dpi(2, 3), dpi(3, 3)],
    returns: [ret(1, 1, 1), ret(2, 2, 1), ret(3, 3, 1)],
  })
  // delivered 4+3 = 7, returned on them 2 -> net 5; out for delivery 3 - 1 returned = 2; missing = 10 - 5 - 2
  assert.deepEqual([r.delivered, r.returned, r.netDelivered, r.outForDelivery, r.missing], [7, 2, 5, 2, 3])
})

test("M21. historical RET-… returns and returns on other orders' permits are ignored", async () => {
  const r = await only({
    permits: [dp(1, "APPROVED")], dpItems: [dpi(1, 10)],
    returns: [{ header: { return_id: 9, permit_id: "RET-1790257022809", status: "pending_warehouse", created_at: "2026-01-01T00:00:00Z" }, items: [{ return_item_id: 9, return_id: 9, product_id: 7, product_name: "Pump", returned_quantity: 5 }] }, ret(10, 99, 4)],
  })
  assert.deepEqual([r.returned, r.missing], [0, 0])
})

test("M22. net delivered never goes negative", async () => {
  const r = await only({ permits: [dp(1, "APPROVED")], dpItems: [dpi(1, 2)], returns: [ret(1, 1, 5)] })
  assert.ok(r.netDelivered >= 0 && r.returned <= r.delivered)
  assert.equal(r.missing, 10)
})

test("M23. unknown SO -> null; a failing query throws instead of printing wrong numbers", async () => {
  assert.equal(await loadMissingItems(db(), 999), null)
  const broken = db()
  broken.failOn["purchase_order_items:select"] = "boom"
  await assert.rejects(() => loadMissingItems(broken, 1), /boom/)
})

test("M24. a receipt above the ordered PO quantity is shown with a warning, not hidden or clamped", async () => {
  const r = await only({ lines: [outLine(1, "Silicon gun", 5)], pos: [po(1, "received")], poItems: [poi(1, 1, 1, 5)], grn: [grn(1, 5, 1, 1), grn(2, 5, 1, 1)] })
  assert.equal(r.received, 10)
  assert.match(r.procurementStatus, /⚠ received 10 > PO 5/)
})

// ---- Out for Delivery (business correction) -------------------------------------------------------------------
test("O1. 10 ordered, 3 OUT_FOR_DELIVERY -> Missing 7", async () => {
  const r = await only({ permits: [dp(1, "OUT_FOR_DELIVERY")], dpItems: [dpi(1, 3)] })
  assert.deepEqual([r.ordered, r.outForDelivery, r.delivered, r.returned, r.netDelivered, r.missing], [10, 3, 0, 0, 0, 7])
})

test("O2. 10 ordered, 3 OUT_FOR_DELIVERY + 4 delivered -> Missing 3", async () => {
  const r = await only({ permits: [dp(1, "OUT_FOR_DELIVERY"), dp(2, "APPROVED")], dpItems: [dpi(1, 3), dpi(2, 4)] })
  assert.deepEqual([r.outForDelivery, r.delivered, r.netDelivered, r.missing], [3, 4, 4, 3])
})

test("O3. the spec example: 10 ordered, 3 OFD, 4 delivered, 1 returned -> Net Delivered 3, Missing 4", async () => {
  const r = await only({ permits: [dp(1, "OUT_FOR_DELIVERY"), dp(2, "SUBMITTED_SIGNED")], dpItems: [dpi(1, 3), dpi(2, 4)], returns: [ret(1, 2, 1)] })
  assert.deepEqual([r.ordered, r.outForDelivery, r.delivered, r.returned, r.netDelivered, r.missing], [10, 3, 4, 1, 3, 4])
})

test("O4. DRAFT permits are neither Out for Delivery nor Delivered", async () => {
  const r = await only({ permits: [dp(1, "DRAFT")], dpItems: [dpi(1, 6)] })
  assert.deepEqual([r.outForDelivery, r.delivered, r.missing], [0, 0, 10])
})

test("O5. REJECTED permits are neither Out for Delivery nor Delivered", async () => {
  const r = await only({ permits: [dp(1, "REJECTED")], dpItems: [dpi(1, 6)] })
  assert.deepEqual([r.outForDelivery, r.delivered, r.missing], [0, 0, 10])
})

test("O6. several OUT_FOR_DELIVERY permits aggregate (once each)", async () => {
  const r = await only({ permits: [dp(1, "OUT_FOR_DELIVERY"), dp(2, "OUT_FOR_DELIVERY"), dp(3, "OUT_FOR_DELIVERY")], dpItems: [dpi(1, 2), dpi(2, 3), dpi(3, 1)] })
  assert.deepEqual([r.outForDelivery, r.missing], [6, 4])
})

test("O7. OFD + several delivered permits + returns on both: no join multiplication, exact figures", async () => {
  const r = await only({
    lines: [outLine(1, "Borescope", 20)],
    pos: [po(1), po(2)], poItems: [poi(1, 1, 1, 10, 1000), poi(2, 2, 1, 10, 3000)],
    grn: [grn(1, 6, 1, 1), grn(2, 4, 1, 2)],
    permits: [dp(1, "OUT_FOR_DELIVERY"), dp(2, "OUT_FOR_DELIVERY"), dp(3, "APPROVED"), dp(4, "SUBMITTED_SIGNED"), dp(5, "APPROVED"), dp(6, "DRAFT")],
    dpItems: [dpi(1, 2, null, "Borescope"), dpi(2, 3, null, "Borescope"), dpi(3, 4, null, "Borescope"), dpi(4, 2, null, "Borescope"), dpi(5, 1, null, "Borescope"), dpi(6, 9, null, "Borescope")],
    returns: [ret(1, 3, 1, null, "Borescope"), ret(2, 4, 1, null, "Borescope"), ret(3, 2, 1, null, "Borescope"), ret(4, 5, 5, null, "Borescope", "rejected")],
  })
  assert.equal(r.outForDelivery, 4) // 2 + 3 - 1 returned on permit 2
  assert.equal(r.delivered, 7) // 4 + 2 + 1
  assert.equal(r.returned, 2)
  assert.equal(r.netDelivered, 5)
  assert.equal(r.missing, 11) // 20 - 5 - 4
  assert.equal(r.poOrdered, 20)
  assert.equal(r.received, 10)
  assert.equal(r.unitCost, 200) // (1000 + 3000) / 20
})

test("O8. Missing never goes negative when out-for-delivery + delivered exceed the order", async () => {
  const r = await only({ permits: [dp(1, "OUT_FOR_DELIVERY"), dp(2, "APPROVED")], dpItems: [dpi(1, 8), dpi(2, 8)] })
  assert.equal(r.missing, 0)
})

test("C1. PO Price fallback: no landed cost, no product cost, no inventory -> the PO unit price, labelled po_price", async () => {
  const r = await only({ lines: [outLine(1, "Borescope", 4, 99999)], pos: [po(1)], poItems: [poi(1, 1, 1, 4, 0, 750)] })
  assert.deepEqual([r.unitCost, r.costSource], [750, "po_price"])
})

test("C2. PO Price is quantity-weighted across PO lines, never summed; rejected POs are ignored", async () => {
  // 2 @ 100 + 8 @ 200 -> (200 + 1600) / 10 = 180
  const r = await only({ lines: [outLine(1, "Borescope", 10)], pos: [po(1), po(2), po(3, "rejected")], poItems: [poi(1, 1, 1, 2, 0, 100), poi(2, 2, 1, 8, 0, 200), poi(3, 3, 1, 50, 0, 9999)] })
  assert.deepEqual([r.unitCost, r.costSource], [180, "po_price"])
})

test("C3. priority: landed cost beats product cost beats inventory beats PO Price beats n/a", async () => {
  const products = [{ product_id: 7, product_name: "Pump", sku: "P", last_landed_cost: 800 }]
  const inventory = [{ product_id: 7, quantity: 5, unit_cost: 700, is_returned: false }]
  const base = { lines: [stockLine(1, 7, 4)], pos: [po(1)] }
  assert.equal((await only({ ...base, products, inventory, poItems: [poi(1, 1, 1, 4, 4000, 500)] })).costSource, "po")
  assert.equal((await only({ ...base, products, inventory, poItems: [poi(1, 1, 1, 4, 0, 500)] })).costSource, "product")
  assert.equal((await only({ ...base, inventory, poItems: [poi(1, 1, 1, 4, 0, 500)] })).costSource, "inventory")
  assert.equal((await only({ ...base, poItems: [poi(1, 1, 1, 4, 0, 500)] })).costSource, "po_price")
  assert.equal((await only({ ...base })).unitCost, null)
})

test("C4. mixed lines: a line with landed cost uses it alone; PO price is used only when NO line has a landed cost", async () => {
  const r = await only({ lines: [outLine(1, "B", 10)], pos: [po(1), po(2)], poItems: [poi(1, 1, 1, 5, 1000, 50), poi(2, 2, 1, 5, 0, 999)] })
  assert.deepEqual([r.unitCost, r.costSource], [200, "po"]) // 1000 / 5, the PO-price-only line is not blended in
})
