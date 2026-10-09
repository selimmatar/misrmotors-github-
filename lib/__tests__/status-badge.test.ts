// Status pill tones (spec §3): every SO status, the other listed statuses, and odd inputs.
import test from "node:test"
import assert from "node:assert/strict"
import { statusTone, type StatusTone } from "../status-tone"
import { SO_STATUS_VALUES } from "../enums"

const EXPECTED: Record<string, StatusTone> = {
  draft_quotation: "neutral", pending_approval: "waiting", approved_quotation: "approved", rejected_quotation: "danger",
  expired_quotation: "danger", draft: "neutral", pending: "waiting", pending_accountant: "waiting",
  accountant_approved: "approved", ready_for_delivery: "ready", shipped: "ready", delivered: "done", cancelled: "danger",
}

test("every SO status has its tone", () => {
  assert.equal(SO_STATUS_VALUES.length, Object.keys(EXPECTED).length)
  for (const s of SO_STATUS_VALUES) assert.equal(statusTone(s), EXPECTED[s], s)
})

test("other listed statuses", () => {
  assert.equal(statusTone("pending_ceo"), "waiting")
  assert.equal(statusTone("approved"), "approved")
  assert.equal(statusTone("paid"), "done")
  assert.equal(statusTone("received"), "done")
  assert.equal(statusTone("overdue"), "danger")
})

test("odd inputs", () => {
  assert.equal(statusTone("DELIVERED"), "done")
  for (const v of [null, undefined, "", "something_else"]) assert.equal(statusTone(v as any), "neutral")
})

test("other record statuses get a tone, not draft grey", () => {
  for (const s of ["rejected", "voided", "discrepancy"]) assert.equal(statusTone(s), "danger", s)
  assert.equal(statusTone("received_with_issues"), "waiting")
  assert.equal(statusTone("partially_paid"), "approved")
  assert.equal(statusTone("OUT_FOR_DELIVERY"), "ready")
  // Every other workflow status the DB allows (lib/enums.ts CHECK lists).
  const MORE: Record<string, StatusTone> = {
    expired: "danger", sent: "waiting", submitted_signed: "waiting", accepted: "approved",
    partial: "approved", partially_received: "approved", ready_for_shipment: "ready", printed: "ready",
    ready_for_pickup: "ready", complete: "done",
  }
  for (const [s, tone] of Object.entries(MORE)) assert.equal(statusTone(s), tone, s)
})

test("1b tones", () => {
  const T: Record<string, string> = { "due-soon": "waiting", pending_warehouse: "waiting", partially_delivered: "approved",
    not_delivered: "neutral", fully_paid: "done", not_paid: "danger", unpaid: "danger", no_invoice: "neutral" }
  for (const [s, tone] of Object.entries(T)) { assert.equal(statusTone(s), tone, s); assert.equal(statusTone(s.toUpperCase()), tone, s) }
})
