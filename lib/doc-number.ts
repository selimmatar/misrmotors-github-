// A document number the person types instead of the automatic one (owner, 2026-11-04): DP, sales order, customer
// invoice, purchase order, supplier invoice, quotation, PO request, goods receipt. Everyone who creates the
// document may type one, in any form. Left empty, the automatic number is used as before.
//
// The database already refuses two documents with the same number (a UNIQUE constraint on each number column,
// checked 2026-11-04), so a taken number is caught there; numberTakenResponse() turns that into a plain message.
//
// Counters that read the highest existing number (DP, customer invoice, PO request) only count numbers that look
// like their own ("DP-2026-0041"). A typed number in that shape must end in at most 9 digits, so the counter can
// still read it; any other text ("OLD-55", "Book 3 / 120") is allowed and the counter ignores it.
import { NextResponse } from "next/server"

export const MAX_DOC_NUMBER_LENGTH = 50 // every number column is varchar(50)

export type ManualNumber = { ok: true; value: string | null } | { ok: false; error: string }

/** Auto-number shapes read back by a "highest + 1" counter: `PREFIX-YYYY-<digits>`. */
const COUNTED_PREFIXES = ["DP", "INV", "POR"]

export function cleanManualNumber(raw: unknown): ManualNumber {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: "The document number must be text." }
  const value = String(raw).replace(/\s+/g, " ").trim()
  if (!value) return { ok: true, value: null }
  if (value.length > MAX_DOC_NUMBER_LENGTH) {
    return { ok: false, error: `The document number can be at most ${MAX_DOC_NUMBER_LENGTH} characters.` }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: "The document number has characters that cannot be saved." }
  for (const prefix of COUNTED_PREFIXES) {
    const shaped = new RegExp(`^${prefix}-\\d{4}-(.*)$`, "i").exec(value)
    if (shaped && !/^\d{1,9}$/.test(shaped[1])) {
      return {
        ok: false,
        error: `A number that starts like ${prefix}-${new Date().getFullYear()}- must end in digits only (up to 9), for example ${prefix}-${new Date().getFullYear()}-0150.`,
      }
    }
  }
  return { ok: true, value }
}

/** Highest serial among numbers shaped `PREFIX-YEAR-<digits>`; anything else is ignored. */
export function highestSerial(numbers: (string | null | undefined)[], prefix: string, year: number): number {
  const shape = new RegExp(`^${prefix}-${year}-(\\d{1,9})$`)
  let max = 0
  for (const n of numbers) {
    const m = shape.exec(n || "")
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return max
}

export const isUniqueViolation = (error: any) => error?.code === "23505"

export function numberTakenMessage(number: string) {
  return `${number} is already used. Pick another number.`
}

export function numberTakenResponse(number: string) {
  return NextResponse.json({ error: numberTakenMessage(number), code: "NUMBER_TAKEN" }, { status: 409 })
}

export function badNumberResponse(error: string) {
  return NextResponse.json({ error, code: "BAD_NUMBER" }, { status: 400 })
}

export type NumberedInsert<T> =
  | { ok: true; data: T; number: string }
  | { ok: false; reason: "taken"; number: string }
  | { ok: false; reason: "no_number" }
  | { ok: false; reason: "error"; error: any }

/**
 * Insert a document under the typed number, or under the next automatic one. A taken typed number is reported, never
 * replaced; an automatic number that clashes with a typed one is replaced by the following automatic number (up to
 * 3 tries).
 */
export async function insertWithNumber<T>(
  manual: string | null,
  nextNumber: () => Promise<string | null>,
  insert: (number: string) => PromiseLike<{ data: T | null; error: any }>,
): Promise<NumberedInsert<T>> {
  for (let attempt = 0; attempt < (manual ? 1 : 3); attempt++) {
    const number = manual ?? (await nextNumber())
    if (!number) return { ok: false, reason: "no_number" }
    const { data, error } = await insert(number)
    if (!error) return { ok: true, data: data as T, number }
    if (!isUniqueViolation(error)) return { ok: false, reason: "error", error }
    if (manual) return { ok: false, reason: "taken", number }
  }
  return { ok: false, reason: "error", error: { message: "Could not find a free document number." } }
}
