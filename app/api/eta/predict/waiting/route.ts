import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { classifyWaiting } from "@/lib/eta/waiting"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST { cursor? }: the not-green lines of customer invoices made after go-live and not on the real portal yet,
// grouped by name: { items: [{ name, normalizedName, count, suggestion: { codeId, state }, invoices, productIds }],
// invoices, cursor, goLive }. A call stops after ~40 s; the screen calls again with the cursor until it is null.
// Read-only. Accountant, CEO, admin (the /api/eta rule).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const cursor = body && typeof body === "object" && body.cursor != null ? Number(body.cursor) : null
    if (cursor != null && (!Number.isInteger(cursor) || cursor < 0)) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
    return NextResponse.json(await classifyWaiting(createAdminClient(), cursor))
  } catch (error: any) {
    console.error("Error classifying waiting invoices:", error)
    return NextResponse.json({ error: "Could not list the waiting invoices" }, { status: 500 })
  }
}
