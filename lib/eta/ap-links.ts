// Accounts Payable <-> portal comparison with many-to-many links. Pure, no I/O.
// Effective links = the links a person made ('manual' rows of ap_portal_links)
//                 + the automatic matches (lib/eta/ap-match.ts) that were not removed ('rejected' rows), and only for a
//                   portal document and an AP invoice that have no manual link (once a person links either side by
//                   hand, that side is theirs).
// AP invoices and portal documents joined by effective links form groups (connected components): one ERP invoice
// paid by two portal invoices, or two ERP invoices against two portal invoices, are one group with one total each side.
import { AMOUNT_TOLERANCE, matchReceived, type ApForMatch, type MatchReport, type ReceivedForMatch, type SupplierForMatch } from "./ap-match"

export type LinkKind = "manual" | "rejected"
export type LinkSource = "auto" | "manual"
export type GroupStatus = "matched" | "differs" | "no_portal" | "no_erp" | "unknown_supplier"
export const GROUP_STATUSES: GroupStatus[] = ["matched", "differs", "no_portal", "no_erp", "unknown_supplier"]

export interface StoredLink {
  received_id: number
  ap_invoice_id: number
  kind: LinkKind | string
}
export interface AutoMatch {
  receivedId: number
  apInvoiceId: number
  /** why it was suggested (lib/eta/ap-score.ts) */
  reasons?: string[]
}
export interface EffectiveLink {
  receivedId: number
  apInvoiceId: number
  source: LinkSource
  /** automatic links: why they were suggested */
  reasons?: string[]
}
export interface Group {
  /** stable key: "ap:<lowest AP id>" or "r:<lowest received id>" */
  key: string
  supplierId: number | null
  apInvoiceIds: number[]
  receivedIds: number[]
  links: EffectiveLink[]
  erpTotal: number
  /** standing portal documents; credit notes count negative */
  portalTotal: number
  /** portal - ERP */
  difference: number
  status: GroupStatus
  /** the latest date in the group (for sorting) */
  date: string | null
}
export interface GroupTotals {
  erpTotal: number
  portalTotal: number
  difference: number
  counts: Record<GroupStatus, number>
}
export interface GroupsResult {
  links: EffectiveLink[]
  groups: Group[]
  totals: GroupTotals
}

const round2 = (n: number) => Math.round(n * 100) / 100
const text = (v: unknown) => (v == null ? "" : String(v).trim())
const digits = (v: unknown) => text(v).replace(/\D/g, "")
/** a portal document the supplier withdrew no longer stands for an invoice */
export const standingDoc = (r: { status?: string | null }) => !["cancelled", "rejected", "invalid"].includes(text(r.status).toLowerCase())
/** the amount a portal document adds to its side: credit notes negative, withdrawn documents nothing */
export const portalAmount = (r: ReceivedForMatch): number => {
  if (!standingDoc(r)) return 0
  const total = Number(r.total) || 0
  return r.document_type === "C" ? -total : total
}
const pairKey = (receivedId: number, apInvoiceId: number) => `${receivedId}:${apInvoiceId}`

/** the supplier of a portal document: its own supplier_id, else the supplier card with its tax number */
export function supplierResolver(suppliers: readonly SupplierForMatch[]) {
  const byTax = new Map<string, number>()
  for (const s of suppliers) {
    const d = digits(s.tax_registration_number)
    if (d && !byTax.has(d)) byTax.set(d, s.supplier_id)
  }
  return (r: Pick<ReceivedForMatch, "supplier_id" | "issuer_id">): number | null => r.supplier_id ?? byTax.get(digits(r.issuer_id)) ?? null
}

/** the automatic suggestions of matchReceived (standing invoices / debit notes with an AP invoice) */
export function autoMatchesOf(report: MatchReport): AutoMatch[] {
  return report.documents.filter((m) => m.apInvoiceId != null).map((m) => ({ receivedId: m.receivedId, apInvoiceId: m.apInvoiceId as number }))
}

/** matchReceived over the same rows, as automatic suggestions; withdrawn documents are never suggested */
export function suggestMatches(received: readonly ReceivedForMatch[], apInvoices: readonly ApForMatch[], suppliers: readonly SupplierForMatch[]): AutoMatch[] {
  const standing = new Set(received.filter(standingDoc).map((r) => r.received_id))
  return autoMatchesOf(matchReceived(received, apInvoices, suppliers)).filter((m) => standing.has(m.receivedId))
}

/** manual links + automatic matches that were not rejected, for sides with no manual link; only rows that are present */
export function effectiveLinks(
  links: readonly StoredLink[],
  autoMatches: readonly AutoMatch[],
  present?: { ap: ReadonlySet<number>; received: ReadonlySet<number> },
): EffectiveLink[] {
  const here = (r: number, a: number) => !present || (present.received.has(r) && present.ap.has(a))
  const out: EffectiveLink[] = []
  const seen = new Set<string>()
  const rejected = new Set<string>()
  const manualAp = new Set<number>()
  const manualReceived = new Set<number>()
  for (const l of links) {
    const r = Number(l.received_id), a = Number(l.ap_invoice_id)
    if (l.kind === "rejected") rejected.add(pairKey(r, a))
    if (l.kind !== "manual" || !here(r, a)) continue
    manualAp.add(a)
    manualReceived.add(r)
    if (seen.has(pairKey(r, a))) continue
    seen.add(pairKey(r, a))
    out.push({ receivedId: r, apInvoiceId: a, source: "manual" })
  }
  for (const m of autoMatches) {
    const k = pairKey(m.receivedId, m.apInvoiceId)
    if (seen.has(k) || rejected.has(k) || manualAp.has(m.apInvoiceId) || manualReceived.has(m.receivedId) || !here(m.receivedId, m.apInvoiceId)) continue
    seen.add(k)
    out.push({ receivedId: m.receivedId, apInvoiceId: m.apInvoiceId, source: "auto", ...(m.reasons ? { reasons: m.reasons } : {}) })
  }
  return out
}

export function groupStatus(g: { apInvoiceIds: number[]; receivedIds: number[]; supplierId: number | null; difference: number }): GroupStatus {
  if (g.receivedIds.length === 0) return "no_portal"
  if (g.apInvoiceIds.length === 0) return g.supplierId == null ? "unknown_supplier" : "no_erp"
  return Math.abs(g.difference) <= AMOUNT_TOLERANCE ? "matched" : "differs"
}

const emptyCounts = (): Record<GroupStatus, number> => ({ matched: 0, differs: 0, no_portal: 0, no_erp: 0, unknown_supplier: 0 })

export function buildGroups(
  apInvoices: readonly ApForMatch[],
  received: readonly ReceivedForMatch[],
  suppliers: readonly SupplierForMatch[],
  links: readonly StoredLink[],
  autoMatches: readonly AutoMatch[],
): GroupsResult {
  const supplierOf = supplierResolver(suppliers)
  const apById = new Map(apInvoices.map((a) => [a.invoice_id, a]))
  const docById = new Map(received.map((r) => [r.received_id, r]))
  const effective = effectiveLinks(links, autoMatches, { ap: new Set(apById.keys()), received: new Set(docById.keys()) })

  // union-find over "a<id>" and "r<id>"
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    while (parent.get(x) !== root) {
      const next = parent.get(x)!
      parent.set(x, root)
      x = next
    }
    return root
  }
  for (const id of apById.keys()) parent.set(`a${id}`, `a${id}`)
  for (const id of docById.keys()) parent.set(`r${id}`, `r${id}`)
  for (const l of effective) {
    const x = find(`a${l.apInvoiceId}`), y = find(`r${l.receivedId}`)
    if (x !== y) parent.set(y, x)
  }

  const members = new Map<string, { ap: number[]; r: number[] }>()
  const bucket = (root: string) => {
    let m = members.get(root)
    if (!m) members.set(root, (m = { ap: [], r: [] }))
    return m
  }
  for (const id of apById.keys()) bucket(find(`a${id}`)).ap.push(id)
  for (const id of docById.keys()) bucket(find(`r${id}`)).r.push(id)
  const linksByRoot = new Map<string, EffectiveLink[]>()
  for (const l of effective) {
    const root = find(`a${l.apInvoiceId}`)
    linksByRoot.set(root, [...(linksByRoot.get(root) || []), l])
  }

  const totals: GroupTotals = { erpTotal: 0, portalTotal: 0, difference: 0, counts: emptyCounts() }
  const groups: Group[] = []
  for (const [root, m] of members) {
    m.ap.sort((x, y) => x - y)
    m.r.sort((x, y) => x - y)
    const erpTotal = round2(m.ap.reduce((s, id) => s + (Number(apById.get(id)!.amount) || 0), 0))
    const portalTotal = round2(m.r.reduce((s, id) => s + portalAmount(docById.get(id)!), 0))
    const difference = round2(portalTotal - erpTotal)
    const firstAp = m.ap.length ? apById.get(m.ap[0])! : null
    const supplierId = firstAp?.supplier_id ?? (m.r.map((id) => supplierOf(docById.get(id)!)).find((s) => s != null) ?? null)
    const dates = [
      ...m.ap.map((id) => text(apById.get(id)!.invoice_date) || text(apById.get(id)!.created_at)),
      ...m.r.map((id) => text(docById.get(id)!.date_issued).slice(0, 10)),
    ].filter(Boolean).sort()
    const g: Group = {
      key: m.ap.length ? `ap:${m.ap[0]}` : `r:${m.r[0]}`,
      supplierId,
      apInvoiceIds: m.ap,
      receivedIds: m.r,
      links: (linksByRoot.get(root) || []).sort((x, y) => x.apInvoiceId - y.apInvoiceId || x.receivedId - y.receivedId),
      erpTotal,
      portalTotal,
      difference,
      status: "matched",
      date: dates.length ? dates[dates.length - 1] : null,
    }
    g.status = groupStatus(g)
    groups.push(g)
    totals.erpTotal += erpTotal
    totals.portalTotal += portalTotal
    totals.counts[g.status]++
  }
  groups.sort((x, y) => text(y.date).localeCompare(text(x.date)) || x.key.localeCompare(y.key))
  totals.erpTotal = round2(totals.erpTotal)
  totals.portalTotal = round2(totals.portalTotal)
  totals.difference = round2(totals.portalTotal - totals.erpTotal)
  return { links: effective, groups, totals }
}

/** totals of a subset of groups (after a supplier / period filter) */
export function totalsOf(groups: readonly Group[]): GroupTotals {
  const t: GroupTotals = { erpTotal: 0, portalTotal: 0, difference: 0, counts: emptyCounts() }
  for (const g of groups) {
    t.erpTotal += g.erpTotal
    t.portalTotal += g.portalTotal
    t.counts[g.status]++
  }
  t.erpTotal = round2(t.erpTotal)
  t.portalTotal = round2(t.portalTotal)
  t.difference = round2(t.portalTotal - t.erpTotal)
  return t
}
