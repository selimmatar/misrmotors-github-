// Name normalisation for e-invoice item-code matching (spec section 8.1 and 8.2). Pure, no I/O.

export const DEFAULT_BRANDS: string[] = [
  "stanley", "king tony", "kingtony", "bosch", "makita", "total", "ingco", "dewalt", "crown", "tolsen",
  "black decker", "ستانلي", "بوش", "ماكيتا", "توتال", "انجكو", "كينج توني",
]

export const SIZE_WORDS: string[] = [
  "بوصه", "انش", "مم", "سم", "متر", "م", "inch", "mm", "cm", "n.m", "نيوتن", "درج", "قطعه", "pcs", "pc",
]

export const FILLER_WORDS: string[] = [
  "كبير", "صغير", "وسط", "متوسط", "جديد", "اصلي", "اصليه", "original", "new", "large", "small", "big", "mini",
]

export function normalizeName(s: string): string {
  let out = String(s ?? "")
  out = out
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
  out = out.replace(/[^\p{L}\p{N}/]/gu, " ")
  return out.replace(/\s+/g, " ").trim()
}

function isSizeToken(t: string, dropWords: Set<string>): boolean {
  return /\d/.test(t) || /^\d+\/\d+$/.test(t) || dropWords.has(t)
}

export function coreName(normalized: string, brands: string[]): string {
  let tokens = normalized.split(" ").filter(Boolean)
  const brandPhrases = brands
    .map((b) => normalizeName(b).split(" ").filter(Boolean))
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length)
  const kept: string[] = []
  const sizeWords = new Set([...SIZE_WORDS, ...FILLER_WORDS].map(normalizeName))
  let i = 0
  while (i < tokens.length) {
    const phrase = brandPhrases.find((p) => p.every((w, k) => tokens[i + k] === w))
    if (phrase) {
      i += phrase.length
      continue
    }
    if (!isSizeToken(tokens[i], sizeWords)) kept.push(tokens[i])
    i++
  }
  tokens = kept
  return tokens.join(" ")
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}

// Dice coefficient over character bigrams, spaces ignored. 0..1.
export function similarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, "")
  const y = b.replace(/\s+/g, "")
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const bx = bigrams(x)
  const by = bigrams(y)
  let overlap = 0
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) || 0)
  return (2 * overlap) / (x.length - 1 + (y.length - 1))
}
