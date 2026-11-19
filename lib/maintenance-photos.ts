// Maintenance photo drafts (spec 2026-11-19, Part 2): the worker's secret link, the upload checks and the AI reading
// of a handwritten invoice. Prices on the paper are before VAT (owner, 2026-11-19).
import { createHash, randomBytes } from "node:crypto"
import { readPhoto, type PhotoRequest } from "./photo-reader"
import { MAX_LINES, MAX_NAME_LENGTH } from "./maintenance-quick-invoice"

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
/** Photos one link may send in 24 hours: far above a day's work, low enough to stop a leaked link being abused. */
export const DAILY_PHOTO_LIMIT = 40
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
export const MAX_WORKER_NAME = 80
export const MAX_REJECT_REASON = 300

/** 24 random bytes as base64url: 32 characters, cannot be guessed. */
export const newSecret = () => randomBytes(24).toString("base64url")
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex")
export const isSecretShape = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value)

export const photoExtension = (type: string) =>
  type === "image/png" ? "png" : type === "image/webp" ? "webp" : type.startsWith("image/hei") ? "heic" : "jpg"

export interface DraftLine {
  name: string
  quantity: number
  unitPrice: number
}
export interface DraftRead {
  customerName: string
  date: string
  lines: DraftLine[]
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

/** A number written by hand, Arabic or Western digits, "1,250" or "1٬250": 0 when it is not a positive number. */
export function handNumber(value: unknown): number {
  const text = String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[,٬\s]/g, "")
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The AI answer, made safe: at most 50 lines with a name; a line without a quantity counts as 1. */
export function normalizeRead(raw: unknown): DraftRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const rows = Array.isArray(r.lines) ? r.lines : []
  const lines: DraftLine[] = []
  for (const row of rows) {
    if (lines.length >= MAX_LINES) break
    const item = (row && typeof row === "object" ? row : {}) as Record<string, unknown>
    const name = String(item.name ?? "").trim().slice(0, MAX_NAME_LENGTH)
    if (!name) continue
    lines.push({ name, quantity: handNumber(item.quantity) || 1, unitPrice: Math.round(handNumber(item.unitPrice) * 100) / 100 })
  }
  return {
    customerName: String(r.customerName ?? "").trim().slice(0, 200),
    date: String(r.date ?? "").trim().slice(0, 20),
    lines,
  }
}

const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    customerName: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", nullable: true },
          quantity: { type: "STRING", nullable: true },
          unitPrice: { type: "STRING", nullable: true },
        },
      },
    },
  },
}

export function photoReadRequest(image: string, mediaType: string): PhotoRequest {
  return {
    tag: "[maintenance-photo]",
    system:
      "You copy a handwritten maintenance invoice from an Egyptian workshop into JSON. The writing may be Arabic or English. " +
      "Copy exactly what is written; never invent a line, a price or a customer. Leave a field empty when you cannot read it.",
    text:
      "Return the customer name, the date as written, and one line per job or part: name (what was done, as written), " +
      "quantity (1 when none is written) and unitPrice (the price of one, as written, digits only). " +
      "Skip total, VAT and subtotal rows.",
    image,
    mediaType,
    geminiSchema: READ_SCHEMA,
    jsonShape: '{"customerName":"...","date":"...","lines":[{"name":"...","quantity":"1","unitPrice":"250"}]}',
  }
}

type Db = any

/** Reads the photo and stores the result; a failed reading still leaves the draft for the accountant to type. */
export async function readDraftPhoto(db: Db, draftId: number, base64: string, mediaType: string): Promise<void> {
  let data: DraftRead | null = null
  try {
    const answer = await readPhoto<unknown>(photoReadRequest(base64, mediaType))
    if (answer.ok && answer.data) data = normalizeRead(answer.data)
    else if (!answer.ok) console.error(`[maintenance-photo] draft ${draftId}: not read (${answer.kind})`)
  } catch (error) {
    console.error(`[maintenance-photo] draft ${draftId}: reading failed`, error)
  }
  const { error } = await db
    .from("maintenance_photo_drafts")
    .update({ read_status: data && data.lines.length > 0 ? "done" : "failed", read_data: data })
    .eq("id", draftId)
  if (error) console.error(`[maintenance-photo] draft ${draftId}: could not save the reading`, error.message)
}
