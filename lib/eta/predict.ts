// Predicts an item's e-invoice code from its name (free, no external service). Pure, no I/O.
//
// The same item is written many ways ("مفك صليبة" / "مفك صليبة بطيخة"), so exact and close-spelling memory miss
// many lines. Here every remembered name (eta_code_memory) and, more weakly, every code's own name is a document; a
// new name is compared with all of them by TF-IDF cosine over its words (lightly stemmed) and the 3-letter pieces of
// each word (so misspellings still meet). Rare words count more than common ones ("عده", "هيدروليك"). The codes of
// the nearest names vote; the state says how sure the vote is.
import { coreName, normalizeName, DEFAULT_BRANDS } from "./normalize"

/** green only when the closest remembered name is at least this similar ... */
export const GREEN_SIMILARITY = 0.85
/** ... and the winning code holds at least this share of all the votes ... */
export const GREEN_CONFIDENCE = 0.9
/** ... and this many distinct neighbours of the winning code agree (or one the accountant confirmed) */
export const GREEN_AGREE = 2
/** orange (a suggestion) when the closest name is at least this similar and the code holds this share */
export const ORANGE_SIMILARITY = 0.45
export const ORANGE_CONFIDENCE = 0.5
/** a neighbour "agrees" when it is at least this similar */
export const AGREE_SIMILARITY = ORANGE_SIMILARITY
/** neighbours below this similarity are noise and get no vote */
export const MIN_NEIGHBOUR_SIMILARITY = 0.25
/** each code's score is the sum of its best K neighbours' votes */
export const TOP_K = 5
/**
 * a neighbour votes its similarity to this power: a plain sum let many half-similar names that only share a common
 * word ("مفك ...", "... عده") outvote the one name that really matches
 */
export const VOTE_POWER = 4
/** a confirmed memory row votes this many times an imported one */
export const CONFIRMED_WEIGHT = 2
/** a code's own name votes this much of a memory row */
export const CODE_NAME_WEIGHT = 0.5
/** the 3-letter pieces of a word together weigh this much of the word itself */
export const GRAM_WEIGHT = 2
/** how many neighbours the answer lists */
export const NEIGHBOURS_SHOWN = 5

export type PredictState = "green" | "orange" | "red"

export interface PredictMemoryRow {
  normalized_name: string
  core_name?: string | null
  code_id: number
  source?: string | null
}
export interface PredictCode {
  code_id: number
  name?: string | null
  active?: boolean | null
}
export interface Neighbour {
  name: string
  codeId: number
  score: number
}
export interface Prediction {
  codeId: number | null
  confidence: number
  state: PredictState
  neighbours: Neighbour[]
  /** the best neighbour similarity of the chosen code and how many near neighbours agree (for calibration) */
  best?: number
  agree?: number
  confirmedAgree?: boolean
}
export interface Predictor {
  predict(name: string): Prediction
  /** the number of distinct names the predictor compares against */
  size: number
}

const SUFFIXES = ["ين", "ات", "ه"]

/** light Arabic stemming: drop a leading "ال", then one common suffix while the word stays long enough */
export function stem(word: string): string {
  let w = word
  if (w.startsWith("ال") && w.length >= 5) w = w.slice(2)
  if (w.length > 4) {
    for (const s of SUFFIXES) {
      if (w.endsWith(s) && w.length - s.length >= 3) {
        w = w.slice(0, -s.length)
        break
      }
    }
  }
  return w
}

/** the stemmed words of an already-core name: pure numbers / sizes / single letters dropped */
export function words(core: string): string[] {
  return core
    .split(" ")
    .filter((t) => t && !/\d/.test(t) && t.length > 1)
    .map(stem)
}

/** term -> raw weight: each word once, and its 3-letter pieces sharing GRAM_WEIGHT */
function terms(core: string): Map<string, number> {
  const out = new Map<string, number>()
  const add = (k: string, v: number) => out.set(k, (out.get(k) || 0) + v)
  for (const w of words(core)) {
    add(`w:${w}`, 1)
    const padded = `#${w}#`
    const grams: string[] = []
    for (let i = 0; i + 3 <= padded.length; i++) grams.push(padded.slice(i, i + 3))
    for (const g of grams) add(`g:${g}`, GRAM_WEIGHT / grams.length)
  }
  return out
}

interface Entry {
  name: string
  codeId: number
  weight: number
  confirmed: boolean
  terms: Map<string, number>
  /** the core name the entry stands for (leave-one-out removes every entry of a held-out core) */
  core: string
  /** the TF-IDF vector, unit length */
  vec: Map<string, number>
}

const idfOf = (n: number, df: number) => Math.log((n + 1) / (df + 1)) + 1

function unit(raw: Map<string, number>, idf: (t: string) => number): Map<string, number> {
  const v = new Map<string, number>()
  let norm = 0
  for (const [t, tf] of raw) {
    const w = tf * idf(t)
    if (w <= 0) continue
    v.set(t, w)
    norm += w * w
  }
  norm = Math.sqrt(norm)
  if (norm > 0) for (const [t, w] of v) v.set(t, w / norm)
  return v
}

interface Built {
  entries: Entry[]
  df: Map<string, number>
  postings: Map<string, number[]>
  brands: string[]
}

function build(memory: readonly PredictMemoryRow[], codes: readonly PredictCode[], brands: string[]): Built {
  const active = new Set(codes.filter((c) => c.active !== false).map((c) => Number(c.code_id)))
  const usable = (id: number) => codes.length === 0 || active.has(id)

  // one entry per distinct (core name, code): the full-name row and the core row of the same item vote once
  const byKey = new Map<string, Entry>()
  for (const m of memory) {
    const codeId = Number(m.code_id)
    if (!usable(codeId)) continue
    const core = String(m.core_name || "").trim() || coreName(normalizeName(m.normalized_name), brands)
    if (!core) continue
    const key = `m|${core}|${codeId}`
    const confirmed = m.source === "confirmed"
    const hit = byKey.get(key)
    if (hit) {
      if (confirmed && !hit.confirmed) ((hit.confirmed = true), (hit.weight = CONFIRMED_WEIGHT))
      continue
    }
    const t = terms(core)
    if (t.size === 0) continue
    byKey.set(key, { name: m.normalized_name, codeId, weight: confirmed ? CONFIRMED_WEIGHT : 1, confirmed, terms: t, core, vec: new Map() })
  }
  for (const c of codes) {
    if (c.active === false || !c.name) continue
    // a code name is often "عربي / English": each side is its own weak entry
    for (const part of String(c.name).split("/")) {
      const core = coreName(normalizeName(part), brands)
      const t = terms(core)
      if (!core || t.size === 0) continue
      const key = `c|${core}|${c.code_id}`
      if (!byKey.has(key)) byKey.set(key, { name: normalizeName(part), codeId: Number(c.code_id), weight: CODE_NAME_WEIGHT, confirmed: false, terms: t, core: `code:${core}`, vec: new Map() })
    }
  }
  const entries = [...byKey.values()]
  const df = new Map<string, number>()
  for (const e of entries) for (const t of e.terms.keys()) df.set(t, (df.get(t) || 0) + 1)
  const n = entries.length
  const postings = new Map<string, number[]>()
  entries.forEach((e, i) => {
    e.vec = unit(e.terms, (t) => idfOf(n, df.get(t) || 0))
    for (const t of e.vec.keys()) {
      let p = postings.get(t)
      if (!p) postings.set(t, (p = []))
      p.push(i)
    }
  })
  return { entries, df, postings, brands }
}

interface CodeVote { sims: number[]; score: number; agree: number; confirmedAgree: boolean; best: number }

function predictWith(b: Built, name: string, exclude?: (e: Entry) => boolean, excludedDf?: Map<string, number>): Prediction {
  const red: Prediction = { codeId: null, confidence: 0, state: "red", neighbours: [] }
  const core = coreName(normalizeName(name), b.brands)
  if (!core) return red
  const n = b.entries.length - (excludedDf ? (excludedDf.get("__n") || 0) : 0)
  // a word nobody has used carries no evidence: only terms seen in the other names count
  const q = unit(terms(core), (t) => {
    const df = (b.df.get(t) || 0) - (excludedDf?.get(t) || 0)
    return df > 0 ? idfOf(n, df) : 0
  })
  if (q.size === 0) return red

  const dots = new Map<number, number>()
  for (const [t, w] of q) {
    for (const i of b.postings.get(t) || []) dots.set(i, (dots.get(i) || 0) + w * (b.entries[i].vec.get(t) || 0))
  }
  const near: { e: Entry; sim: number }[] = []
  for (const [i, sim] of dots) {
    const e = b.entries[i]
    if (sim < MIN_NEIGHBOUR_SIMILARITY || (exclude && exclude(e))) continue
    near.push({ e, sim: Math.min(1, sim) })
  }
  if (near.length === 0) return red
  near.sort((x, y) => y.sim - x.sim || x.e.codeId - y.e.codeId)

  const perCode = new Map<number, CodeVote>()
  for (const { e, sim } of near) {
    let c = perCode.get(e.codeId)
    if (!c) perCode.set(e.codeId, (c = { sims: [], score: 0, agree: 0, confirmedAgree: false, best: 0 }))
    if (c.sims.length >= TOP_K) continue
    c.sims.push(sim)
    c.score += Math.pow(sim, VOTE_POWER) * e.weight
    c.best = Math.max(c.best, sim)
    if (sim >= AGREE_SIMILARITY && e.weight >= 1) {
      c.agree++
      if (e.confirmed) c.confirmedAgree = true
    }
  }
  let total = 0
  let top: [number, CodeVote] | null = null
  for (const entry of perCode) {
    total += entry[1].score
    if (!top || entry[1].score > top[1].score || (entry[1].score === top[1].score && entry[0] < top[0])) top = entry
  }
  if (!top || total <= 0) return red
  const [codeId, c] = top
  const confidence = c.score / total
  const best = c.best
  const neighbours = near.slice(0, NEIGHBOURS_SHOWN).map(({ e, sim }) => ({ name: e.name, codeId: e.codeId, score: Math.round(sim * 1000) / 1000 }))
  const agreed = c.agree >= GREEN_AGREE || c.confirmedAgree
  const state: PredictState =
    best >= GREEN_SIMILARITY && confidence >= GREEN_CONFIDENCE && agreed
      ? "green"
      : best >= ORANGE_SIMILARITY && confidence >= ORANGE_CONFIDENCE
        ? "orange"
        : "red"
  return {
    codeId: state === "red" ? null : codeId,
    confidence: Math.round(confidence * 1000) / 1000,
    state,
    neighbours,
    best: Math.round(best * 1000) / 1000,
    agree: c.agree,
    confirmedAgree: c.confirmedAgree,
    // the chosen code before the red cut, so calibration can score it
    ...(state === "red" ? { candidate: codeId } : {}),
  } as Prediction
}

/**
 * The predictor over the remembered names and the code names. Memory rows of an inactive code are left out (when a
 * code list is given). Confirmed rows weigh CONFIRMED_WEIGHT, code names CODE_NAME_WEIGHT.
 */
export function buildPredictor(memory: readonly PredictMemoryRow[], codes: readonly PredictCode[], brands: string[] = DEFAULT_BRANDS): Predictor {
  const b = build(memory, codes, brands)
  return { predict: (name: string) => predictWith(b, name), size: b.entries.length }
}

export interface EvaluateReport {
  green: { n: number; correct: number }
  orange: { n: number; correct: number }
  red: number
  /** distinct remembered names tried */
  total: number
  /** what other green rules would give on the same data: n auto-filled and how many were right */
  calibration?: { similarity: number; confidence: number; agree: number; n: number; correct: number; accuracy: number }[]
}

/**
 * Leave-one-out accuracy, for tuning the thresholds on real data: each distinct remembered core name is held out
 * (every memory row of that core name, so its twin full-name row does not give the answer away) and predicted from
 * the rest; the answer is compared with the code it is remembered under.
 */
export function evaluate(memory: readonly PredictMemoryRow[], codes: readonly PredictCode[] = [], brands: string[] = DEFAULT_BRANDS): EvaluateReport {
  const b = build(memory, codes, brands)
  const report: EvaluateReport = { green: { n: 0, correct: 0 }, orange: { n: 0, correct: 0 }, red: 0, total: 0 }
  const cores = new Map<string, Entry[]>()
  for (const e of b.entries) {
    if (e.core.startsWith("code:")) continue
    const list = cores.get(e.core) || []
    list.push(e)
    cores.set(e.core, list)
  }
  const samples: { best: number; confidence: number; agree: number; confirmedAgree: boolean; right: boolean }[] = []
  for (const [core, held] of cores) {
    // the document frequencies without the held-out entries
    const excludedDf = new Map<string, number>([["__n", held.length]])
    for (const e of held) for (const t of e.terms.keys()) excludedDf.set(t, (excludedDf.get(t) || 0) + 1)
    const p = predictWith(b, core, (e) => e.core === core, excludedDf)
    // the expected code: the one most of the held-out rows carry (a confirmed row wins a tie)
    const votes = new Map<number, number>()
    for (const e of held) votes.set(e.codeId, (votes.get(e.codeId) || 0) + e.weight)
    const expected = [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]
    report.total++
    const chosen = p.codeId ?? (p as any).candidate ?? null
    if (chosen != null) samples.push({ best: p.best ?? 0, confidence: p.confidence, agree: p.agree ?? 0, confirmedAgree: !!p.confirmedAgree, right: chosen === expected })
    if (p.state === "red") report.red++
    else {
      report[p.state].n++
      if (p.codeId === expected) report[p.state].correct++
    }
  }
  report.calibration = []
  for (const similarity of [0.75, 0.8, 0.85, 0.9, 0.95])
    for (const confidence of [0.75, 0.85, 0.9, 0.95])
      for (const agree of [2, 3]) {
        const hit = samples.filter((x) => x.best >= similarity && x.confidence >= confidence && (x.agree >= agree || x.confirmedAgree))
        const correct = hit.filter((x) => x.right).length
        report.calibration.push({ similarity, confidence, agree, n: hit.length, correct, accuracy: hit.length ? Math.round((correct / hit.length) * 1000) / 1000 : 0 })
      }
  return report
}
