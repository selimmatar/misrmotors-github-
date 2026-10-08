/**
 * Strict positive-integer id parser for DELETE handlers. Accepts only digit strings ("12"), so a missing, blank,
 * "abc", "1abc", "0", "-3" or "1.5" id is rejected instead of silently turning into a bulk delete or a NaN filter.
 */
export function parsePositiveId(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!/^\d{1,15}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
