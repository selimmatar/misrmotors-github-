import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { loadDirectPending } from "@/lib/outsourced-pending"

export const dynamic = "force-dynamic"

/** Outsourced items received for a sales order straight to the customer, not yet on a delivery permit (lib/outsourced-pending.ts). */
export async function GET() {
  try {
    return NextResponse.json(await loadDirectPending(createAdminClient()))
  } catch (error: any) {
    console.error("Inventory pending GET:", error?.message || error)
    return NextResponse.json({ error: "Failed to load the pending outsourced items" }, { status: 500 })
  }
}
