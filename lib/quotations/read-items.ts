// Items read from a photo of a printed item list (owner request, 2026-10-29): each row has an item name and a
// quantity, in a table or not. These helpers turn what was read into quotation rows.
import { toEnglishDigits } from "@/lib/po-requests/read-prices"

export type ReadItemRow = { name: string | null; quantity: string | null }
export type PhotoItem = { productName: string; quantity: number }

// What was printed -> a quantity. Missing, zero or unreadable quantities become 1 (owner ruling).
// "4", "٤", "4 pcs", "x4", "1,000" and "2.5" are read; "12,5" is a decimal comma.
export function parseQuantity(written: string | null | undefined): number {
  if (!written) return 1
  let text = toEnglishDigits(written).replace(/[^\d.,]/g, "")
  if (/^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "")
  else if (/^\d+,\d+$/.test(text)) text = text.replace(",", ".")
  const quantity = Number(text)
  return text && Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 1000) / 1000 : 1
}

// Rows whose name cannot be read are skipped and counted.
export function photoItems(rows: ReadItemRow[]): { items: PhotoItem[]; skipped: number } {
  const items: PhotoItem[] = []
  let skipped = 0
  for (const row of rows) {
    const name = String(row?.name ?? "").replace(/\s+/g, " ").trim()
    if (!name) skipped++
    else items.push({ productName: name, quantity: parseQuantity(row?.quantity) })
  }
  return { items, skipped }
}
