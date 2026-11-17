// Item-code matching engine (spec section 8.3 to 8.5). Pure, no I/O.
import { normalizeName, coreName, similarity } from "./normalize"
import type { Predictor } from "./predict"

export { normalizeName, coreName, similarity, DEFAULT_BRANDS, SIZE_WORDS, FILLER_WORDS } from "./normalize"

export const AUTO_SIMILARITY = 0.92
export const SUGGEST_SIMILARITY = 0.8

export type CodeState = "green" | "orange" | "red"
export type MatchBy = "product" | "memory" | "portal" | "core" | "close" | "predict" | "keyword" | "none"

export interface EtaCode {
  codeId: number
  itemCode: string
  name: string
  keywords: string[]
  defaultUnit: string
  active: boolean
  /** the portal scheme stored on the code (eta_item_codes.code_type); absent when not set */
  codeType?: "EGS" | "GS1"
}

export interface MemoryRow {
  normalizedName: string
  coreName: string
  codeId: number
  unitType: string
  /** "confirmed" (the accountant) or "imported" (learned); absent in older callers */
  source?: string
}

export interface MatchInput {
  name: string
  productCodeId?: number | null
  productUnit?: string | null
}

export interface MatchContext {
  codes: EtaCode[]
  memory: MemoryRow[]
  brands: string[]
  /** name -> code prediction over the memory (lib/eta/predict.ts); built once per request by loadMatchContext */
  predictor?: Predictor
}

export interface MatchResult {
  codeId: number | null
  unit: string
  state: CodeState
  by: MatchBy
  /**
   * set (by "portal") when the code the accountant used on the portal for this exact name differs from the product
   * card's code: the line is orange and the invoice is not sent until the accountant confirms the line
   */
  portalCodeId?: number
}

export function matchCode(input: MatchInput, ctx: MatchContext): MatchResult {
  const active = new Map<number, EtaCode>()
  for (const c of ctx.codes) if (c.active) active.set(c.codeId, c)
  const unitFor = (codeId: number, preferred?: string | null) =>
    preferred || active.get(codeId)?.defaultUnit || "EA"
  const done = (codeId: number, state: CodeState, by: MatchBy, preferred?: string | null): MatchResult => ({
    codeId,
    unit: unitFor(codeId, preferred),
    state,
    by,
  })

  const full = normalizeName(input.name)
  const core = coreName(full, ctx.brands)
  const memory = ctx.memory.filter((r) => active.has(r.codeId))
  const exact = full ? memory.filter((r) => r.normalizedName === full) : []
  const exactRow = exact[exact.length - 1]

  // 1. product card code - unless the memory holds a different code for this exact name: the accountant's own
  //    decision (confirmed, green) or the code learned from the accountant's portal invoices (imported: orange, to be
  //    confirmed before the invoice can be sent)
  if (input.productCodeId != null && active.has(input.productCodeId)) {
    if (exactRow && exactRow.codeId !== input.productCodeId) {
      if (exactRow.source === "confirmed") return done(exactRow.codeId, "green", "memory", exactRow.unitType)
      if (exactRow.source === "imported") return { ...done(exactRow.codeId, "orange", "portal", exactRow.unitType), portalCodeId: exactRow.codeId }
    }
    return done(input.productCodeId, "green", "product", input.productUnit)
  }

  // 2. memory by full normalised name
  if (exactRow) return done(exactRow.codeId, "green", "memory", exactRow.unitType)

  if (core) {
    // 3. memory by core name
    const byCore = memory.filter((r) => r.coreName === core)
    if (byCore.length) {
      const last = byCore[byCore.length - 1]
      const agree = byCore.every((r) => r.codeId === last.codeId)
      return done(last.codeId, agree ? "green" : "orange", "core", last.unitType)
    }

    // 4. close spelling of a remembered core name
    let best = 0
    let bestCore = ""
    for (const r of memory) {
      if (!r.coreName) continue
      const s = similarity(core, r.coreName)
      if (s > best) {
        best = s
        bestCore = r.coreName
      }
    }
    if (best >= SUGGEST_SIMILARITY) {
      const rows = memory.filter((r) => r.coreName === bestCore)
      const last = rows[rows.length - 1]
      const agree = rows.every((r) => r.codeId === last.codeId)
      const state: CodeState = best >= AUTO_SIMILARITY && agree ? "green" : "orange"
      return done(last.codeId, state, "close", last.unitType)
    }
  }

  // 5. predicted from similar remembered names: green acts as a memory hit, orange as a suggestion. Never written
  // to the memory by itself; confirming the line (POST /api/eta/memory) remembers it.
  if (ctx.predictor) {
    const p = ctx.predictor.predict(input.name)
    if (p.state !== "red" && p.codeId != null && active.has(p.codeId)) {
      const near = p.neighbours.find((n) => n.codeId === p.codeId)
      const row = near ? memory.find((r) => r.normalizedName === near.name && r.codeId === p.codeId) : undefined
      return done(p.codeId, p.state, "predict", row?.unitType)
    }
  }

  // 6. keyword rules
  const tokens = (core || full).split(" ").filter(Boolean)
  if (tokens.length) {
    for (const c of active.values()) {
      const kws = new Set(c.keywords.map(normalizeName).filter(Boolean))
      if (tokens.some((t) => kws.has(t))) return done(c.codeId, "orange", "keyword")
    }
  }

  // 7. unknown
  return { codeId: null, unit: "EA", state: "red", by: "none" }
}

export interface PrepareRowIn {
  name: string
  /** the code the match suggested */
  codeId: number | null
  /** the unit the match gave for that code */
  unit: string
  /** the code picked on screen ("none" or a code id) */
  pick: string
  skip: boolean
}

/**
 * "Prepare from past items": the rows to remember. A row whose code was changed on screen takes the picked code's
 * default unit ("" lets the server use it), never the unit matched for the code it replaced.
 */
export function prepareRowsToPost(
  rows: readonly PrepareRowIn[],
  codes: readonly { code_id: number; default_unit?: string | null }[],
): { name: string; codeId: number; unitType: string }[] {
  const unitOf = new Map(codes.map((c) => [c.code_id, c.default_unit || ""]))
  return rows
    .filter((r) => !r.skip && r.pick !== "none" && r.pick !== "")
    .map((r) => {
      const codeId = Number(r.pick)
      const kept = r.codeId != null && codeId === r.codeId
      return { name: r.name, codeId, unitType: kept ? r.unit || "" : unitOf.get(codeId) ?? "" }
    })
}

/** "Prepare from past items": the most rows one save request takes; the screen sends them in chunks of this size. */
export const PREPARE_BATCH = 50

/** Splits `items` into consecutive chunks of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}
