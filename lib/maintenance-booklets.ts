// Pre-numbered carbon booklets (spec 2026-11-19, Part 3). A booklet holds a block of MINV serials of one year; a page
// becomes an invoice with exactly its printed number, a cancelled page's number is recorded and never used.
import { BOOKLET_PAGES, codedNumber, invoiceYear2, nextBookletRange, parseMinvNumber, type SerialRange } from "./invoice-codes"

type Db = any

export const MAX_VOID_REASON = 200

const missingTable = (error: any) => error?.code === "42P01" || error?.code === "PGRST205"
export const minvNumber = (year2: string, serial: number) => codedNumber("MINV", year2, serial)

export interface BookletRow {
  id: number
  /** Old per-worker booklets only; the booklet is now shared by every worker (owner, 2026-11-19). */
  link_id: number | null
  year2: string
  first_serial: number
  last_serial: number
  status: "active" | "finished"
  created_at: string
}

export class BookletStillOpen extends Error {
  constructor() {
    super("Finish the current booklet before making a new one")
  }
}

/** True while a booklet is open: every photo must then carry its page number. */
export async function hasActiveBooklet(db: Db): Promise<boolean> {
  const { data, error } = await db.from("maintenance_booklets").select("id").eq("status", "active").limit(1)
  if (error) {
    if (missingTable(error)) return false
    throw new Error(`load booklets: ${error.message}`)
  }
  return (data || []).length > 0
}

/**
 * MINV numbers of the year that are taken but not on an invoice yet: cancelled pages and photos still waiting with a
 * number. The office counter counts them so it never hands out a page a worker already wrote.
 */
export async function pendingMinvNumbers(db: Db, year2: string): Promise<string[]> {
  const [voids, drafts] = await Promise.all([
    db.from("maintenance_booklet_voids").select("invoice_number").like("invoice_number", `MINV${year2}%`),
    db.from("maintenance_photo_drafts").select("invoice_number").neq("status", "rejected").like("invoice_number", `MINV${year2}%`),
  ])
  for (const result of [voids, drafts]) {
    if (result.error && !missingTable(result.error)) throw new Error(`load MINV numbers: ${result.error.message}`)
  }
  return [...(voids.data || []), ...(drafts.data || [])].map((row: any) => String(row.invoice_number))
}

const bySerial = (a: string, b: string) => (parseMinvNumber(a)?.serial ?? 0) - (parseMinvNumber(b)?.serial ?? 0)

/**
 * MINV numbers of the year that were handed out and then cancelled BEFORE an invoice existed (a cancelled booklet
 * page, a rejected photo): free again, lowest first (owner, 2026-11-22). A number that was ever on an invoice (also one
 * cancelled later, kept as "X<id>-<number>") is never in this list.
 */
export async function freedMinvNumbers(db: Db, year2: string): Promise<string[]> {
  const [voids, drafts, invoices, cancelled] = await Promise.all([
    db.from("maintenance_booklet_voids").select("invoice_number").like("invoice_number", `MINV${year2}%`),
    db.from("maintenance_photo_drafts").select("invoice_number, status, invoice_id").like("invoice_number", `MINV${year2}%`),
    db.from("accounts_receivable").select("invoice_number").like("invoice_number", `MINV${year2}%`),
    db.from("accounts_receivable").select("invoice_number").like("invoice_number", `X%-MINV${year2}%`),
  ])
  for (const result of [voids, drafts, invoices, cancelled]) {
    if (result.error && !missingTable(result.error)) throw new Error(`load MINV numbers: ${result.error.message}`)
  }
  const onInvoice = new Set<string>([
    ...(invoices.data || []).map((r: any) => String(r.invoice_number)),
    ...(cancelled.data || []).map((r: any) => String(r.invoice_number).replace(/^X\d+-/, "")),
  ])
  const draftRows = (drafts.data || []) as Array<{ invoice_number: string; status: string; invoice_id: number | null }>
  const stillPending = new Set(draftRows.filter((d) => d.status !== "rejected").map((d) => String(d.invoice_number)))
  const candidates = [
    ...(voids.data || []).map((r: any) => String(r.invoice_number)),
    ...draftRows.filter((d) => d.status === "rejected" && d.invoice_id == null).map((d) => String(d.invoice_number)),
  ]
  const freed = new Set(candidates.filter((n) => parseMinvNumber(n)?.year2 === year2 && !onInvoice.has(n) && !stillPending.has(n)))
  return [...freed].sort(bySerial)
}

export type PageCheck ={ ok: true; bookletId: number | null; number: string } | { ok: false; error: string }

/**
 * Any MINV number is accepted unless it is on an invoice already; linked to a booklet when one holds it. A cancelled
 * page's number is free again (owner, 2026-11-22), so it is accepted too.
 */
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

  const { data: used } = await db.from("accounts_receivable").select("invoice_id").eq("invoice_number", number).limit(1)
  if (used?.length) return { ok: false, error: `${number} is already on an invoice` }
  return { ok: true, bookletId: holder ? Number(holder.id) : null, number }
}

/**
 * The next MINV number in the one system sequence, the same for every worker and for the office: the lowest number
 * freed before its invoice was made (freedMinvNumbers), else one after the highest number on an invoice, cancelled, or
 * on a photo still waiting. With no number yet, the open booklet's first page.
 */
export async function nextMinvNumber(db: Db): Promise<string | null> {
  const year2 = invoiceYear2()
  const [invoices, pending, booklet, freed] = await Promise.all([
    db.from("accounts_receivable").select("invoice_number").like("invoice_number", `MINV${year2}%`),
    pendingMinvNumbers(db, year2),
    db.from("maintenance_booklets").select("first_serial").eq("year2", year2).eq("status", "active").limit(1),
    freedMinvNumbers(db, year2),
  ])
  if (invoices.error) throw new Error(`load invoice numbers: ${invoices.error.message}`)
  if (freed.length) return freed[0]
  const serials = [...(invoices.data || []).map((row: any) => row.invoice_number), ...pending]
    .map((number) => parseMinvNumber(number))
    .filter((p): p is { year2: string; serial: number } => !!p && p.year2 === year2)
    .map((p) => p.serial)
  if (serials.length) return minvNumber(year2, Math.max(...serials) + 1)
  const first = booklet.data?.[0]?.first_serial
  return first ? minvNumber(year2, Number(first)) : null
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

/** The next shared booklet, once the open one is finished: the next BOOKLET_PAGES serials after every MINV number. */
export async function createBooklet(db: Db, createdBy: number | null): Promise<BookletRow> {
  const year2 = invoiceYear2()
  if (await hasActiveBooklet(db)) throw new BookletStillOpen()
  for (let attempt = 0; attempt < 3; attempt++) {
    const [numbers, blocks] = await Promise.all([
      db.from("accounts_receivable").select("invoice_number").like("invoice_number", `MINV${year2}%`),
      db.from("maintenance_booklets").select("first_serial, last_serial").eq("year2", year2),
    ])
    if (numbers.error) throw new Error(`load invoice numbers: ${numbers.error.message}`)
    if (blocks.error) throw new Error(`load booklets: ${blocks.error.message}`)
    const reserved: SerialRange[] = (blocks.data || []).map((b: any) => ({ first: Number(b.first_serial), last: Number(b.last_serial) }))
    const taken = [...(numbers.data || []).map((r: any) => r.invoice_number), ...(await pendingMinvNumbers(db, year2))]
    const range = nextBookletRange(year2, taken, reserved, BOOKLET_PAGES)
    const { data, error } = await db
      .from("maintenance_booklets")
      .insert({ link_id: null, year2, first_serial: range.first, last_serial: range.last, created_by: createdBy })
      .select()
      .single()
    if (!error) return data as BookletRow
    if (error.code !== "23505") throw new Error(`create booklet: ${error.message}`)
    if (await hasActiveBooklet(db)) throw new BookletStillOpen()
  }
  throw new Error("create booklet: another booklet was being made at the same time, try again")
}
