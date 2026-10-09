// Approval-step state for sales orders (spec §4.4): accountant → warehouse → shipping → delivered.
import test from "node:test"
import assert from "node:assert/strict"
import { approvalState, approvalAriaLabel, type ApprovalState } from "../approval-steps"
import { SO_STATUS_VALUES } from "../enums"

const ROWS: Array<[string, ApprovalState | null]> = [
  ["draft", { done: 0, current: null }], ["pending", { done: 0, current: "accountant" }],
  ["pending_accountant", { done: 0, current: "accountant" }], ["accountant_approved", { done: 1, current: "warehouse" }],
  ["ready_for_delivery", { done: 2, current: "shipping" }], ["shipped", { done: 3, current: "delivered" }],
  ["delivered", { done: 4, current: null }], ["cancelled", null], ["draft_quotation", null], ["pending_approval", null],
  ["approved_quotation", null], ["rejected_quotation", null], ["expired_quotation", null],
]

test("every SO status row in spec §4.4", () => {
  for (const [s, want] of ROWS) assert.deepEqual(approvalState(s), want, s)
  assert.deepEqual(ROWS.map(([s]) => s).sort(), [...SO_STATUS_VALUES].sort())
  assert.equal(approvalState("nonsense"), null)
  assert.equal(approvalState(null), null)
  assert.equal(approvalState("SHIPPED")?.current, "delivered")
})

test("accessible label", () => {
  const t = (k: string) => ({ "approval.title": "Approval", "approval.step": "step", "approval.of": "of",
    "approval.warehouse": "Warehouse", "approval.complete": "complete", "approval.not-started": "not started" } as Record<string, string>)[k] ?? k
  assert.equal(approvalAriaLabel({ done: 1, current: "warehouse" }, t), "Approval: step 2 of 4, Warehouse")
  assert.equal(approvalAriaLabel({ done: 4, current: null }, t), "Approval: complete")
  assert.equal(approvalAriaLabel({ done: 0, current: null }, t), "Approval: not started")
})
