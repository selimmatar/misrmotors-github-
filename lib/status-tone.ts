// Status pill tone for any record status (spec §3). Unknown or empty statuses are neutral; nothing throws.
export type StatusTone = "neutral" | "waiting" | "approved" | "ready" | "done" | "danger"

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  draft_quotation: "neutral",
  pending: "waiting",
  pending_accountant: "waiting",
  pending_approval: "waiting",
  pending_ceo: "waiting",
  accountant_approved: "approved",
  approved: "approved",
  approved_quotation: "approved",
  ready_for_delivery: "ready",
  shipped: "ready",
  delivered: "done",
  paid: "done",
  received: "done",
  cancelled: "danger",
  rejected_quotation: "danger",
  expired_quotation: "danger",
  overdue: "danger",
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral"
  return STATUS_TONE[status.toLowerCase()] ?? "neutral"
}
