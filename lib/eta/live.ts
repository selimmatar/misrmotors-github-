// Which e-invoice documents keep an invoice in the ERP (spec §6.1 "Deleting an invoice on the portal", ruling P3).
// Kept apart from ./send so the receivables routes don't load the signing code.
type Db = any

export const ETA_LIVE_MESSAGE =
  "This invoice is on the tax portal (waiting to be signed, sent, valid, cancelled or credited): cancel it on the portal or issue a credit note first."

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

/** A real document that must stay in the ERP (spec §6.1, P3): anything but manual / needs review / invalid, or any credit note. */
const blocks = (r: any) => (r.environment || "real") === "real" && (r.document_type === "C" || !["manual", "needs_review", "invalid"].includes(r.status))

/** True when the invoice has a real document waiting, sent, valid, cancelled, rejected, or a real credit note. */
export async function liveRealDocument(db: Db, invoiceId: number): Promise<boolean> {
  const rows = must(await db.from("eta_documents").select("doc_id, document_type, environment, status").eq("invoice_id", invoiceId), "load e-invoice documents") as any[]
  return rows.some(blocks)
}

/** Before an invoice is deleted: removes its e-invoice rows that don't block (test, manual, needs review, real invalid). */
export async function clearRemovableDocuments(db: Db, invoiceId: number): Promise<void> {
  const rows = must(await db.from("eta_documents").select("doc_id, document_type, environment, status").eq("invoice_id", invoiceId), "load e-invoice documents") as any[]
  if (rows.some(blocks)) throw new Error(ETA_LIVE_MESSAGE)
  const ids = rows.map((r) => r.doc_id)
  if (ids.length) must(await db.from("eta_documents").delete().in("doc_id", ids), "remove e-invoice documents")
}
