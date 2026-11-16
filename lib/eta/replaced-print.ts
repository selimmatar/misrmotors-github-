// The printout of a replaced invoice (spec §6.5a, ruling P12). Its delivery-permit links moved to the new invoice, so
// it prints from what was sent to the tax portal: the real invoice document's stored body text (ruling P5), latest
// version that is valid or cancelled, with a "Replaced by {new number}" note. Without a snapshot it prints the header
// and the note, no lines. Normal invoices never come here (their prints are unchanged).
import { REPLACED_AR_STATUS } from "../ar-live"

type Db = any

export interface ReplacedPrintLine { name: string; quantity: number; unitPrice: number; total: number }
export interface ReplacedPrint {
  replacedByNumber: string | null
  /** null: no sent document to print from */
  lines: ReplacedPrintLine[] | null
  totals: { net: number; vat: number; total: number } | null
  note: { en: string; ar: string }
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function replacedNote(newNumber: string | null): { en: string; ar: string } {
  return newNumber
    ? { en: `Replaced by ${newNumber}`, ar: `استُبدلت بالفاتورة ${newNumber}` }
    : { en: "Replaced: the corrected invoice has not been created yet", ar: "مستبدلة: لم تُنشأ الفاتورة المصححة بعد" }
}

/** null for an invoice that is not replaced. */
export async function replacedPrint(db: Db, invoice: { invoice_id: number; status?: string | null; replaced_by_invoice_id?: number | null }): Promise<ReplacedPrint | null> {
  if (invoice?.status !== REPLACED_AR_STATUS) return null
  let replacedByNumber: string | null = null
  if (invoice.replaced_by_invoice_id) {
    const { data } = await db.from("accounts_receivable").select("invoice_number").eq("invoice_id", invoice.replaced_by_invoice_id).maybeSingle()
    replacedByNumber = data?.invoice_number ?? null
  }
  const { data: docs } = await db
    .from("eta_documents")
    .select("doc_id, document_type, environment, version, status, document")
    .eq("invoice_id", invoice.invoice_id)
  const sent = ((docs || []) as any[])
    .filter((d) => d.document_type === "I" && (d.environment || "real") === "real" && ["valid", "cancelled"].includes(d.status))
    .sort((a, b) => num(b.version) - num(a.version))[0]
  let body: any = null
  if (sent && typeof sent.document === "string" && sent.document.startsWith("{")) {
    try {
      body = JSON.parse(sent.document)
    } catch {
      body = null
    }
  }
  const note = replacedNote(replacedByNumber)
  if (!body || !Array.isArray(body.invoiceLines)) return { replacedByNumber, lines: null, totals: null, note }
  const lines = body.invoiceLines.map((l: any) => ({
    name: String(l?.description ?? ""),
    quantity: num(l?.quantity),
    unitPrice: num(l?.unitValue?.amountEGP),
    total: num(l?.salesTotal),
  }))
  const vat = Array.isArray(body.taxTotals) ? body.taxTotals.reduce((s: number, t: any) => s + num(t?.amount), 0) : 0
  return { replacedByNumber, lines, totals: { net: num(body.netAmount), vat, total: num(body.totalAmount) }, note }
}
