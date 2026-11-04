import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { brandsByItem, codesByItem, pricesByItem, sameRequestNumber, sortRequestItems, type ReadRow } from "@/lib/po-requests/read-prices"
import { readPhoto } from "@/lib/photo-reader"
import { failed } from "@/lib/photo-read-failure"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
// The phone shrinks the photo well below this before sending.
const MAX_IMAGE_BASE64 = 7_000_000

// JSON shape the reader must answer in (Gemini's schema format).
const SHEET_SCHEMA = {
  type: "OBJECT",
  required: ["request_number", "rows"],
  properties: {
    request_number: { type: "STRING", nullable: true },
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["row", "written"],
        properties: { row: { type: "INTEGER" }, written: { type: "STRING", nullable: true }, brand: { type: "STRING", nullable: true }, code: { type: "STRING", nullable: true } },
      },
    },
  },
}
const SYSTEM = `You read photos of a printed price request from Misr Motors. The sheet has a table with numbered rows (column "م"), an item name, and a "سعر الوحدة" box (older sheets label it "سعر الوحدة / Unit Price") where the supplier hand-writes one unit price per row.
For every row number you are given, copy exactly what is hand-written in that row's price box, digit by digit, in the same digits the supplier used (Arabic-Indic like ١٢٥٠ or English like 1250), keeping any commas or dots. Do not convert, round or calculate.
Use null when the box is empty, crossed out, or you cannot read every digit with confidence. Never guess a digit, and never take a number from another column (quantity, code, row number).
Newer sheets also have a "الماركة" (brand) box in each row. Copy the brand name written there as written (Arabic or English letters), or null when it is empty or you cannot read it. Never put a brand into "written" or a price into "brand".
Newer sheets also have a "الكود" (code) box in each row where the supplier writes the part or item code. Copy it character by character as written (letters, digits, dashes), or null when it is empty or you cannot read every character. Never put a code into "written" or "brand".
Also copy the request number printed on the sheet (رقم الطلب), or null if you cannot see it.`

// The same shape in words, for the backup reader (Groq), which is told the shape in the prompt.
const SHEET_SHAPE = `{"request_number": string or null, "rows": [{"row": number, "written": string or null, "brand": string or null, "code": string or null}]}`

// POST { request_id, image (base64, no data: prefix), media_type } -> { prices: {item_id: price}, brands: {item_id: brand}, codes: {item_id: code}, read, total, request_number_matches }
// Nothing is saved here: the prices go back to the "Quote received" screen for a person to check and save.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const requestId = parsePositiveId(body?.request_id === undefined ? null : String(body.request_id))
    const mediaType = MEDIA_TYPES.find((t) => t === body?.media_type)
    const image = typeof body?.image === "string" ? body.image : ""
    if (!requestId || !mediaType || !image) {
      return NextResponse.json({ error: "request_id, image and an image media_type are required" }, { status: 400 })
    }
    if (image.length > MAX_IMAGE_BASE64) {
      return NextResponse.json({ error: "The photo is too large" }, { status: 413 })
    }
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return NextResponse.json({ error: "Reading photos is not set up yet (GEMINI_API_KEY or GROQ_API_KEY is missing)" }, { status: 503 })
    }

    const supabase = createAdminClient()
    const { data: pr, error } = await supabase
      .from("po_requests")
      .select("request_id, request_number, po_request_items (item_id, product_name, quantity, unit)")
      .eq("request_id", requestId)
      .single()
    if (error || !pr) return NextResponse.json({ error: "Price request not found" }, { status: 404 })
    const items = sortRequestItems((pr.po_request_items || []) as { item_id: number; product_name: string; quantity: number; unit?: string }[])
    if (!items.length) return NextResponse.json({ error: "This price request has no items" }, { status: 400 })

    const rowList = items.map((item, i) => `${i + 1}. ${item.product_name} (× ${item.quantity}${item.unit ? " " + item.unit : ""})`).join("\n")
    const answer = await readPhoto<{ request_number: string | null; rows: ReadRow[] }>({
      tag: "read-prices",
      system: SYSTEM,
      text: `Price request ${pr.request_number}. Rows on the sheet:\n${rowList}`,
      image,
      mediaType,
      geminiSchema: SHEET_SCHEMA,
      jsonShape: SHEET_SHAPE,
    })
    if (!answer.ok) return failed(answer.kind, answer.why, "type the prices")

    const sheet = answer.data
    if (!sheet || !Array.isArray(sheet.rows)) {
      return NextResponse.json({ error: "The photo could not be read. Please type the prices." }, { status: 422 })
    }
    const prices = pricesByItem(items, sheet.rows)
    const brands = brandsByItem(items, sheet.rows)
    const codes = codesByItem(items, sheet.rows)
    return NextResponse.json({
      prices,
      brands,
      codes,
      read: Object.keys(prices).length,
      total: items.length,
      request_number_matches: sheet.request_number ? sameRequestNumber(sheet.request_number, pr.request_number) : null,
    })
  } catch (error) {
    console.error("read-prices error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

