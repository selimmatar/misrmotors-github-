// Item-by-item comparison of a matched bill (or a linked group) with the supplier's portal invoice(s) (owner request
// 2026-11-17). "Our lines" are the bill lines (what was received and billed); the portal lines come from the portal
// details. Each possible pair is scored on name similarity, the supplier's own item code, quantity, unit price, line
// total and the supplier's pair memory (pairs the accountant confirmed or took apart); pairs are then taken best first,
// each line used once. Pure, no I/O.
import { DEFAULT_BRANDS, coreName, normalizeName, similarity } from "./normalize"

export interface OurLine {
  /** unique in one comparison: "l<line_id>" (a bill line) or "p<invoice_id>-<po_item_id>" (a PO line of a bill without lines) */
  key: string
  apInvoiceId: number
  poItemId: number | null
  productId: number | null
  name: string
  quantity: number
  unitPrice: number
  /** before VAT */
  total: number
}
export interface PortalLine {
  /** "<received_id>:<index>" */
  key: string
  receivedId: number
  index: number
  description: string
  itemCode: string | null
  internalCode: string | null
  unitType: string | null
  quantity: number
  unitPrice: number
  /** before VAT (the portal's net total, else quantity x unit price) */
  total: number
}
export type PairKind = "confirmed" | "rejected"
export interface PairMemory {
  supplier_id: number
  portal_name: string
  portal_code: string
  our_key: string
  product_id?: number | null
  kind: PairKind | string
}
export type LineStatus = "matched" | "differs" | "only_erp" | "only_portal"
export interface LineDiffs {
  quantity: boolean
  unitPrice: boolean
  total: boolean
}
export interface LineRow {
  status: LineStatus
  our: OurLine | null
  portal: PortalLine | null
  score: number | null
  diffs: LineDiffs | null
  /** a remembered pair (the accountant confirmed it before) */
  remembered: boolean
  reasons: string[]
}
export interface LineSummary {
  matched: number
  differs: number
  only_erp: number
  only_portal: number
  ourTotal: number
  portalTotal: number
}

export const LINE_SCORE = {
  remembered: 100, // a pair the accountant confirmed outweighs everything else
  name: 35, // x similarity 0..1
  code: 15, // the supplier's item code written in our item name
  quantity: 15,
  quantityPart: 7, // x smaller / larger quantity
  price: 15,
  priceClose: 7, // within 5 %
  total: 10,
} as const
/** a unit price within this share (or 0.01) is the same price */
export const PRICE_SHARE = 0.005
export const LINE_TOTAL_TOLERANCE = 0.5
export const QTY_EPS = 0.0005

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const text = (v: unknown) => (v == null ? "" : String(v).trim())
const compact = (v: unknown) => text(v).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** the key that remembers our side of a pair: the product, or the item's name when it has no product card */
export const ourMemoryKey = (l: Pick<OurLine, "productId" | "name">) => (l.productId != null ? `p:${l.productId}` : `n:${normalizeName(l.name)}`)
/** the supplier's own code of a portal line: its internal code, else its tax-portal item code */
export const portalCodeOf = (l: Pick<PortalLine, "internalCode" | "itemCode">) => text(l.internalCode) || text(l.itemCode)
export const portalNameOf = (l: Pick<PortalLine, "description">) => normalizeName(l.description)

/** the portal lines of one document as stored (eta_received_documents.lines) */
export function portalLinesOf(receivedId: number, stored: unknown): PortalLine[] {
  const rows: any[] = Array.isArray(stored) ? stored : []
  return rows.map((l, index) => {
    const quantity = n(l?.quantity)
    const unitPrice = n(l?.unitPrice ?? l?.unitValue?.amountEGP)
    const net = l?.netTotal ?? l?.salesTotal
    return {
      key: `${receivedId}:${index}`,
      receivedId,
      index,
      description: text(l?.description),
      itemCode: text(l?.itemCode) || null,
      internalCode: text(l?.internalCode) || null,
      unitType: text(l?.unitType) || null,
      quantity,
      unitPrice,
      total: round2(net != null && Number.isFinite(Number(net)) ? Number(net) : quantity * unitPrice),
    }
  })
}

const samePrice = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * PRICE_SHARE)
export function diffsOf(o: OurLine, p: PortalLine): LineDiffs {
  return {
    quantity: Math.abs(o.quantity - p.quantity) > QTY_EPS,
    unitPrice: !samePrice(o.unitPrice, p.unitPrice),
    total: Math.abs(o.total - p.total) > LINE_TOTAL_TOLERANCE,
  }
}

function nameScore(a: string, b: string): number {
  const x = normalizeName(a), y = normalizeName(b)
  if (!x || !y) return 0
  let s = similarity(x, y)
  const cx = coreName(x, DEFAULT_BRANDS), cy = coreName(y, DEFAULT_BRANDS)
  if (cx && cy) s = Math.max(s, similarity(cx, cy))
  // one name inside the other ("filter" and "oil filter 10w")
  const sx = x.replace(/\s+/g, ""), sy = y.replace(/\s+/g, "")
  if (Math.min(sx.length, sy.length) >= 4 && (sx.includes(sy) || sy.includes(sx))) s = Math.max(s, 0.75)
  return s
}

export interface PairScore {
  score: number
  eligible: boolean
  remembered: boolean
  rejected: boolean
  reasons: string[]
}

/** the memory rows that speak about this portal line: the same supplier code, or the same name (and no other code) */
export function memoryFor(p: PortalLine, memory: readonly PairMemory[]): PairMemory[] {
  const code = portalCodeOf(p)
  const name = portalNameOf(p)
  return memory.filter((m) => {
    const mc = text(m.portal_code), mn = text(m.portal_name)
    if (mc && code) return mc === code
    return !!mn && mn === name
  })
}

export function scoreLinePair(o: OurLine, p: PortalLine, memory: readonly PairMemory[] = []): PairScore {
  const reasons: string[] = []
  const mine = memoryFor(p, memory).filter((m) => m.our_key === ourMemoryKey(o))
  const rejected = mine.some((m) => m.kind === "rejected")
  const remembered = !rejected && mine.some((m) => m.kind === "confirmed")
  let score = 0
  if (remembered) {
    score += LINE_SCORE.remembered
    reasons.push("remembered")
  }
  const sim = nameScore(o.name, p.description)
  score += LINE_SCORE.name * sim
  if (sim >= 0.45) reasons.push("name")
  const code = compact(portalCodeOf(p))
  const codeHit = code.length >= 4 && compact(o.name).includes(code)
  if (codeHit) {
    score += LINE_SCORE.code
    reasons.push("code")
  }
  const qtyEq = Math.abs(o.quantity - p.quantity) <= QTY_EPS
  if (qtyEq) {
    score += LINE_SCORE.quantity
    reasons.push("quantity")
  } else if (o.quantity > 0 && p.quantity > 0) score += LINE_SCORE.quantityPart * (Math.min(o.quantity, p.quantity) / Math.max(o.quantity, p.quantity))
  const priceEq = samePrice(o.unitPrice, p.unitPrice)
  if (priceEq) {
    score += LINE_SCORE.price
    reasons.push("price")
  } else if (o.unitPrice > 0 && Math.abs(o.unitPrice - p.unitPrice) / o.unitPrice <= 0.05) score += LINE_SCORE.priceClose
  if (Math.abs(o.total - p.total) <= LINE_TOTAL_TOLERANCE) {
    score += LINE_SCORE.total
    reasons.push("total")
  }
  const eligible = !rejected && (remembered || codeHit || sim >= 0.45 || (sim >= 0.25 && (qtyEq || priceEq)) || (qtyEq && priceEq))
  return { score: Math.round(score * 10) / 10, eligible, remembered, rejected, reasons }
}

/** pairs best first, each line used once; the rest is "only in ERP" / "only on the portal" */
export function compareLines(ours: readonly OurLine[], portal: readonly PortalLine[], memory: readonly PairMemory[] = []): { rows: LineRow[]; summary: LineSummary } {
  const cands: { o: OurLine; p: PortalLine; s: PairScore }[] = []
  for (const o of ours)
    for (const p of portal) {
      const s = scoreLinePair(o, p, memory)
      if (s.eligible) cands.push({ o, p, s })
    }
  cands.sort(
    (x, y) =>
      y.s.score - x.s.score ||
      Math.abs(x.o.total - x.p.total) - Math.abs(y.o.total - y.p.total) ||
      x.o.key.localeCompare(y.o.key) ||
      x.p.receivedId - y.p.receivedId ||
      x.p.index - y.p.index,
  )
  const usedO = new Set<string>()
  const usedP = new Set<string>()
  const paired = new Map<string, LineRow>()
  for (const c of cands) {
    if (usedO.has(c.o.key) || usedP.has(c.p.key)) continue
    usedO.add(c.o.key)
    usedP.add(c.p.key)
    const diffs = diffsOf(c.o, c.p)
    paired.set(c.o.key, {
      status: diffs.quantity || diffs.unitPrice || diffs.total ? "differs" : "matched",
      our: c.o,
      portal: c.p,
      score: c.s.score,
      diffs,
      remembered: c.s.remembered,
      reasons: c.s.reasons,
    })
  }
  const rows: LineRow[] = []
  for (const o of ours) rows.push(paired.get(o.key) || { status: "only_erp", our: o, portal: null, score: null, diffs: null, remembered: false, reasons: [] })
  for (const p of portal) if (!usedP.has(p.key)) rows.push({ status: "only_portal", our: null, portal: p, score: null, diffs: null, remembered: false, reasons: [] })
  const summary: LineSummary = { matched: 0, differs: 0, only_erp: 0, only_portal: 0, ourTotal: 0, portalTotal: 0 }
  for (const r of rows) summary[r.status]++
  summary.ourTotal = round2(ours.reduce((s, o) => s + o.total, 0))
  summary.portalTotal = round2(portal.reduce((s, p) => s + p.total, 0))
  return { rows, summary }
}
