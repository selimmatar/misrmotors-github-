// The worker's own list on his upload link page (owner, 2026-11-22): every photo he sent through THIS link, newest
// first, with its number, customer, total and where it stands. Read-only and limited to his link: the caller passes
// the link id found from the secret (the same check as the upload route), and only that link's drafts and the
// invoices made from them are read, so no other worker's invoice or price can show.
import type { DraftRead } from "./maintenance-photos"

type Db = any

export type SentStatus = "review" | "created" | "rejected" | "cancelled"

export interface SentItem {
  id: number
  sentAt: string
  /** The invoice number once known: on the invoice, reserved for the page, or read from the photo. */
  number: string | null
  customer: string | null
  total: number | null
  status: SentStatus
  /** Why the office rejected or cancelled it, when they wrote it. */
  reason: string | null
}

export const SENT_LIST_LIMIT = 30

const round2 = (n: number) => Math.round(n * 100) / 100

function readTotal(read: Partial<DraftRead> | null): number | null {
  if (!read) return null
  if (Number(read.writtenTotal) > 0) return round2(Number(read.writtenTotal))
  const sum = (read.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  return sum > 0 ? round2(sum) : null
}

/** A cancelled invoice keeps its number as "X<id>-<number>" (lib/minv-cancel.ts). */
const shownNumber = (invoiceNumber: string) => invoiceNumber.replace(/^X\d+-/, "")

export async function workerSentList(db: Db, linkId: number, limit = SENT_LIST_LIMIT): Promise<SentItem[]> {
  const { data, error } = await db
    .from("maintenance_photo_drafts")
    .select("id, link_id, created_at, status, reject_reason, invoice_number, invoice_id, read_data")
    .eq("link_id", linkId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`load sent photos: ${error.message}`)
  // Belt and braces: never a row of another link, whatever the query returned.
  const drafts = ((data || []) as any[]).filter((d) => Number(d.link_id) === linkId)
  if (!drafts.length) return []

  const invoiceIds = [...new Set(drafts.map((d) => Number(d.invoice_id)).filter((n) => n > 0))]
  const invoices = new Map<number, any>()
  const customers = new Map<number, string>()
  if (invoiceIds.length) {
    const { data: rows, error: arError } = await db
      .from("accounts_receivable")
      .select("invoice_id, invoice_number, amount, status, customer_id")
      .in("invoice_id", invoiceIds)
    if (arError) throw new Error(`load sent invoices: ${arError.message}`)
    for (const r of rows || []) invoices.set(Number(r.invoice_id), r)
    const customerIds = [...new Set([...invoices.values()].map((r) => Number(r.customer_id)).filter((n) => n > 0))]
    if (customerIds.length) {
      const { data: people } = await db.from("customers").select("customer_id, customer_name").in("customer_id", customerIds)
      for (const c of people || []) customers.set(Number(c.customer_id), String(c.customer_name || ""))
    }
  }

  // Booklet pages cancelled from a photo (old MINV numbering) keep their number on the cancelled list.
  const { data: voidRows } = await db
    .from("maintenance_booklet_voids")
    .select("draft_id, invoice_number")
    .in("draft_id", drafts.map((d) => Number(d.id)))
  const voids = new Map<number, string>((voidRows || []).map((v: any) => [Number(v.draft_id), String(v.invoice_number)]))

  return drafts.map((d): SentItem => {
    const invoice = d.invoice_id ? invoices.get(Number(d.invoice_id)) : null
    const read = (d.read_data || null) as Partial<DraftRead> | null
    const draftNumber = d.invoice_number ? String(d.invoice_number) : voids.get(Number(d.id)) ?? null
    const number = invoice ? shownNumber(String(invoice.invoice_number)) : draftNumber || (read?.printedNumber ? String(read.printedNumber) : null)
    let reason: string | null = d.reject_reason ? String(d.reject_reason) : null
    // A cancelled page ("void"): the reason was saved as "<reason> (<number>)".
    const voided = d.status === "rejected" && !invoice && !!draftNumber && !!reason && reason.endsWith(` (${draftNumber})`)
    if (voided && reason) reason = reason.slice(0, -` (${draftNumber})`.length).trim() || null

    let status: SentStatus
    if (invoice?.status === "cancelled") status = "cancelled"
    else if (invoice && d.status === "converted") status = "created"
    else if (d.status === "waiting" || d.status === "converting") status = "review"
    else if (voided) status = "cancelled"
    else if (d.status === "converted") status = "created"
    else status = "rejected"

    return {
      id: Number(d.id),
      sentAt: String(d.created_at),
      number: number || null,
      customer: (invoice && customers.get(Number(invoice.customer_id))) || (read?.customerName ? String(read.customerName) : null),
      total: invoice ? round2(Number(invoice.amount) || 0) : readTotal(read),
      status,
      reason: status === "rejected" || status === "cancelled" ? reason : null,
    }
  })
}
