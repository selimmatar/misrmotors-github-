// Status pill tone for any record status (spec §3). Unknown or empty statuses are neutral; nothing throws.
export type StatusTone = "neutral" | "waiting" | "approved" | "ready" | "done" | "danger"

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  draft_quotation: "neutral",
  pending: "waiting",
  pending_accountant: "waiting",
  pending_approval: "waiting",
  pending_ceo: "waiting",
  sent: "waiting",
  submitted_signed: "waiting",
  received_with_issues: "waiting",
  accountant_approved: "approved",
  approved: "approved",
  approved_quotation: "approved",
  accepted: "approved",
  partial: "approved",
  partially_paid: "approved",
  partially_received: "approved",
  ready_for_delivery: "ready",
  shipped: "ready",
  ready_for_shipment: "ready",
  printed: "ready",
  ready_for_pickup: "ready",
  out_for_delivery: "ready",
  delivered: "done",
  paid: "done",
  received: "done",
  complete: "done",
  cancelled: "danger",
  rejected_quotation: "danger",
  expired_quotation: "danger",
  overdue: "danger",
  rejected: "danger",
  expired: "danger",
  voided: "danger",
  discrepancy: "danger",
  "due-soon": "waiting",
  pending_warehouse: "waiting",
  partially_delivered: "approved",
  not_delivered: "neutral",
  fully_paid: "done",
  not_paid: "danger",
  unpaid: "danger",
  no_invoice: "neutral",
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral"
  return STATUS_TONE[status.toLowerCase()] ?? "neutral"
}
