// Owner report 2026-11-25: "Reject receipt" did nothing (an approved PO cannot become "rejected"); after a partial
// receipt the receiving card still showed the full quantities. Decision: reject = refuse this delivery, PO stays open.
import { useDb } from "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { allows, ruleFor } from "../auth/permissions"
import * as refuseRoute from "../../app/api/goods-receipts/refuse/route"

const REPO = process.env.REPO_ROOT || process.cwd()
const rq = (body: unknown, role = "warehouse-rep"): any =>
  new Request("http://test.local/api/goods-receipts/refuse", { method: "POST", headers: { "content-type": "application/json", "x-mm-roles": role, "x-mm-user-id": "7" }, body: JSON.stringify(body) })

function db() {
  const d = new FakeDb({
    users: [{ user_id: 7 }],
    purchase_orders: [
      { po_id: 1, po_number: "PO-1", status: "approved", total: 500 },
      { po_id: 2, po_number: "PO-2", status: "partially_received", total: 900 },
      { po_id: 3, po_number: "PO-3", status: "pending", total: 100 },
    ],
    workflow_events: [],
  })
  d.jitter = false
  useDb(d)
  return d
}

test("GR1. refusing a delivery: reason saved as a PO note and a history event; the order stays open; money untouched", async () => {
  const d = db()
  const res = await refuseRoute.POST(rq({ id: 1, reason: "Damaged boxes" }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, poNumber: "PO-1", status: "approved" })
  assert.equal(d.tables.purchase_orders[0].status, "approved")
  assert.equal(d.tables.purchase_orders[0].total, 500)
  const notes = d.tables.workflow_events.filter((e) => e.event_type === "NOTE")
  assert.equal(notes.length, 1)
  assert.equal(notes[0].entity_type, "PURCHASE_ORDER")
  assert.equal(notes[0].entity_id, 1)
  assert.match(notes[0].notes, /Damaged boxes/)
  assert.equal(notes[0].performed_by, 7)
  assert.equal(d.tables.workflow_events.filter((e) => e.event_type === "DELIVERY_REFUSED").length, 1)
  assert.equal((await refuseRoute.POST(rq({ id: 2, reason: "Wrong item" }))).status, 200, "a partly received order too")
})

test("GR2. refused: no reason, unknown order, an order not waiting for goods; nothing written", async () => {
  const d = db()
  assert.equal((await refuseRoute.POST(rq({ id: 1, reason: "  " }))).status, 400)
  assert.equal((await refuseRoute.POST(rq({ id: 99, reason: "x" }))).status, 404)
  assert.equal((await refuseRoute.POST(rq({ id: 3, reason: "x" }))).status, 409)
  assert.equal(d.tables.workflow_events.length, 0)
})

test("GR3. the warehouse may refuse (goods-receipts rule); sales may not", () => {
  const rule = ruleFor("/api/goods-receipts/refuse")!
  assert.equal(allows(rule, "POST", ["warehouse-rep"] as any), true)
  assert.equal(allows(rule, "POST", ["sales-rep"] as any), false)
})

test("GR4. the screen calls the refuse route and reports failures; the card shows only what is still to come", () => {
  const src = readFileSync(join(REPO, "components/modules/goods-receipt-module.tsx"), "utf8")
  assert.match(src, /fetch\("\/api\/goods-receipts\/refuse"/)
  assert.ok(!/status: "rejected" as const/.test(src), "no longer tries to set an approved PO to rejected")
  assert.match(src, /if \(!res\.ok\) \{\s*alert\(fill\(t\("gr\.refuse-failed"\)/)
  assert.match(src, /const left = Math\.max\(0, ordered - received\)\s*if \(received > 0 && left <= 0\) return null/)
  assert.match(src, /setReceivedVersion\(\(v\) => v \+ 1\)/, "refreshed after receiving")
})
