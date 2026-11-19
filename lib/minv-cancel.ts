// Cancel a maintenance (MINV) invoice (owner request, 2026-11-20). The row is kept for history with status
// "cancelled" and its photo, but it gives its printed number back: invoice_number becomes "X<id>-<number>" (outside
// the MINV sequence and the UNIQUE index) and the number is kept in cancelled_number, so the same page can be uploaded
// and invoiced again. Refused once money was collected or while the invoice is on the tax portal.
import { knownUserId } from "./po-history"
import { parseMinvNumber } from "./invoice-codes"

type Db = any
export type CancelMinvResult = { ok: true; invoiceNumber: string } | { ok: false; status: number; code: string; error: string }

export const MAX_CANCEL_REASON = 300
const fail = (status: number, code: string, error: string): CancelMinvResult => ({ ok: false, status, code, error })

export async function cancelMinvInvoice(db: Db, invoiceId: number, rawReason: unknown, userId: unknown): Promise<CancelMinvResult> {
  const reason = String(rawReason ?? "").trim().slice(0, MAX_CANCEL_REASON)
  if (!reason) return fail(400, "NO_REASON", "Write why the invoice is cancelled.")

  const { data: inv, error } = await db
    .from("accounts_receivable")
    .select("invoice_id, invoice_number, status, collected_amount")
    .eq("invoice_id", invoiceId)
    .maybeSingle()
  if (error) return fail(500, "READ_FAILED", "Could not read the invoice.")
  if (!inv) return fail(404, "NOT_FOUND", "Invoice not found.")
  const number = String(inv.invoice_number || "")
  if (!parseMinvNumber(number)) return fail(409, "NOT_MINV", "Only maintenance (MINV) invoices can be cancelled here.")
  if (inv.status === "cancelled") return fail(409, "ALREADY_CANCELLED", "This invoice is already cancelled.")
  if (inv.status === "replaced") return fail(409, "REPLACED", "This invoice was replaced; it cannot be cancelled.")
  if ((Number(inv.collected_amount) || 0) > 0.005) {
    return fail(409, "HAS_PAYMENTS", "Money was already collected on this invoice. Refund the payments first, then cancel it.")
  }

  const docs = await db.from("eta_documents").select("document_type, environment, status").eq("invoice_id", invoiceId)
  if (docs.error) return fail(500, "READ_FAILED", "Could not read the e-invoice documents.")
  const onPortal = ((docs.data || []) as any[]).some(
    (d) => (d.environment || "real") === "real" && (d.document_type === "C" || !["needs_review", "invalid"].includes(d.status)),
  )
  if (onPortal) return fail(409, "ETA_LIVE", "This invoice is on the tax portal. Cancel it on the portal first.")

  const performedBy = await knownUserId(db, userId)
  const { data: updated, error: updateError } = await db
    .from("accounts_receivable")
    .update({
      invoice_number: `X${invoiceId}-${number}`,
      cancelled_number: number,
      status: "cancelled",
      cancel_reason: reason,
      cancelled_at: new Date().toISOString(),
      cancelled_by_user_id: performedBy,
    })
    .eq("invoice_id", invoiceId)
    .eq("invoice_number", number)
    .eq("status", inv.status)
    .select("invoice_id")
  if (updateError) return fail(500, "UPDATE_FAILED", `Could not cancel the invoice: ${updateError.message}`)
  if (!updated?.length) return fail(409, "CHANGED", "The invoice changed while cancelling. Reload and try again.")

  // The photo it came from no longer holds the number (it stays viewable through the invoice).
  const drafts = await db.from("maintenance_photo_drafts").update({ status: "rejected" }).eq("invoice_id", invoiceId)
  if (drafts.error) console.error(`Invoice ${invoiceId}: could not release its photo draft`, drafts.error)

  const ev = await db.from("workflow_events").insert({
    entity_type: "CUSTOMER_INVOICE",
    entity_id: invoiceId,
    event_type: "INVOICE_CANCELLED",
    old_value: number,
    new_value: "cancelled",
    notes: `Maintenance invoice ${number} cancelled: ${reason}`,
    performed_by: performedBy,
  })
  if (ev.error) console.error(`Invoice ${invoiceId}: could not record the cancellation`, ev.error)
  return { ok: true, invoiceNumber: number }
}
