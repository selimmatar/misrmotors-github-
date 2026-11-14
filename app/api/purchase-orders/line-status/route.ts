// GET ?poId=N -> a status for each line of the PO (lib/po-line-status.ts). Read-only.
import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { poLineStatuses } from "@/lib/po-line-status"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("poId") || ""
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) return NextResponse.json({ error: "Choose a purchase order" }, { status: 400 })
  try {
    return NextResponse.json({ lines: await poLineStatuses(createAdminClient(), Number(raw)) })
  } catch (error) {
    console.error("PO line status error:", error)
    return NextResponse.json({ error: "Could not load the line statuses" }, { status: 500 })
  }
}
