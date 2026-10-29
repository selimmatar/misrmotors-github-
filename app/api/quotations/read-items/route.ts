import { type NextRequest, NextResponse } from "next/server"
import { askGemini, geminiFailure, geminiJson } from "@/lib/gemini-models"
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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Reading photos is not set up yet (GEMINI_API_KEY is missing)" }, { status: 503 })
    }

    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text: "Read every item row: name and quantity." }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: LIST_SCHEMA,
        // Copying printed text needs little reasoning; low thinking answers much faster.
        thinkingConfig: { thinkingLevel: "low" },
      },
    })
    const response = await askGemini(payload, apiKey, "read-items")

    if (!response.ok) {
      const { reason, why } = await geminiFailure(response)
      console.error("read-items: Gemini error", response.status, reason)
      if (reason === "API_KEY_INVALID" || response.status === 401 || response.status === 403) {
        return NextResponse.json({ error: "Reading photos is not set up correctly (the API key was rejected)", detail: why }, { status: 503 })
      }
      if (response.status === 429) {
        return NextResponse.json({ error: "The free photo-reading limit was reached. Please try again later or add the items by hand.", detail: why }, { status: 429 })
      }
      return NextResponse.json({ error: "The photo could not be read. Please try again or add the items by hand.", detail: why }, { status: 502 })
    }

    const list = await geminiJson<{ rows: ReadItemRow[] }>(response)
    if (!list || !Array.isArray(list.rows)) {
      return NextResponse.json({ error: "The photo could not be read. Please add the items by hand." }, { status: 422 })
    }
    return NextResponse.json(photoItems(list.rows))
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      console.error("read-items: Google did not answer in time")
      return NextResponse.json({ error: "Google took too long to read the photo. Please try again or add the items by hand.", detail: "timeout" }, { status: 504 })
    }
    console.error("read-items error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
