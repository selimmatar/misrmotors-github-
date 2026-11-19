// "Change invoice number" (owner request): the accountant may change the internal number of a customer invoice that is
// NOT on the tax portal yet, before it is issued there. Refused for a replaced invoice, for a maintenance invoice
// (its INV-MNT- number decides which tab it is in), and while a real document exists (waiting, sent, valid, cancelled,
// rejected, a credit note, or the manual "already on the portal" mark). A real invalid or needs-review document does
// not block, as in ./live. The new number follows the same rules as a typed number on create (lib/doc-number.ts) and
// must be free. Every use is written to workflow_events.
import { cleanManualNumber, numberTakenMessage, isUniqueViolation } from "../doc-number"
import { knownUserId } from "../po-history"

type Db = any
export type RenameInvoiceResult = { ok: true; invoiceNumber: string } | { ok: false; status: number; code: string; error: string }

const MAINTENANCE_PREFIX = /^INV-MNT-/i
const fail = (status: number, code: string, error: string): RenameInvoiceResult => ({ ok: false, status, code, error })

export async function renameInvoiceNumber(db: Db, invoiceId: number, rawNumber: unknown, userId: unknown): Promise<RenameInvoiceResult> {
  const cleaned = cleanManualNumber(rawNumber)
  if (!cleaned.ok) return fail(400, "BAD_NUMBER", cleaned.error)
  if (!cleaned.value) return fail(400, "BAD_NUMBER", "Type the new invoice number.")
  const next = cleaned.value

  const { data: inv, error } = await db.from("accounts_receivable").select("invoice_id, invoice_number, status").eq("invoice_id", invoiceId).maybeSingle()
  if (error) return fail(500, "READ_FAILED", "Could not read the invoice.")
  if (!inv) return fail(404, "NOT_FOUND", "Invoice not found.")
  const old = String(inv.invoice_number || "")
  if (inv.status === "replaced") return fail(409, "REPLACED", "This invoice was replaced; its number cannot be changed.")
  if (MAINTENANCE_PREFIX.test(old) || MAINTENANCE_PREFIX.test(next)) {
    return fail(409, "MAINTENANCE_NUMBER", "Maintenance invoice numbers (INV-MNT-) cannot be changed or used here.")
  }
  if (next === old) return fail(409, "SAME_NUMBER", "That is already the invoice number.")

  const docs = await db.from("eta_documents").select("doc_id, document_type, environment, status").eq("invoice_id", invoiceId)
  if (docs.error) return fail(500, "READ_FAILED", "Could not read the e-invoice documents.")
  const onPortal = ((docs.data || []) as any[]).some(
    (d) => (d.environment || "real") === "real" && (d.document_type === "C" || !["needs_review", "invalid"].includes(d.status)),
  )
  if (onPortal) return fail(409, "ETA_LIVE", "This invoice is already on the portal, so its number cannot be changed.")

  const up = await db.from("accounts_receivable").update({ invoice_number: next }).eq("invoice_id", invoiceId).eq("invoice_number", old).select("invoice_id")
  if (up.error) {
    if (isUniqueViolation(up.error)) return fail(409, "NUMBER_TAKEN", numberTakenMessage(next))
    return fail(500, "WRITE_FAILED", "Could not change the invoice number.")
  }
  if (!Array.isArray(up.data) || up.data.length === 0) return fail(409, "CHANGED", "The invoice was changed by someone else. Reload and try again.")

  const ev = await db.from("workflow_events").insert({
    entity_type: "CUSTOMER_INVOICE",
    entity_id: invoiceId,
    event_type: "INVOICE_NUMBER_CHANGED",
    old_value: old,
    new_value: next,
    notes: `Invoice number changed from ${old} to ${next} before it was issued on the portal`,
    performed_by: await knownUserId(db, userId),
  })
  if (ev.error) console.error(`Invoice ${invoiceId}: could not record the number change`, ev.error)
  return { ok: true, invoiceNumber: next }
}
