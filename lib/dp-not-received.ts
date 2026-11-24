// "Not received" on the signed delivery permit (owner request, 2026-11-24).
//  - The printed permit has, per line, an empty tick box "لم يُستلم" (Not received) and a small "الكمية المستلمة"
//    (quantity received) box, so the customer / driver can mark on paper what did not arrive.
//  - When shipping uploads the signed photo(s), the photo reader (lib/photo-reader.ts: Claude, then Grok / Groq) reads
//    which boxes are ticked or circled and any received quantity written. Nothing is saved from the reading: the
//    shipping user sees each line with "Returned / لم يُستلم" pre-ticked from what was read and an editable quantity,
//    and only the lines he confirms become returns, through the existing return flow (lib/returns.ts createReturn:
//    product_returns / return_items), exactly like "Return items" by hand. If the reader fails, every line starts
//    unticked with the note "could not read - tick manually".
// Pure helpers plus the line loader; the routes are app/api/delivery-permits/read-signed and .../not-received.
import { followLineOrder, sortSoLines } from "./line-order"
import { lineKey, loadReturnLines, netLineQuantities, returnedByKey } from "./return-lines"

export const NOT_RECEIVED_AR = "لم يُستلم"
export const NOT_RECEIVED_EN = "Not received"
export const RECEIVED_QTY_AR = "الكمية المستلمة"
export const RECEIVED_QTY_EN = "Qty received"

/** One permit line as offered for confirmation. `returnable` = quantity less what earlier returns already took. */
export interface SignedLine {
  itemId: number
  productId: number | null
  name: string
  sku: string | null
  quantity: number
  returnable: number
}

/** What the reader answers per printed row (row = the serial number printed on the permit, 1-based). */
export interface ReadRow {
  row: number
  not_received?: boolean | null
  received_quantity?: number | string | null
}
export interface SignedReading {
  permit_no?: string | null
  rows?: ReadRow[]
}

/** One line of the confirmation step. */
export interface ConfirmRow extends SignedLine {
  /** "Returned / لم يُستلم" ticked */
  notReceived: boolean
  /** the quantity that becomes a return when ticked */
  returnQuantity: number
  /** the received quantity read from the paper, when one was written */
  receivedQuantity: number | null
  /** true when the reader saw a tick / circle or a lower received quantity on this line */
  fromReader: boolean
}

export interface Confirmation {
  read: boolean
  /** shown above the lines when the reader could not read the upload */
  note: string | null
  noteAr: string | null
  via?: string | null
  rows: ConfirmRow[]
}

export const COULD_NOT_READ_EN = "Could not read the signed permit - tick manually the lines that were not received."
export const COULD_NOT_READ_AR = "تعذّرت قراءة الإذن الموقّع - علّم يدويًا الأصناف التي لم تُستلم."

export const SIGNED_SYSTEM = `You read photos or scans of a signed delivery permit (إذن تسليم) from Misr Motors. The permit has a table with numbered rows (column "مسلسل"), a quantity column ("عدد"), an item description ("البيان"), and two boxes the customer or driver fills by hand:
- "${NOT_RECEIVED_AR}" (Not received): an empty square. It counts as marked when it is ticked (✓), crossed (✗), filled in, or circled.
- "${RECEIVED_QTY_AR}" (Quantity received): a small box where a number may be written.
For every row number you are given, say whether its "${NOT_RECEIVED_AR}" box is marked, and copy the number written in its "${RECEIVED_QTY_AR}" box (Arabic-Indic digits like ٣ or English like 3), or null when that box is empty or you cannot read it with confidence.
A row whose item is crossed out or circled as a whole also counts as not received. Never guess, never take a number from another column (the printed quantity, the serial number, the item code).
Also copy the permit number printed on the sheet (رقم إذن تسليم), or null.`

export const SIGNED_SHAPE = `{"permit_no": string or null, "rows": [{"row": number, "not_received": true or false, "received_quantity": number or string or null}]}`

/** The text sent with each photo: the printed rows, so the reader can match them. */
export function signedReadText(permitNo: string, lines: SignedLine[]): string {
  const list = lines.map((l, i) => `${i + 1}. ${l.name}${l.sku ? ` [${l.sku}]` : ""} (printed quantity ${l.quantity})`).join("\n")
  return `Delivery permit ${permitNo}. Rows on the sheet:\n${list}`
}

const ARABIC_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٫": ".", "٬": "" }

/** A received quantity as written: a whole or decimal number >= 0, or null when unreadable. */
export function parseReceived(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null
  const s = String(v)
    .replace(/[٠-٩۰-۹٫٬]/g, (c) => ARABIC_DIGITS[c] ?? c)
    .trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const whole = (n: number) => Math.max(0, Math.floor(n + 1e-9))

/** Every line unticked (the reader could not read the upload, or nothing was sent to it). */
export function unreadConfirmation(lines: SignedLine[], via: string | null = null): Confirmation {
  return {
    read: false,
    note: COULD_NOT_READ_EN,
    noteAr: COULD_NOT_READ_AR,
    via,
    rows: lines.map((l) => ({ ...l, notReceived: false, returnQuantity: 0, receivedQuantity: null, fromReader: false })),
  }
}

/**
 * The confirmation rows from one reading per uploaded page (null = that page could not be read). A line is pre-ticked
 * when any page marks its box, or a received quantity lower than the printed one is written; the quantity to return
 * is then printed - received (or the whole line when only the box is marked), whole units, at most what is still
 * returnable. When no page could be read, every line starts unticked with the note.
 */
export function confirmationFromReadings(lines: SignedLine[], readings: (SignedReading | null)[], via: string | null = null): Confirmation {
  const usable = readings.filter((r): r is SignedReading => !!r && Array.isArray(r.rows))
  if (usable.length === 0) return unreadConfirmation(lines, via)
  const rows = lines.map((line, i): ConfirmRow => {
    let ticked = false
    let received: number | null = null
    for (const reading of usable) {
      for (const r of reading.rows || []) {
        if (Number(r?.row) !== i + 1) continue
        if (r.not_received === true) ticked = true
        const q = parseReceived(r.received_quantity)
        if (q !== null && q <= line.quantity && (received === null || q < received)) received = q
      }
    }
    const shortBy = received !== null && received < line.quantity ? line.quantity - received : 0
    const wanted = shortBy > 0 ? shortBy : ticked ? line.quantity : 0
    const returnQuantity = Math.min(whole(wanted), whole(line.returnable))
    return { ...line, notReceived: returnQuantity > 0, returnQuantity, receivedQuantity: received, fromReader: ticked || shortBy > 0 }
  })
  return { read: true, note: null, noteAr: null, via, rows }
}

/** One confirmed line as sent back by the screen. */
export interface ConfirmedInput {
  itemId: number | string
  notReceived: boolean
  quantity: number | string
}

/**
 * The body for the existing return flow (lib/returns.ts createReturn) from the lines the shipping user confirmed:
 * only ticked lines with a whole quantity > 0, never more than is still returnable. Null when nothing is confirmed.
 */
export function notReceivedReturnBody(
  permitId: number,
  idempotencyKey: string,
  lines: SignedLine[],
  confirmed: ConfirmedInput[],
  by: { createdBy?: string | null; notes?: string | null } = {},
): { body: any; lines: { line: SignedLine; quantity: number }[] } | null {
  const picked: { line: SignedLine; quantity: number }[] = []
  for (const c of confirmed || []) {
    if (!c || c.notReceived !== true) continue
    const line = lines.find((l) => String(l.itemId) === String(c.itemId))
    if (!line) continue
    const qty = Math.min(whole(Number(c.quantity) || 0), whole(line.returnable))
    if (qty > 0) picked.push({ line, quantity: qty })
  }
  if (picked.length === 0) return null
  return {
    lines: picked,
    body: {
      permitId,
      idempotencyKey,
      createdBy: by.createdBy || "shipping_team",
      notes: by.notes || `${NOT_RECEIVED_EN} / ${NOT_RECEIVED_AR} (signed permit)`,
      items: picked.map(({ line, quantity }) => ({
        permitItemId: line.itemId,
        productId: line.productId ?? undefined,
        productName: line.name,
        sku: line.sku || "",
        quantityReturned: quantity,
        reason: "customer_refused",
        condition: "good",
        isOutsourced: !line.productId,
      })),
    },
  }
}

type Db = any

/** The permit lines in the order the print numbers them (app/api/delivery-permits/pdf uses the same order). */
export function printOrder<T extends Record<string, any>>(permitItems: readonly T[] | null | undefined, soLines: readonly any[] | null | undefined): T[] {
  return followLineOrder(
    permitItems,
    sortSoLines(soLines as any[]),
    (row: any) => lineKey(row.product_id, row.item_name_snapshot),
    (line: any) => lineKey(line.product_id, line.outsourced_name),
    "item_id",
  )
}

/** The permit and its lines as printed, each with what is still returnable (quantity less earlier returns). */
export async function loadSignedLines(db: Db, permitId: number): Promise<{ permit: any; lines: SignedLine[] } | null> {
  const { data: permit, error } = await db.from("delivery_permits").select("permit_id, permit_no, status, sales_order_id").eq("permit_id", permitId).maybeSingle()
  if (error) throw new Error(`load delivery permit: ${error.message}`)
  if (!permit) return null
  const { data: items, error: itemsError } = await db
    .from("delivery_permit_items")
    .select("item_id, product_id, item_name_snapshot, sku_snapshot, quantity")
    .eq("permit_id", permitId)
  if (itemsError) throw new Error(`load delivery permit items: ${itemsError.message}`)
  const { data: soLines } = permit.sales_order_id
    ? await db.from("sales_order_items").select("*").eq("so_id", permit.sales_order_id)
    : { data: [] as any[] }
  const ordered = printOrder((items || []) as any[], soLines || [])
  const keyed = ordered.map((row: any) => ({ key: lineKey(row.product_id, row.item_name_snapshot), quantity: Number(row.quantity) || 0 }))
  const net = netLineQuantities(keyed, returnedByKey(await loadReturnLines(db, [permitId]), { permitId }))
  return {
    permit,
    lines: ordered.map((row: any, i: number) => ({
      itemId: Number(row.item_id),
      productId: row.product_id ? Number(row.product_id) : null,
      name: String(row.item_name_snapshot || "-"),
      sku: row.sku_snapshot || null,
      quantity: Number(row.quantity) || 0,
      returnable: Math.max(net[i], 0),
    })),
  }
}
