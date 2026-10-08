// Delivery-permit actions and the statuses each one may start from (PUT /api/delivery-permits).
// Lifecycle: DRAFT -> READY_FOR_SHIPMENT -> (PRINTED) -> READY_FOR_PICKUP -> OUT_FOR_DELIVERY -> SUBMITTED_SIGNED -> APPROVED,
// plus REJECTED. The sets below are what the UI really offers today:
//  - delivery-permit-card: MARK_READY_FOR_PICKUP and MARK_PRINTED from DRAFT, MARK_OUT_FOR_DELIVERY from PRINTED /
//    READY_FOR_PICKUP, MARK_SUBMITTED_SIGNED from OUT_FOR_DELIVERY, APPROVE / REJECT from SUBMITTED_SIGNED;
//  - warehouse-delivery-module: ALLOCATE_WAREHOUSES from DRAFT, MARK_READY_FOR_PICKUP from READY_FOR_SHIPMENT;
//  - shipping-module: MARK_OUT_FOR_DELIVERY from PRINTED / READY_FOR_PICKUP, MARK_SUBMITTED_SIGNED from OUT_FOR_DELIVERY.
// MARK_READY_FOR_PICKUP is also allowed from DRAFT (the permit card skips the allocation step) and from PRINTED
// (lifecycle order). An APPROVED permit is refused earlier by the DP_ALREADY_APPROVED guard.
const NON_FINAL = ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "SUBMITTED_SIGNED"] as const

export const DP_ACTION_FROM: Record<string, readonly string[]> = {
  ALLOCATE_WAREHOUSES: ["DRAFT", "READY_FOR_SHIPMENT"],
  MARK_READY_FOR_PICKUP: ["DRAFT", "READY_FOR_SHIPMENT", "PRINTED"],
  MARK_PRINTED: ["DRAFT", "READY_FOR_SHIPMENT"],
  MARK_OUT_FOR_DELIVERY: ["PRINTED", "READY_FOR_PICKUP"],
  MARK_SUBMITTED_SIGNED: ["OUT_FOR_DELIVERY"],
  APPROVE: ["SUBMITTED_SIGNED", "APPROVED"], // APPROVED -> APPROVE is the existing idempotent repeat
  REJECT: NON_FINAL,
}

/** True when `action` may run on a permit currently in `from`. Actions not listed (UPDATE_DETAILS, unknown) are not guarded here. */
export function isAllowedDpTransition(from: string, action: string): boolean {
  const allowed = DP_ACTION_FROM[action]
  return !allowed || allowed.includes(from)
}
