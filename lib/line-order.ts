// The order of the lines on a quotation / sales order (owner report, 2026-11-17: the lines showed up scattered in the
// approval view, because the database returns embedded rows in no particular order).
//   - Quotation lines are kept in sales_quotation_items.line_no (1..n, written from the form's order on every save).
//   - Sales order lines are kept in sales_order_items.line_order once scripts/sql/2026-11-18-line-order.sql is
//     applied; before that they fall back to so_item_id order (the order they were inserted in).
// Everything here is pure, except hasLineOrderColumn (one cheap read).

type Row = Record<string, any>

const positionOf = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Rows sorted by their stored position (`orderKey`), then by `idKey`. A row without a position goes after those
 *  with one. Returns a new array; the input is left alone. */
export function sortLines<T extends Row>(rows: readonly T[] | null | undefined, idKey: string, orderKey: string): T[] {
  return [...(rows || [])].sort((a, b) => {
    const pa = positionOf(a?.[orderKey])
    const pb = positionOf(b?.[orderKey])
    if (pa !== pb) {
      if (pa === null) return 1
      if (pb === null) return -1
      return pa - pb
    }
    return (Number(a?.[idKey]) || 0) - (Number(b?.[idKey]) || 0)
  })
}

/** Quotation lines (sales_quotation_items): by line_no, then id. */
export const sortQuotationLines = <T extends Row>(rows: readonly T[] | null | undefined): T[] => sortLines(rows, "id", "line_no")

/** Sales order lines (sales_order_items): by line_order when the column exists, then so_item_id. */
export const sortSoLines = <T extends Row>(rows: readonly T[] | null | undefined): T[] => sortLines(rows, "so_item_id", "line_order")

/** Lines of another document (delivery permit, invoice) put in the order of the sales order's lines they come from,
 *  matched by `keyOf`. Lines with no match keep their place after the matched ones, by `idKey`. */
export function followLineOrder<T extends Row, R extends Row>(
  rows: readonly T[] | null | undefined,
  orderedReference: readonly R[] | null | undefined,
  keyOf: (row: T) => string,
  refKeyOf: (ref: R) => string,
  idKey: string,
): T[] {
  const rank = new Map<string, number>()
  ;(orderedReference || []).forEach((ref, index) => {
    const key = refKeyOf(ref)
    if (!rank.has(key)) rank.set(key, index)
  })
  return [...(rows || [])].sort((a, b) => {
    const ra = rank.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return (Number(a?.[idKey]) || 0) - (Number(b?.[idKey]) || 0)
  })
}

/** The list with the line at `from` moved to `to` (both positions in the full list). Out-of-range moves return a copy. */
export function moveLine<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list]
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy
  const [moved] = copy.splice(from, 1)
  copy.splice(to, 0, moved)
  return copy
}

/** Where "move up" / "move down" sends the line at `index` when only `visible` lines are shown (a search is on): the
 *  position of the previous / next shown line, or null at the edge. With every line shown it is index -/+ 1. */
export function moveTarget(visible: readonly number[], index: number, direction: -1 | 1): number | null {
  const at = visible.indexOf(index)
  if (at < 0) return null
  const next = visible[at + direction]
  return next === undefined ? null : next
}

// Arabic and Latin text compared loosely: case, Arabic-Indic digits, alef / yeh / teh-marbuta forms and tatweel.
export function normalizeSearchText(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـً-ْ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Positions (in the full list, in list order) of the lines matching `query`: every word of the query must appear in
 *  one of the line's texts (item name, SKU...). An empty query matches every line. The list itself is not changed. */
export function filterLines<T>(list: readonly T[], query: string, textsOf: (line: T) => readonly unknown[]): number[] {
  const words = normalizeSearchText(query).split(" ").filter(Boolean)
  const all = list.map((_, index) => index)
  if (words.length === 0) return all
  return all.filter((index) => {
    const haystack = textsOf(list[index]).map(normalizeSearchText).join(" \u0000 ")
    return words.every((word) => haystack.includes(word))
  })
}

/** Whether sales_order_items.line_order exists (scripts/sql/2026-11-18-line-order.sql applied). Any error means no:
 *  the order is then not saved (silently) and reads fall back to so_item_id order. */
export async function hasLineOrderColumn(db: any, table = "sales_order_items"): Promise<boolean> {
  return hasColumn(db, table, "line_order")
}

/** Whether `table.column` exists (a column added by a scripts/sql file that may not be applied yet). Any error = no. */
export async function hasColumn(db: any, table: string, column: string): Promise<boolean> {
  try {
    const { error } = await db.from(table).select(column).limit(1)
    return !error
  } catch {
    return false
  }
}
