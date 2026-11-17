import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { cronAuthorized, runDailySync } from "@/lib/eta/daily-sync"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// The daily job (vercel.json crons, 03:17 UTC). Public path (no login session): refused with 401 unless the request
// carries `Authorization: Bearer ${CRON_SECRET}`. Reads supplier documents of the last 2 days, follows up our sent
// documents and learns item codes from our portal invoices of the last 3 days; it never sends or cancels anything.
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await runDailySync(createAdminClient()))
  } catch (error: any) {
    console.error("Error in the daily e-invoice job:", error)
    return NextResponse.json({ error: "The daily e-invoice job failed" }, { status: 500 })
  }
}
