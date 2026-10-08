// Create-DP dialog: which existing delivery permits count as "already planned" for a sales order. A REJECTED
// permit never ships, so its quantity can be planned again. Every other status still counts as planned (the
// dialog caps new permits at ordered minus planned); this is the planning view, whereas isSOFullyDelivered in
// lib/delivery-status.ts decides "delivered" from SUBMITTED_SIGNED/APPROVED permits only and is unchanged.
export const isPlannedPermit = (permit: { status?: string | null } | null | undefined): boolean =>
  String(permit?.status ?? "").toUpperCase() !== "REJECTED"
