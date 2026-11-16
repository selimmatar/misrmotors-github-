// The one-word e-invoice state shown on each receivables row (spec §9), worked out from the invoice's documents on the
// selected portal. Kept pure so the route and the tests share it.
import { cancelPending } from "./send"

export type EtaBadgeKey =
  | "not_sent" | "waiting" | "sent" | "valid" | "invalid" | "cancel_requested" | "cancelled"
  | "credit_waiting" | "credited" | "credit_invalid" | "manual"

interface DocRow { doc_id?: number; document_type?: string | null; status?: string | null; errors?: unknown }

const latest = (rows: DocRow[]) => [...rows].sort((a, b) => Number(b.doc_id) - Number(a.doc_id))[0]

export function invoiceBadge(docs: DocRow[]): EtaBadgeKey {
  const invoices = docs.filter((d) => (d.document_type || "I") !== "C")
  const notes = docs.filter((d) => d.document_type === "C")
  const note = latest(notes)
  if (note?.status === "valid") return "credited"
  const inv = latest(invoices)
  if (inv?.status === "manual") return "manual"
  if (note?.status === "pending_signature" || note?.status === "submitted") return "credit_waiting"
  if (note?.status === "invalid" && inv?.status === "valid") return "credit_invalid"
  if (!inv) return "not_sent"
  if (inv.status === "pending_signature") return "waiting"
  if (inv.status === "submitted") return "sent"
  if (inv.status === "valid") return "valid"
  if (inv.status === "invalid") return "invalid"
  if (inv.status === "cancelled") return cancelPending({ status: inv.status, errors: inv.errors }) ? "cancel_requested" : "cancelled"
  return "not_sent"
}
