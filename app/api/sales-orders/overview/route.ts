// GET ?soId=N -> the 360 order overview (lib/so-overview.ts). Read-only; costs are on /overview/profit.
import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildSoOverview } from "@/lib/so-overview"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("soId") || ""
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) return NextResponse.json({ error: "Choose a sales order" }, { status: 400 })
  try {
    const overview = await buildSoOverview(createAdminClient(), Number(raw))
    if (!overview) return NextResponse.json({ error: "Sales order not found" }, { status: 404 })
    return NextResponse.json(overview)
  } catch (error) {
    console.error("Order overview error:", error)
    return NextResponse.json({ error: "Could not load the order overview" }, { status: 500 })
  }
}
