// Accounts Payable <-> portal comparison: loading (GET /api/eta/ap-portal) and the links a person makes or removes
// (POST / DELETE /api/eta/ap-portal/link). Accounts Payable and the portal documents are never changed here; only
// ap_portal_links rows are written, and every change is recorded in workflow_events (entity_type 'AP_INVOICE').
import { DATE_WINDOW_DAYS, type ApForMatch, type ReceivedForMatch } from "./ap-match"
import { buildGroups, portalAmount, standingDoc, suggestMatches, supplierResolver, totalsOf, type EffectiveLink, type Group, type LinkSource, type StoredLink } from "./ap-links"
import type { EtaEnv } from "./portal"
import { knownUserId } from "../po-history"

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
const CHUNK = 200
async function byIds(ids: number[], load: (chunk: number[]) => any, what: string): Promise<any[]> {
  const rows: any[] = []
  for (let i = 0; i < ids.length; i += CHUNK) rows.push(...(must(await load(ids.slice(i, i + CHUNK)), what) as any[]))
  return rows
}
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const text = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => (v == null ? null : Number(v))

const AP_COLUMNS = "invoice_id, invoice_number, supplier_id, amount, invoice_date, created_at, po_id"
const DOC_COLUMNS = "received_id, uuid, document_type, issuer_id, issuer_name, supplier_id, internal_id, date_issued, net, vat, total, status"

export interface ApPortalInvoice {
  invoiceId: number
  invoiceNumber: string
  poNumber: string | null
  supplierId: number | null
  supplierName: string | null
  date: string | null
  amount: number
  groupKey: string
  links: { receivedId: number; source: LinkSource }[]
}
export interface ApPortalDoc {
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
  /** what it adds to the portal side: credit notes negative, withdrawn documents 0 */
  signedTotal: number
  portalStatus: string | null
  standing: boolean
  groupKey: string
  links: { apInvoiceId: number; source: LinkSource }[]
  /** a person can link it (its supplier is known) */
  linkable: boolean
}

export async function loadApPortal(db: Db, env: EtaEnv, q: { from: string; to: string; supplierId?: number | null }) {
  const { from, to } = q
  const [docs, suppliers, apWide, stored] = await Promise.all([
    paged(
      (a, b) =>
        db.from("eta_received_documents").select(DOC_COLUMNS)
          .eq("environment", env)
          .gte("date_issued", `${from}T00:00:00Z`)
          .lte("date_issued", `${to}T23:59:59Z`)
          .order("received_id")
          .range(a, b),
      "load received documents",
    ),
    paged((a, b) => db.from("suppliers").select("supplier_id, supplier_name, tax_registration_number").order("supplier_id").range(a, b), "load suppliers"),
    // AP of the period, widened by the date window so an invoice dated just outside it still matches
    paged(
      (a, b) =>
        db.from("accounts_payable").select(AP_COLUMNS)
          .gte("invoice_date", shift(from, -DATE_WINDOW_DAYS))
          .lte("invoice_date", shift(to, DATE_WINDOW_DAYS))
          .order("invoice_id")
          .range(a, b),
      "load supplier invoices",
    ),
    // only rows a person made: a small table, read whole
    paged((a, b) => db.from("ap_portal_links").select("received_id, ap_invoice_id, kind").order("link_id").range(a, b), "load portal links"),
  ])
  const links = stored as StoredLink[]
  const ap = apWide as (ApForMatch & { po_id?: number | null })[]
  const received = docs as (ReceivedForMatch & Record<string, any>)[]

  // the other side of a manual link may fall outside the period: load it too, so the group is whole
  const apIds = new Set(ap.map((a) => a.invoice_id))
  const docIds = new Set(received.map((r) => r.received_id))
  const manual = links.filter((l) => l.kind === "manual")
  const missingAp = [...new Set(manual.filter((l) => docIds.has(l.received_id) && !apIds.has(l.ap_invoice_id)).map((l) => l.ap_invoice_id))]
  const missingDocs = [...new Set(manual.filter((l) => apIds.has(l.ap_invoice_id) && !docIds.has(l.received_id)).map((l) => l.received_id))]
  if (missingAp.length) ap.push(...(await byIds(missingAp, (c) => db.from("accounts_payable").select(AP_COLUMNS).in("invoice_id", c), "load linked supplier invoices")))
  if (missingDocs.length) received.push(...(await byIds(missingDocs, (c) => db.from("eta_received_documents").select(DOC_COLUMNS).eq("environment", env).in("received_id", c), "load linked received documents")))

  // automatic suggestions among the rows no one linked by hand, so a manual link never hides a better match elsewhere
  const manualAp = new Set(manual.map((l) => l.ap_invoice_id))
  const manualDocs = new Set(manual.map((l) => l.received_id))
  const auto = suggestMatches(received.filter((r) => !manualDocs.has(r.received_id)), ap.filter((a) => !manualAp.has(a.invoice_id)), suppliers)
  const result = buildGroups(ap, received, suppliers, links, auto)

  // the period and the supplier filter: a group is shown when one of its rows is in the period
  const apDay = (a: ApForMatch) => text(a.invoice_date) || text(a.created_at).slice(0, 10)
  const inPeriod = (day: string) => !!day && day >= from && day <= to
  const apById = new Map(ap.map((a) => [a.invoice_id, a]))
  const docById = new Map(received.map((r) => [r.received_id, r]))
  const groups: Group[] = result.groups.filter(
    (g) =>
      (q.supplierId == null || g.supplierId === q.supplierId) &&
      (g.apInvoiceIds.some((id) => inPeriod(apDay(apById.get(id)!))) || g.receivedIds.some((id) => inPeriod(text(docById.get(id)!.date_issued).slice(0, 10)))),
  )

  const supplierOf = supplierResolver(suppliers)
  const name = new Map<number, string>(suppliers.map((s: any) => [s.supplier_id, String(s.supplier_name ?? "")]))
  const shownAp = groups.flatMap((g) => g.apInvoiceIds.map((id) => [id, g.key] as const))
  const shownDocs = groups.flatMap((g) => g.receivedIds.map((id) => [id, g.key] as const))
  const poIds = [...new Set(shownAp.map(([id]) => apById.get(id)!.po_id).filter((p): p is number => p != null))]
  const pos = poIds.length ? await byIds(poIds, (c) => db.from("purchase_orders").select("po_id, po_number").in("po_id", c), "load purchase orders") : []
  const poNumber = new Map<number, string>(pos.map((p: any) => [p.po_id, String(p.po_number ?? "")]))
  const linksOfAp = new Map<number, EffectiveLink[]>()
  const linksOfDoc = new Map<number, EffectiveLink[]>()
  for (const l of result.links) {
    linksOfAp.set(l.apInvoiceId, [...(linksOfAp.get(l.apInvoiceId) || []), l])
    linksOfDoc.set(l.receivedId, [...(linksOfDoc.get(l.receivedId) || []), l])
  }

  const apInvoices: ApPortalInvoice[] = shownAp.map(([id, groupKey]) => {
    const a = apById.get(id)!
    return {
      invoiceId: id,
      invoiceNumber: text(a.invoice_number),
      poNumber: a.po_id != null ? poNumber.get(a.po_id) ?? null : null,
      supplierId: a.supplier_id ?? null,
      supplierName: a.supplier_id != null ? name.get(a.supplier_id) ?? null : null,
      date: apDay(a) || null,
      amount: Number(a.amount) || 0,
      groupKey,
      links: (linksOfAp.get(id) || []).map((l) => ({ receivedId: l.receivedId, source: l.source })),
    }
  })
  const portalDocs: ApPortalDoc[] = shownDocs.map(([id, groupKey]) => {
    const d = docById.get(id)!
    const supplierId = supplierOf(d)
    return {
      receivedId: id,
      uuid: String(d.uuid ?? ""),
      documentType: d.document_type || "I",
      issuerId: d.issuer_id ?? null,
      issuerName: d.issuer_name ?? null,
      supplierId,
      supplierName: supplierId != null ? name.get(supplierId) ?? null : null,
      internalId: d.internal_id ?? null,
      dateIssued: d.date_issued ?? null,
      net: num(d.net),
      vat: num(d.vat),
      total: num(d.total),
      signedTotal: portalAmount(d),
      portalStatus: d.status ?? null,
      standing: standingDoc(d),
      groupKey,
      links: (linksOfDoc.get(id) || []).map((l) => ({ apInvoiceId: l.apInvoiceId, source: l.source })),
      linkable: supplierId != null,
    }
  })
  const usedSuppliers = new Set<number>([...apInvoices.map((a) => a.supplierId), ...portalDocs.map((d) => d.supplierId)].filter((s): s is number => s != null))
  if (q.supplierId != null) usedSuppliers.add(q.supplierId)
  return {
    environment: env,
    from,
    to,
    groups,
    apInvoices,
    portalDocs,
    totals: totalsOf(groups),
    suppliers: [...usedSuppliers].map((id) => ({ supplierId: id, supplierName: name.get(id) ?? "" })).sort((x, y) => x.supplierName.localeCompare(y.supplierName)),
  }
}

// ---------------------------------------------------------------- links a person makes or removes

export type LinkResult = { ok: true; changed: number } | { ok: false; status: number; code: string; error: string; errorAr?: string }
export interface Pair {
  receivedId: number
  apInvoiceId: number
}
type Failure = Extract<LinkResult, { ok: false }>
const fail = (status: number, code: string, error: string, errorAr?: string): Failure => ({ ok: false, status, code, error, ...(errorAr ? { errorAr } : {}) })

/** reads both sides of a pair and refuses a pair of two different suppliers (or a portal document of an unknown one) */
async function checkPair(db: Db, p: Pair): Promise<{ ok: true; doc: any; ap: any } | Failure> {
  const [docRes, apRes] = await Promise.all([
    db.from("eta_received_documents").select("received_id, issuer_id, issuer_name, supplier_id, internal_id").eq("received_id", p.receivedId).maybeSingle(),
    db.from("accounts_payable").select("invoice_id, invoice_number, supplier_id").eq("invoice_id", p.apInvoiceId).maybeSingle(),
  ])
  if (docRes.error || apRes.error) return fail(500, "READ_FAILED", "Could not read the invoices.")
  const doc = docRes.data, ap = apRes.data
  if (!doc) return fail(404, "NOT_FOUND", "Portal invoice not found.", "فاتورة البوابة غير موجودة.")
  if (!ap) return fail(404, "NOT_FOUND", "Supplier invoice not found.", "فاتورة المورد غير موجودة.")
  let supplierId: number | null = doc.supplier_id ?? null
  if (supplierId == null && text(doc.issuer_id)) {
    const sup = must(await db.from("suppliers").select("supplier_id, tax_registration_number").not("tax_registration_number", "is", null), "load suppliers") as any[]
    supplierId = supplierResolver(sup)(doc)
  }
  if (supplierId == null) {
    const tax = text(doc.issuer_id) || "-"
    return fail(
      409, "UNKNOWN_SUPPLIER",
      `The supplier of this portal invoice is not known. Add the tax number ${tax} to the supplier's card, then link it.`,
      `مورد فاتورة البوابة غير معروف. أضف الرقم الضريبي ${tax} إلى بطاقة المورد ثم اربطها.`,
    )
  }
  if (ap.supplier_id !== supplierId)
    return fail(409, "OTHER_SUPPLIER", "The portal invoice and the ERP invoice are from different suppliers.", "فاتورة البوابة وفاتورة النظام من موردين مختلفين.")
  return { ok: true, doc, ap }
}

async function record(db: Db, ap: any, doc: any, event: "AP_PORTAL_LINKED" | "AP_PORTAL_UNLINKED", oldKind: string | null, userId: number | null) {
  const portalNo = text(doc.internal_id) || `#${doc.received_id}`
  const ev = await db.from("workflow_events").insert({
    entity_type: "AP_INVOICE",
    entity_id: ap.invoice_id,
    event_type: event,
    old_value: oldKind,
    new_value: event === "AP_PORTAL_LINKED" ? `manual:${doc.received_id}` : `rejected:${doc.received_id}`,
    notes: `Portal invoice ${portalNo} ${event === "AP_PORTAL_LINKED" ? "linked to" : "unlinked from"} supplier invoice ${text(ap.invoice_number) || ap.invoice_id}`,
    performed_by: userId,
  })
  if (ev.error) console.error(`AP portal: could not record ${event} for AP invoice ${ap.invoice_id}`, ev.error)
}

async function currentKind(db: Db, p: Pair): Promise<string | null> {
  const r = await db.from("ap_portal_links").select("kind").eq("received_id", p.receivedId).eq("ap_invoice_id", p.apInvoiceId).maybeSingle()
  if (r.error) throw new Error(`read portal link: ${r.error.message || r.error}`)
  return r.data?.kind ?? null
}

/**
 * Links a portal document to an AP invoice by hand. `keep` are the automatic links of both sides that the person saw:
 * they are stored as manual too, because a manual link on a side ends the automatic suggestions for that side.
 * All pairs are checked before anything is written.
 */
export async function linkPortal(db: Db, pair: Pair, keep: Pair[], rawUserId: unknown): Promise<LinkResult> {
  const all = [pair, ...keep.filter((k) => k.receivedId !== pair.receivedId || k.apInvoiceId !== pair.apInvoiceId)]
  const checked: { doc: any; ap: any; pair: Pair }[] = []
  for (const p of all) {
    const c = await checkPair(db, p)
    if (!c.ok) return c
    checked.push({ doc: c.doc, ap: c.ap, pair: p })
  }
  const userId = await knownUserId(db, rawUserId)
  let changed = 0
  for (const { doc, ap, pair: p } of checked) {
    const before = await currentKind(db, p)
    if (before === "manual") continue
    // one statement: a 'rejected' row for the pair becomes 'manual'
    const up = await db.from("ap_portal_links").upsert(
      { received_id: p.receivedId, ap_invoice_id: p.apInvoiceId, kind: "manual", created_by: userId, created_at: new Date().toISOString() },
      { onConflict: "received_id,ap_invoice_id" },
    )
    if (up.error) return fail(500, "WRITE_FAILED", "Could not save the link.", "تعذر حفظ الربط.")
    await record(db, ap, doc, "AP_PORTAL_LINKED", before, userId)
    changed++
  }
  return { ok: true, changed }
}

/** Removes a link: the pair is stored as 'rejected' (a manual row becomes rejected), so it is never suggested again. */
export async function unlinkPortal(db: Db, pair: Pair, rawUserId: unknown): Promise<LinkResult> {
  const c = await checkPair(db, pair)
  if (!c.ok && c.code !== "UNKNOWN_SUPPLIER" && c.code !== "OTHER_SUPPLIER") return c
  const before = await currentKind(db, pair)
  if (before === "rejected") return { ok: true, changed: 0 }
  const doc = c.ok ? c.doc : { received_id: pair.receivedId }
  const ap = c.ok ? c.ap : { invoice_id: pair.apInvoiceId }
  const userId = await knownUserId(db, rawUserId)
  const up = await db.from("ap_portal_links").upsert(
    { received_id: pair.receivedId, ap_invoice_id: pair.apInvoiceId, kind: "rejected", created_by: userId, created_at: new Date().toISOString() },
    { onConflict: "received_id,ap_invoice_id" },
  )
  if (up.error) return fail(500, "WRITE_FAILED", "Could not remove the link.", "تعذر إزالة الربط.")
  await record(db, ap, doc, "AP_PORTAL_UNLINKED", before, userId)
  return { ok: true, changed: 1 }
}

/** a { receivedId, apInvoiceId } pair of positive integers, or null */
export function parsePair(v: any): Pair | null {
  const r = Number(v?.receivedId), a = Number(v?.apInvoiceId)
  return Number.isSafeInteger(r) && r > 0 && Number.isSafeInteger(a) && a > 0 ? { receivedId: r, apInvoiceId: a } : null
}
