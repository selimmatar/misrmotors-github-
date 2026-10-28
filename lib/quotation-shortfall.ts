// "N missing" on a quotation line: how much of the asked quantity the free stock cannot cover.
// free null (not known yet) shows nothing.
export function stockShortfall(requested: number, free: number | null | undefined): number {
  if (free === null || free === undefined || !Number.isFinite(requested)) return 0
  return Math.max(0, requested - Math.max(0, free))
}
