// "Learn codes from portal invoices": reads the company's past SENT invoices of ONE window from the ETA portal
// (read-only) and fills the name -> code memory (source 'imported'). A row the accountant confirmed is never replaced,
// and eta_item_codes / products are never touched. One window per call (serverless time limit).
import { createPortal, type EtaEnv, type EtaPortal } from "./portal"
import { normalizeName } from "./normalize"
import { rememberCode } from "./store"

type Db = any

export const MAX_WINDOW_DAYS = 31
export const SEARCH_GAP_MS = 2000 // portal limit: about 1 search per 2 s
export const DETAILS_GAP_MS = 500 // portal limit: about 2 detail reads per second
const MAX_PAGES = 200 // safety stop
const MAX_UNKNOWN = 50

export interface LearnResult { invoices: number; lines: number; learned: number; alreadyKnown: number; conflicts: number; unknownCodes: string[] }
export interface LearnDeps { portal?: EtaPortal; sleep?: (ms: number) => Promise<void>; userId?: number | null }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (d: string) => (DAY.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN)

/** both dates must be real YYYY-MM-DD days, from <= to, and the window at most 31 days. Returns an error text, or null. */
export function windowError(from: unknown, to: unknown): string | null {
  const a = dayMs(String(from)), b = dayMs(String(to))
  if (Number.isNaN(a) || Number.isNaN(b)) return "Dates must look like 2026-01-31."
  if (new Date(a).toISOString().slice(0, 10) !== from || new Date(b).toISOString().slice(0, 10) !== to) return "Dates must look like 2026-01-31."
  if (b < a) return "The start date must not be after the end date."
  if ((b - a) / 86400000 + 1 > MAX_WINDOW_DAYS) return `Read at most ${MAX_WINDOW_DAYS} days at a time.`
  return null
}

/** the invoice lines out of a details / raw answer: the document may be a JSON text, an object, or the body itself */
export function linesOf(body: any): any[] {
  let doc = body?.document ?? body
  if (typeof doc === "string") { try { doc = JSON.parse(doc) } catch { return [] } }
  const lines = doc?.invoiceLines ?? body?.invoiceLines
  return Array.isArray(lines) ? lines : []
}

const isValid = (d: any) => String(d?.status ?? "Valid").toLowerCase() === "valid"
const isDebitNote = (d: any) => /^d(ebit.*)?$/i.test(String(d?.typeName ?? d?.documentTypeName ?? d?.documentType ?? "").trim())

export async function learnFromPortalWindow(db: Db, env: EtaEnv, win: { from: string; to: string }, deps: LearnDeps = {}): Promise<LearnResult> {
  const bad = windowError(win.from, win.to)
  if (bad) throw new Error(bad)
  const portal = deps.portal || createPortal(env)
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // 1. the valid invoices / credit notes of the window
  const uuids: string[] = []
  let token: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(SEARCH_GAP_MS)
    const body: any = await portal.searchSentWindow({ from: `${win.from}T00:00:00Z`, to: `${win.to}T23:59:59Z`, continuationToken: token })
    for (const d of Array.isArray(body?.result) ? body.result : []) {
      if (d?.uuid && isValid(d) && !isDebitNote(d) && !uuids.includes(String(d.uuid))) uuids.push(String(d.uuid))
    }
    const next = body?.metadata?.continuationToken
    if (!next || next === "EndofResultSet" || next === token) break
    token = String(next)
  }

  // 2. description -> code counts
  const { data: codeRows, error: codeErr } = await db.from("eta_item_codes").select("code_id, item_code, active")
  if (codeErr) throw new Error(codeErr.message || "Could not read the item codes")
  const codeByItem = new Map<string, number>()
  for (const c of (codeRows || []) as any[]) if (c.active !== false) codeByItem.set(String(c.item_code), Number(c.code_id))

  const agg = new Map<string, { name: string; codes: Map<number, number>; units: Map<number, string> }>()
  const unknown = new Set<string>()
  let lines = 0
  for (let i = 0; i < uuids.length; i++) {
    if (i > 0) await sleep(DETAILS_GAP_MS)
    for (const l of linesOf(await portal.getDetails(uuids[i]))) {
      lines++
      const name = String(l?.description ?? "").trim()
      const key = normalizeName(name)
      const itemCode = String(l?.itemCode ?? "").trim()
      if (!key || !itemCode) continue
      const codeId = codeByItem.get(itemCode)
      if (codeId === undefined) { unknown.add(itemCode); continue }
      const a = agg.get(key) || { name, codes: new Map(), units: new Map() }
      a.codes.set(codeId, (a.codes.get(codeId) || 0) + 1)
      if (l?.unitType) a.units.set(codeId, String(l.unitType))
      agg.set(key, a)
    }
  }

  // 3. write the memory
  const { data: memRows, error: memErr } = await db.from("eta_code_memory").select("normalized_name, code_id, source")
  if (memErr) throw new Error(memErr.message || "Could not read the code memory")
  const known = new Map<string, { code_id: number; source: string }>(((memRows || []) as any[]).map((m) => [String(m.normalized_name), m]))
  let learned = 0, alreadyKnown = 0, conflicts = 0
  for (const [key, a] of agg) {
    if (a.codes.size > 1) conflicts++
    const [codeId] = [...a.codes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]
    const have = known.get(key)
    if (have && (have.source === "confirmed" || have.code_id === codeId)) { alreadyKnown++; continue }
    await rememberCode(db, { name: a.name, codeId, unitType: a.units.get(codeId) || "", userId: deps.userId ?? null, source: "imported", keepConfirmed: true })
    learned++
  }
  return { invoices: uuids.length, lines, learned, alreadyKnown, conflicts, unknownCodes: [...unknown].slice(0, MAX_UNKNOWN) }
}
