// "Classify waiting invoices": the lines of customer invoices made after go-live that are not on the real portal yet
// and whose item code is not green, grouped by name, so the accountant settles each name once. Read-only.
import { excludeReplaced } from "../ar-live"
import { normalizeName } from "./normalize"
import { buildEtaPreview } from "./preview"
import { loadMatchContext, readEtaSettings } from "./store"
import { isAfterGoLive } from "./totals"
import type { WaitingItem } from "./waiting-list"

export type { WaitingItem } from "./waiting-list"
export { mergeWaiting } from "./waiting-list"

type Db = any

/** one request stops starting new invoices after this long (the server cuts requests at 60 s); the screen continues from the cursor */
export const WAITING_BUDGET_MS = 40_000
const PAGE = 1000

export interface WaitingResult {
  items: WaitingItem[]
  /** invoices looked at in this call */
  invoices: number
  /** the next call's cursor (an index in the waiting invoices, oldest first); null when done */
  cursor: number | null
  goLive: string | null
}
export interface WaitingDeps { now?: () => number; budgetMs?: number }

/** A real document that keeps the invoice off the waiting list: anything but needs review / invalid (manual = handled manually). */
const onPortal = (r: any) => (r.environment || "real") === "real" && (r.document_type === "C" || !["needs_review", "invalid"].includes(r.status))

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

/** The ids of the invoices still to be sent (after go-live, no live real document, not replaced), oldest first. */
export async function waitingInvoiceIds(db: Db, goLiveAt: string): Promise<{ id: number; number: string }[]> {
  const since = new Date(goLiveAt)
  if (Number.isNaN(since.getTime())) return []
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const page = must(
      await excludeReplaced(db.from("accounts_receivable").select("invoice_id, invoice_number, created_at, status"))
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true })
        .order("invoice_id", { ascending: true })
        .range(from, from + PAGE - 1),
      "load invoices",
    ) as any[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  const after = rows.filter((r) => isAfterGoLive(r.created_at, goLiveAt))
  if (after.length === 0) return []
  const docs: any[] = []
  const ids = after.map((r) => r.invoice_id)
  for (let i = 0; i < ids.length; i += 200) {
    docs.push(...(must(await db.from("eta_documents").select("invoice_id, document_type, environment, status").in("invoice_id", ids.slice(i, i + 200)), "load e-invoice documents") as any[]))
  }
  const skip = new Set(docs.filter(onPortal).map((d) => d.invoice_id))
  return after.filter((r) => !skip.has(r.invoice_id)).map((r) => ({ id: r.invoice_id, number: String(r.invoice_number ?? "") }))
}

/** Groups the not-green lines of the waiting invoices by normalised name, most frequent first. Continues from `cursor`. */
export async function classifyWaiting(db: Db, cursor: number | null = null, deps: WaitingDeps = {}): Promise<WaitingResult> {
  const settings = await readEtaSettings(db)
  const goLive = String(settings.eta_go_live_at || "").trim()
  if (!goLive) return { items: [], invoices: 0, cursor: null, goLive: null }
  const now = deps.now || (() => Date.now())
  const budget = deps.budgetMs ?? WAITING_BUDGET_MS
  const started = now()

  const [invoices, ctx] = await Promise.all([waitingInvoiceIds(db, goLive), loadMatchContext(db)])
  const first = Math.max(0, Math.floor(Number(cursor) || 0))
  const groups = new Map<string, WaitingItem & { spellings: Map<string, number> }>()
  let i = first
  for (; i < invoices.length; i++) {
    if (i > first && now() - started > budget) break
    const preview = await buildEtaPreview(db, invoices[i].id, { ctx, settings })
    if (!preview || preview.handledManually) continue
    for (const line of preview.lines) {
      if (line.state === "green") continue
      const key = normalizeName(line.name)
      if (!key) continue
      let g = groups.get(key)
      if (!g) {
        g = { name: line.name, normalizedName: key, count: 0, suggestion: { codeId: line.codeId, state: line.state }, invoices: [], productIds: [], spellings: new Map() }
        groups.set(key, g)
      }
      g.count++
      g.spellings.set(line.name, (g.spellings.get(line.name) || 0) + 1)
      if (!g.invoices.includes(invoices[i].number)) g.invoices.push(invoices[i].number)
      if (line.productId != null && !g.productIds.includes(line.productId)) g.productIds.push(line.productId)
    }
  }
  const items: WaitingItem[] = [...groups.values()].map(({ spellings, ...g }) => {
    let best = 0
    for (const [spelling, n] of spellings) if (n > best) ((best = n), (g.name = spelling))
    return g
  })
  items.sort((a, b) => b.count - a.count || a.normalizedName.localeCompare(b.normalizedName))
  return { items, invoices: i - first, cursor: i < invoices.length ? i : null, goLive }
}
