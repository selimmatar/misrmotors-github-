// "Not on the portal - make it sendable": an invoice created before the go-live moment is "handled manually" (never
// sent). When the accountant knows it was NOT typed on the portal, this moves its creation moment to now, so it counts
// as a new invoice and can be sent. Its number, date, amount and lines do not change. The manual "already on the
// portal" mark (real environment) is removed. Refused while a real document is live, for a replaced invoice, and
// before a go-live moment exists. Every use is written to workflow_events.
import { loadEtaGoLiveAt } from "../invoicing"
import { liveRealDocument } from "./live"
import { knownUserId } from "../po-history"

type Db = any
export type MakeSendableResult = { ok: true } | { ok: false; status: number; code: string; error: string }

export async function makeSendable(db: Db, invoiceId: number, userId: unknown, now: Date = new Date()): Promise<MakeSendableResult> {
  const goLive = await loadEtaGoLiveAt(db)
  if (!goLive) return { ok: false, status: 409, code: "NO_GO_LIVE", error: "The e-invoice start date is not set yet." }
  const { data: inv, error } = await db.from("accounts_receivable").select("invoice_id, invoice_number, status, created_at").eq("invoice_id", invoiceId).maybeSingle()
  if (error) return { ok: false, status: 500, code: "READ_FAILED", error: "Could not read the invoice." }
  if (!inv) return { ok: false, status: 404, code: "NOT_FOUND", error: "Invoice not found." }
  if (inv.status === "replaced") return { ok: false, status: 409, code: "REPLACED", error: "This invoice was replaced; send its new invoice instead." }
  if (await liveRealDocument(db, invoiceId)) return { ok: false, status: 409, code: "ETA_LIVE", error: "This invoice is already on the portal." }

  const created = Date.parse(String(inv.created_at).endsWith("Z") || /[+-]\d\d:?\d\d$/.test(String(inv.created_at)) ? String(inv.created_at) : `${inv.created_at}Z`)
  const del = await db.from("eta_documents").delete().eq("invoice_id", invoiceId).eq("environment", "real").eq("status", "manual")
  if (del.error) return { ok: false, status: 500, code: "WRITE_FAILED", error: "Could not remove the manual mark." }
  if (!(created >= Date.parse(goLive))) {
    const up = await db.from("accounts_receivable").update({ created_at: now.toISOString() }).eq("invoice_id", invoiceId)
    if (up.error) return { ok: false, status: 500, code: "WRITE_FAILED", error: "Could not update the invoice." }
  }
  const ev = await db.from("workflow_events").insert({
    entity_type: "CUSTOMER_INVOICE",
    entity_id: invoiceId,
    event_type: "ETA_MADE_SENDABLE",
    old_value: String(inv.created_at ?? ""),
    new_value: now.toISOString(),
    notes: `Invoice ${inv.invoice_number}: marked as not on the portal, made sendable`,
    performed_by: await knownUserId(db, userId),
  })
  if (ev.error) console.error(`E-invoice: could not record make-sendable for invoice ${invoiceId}`, ev.error)
  return { ok: true }
}
