// Pre-numbered carbon booklets (spec 2026-11-19, Part 3). A booklet holds a block of MINV serials of one year; a page
// becomes an invoice with exactly its printed number, a cancelled page's number is recorded and never used.
import { BOOKLET_PAGES, invoiceYear2, nextBookletRange, parseMinvNumber, type SerialRange } from "./invoice-codes"

type Db = any

export const MAX_VOID_REASON = 200

const missingTable = (error: any) => error?.code === "42P01" || error?.code === "PGRST205"
export const minvNumber = (year2: string, serial: number) => `MINV${year2}${serial}`

export interface BookletRow {
  id: number
  link_id: number
  year2: string
  first_serial: number
  last_serial: number
  status: "active" | "finished"
  created_at: string
}

/** True when this worker has been given at least one booklet: his photos must then carry a page number. */
export async function workerHasBooklet(db: Db, linkId: number): Promise<boolean> {
  const { data, error } = await db.from("maintenance_booklets").select("id").eq("link_id", linkId).limit(1)
  if (error) {
    if (missingTable(error)) return false
    throw new Error(`load booklets: ${error.message}`)
  }
  return (data || []).length > 0
}

export type PageCheck = { ok: true; bookletId: number | null; number: string } | { ok: false; error: string }

/** Any MINV number is accepted unless it was cancelled or is on an invoice already; linked to a booklet when one holds it. */
export async function checkBookletPage(db: Db, linkId: number, number: string): Promise<PageCheck> {
  const parsed = parseMinvNumber(number)
  if (!parsed) return { ok: false, error: "Enter the MINV number printed on the page" }
  const { data: booklets, error } = await db
    .from("maintenance_booklets")
    .select("id, link_id")
    .eq("year2", parsed.year2)
    .lte("first_serial", parsed.serial)
    .gte("last_serial", parsed.serial)
  if (error && !missingTable(error)) throw new Error(`load booklets: ${error.message}`)
  const holder = (booklets || []).find((b: any) => Number(b.link_id) === linkId) ?? (booklets || [])[0]

  const { data: voided } = await db.from("maintenance_booklet_voids").select("id").eq("invoice_number", number).limit(1)
  if (voided?.length) return { ok: false, error: `Page ${number} was cancelled` }
  const { data: used } = await db.from("accounts_receivable").select("invoice_id").eq("invoice_number", number).limit(1)
  if (used?.length) return { ok: false, error: `${number} is already on an invoice` }
  return { ok: true, bookletId: holder ? Number(holder.id) : null, number }
}

export interface BookletStats {
  used: number
  voided: number
  blank: number
  /** Blank pages before the last page that was used or cancelled: lost, or a photo still waiting. */
  skipped: string[]
}

export function bookletStats(booklet: Pick<BookletRow, "year2" | "first_serial" | "last_serial">, used: Set<string>, voided: Set<string>): BookletStats {
  let usedCount = 0
  let voidedCount = 0
  let lastHandled = booklet.first_serial - 1
  for (let s = booklet.first_serial; s <= booklet.last_serial; s++) {
    const n = minvNumber(booklet.year2, s)
    if (used.has(n)) usedCount++
    else if (voided.has(n)) voidedCount++
    else continue
    lastHandled = s
  }
  const skipped: string[] = []
  for (let s = booklet.first_serial; s < lastHandled; s++) {
    const n = minvNumber(booklet.year2, s)
    if (!used.has(n) && !voided.has(n)) skipped.push(n)
  }
  const size = booklet.last_serial - booklet.first_serial + 1
  return { used: usedCount, voided: voidedCount, blank: size - usedCount - voidedCount, skipped }
}

/** Gives a worker a new booklet: the next BOOKLET_PAGES serials after every MINV number and every booklet block. */
export async function createBooklet(db: Db, linkId: number, createdBy: number | null): Promise<BookletRow> {
  const year2 = invoiceYear2()
  for (let attempt = 0; attempt < 3; attempt++) {
    const [numbers, blocks] = await Promise.all([
      db.from("accounts_receivable").select("invoice_number").like("invoice_number", `MINV${year2}%`),
      db.from("maintenance_booklets").select("first_serial, last_serial").eq("year2", year2),
    ])
    if (numbers.error) throw new Error(`load invoice numbers: ${numbers.error.message}`)
    if (blocks.error) throw new Error(`load booklets: ${blocks.error.message}`)
    const reserved: SerialRange[] = (blocks.data || []).map((b: any) => ({ first: Number(b.first_serial), last: Number(b.last_serial) }))
    const range = nextBookletRange(year2, (numbers.data || []).map((r: any) => r.invoice_number), reserved, BOOKLET_PAGES)
    const { data, error } = await db
      .from("maintenance_booklets")
      .insert({ link_id: linkId, year2, first_serial: range.first, last_serial: range.last, created_by: createdBy })
      .select()
      .single()
    if (!error) return data as BookletRow
    if (error.code !== "23505") throw new Error(`create booklet: ${error.message}`)
  }
  throw new Error("create booklet: another booklet was being made at the same time, try again")
}
