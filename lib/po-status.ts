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
