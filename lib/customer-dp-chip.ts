// Customers tab: the per-permit "Delivered / Pending" chip. Delivered statuses come from the shared
// DP_DELIVERED_STATUSES (the same list isSOFullyDelivered uses). Returned goods are no longer delivered, so a
// delivered chip is flagged with the quantity returned against THAT permit (not the whole order) instead of being
// shown as plainly delivered; permits without returns stay plainly "Delivered".
import { DP_DELIVERED_STATUSES } from "./delivery-status"

export type PermitChip = { label: string; tone: "green" | "orange" | "yellow" }

export function permitChip(status: string | null | undefined, permitReturnedQuantity: number): PermitChip {
  if (!DP_DELIVERED_STATUSES.includes(String(status ?? ""))) return { label: "Pending", tone: "yellow" }
  const returned = Number(permitReturnedQuantity) || 0
  if (returned > 0) return { label: `Delivered (${returned} returned)`, tone: "orange" }
  return { label: "Delivered", tone: "green" }
}
