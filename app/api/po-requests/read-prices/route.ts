import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod/v4"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { pricesByItem, sameRequestNumber, sortRequestItems } from "@/lib/po-requests/read-prices"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
// The API takes images up to 5 MB; the phone shrinks the photo well below this before sending.
const MAX_IMAGE_BASE64 = 7_000_000

const ReadSheet = z.object({
  request_number: z.string().nullable(),
  rows: z.array(z.object({ row: z.number().int(), written: z.string().nullable() })),
})

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
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Reading photos is not set up yet (ANTHROPIC_API_KEY is missing)" }, { status: 503 })
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
    const client = new Anthropic()
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReadSheet) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: `Price request ${pr.request_number}. Rows on the sheet:\n${rowList}` },
          ],
        },
      ],
    })

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ error: "The photo could not be read. Please type the prices." }, { status: 422 })
    }
    const sheet = response.parsed_output
    const prices = pricesByItem(items, sheet.rows)
    return NextResponse.json({
      prices,
      read: Object.keys(prices).length,
      total: items.length,
      request_number_matches: sheet.request_number === null ? null : sameRequestNumber(sheet.request_number, pr.request_number),
    })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("read-prices: API key rejected", error.status)
      return NextResponse.json({ error: "Reading photos is not set up correctly (the API key was rejected)" }, { status: 503 })
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Too many photos at once. Please try again in a minute." }, { status: 429 })
    }
    if (error instanceof Anthropic.APIError) {
      console.error("read-prices: API error", error.status, error.message)
      return NextResponse.json({ error: "The photo could not be read. Please try again or type the prices." }, { status: 502 })
    }
    console.error("read-prices error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
