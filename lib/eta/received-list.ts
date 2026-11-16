// The "Supplier e-invoices" list: received portal documents of a period with their Accounts Payable match, and the
// AP invoices that are not on the portal. Read-only (AP is never created or changed here).
import { DATE_WINDOW_DAYS, matchReceived, type MatchOutcome, type MatchReport } from "./ap-match"
import type { EtaEnv } from "./portal"

type Db = any

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const PAGE = 1000
async function paged(build: (from: number, to: number) => any, what: string): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const page = must(await build(from, from + PAGE - 1), what) as any[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export interface ReceivedListRow {
  receivedId: number
  uuid: string
  documentType: string
  issuerId: string | null
  issuerName: string | null
  supplierId: number | null
  supplierName: string | null
  internalId: string | null
  dateIssued: string | null
  net: number | null
  vat: number | null
  total: number | null
  portalStatus: string | null
  match: MatchOutcome
}

export async function receivedList(db: Db, env: EtaEnv, from: string, to: string) {
  const [docs, suppliers, ap] = await Promise.all([
    paged(
      (a, b) =>
        db.from("eta_received_documents")
          .select("received_id, uuid, document_type, issuer_id, issuer_name, supplier_id, internal_id, date_issued, net, vat, total, status")
          .eq("environment", env)
          .gte("date_issued", `${from}T00:00:00Z`)
          .lte("date_issued", `${to}T23:59:59Z`)
          .order("date_issued", { ascending: false })
          .order("received_id", { ascending: false })
          .range(a, b),
      "load received documents",
    ),
    paged((a, b) => db.from("suppliers").select("supplier_id, supplier_name, tax_registration_number").order("supplier_id").range(a, b), "load suppliers"),
    // AP of the period, widened by the date window so an invoice dated just outside it still matches
    paged(
      (a, b) =>
        db.from("accounts_payable")
          .select("invoice_id, invoice_number, supplier_id, amount, invoice_date, created_at, po_id")
          .gte("invoice_date", shift(from, -DATE_WINDOW_DAYS))
          .lte("invoice_date", shift(to, DATE_WINDOW_DAYS))
          .order("invoice_id")
          .range(a, b),
      "load supplier invoices",
    ),
  ])
  const report: MatchReport = matchReceived(docs, ap, suppliers, { from, to })
  const name = new Map<number, string>(suppliers.map((s) => [s.supplier_id, String(s.supplier_name ?? "")]))
  const byId = new Map<number, MatchOutcome>([...report.documents, ...report.creditNotes].map((m) => [m.receivedId, m]))
  const rows: ReceivedListRow[] = docs.map((d) => {
    const match = byId.get(d.received_id)!
    const supplierId = match.supplierId ?? d.supplier_id ?? null
    return {
      receivedId: d.received_id,
      uuid: d.uuid,
      documentType: d.document_type || "I",
      issuerId: d.issuer_id ?? null,
      issuerName: d.issuer_name ?? null,
      supplierId,
      supplierName: supplierId != null ? name.get(supplierId) ?? null : null,
      internalId: d.internal_id ?? null,
      dateIssued: d.date_issued ?? null,
      net: d.net == null ? null : Number(d.net),
      vat: d.vat == null ? null : Number(d.vat),
      total: d.total == null ? null : Number(d.total),
      portalStatus: d.status ?? null,
      match,
    }
  })
  return {
    environment: env,
    documents: rows.filter((r) => r.documentType !== "C"),
    creditNotes: rows.filter((r) => r.documentType === "C"),
    missingOnPortal: report.missingOnPortal.map((m) => ({ ...m, supplierName: name.get(m.supplierId) ?? null })),
    supplierTotals: report.supplierTotals.map((t) => ({ ...t, supplierName: name.get(t.supplierId) ?? null })),
  }
}
