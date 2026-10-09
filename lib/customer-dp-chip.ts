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

/**
 * Customers tab: the per-item delivery chip. Returns are taken off the confirmed delivered quantity, so a returned
 * item would otherwise read "Not delivered"; when what was delivered and then returned accounts for the line, the
 * chip shows only what the customer still has (or nothing, next to the "Returned (N)" badge, when all of it came back).
 */
export function itemDeliveryChip(item: {
  quantity: number
  deliveryState?: string | null
  confirmedDeliveredQuantity?: number
  returnedQuantity?: number
}): PermitChip | null {
  const quantity = Number(item.quantity) || 0
  const kept = Number(item.confirmedDeliveredQuantity) || 0
  const returned = Number(item.returnedQuantity) || 0
  if (returned > 0 && kept + returned >= quantity) {
    if (quantity > 0 && kept >= quantity) return { label: "Delivered", tone: "green" }
    if (kept > 0) return { label: `Delivered ${kept}/${quantity}`, tone: "orange" }
    return null
  }
  if (!item.deliveryState) return null
  if (item.deliveryState === "delivered") return { label: "Delivered", tone: "green" }
  if (item.deliveryState === "partial") return { label: `Partially delivered (${kept}/${quantity})`, tone: "orange" }
  return { label: "Not delivered", tone: "yellow" }
}
