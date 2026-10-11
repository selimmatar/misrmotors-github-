// Who may edit a sales order, and which of its lines are locked.
//   * Sales Rep and Admin can edit an order in any status except a cancelled / rejected one.
//   * A line whose item is on a delivery permit is locked (product, quantity, price, delete): the warehouse has
//     already committed it. Extra quantity or a different item goes on a new line.
//   * Exception: a line with a return keeps the exchange rules of lib/so-edit.ts (it can be lowered to what the
//     customer keeps, and the replacement is added as a new line).
// The server enforces the same rules in validateSoEdit.
export const SO_EDIT_ROLES = ["sales-rep", "admin"]
export const SO_NOT_EDITABLE_STATUSES = ["cancelled", "rejected_quotation"]

export function canEditSalesOrder(role: string | null | undefined, status: string | null | undefined): boolean {
  return SO_EDIT_ROLES.includes(String(role || "")) && !SO_NOT_EDITABLE_STATUSES.includes(String(status || ""))
}

export function isLineLocked(item: { onDeliveryPermit?: boolean; returnedQuantity?: number }): boolean {
  return !!item.onDeliveryPermit && !(Number(item.returnedQuantity || 0) > 0)
}
