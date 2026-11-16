// The "Classify waiting invoices" list shape and how the screen adds up its parts. Pure: safe in the browser.
import type { CodeState } from "./codes"

export interface WaitingItem {
  name: string
  normalizedName: string
  count: number
  suggestion: { codeId: number | null; state: CodeState }
  /** invoice numbers, in the order met */
  invoices: string[]
  /** stock products billed under this name (their card takes the confirmed code when it has none) */
  productIds: number[]
}
/** Adds the items of a later part into the list so far (the screen calls part after part). */
export function mergeWaiting(into: readonly WaitingItem[], more: readonly WaitingItem[]): WaitingItem[] {
  const map = new Map<string, WaitingItem>(into.map((x) => [x.normalizedName, { ...x, invoices: [...x.invoices], productIds: [...x.productIds] }]))
  for (const m of more) {
    const have = map.get(m.normalizedName)
    if (!have) {
      map.set(m.normalizedName, { ...m, invoices: [...m.invoices], productIds: [...m.productIds] })
      continue
    }
    have.count += m.count
    for (const n of m.invoices) if (!have.invoices.includes(n)) have.invoices.push(n)
    for (const p of m.productIds) if (!have.productIds.includes(p)) have.productIds.push(p)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.normalizedName.localeCompare(b.normalizedName))
}
