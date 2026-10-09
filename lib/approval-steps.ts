// Sales-order approval progress (spec §4.4): accountant → warehouse → shipping → delivered.
// Quotation, cancelled and unknown statuses have no approval track and return null.
export const APPROVAL_STEPS = ["accountant", "warehouse", "shipping", "delivered"] as const
export type ApprovalStep = (typeof APPROVAL_STEPS)[number]

export interface ApprovalState {
  done: number
  current: ApprovalStep | null
}

const STATE: Record<string, ApprovalState> = {
  draft: { done: 0, current: null },
  pending: { done: 0, current: "accountant" },
  pending_accountant: { done: 0, current: "accountant" },
  accountant_approved: { done: 1, current: "warehouse" },
  ready_for_delivery: { done: 2, current: "shipping" },
  shipped: { done: 3, current: "delivered" },
  delivered: { done: 4, current: null },
}

export function approvalState(status: string | null | undefined): ApprovalState | null {
  if (!status) return null
  const state = STATE[status.toLowerCase()]
  return state ? { ...state } : null
}

export function approvalAriaLabel(state: ApprovalState, t: (key: string) => string): string {
  const title = t("approval.title")
  if (state.current) {
    return `${title}: ${t("approval.step")} ${state.done + 1} ${t("approval.of")} ${APPROVAL_STEPS.length}, ${t(`approval.${state.current}`)}`
  }
  return `${title}: ${t(state.done >= APPROVAL_STEPS.length ? "approval.complete" : "approval.not-started")}`
}
