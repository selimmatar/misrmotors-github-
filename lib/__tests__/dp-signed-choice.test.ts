// Owner request 2026-11-26: the shipping user uploads several photos of the signed delivery permit and ticks which
// ones are sent for approval. The others are kept (SIGNED_PERMIT_UNUSED): the approver does not see them and the
// invoice e-mail does not attach them.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as dpRoute from "../../app/api/delivery-permits/route"
import { chosenFileIds, sentSignedFiles, UNUSED_SIGNED_FILE } from "../dp-signed-choice"
import { signedPermitCopies } from "../eta/signed-permits"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")

function dpDb(files: Row[]) {
  const db = new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-C-1", customer_id: 5, status: "ready_for_delivery", fulfillment_status: "OUT_FOR_DELIVERY", total: 0 }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 7, quantity: 5, item_type: "stock", unit_price: 100, total: 500 }],
    customers: [{ customer_id: 5, customer_name: "BYD" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-2026-0005", sales_order_id: 1, customer_id: 5, status: "OUT_FOR_DELIVERY", created_at: "2026-11-20T09:00:00Z" }],
    delivery_permit_items: [{ item_id: 1, permit_id: 1, product_id: 7, item_name_snapshot: "Pump", sku_snapshot: "P-7", quantity: 5, unit_price: 100, total: 500, warehouse_id: 1 }],
    delivery_permit_files: files,
    inventory: [{ inventory_id: 1, product_id: 7, warehouse_id: 1, quantity: 50, is_returned: false, unit_cost: 5 }],
    inventory_transactions: [], idempotency_log: [], workflow_events: [], users: [{ user_id: 3 }],
    product_returns: [], return_items: [], suppliers: [], invoice_delivery_permits: [], accounts_receivable: [],
  })
  useDb(db)
  return db
}
const file = (id: number, type = "SIGNED_PERMIT", permit = 1): Row => ({ file_id: id, permit_id: permit, file_type: type, file_url: `https://blob.test/${id}.jpg`, file_name: `${id}.jpg`, uploaded_at: "2026-11-26T08:00:00Z" })
const put = (extra: Row = {}) => call(dpRoute.PUT, "PUT", { permitId: "1", action: "MARK_SUBMITTED_SIGNED", ...extra })
const types = (db: FakeDb) => Object.fromEntries(db.tables.delivery_permit_files.map((f) => [f.file_id, f.file_type]))

test("C1 the ticked photos are sent; the others and an earlier round's photo are kept unused", async () => {
  const db = dpDb([file(1), file(2), file(3, UNUSED_SIGNED_FILE), file(4)])
  const r = await put({ signedFileIds: ["2", "3"] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.delivery_permits[0].status, "SUBMITTED_SIGNED")
  assert.deepEqual(types(db), { 1: UNUSED_SIGNED_FILE, 2: "SIGNED_PERMIT", 3: "SIGNED_PERMIT", 4: UNUSED_SIGNED_FILE })
})

test("C2 no ticked photo, or a photo of another permit, is refused and nothing changes", async () => {
  for (const ids of [[], ["x"], ["9"]]) {
    const db = dpDb([file(1), file(2), file(9, "SIGNED_PERMIT", 2)])
    const r = await put({ signedFileIds: ids })
    assert.equal(r.status, 400, `ids ${JSON.stringify(ids)}`)
    assert.ok(r.body.errorAr)
    assert.equal(db.tables.delivery_permits[0].status, "OUT_FOR_DELIVERY")
    assert.deepEqual(types(db), { 1: "SIGNED_PERMIT", 2: "SIGNED_PERMIT", 9: "SIGNED_PERMIT" })
    assert.equal(db.tables.inventory[0].quantity, 50, "no stock moved")
  }
})

test("C3 an older screen that sends no choice keeps every upload (as before)", async () => {
  const db = dpDb([file(1), file(2)])
  assert.equal((await put()).status, 200)
  assert.deepEqual(types(db), { 1: "SIGNED_PERMIT", 2: "SIGNED_PERMIT" })
})

test("C4 the approver sees and the invoice e-mail attaches only the sent photos", async () => {
  assert.deepEqual(sentSignedFiles([{ id: "1", fileType: "SIGNED_PERMIT" }, { id: "2", fileType: UNUSED_SIGNED_FILE }]).map((f) => f.id), ["1"])
  assert.deepEqual(chosenFileIds(["2", 2, "3"]), [2, 3])
  assert.equal(chosenFileIds(undefined), null)
  const db = new FakeDb({ delivery_permit_files: [file(1), file(2, UNUSED_SIGNED_FILE)] })
  const copies = await signedPermitCopies(db as any, [{ permit_id: 1, permit_no: "DP-1" }], async () => ({ bytes: Buffer.from("x"), type: "application/pdf" }))
  const names = JSON.stringify(copies)
  assert.ok(names.includes("1.jpg") || names.includes("blob.test/1"), names)
  assert.ok(!names.includes("blob.test/2") && !names.includes("2.jpg"), names)
})

test("C5 the screens send the tick: upload marks unticked photos, both upload screens pass the chosen ids", () => {
  assert.match(src("app/api/delivery-permits/upload/route.ts"), /formData\.get\("chosen"\) === "0" \? UNUSED_SIGNED_FILE/)
  for (const p of ["components/modules/shipping-module.tsx", "components/delivery-permit/delivery-permit-card.tsx"]) {
    assert.match(src(p), /signedFileIds/, p)
  }
  for (const p of ["components/modules/shipping-module.tsx", "components/delivery-permit/signed-upload-widget.tsx"]) {
    assert.match(src(p), /onSkippedChange=\{set/, p)
  }
  for (const p of ["components/delivery-permit/delivery-permit-card.tsx", "components/delivery-permit/permit-preview-dialog.tsx"]) {
    assert.match(src(p), /sentSignedFiles\(permit\.files\)/, p)
  }
})
