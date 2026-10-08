// Purchase-order status transitions allowed through PUT /api/purchase-orders.
// Receiving statuses (partially_received / received / received_with_issues) are written only by goods receiving
// (lib/goods-receiving.ts), never through the PO edit route.
export const PO_PUT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["pending"],
  pending: ["approved", "rejected"],
}

/** Statuses in which the line items of a PO may still be replaced (before approval). */
export const PO_ITEMS_EDITABLE_STATUSES: readonly string[] = ["draft", "pending"]

/** True when moving from `from` to `to` is allowed. An unchanged status is always allowed (no-op). */
export function isAllowedPoTransition(from: string, to: string): boolean {
  if (from === to) return true
  return (PO_PUT_TRANSITIONS[from] || []).includes(to)
}

/**
 * Columns restored when an approval is undone after the AP invoice failed: the status, the approval fields and the
 * rejection reason go back to what the PO had before this request, together with every other column this request
 * changed, so the order does not keep a half-applied approval.
 */
export function buildApprovalRevert(current: any, appliedUpdates: Record<string, any>): Record<string, any> {
  const revert: Record<string, any> = {}
  for (const key of Object.keys(appliedUpdates)) {
    if (key in current) revert[key] = current[key] ?? null
  }
  revert.status = current.status
  revert.approved_at = current.approved_at ?? null
  revert.approved_by = current.approved_by ?? null
  revert.rejection_reason = current.rejection_reason ?? null
  return revert
}
