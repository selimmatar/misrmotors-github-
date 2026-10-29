import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { pricesByItem, sameRequestNumber, sortRequestItems, type ReadRow } from "@/lib/po-requests/read-prices"

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
        properties: { row: { type: "INTEGER" }, written: { type: "STRING", nullable: true } },
      },
    },
  },
}
// Free-tier model; can be changed in Vercel with GEMINI_MODEL without a code change.
const DEFAULT_MODEL = "gemini-3.8-flash"

const SYSTEM = `You read photos of a printed price request from Misr Motors. The sheet has a table with numbered rows (column "م"), an item name, and a "سعر الوحدة / Unit Price" box where the supplier hand-writes one unit price per row.
For every row number you are given, copy exactly what is hand-written in that row's price box, digit by digit, in the same digits the supplier used (Arabic-Indic like ١٢٥٠ or English like 1250), keeping any commas or dots. Do not convert, round or calculate.
Use null when the box is empty, crossed out, or you cannot read every digit with confidence. Never guess a digit, and never take a number from another column (quantity, code, row number).
Also copy the request number printed on the sheet (رقم الطلب), or null if you cannot see it.`

// POST { request_id, image (base64, no data: prefix), media_type } -> { prices: {item_id: price}, read, total, request_number_matches }
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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Reading photos is not set up yet (GEMINI_API_KEY is missing)" }, { status: 503 })
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
    const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
    const response = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mediaType, data: image } },
              { text: `Price request ${pr.request_number}. Rows on the sheet:\n${rowList}` },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SHEET_SCHEMA },
      }),
    })

    if (!response.ok) {
      const detail = await response.json().catch(() => null)
      const reason = detail?.error?.details?.find((d: { reason?: string }) => d?.reason)?.reason || detail?.error?.status
      console.error("read-prices: Gemini error", response.status, reason)
      if (reason === "API_KEY_INVALID" || response.status === 401 || response.status === 403) {
        return NextResponse.json({ error: "Reading photos is not set up correctly (the API key was rejected)" }, { status: 503 })
      }
      if (response.status === 429) {
        return NextResponse.json({ error: "The free photo-reading limit was reached. Please try again later or type the prices." }, { status: 429 })
      }
      return NextResponse.json({ error: "The photo could not be read. Please try again or type the prices." }, { status: 502 })
    }

    const data = await response.json()
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p?.text || "").join("")
    let sheet: { request_number: string | null; rows: ReadRow[] } | null = null
    try {
      sheet = data?.promptFeedback?.blockReason ? null : JSON.parse(text)
    } catch {
      sheet = null
    }
    if (!sheet || !Array.isArray(sheet.rows)) {
      return NextResponse.json({ error: "The photo could not be read. Please type the prices." }, { status: 422 })
    }
    const prices = pricesByItem(items, sheet.rows)
    return NextResponse.json({
      prices,
      read: Object.keys(prices).length,
      total: items.length,
      request_number_matches: sheet.request_number ? sameRequestNumber(sheet.request_number, pr.request_number) : null,
    })
  } catch (error) {
    console.error("read-prices error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
