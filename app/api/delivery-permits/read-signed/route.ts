import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { photoReaderReady, readPhoto } from "@/lib/photo-reader"
import {
  SIGNED_SHAPE,
  SIGNED_SYSTEM,
  confirmationFromReadings,
  loadSignedLines,
  signedReadText,
  unreadConfirmation,
  type SignedReading,
} from "@/lib/dp-not-received"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
const MAX_IMAGE_BASE64 = 7_000_000
const MAX_PAGES = 4

// POST { permit_id, images: [{ image (base64, no data: prefix), media_type }] }
//   -> { read, note, noteAr, via, rows: [{ itemId, name, quantity, returnable, notReceived, returnQuantity, receivedQuantity, fromReader }] }
// Reads the signed permit photo(s) for the "not received" boxes (lib/dp-not-received.ts). Nothing is saved here: the
// rows go to the shipping user's confirmation step. Any reading problem (no key, busy, unreadable, a PDF / no photo
// sent) still answers 200 with every line unticked and the note "could not read - tick manually".
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const permitId = parsePositiveId(body?.permit_id === undefined ? null : String(body.permit_id))
    if (!permitId) return NextResponse.json({ error: "permit_id is required" }, { status: 400 })
    const images = (Array.isArray(body?.images) ? body.images : [])
      .filter((p: any) => typeof p?.image === "string" && p.image && MEDIA_TYPES.some((t) => t === p?.media_type))
      .slice(0, MAX_PAGES) as { image: string; media_type: string }[]
    if (images.some((p) => p.image.length > MAX_IMAGE_BASE64)) {
      return NextResponse.json({ error: "The photo is too large" }, { status: 413 })
    }

    const db = createAdminClient()
    const loaded = await loadSignedLines(db, permitId)
    if (!loaded) return NextResponse.json({ error: "Delivery permit not found" }, { status: 404 })
    const { permit, lines } = loaded
    if (lines.length === 0) return NextResponse.json({ error: "This delivery permit has no items" }, { status: 400 })

    if (images.length === 0 || !photoReaderReady()) return NextResponse.json(unreadConfirmation(lines))

    const readings: (SignedReading | null)[] = []
    let via: string | null = null
    for (const page of images) {
      const answer = await readPhoto<SignedReading>({
        tag: "read-signed-dp",
        system: SIGNED_SYSTEM,
        text: signedReadText(String(permit.permit_no || permitId), lines),
        image: page.image,
        mediaType: page.media_type,
        jsonShape: SIGNED_SHAPE,
      })
      if (answer.ok && answer.data) {
        readings.push(answer.data)
        via = answer.via
      } else {
        if (!answer.ok) console.error("read-signed-dp: could not read a page:", answer.kind, answer.why)
        readings.push(null)
      }
    }
    return NextResponse.json(confirmationFromReadings(lines, readings, via))
  } catch (error) {
    console.error("read-signed-dp error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
