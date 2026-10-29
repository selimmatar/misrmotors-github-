// Handwritten prices on a printed price request (PR): the supplier writes one unit price per row in the box
// column, the PR is photographed, and the photo is read row by row. These helpers keep the row numbers on paper
// and on screen the same, and turn what was written (Arabic or English digits) into a number.

type ItemWithId = { item_id: number }

// The printed rows and the on-screen rows both use this order, so "row 3" means the same item in both places.
export function sortRequestItems<T extends ItemWithId>(items: T[]): T[] {
  return [...items].sort((a, b) => a.item_id - b.item_id)
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

export function toEnglishDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, ",")
}

// What the supplier wrote -> a price, or null when it cannot be read safely (left empty for a person to type).
// "1,250" and "1.250.000" are thousands; "12,5" is a decimal comma; "1250/-" is 1250.
export function parseWrittenPrice(written: string | null | undefined): number | null {
  if (!written) return null
  let text = toEnglishDigits(written)
    .replace(/ج\.?\s*م\.?|جنيه|EGP|L\.?E\.?/gi, "")
    .replace(/\/-+\s*$/, "")
  if (/\d\s*\/\s*\d/.test(text)) return null
  text = text.replace(/[^\d.,]/g, "")
  if (!/\d/.test(text)) return null
  const hasComma = text.includes(",")
  const dots = (text.match(/\./g) || []).length
  if (hasComma && dots) {
    text = text.replace(/,/g, "")
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "")
    else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".")
    else return null
  } else if (dots > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(text)) return null
    text = text.replace(/\./g, "")
  }
  text = text.replace(/^\.|\.$/g, "")
  const price = Number(text)
  return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null
}

export type ReadRow = { row: number; written: string | null }

// Row numbers read from the photo -> unit price per item_id. Rows that are empty, unreadable or not on the
// request are left out.
export function pricesByItem<T extends ItemWithId>(items: T[], rows: ReadRow[]): Record<number, number> {
  const ordered = sortRequestItems(items)
  const prices: Record<number, number> = {}
  for (const read of rows) {
    const item = ordered[read.row - 1]
    const price = parseWrittenPrice(read.written)
    if (item && price !== null) prices[item.item_id] = price
  }
  return prices
}

export const sameRequestNumber = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && toEnglishDigits(a).replace(/[^a-z0-9]/gi, "").toLowerCase() === toEnglishDigits(b).replace(/[^a-z0-9]/gi, "").toLowerCase()
