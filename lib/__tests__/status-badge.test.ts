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
  for (const v of [null, undefined, "", "partially_paid", "something_else"]) assert.equal(statusTone(v as any), "neutral")
})
