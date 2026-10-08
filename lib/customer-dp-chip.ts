// Customers tab: the per-permit "Delivered / Pending" chip. Delivered statuses come from the shared
// DP_DELIVERED_STATUSES (the same list isSOFullyDelivered uses). Returned goods are no longer delivered, and the
// API reports returns per sales order line (not per permit), so a delivered chip on an order with returns is
// flagged with the returned quantity instead of being shown as plainly delivered.
import { DP_DELIVERED_STATUSES } from "./delivery-status"

export type PermitChip = { label: string; tone: "green" | "orange" | "yellow" }

export function permitChip(status: string | null | undefined, orderReturnedQuantity: number): PermitChip {
  if (!DP_DELIVERED_STATUSES.includes(String(status ?? ""))) return { label: "Pending", tone: "yellow" }
  const returned = Number(orderReturnedQuantity) || 0
  if (returned > 0) return { label: `Delivered (${returned} returned on this order)`, tone: "orange" }
  return { label: "Delivered", tone: "green" }
}
