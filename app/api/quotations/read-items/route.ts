import { type NextRequest, NextResponse } from "next/server"
import { readPhoto } from "@/lib/photo-reader"
import { failed } from "@/lib/photo-read-failure"
import { photoItems, type ReadItemRow } from "@/lib/quotations/read-items"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
// The phone shrinks the photo well below this before sending.
const MAX_IMAGE_BASE64 = 7_000_000

// JSON shape the reader must answer in (Gemini's schema format).
const LIST_SCHEMA = {
  type: "OBJECT",
  required: ["rows"],
  properties: {
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "quantity"],
        properties: { name: { type: "STRING", nullable: true }, quantity: { type: "STRING", nullable: true } },
      },
    },
  },
}

const SYSTEM = `You read photos of a printed (computer-written) list of items a customer wants. The list may be a table or plain lines. Each item row has an item name and a quantity.
Return one entry per item row, top to bottom. Copy the item name exactly as printed (Arabic or English, with its model or part number if it is part of the name). Copy the quantity exactly as printed, or null if the row has none or you cannot read it.
Skip headings, column titles, totals, dates, signatures and notes. Never take the quantity from a price, code, or row-number column. Use null for a name you cannot read.`

// POST { image (base64, no data: prefix), media_type } -> { items: [{ productName, quantity }], skipped }
// Nothing is saved here: the items go into the quotation form for a person to check and save.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const mediaType = MEDIA_TYPES.find((t) => t === body?.media_type)
    const image = typeof body?.image === "string" ? body.image : ""
    if (!mediaType || !image) {
      return NextResponse.json({ error: "image and an image media_type are required" }, { status: 400 })
    }
    if (image.length > MAX_IMAGE_BASE64) {
      return NextResponse.json({ error: "The photo is too large" }, { status: 413 })
    }
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return NextResponse.json({ error: "Reading photos is not set up yet (GEMINI_API_KEY or GROQ_API_KEY is missing)" }, { status: 503 })
    }

    const answer = await readPhoto<{ rows: ReadItemRow[] }>({
      tag: "read-items",
      system: SYSTEM,
      text: "Read every item row: name and quantity.",
      image,
      mediaType,
      geminiSchema: LIST_SCHEMA,
      jsonShape: `{"rows": [{"name": string or null, "quantity": string or null}]}`,
    })
    if (!answer.ok) return failed(answer.kind, answer.why, "add the items by hand")

    const list = answer.data
    if (!list || !Array.isArray(list.rows)) {
      return NextResponse.json({ error: "The photo could not be read. Please add the items by hand." }, { status: 422 })
    }
    return NextResponse.json(photoItems(list.rows))
  } catch (error) {
    console.error("read-items error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
