// Item-code matching engine (spec section 8.3 to 8.5). Pure, no I/O.
import { normalizeName, coreName, similarity } from "./normalize"

export { normalizeName, coreName, similarity, DEFAULT_BRANDS, SIZE_WORDS, FILLER_WORDS } from "./normalize"

export const AUTO_SIMILARITY = 0.92
export const SUGGEST_SIMILARITY = 0.8

export type CodeState = "green" | "orange" | "red"
export type MatchBy = "product" | "memory" | "core" | "close" | "keyword" | "none"

export interface EtaCode {
  codeId: number
  itemCode: string
  name: string
  keywords: string[]
  defaultUnit: string
  active: boolean
}

export interface MemoryRow {
  normalizedName: string
  coreName: string
  codeId: number
  unitType: string
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
}

export interface MatchResult {
  codeId: number | null
  unit: string
  state: CodeState
  by: MatchBy
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

  // 1. product card code
  if (input.productCodeId != null && active.has(input.productCodeId)) {
    return done(input.productCodeId, "green", "product", input.productUnit)
  }

  const full = normalizeName(input.name)
  const core = coreName(full, ctx.brands)
  const memory = ctx.memory.filter((r) => active.has(r.codeId))

  // 2. memory by full normalised name
  const byFull = memory.filter((r) => r.normalizedName === full)
  if (full && byFull.length) {
    const last = byFull[byFull.length - 1]
    return done(last.codeId, "green", "memory", last.unitType)
  }

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

  // 5. keyword rules
  const tokens = (core || full).split(" ").filter(Boolean)
  if (tokens.length) {
    for (const c of active.values()) {
      const kws = new Set(c.keywords.map(normalizeName).filter(Boolean))
      if (tokens.some((t) => kws.has(t))) return done(c.codeId, "orange", "keyword")
    }
  }

  // 6. unknown
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
