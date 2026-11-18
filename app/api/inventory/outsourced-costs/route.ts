import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { loadOutsourcedLineCosts } from "@/lib/outsourced-pending"

export const dynamic = "force-dynamic"

/** Cost per unit and supplier of every outsourced sales-order line, from its purchase order (lib/outsourced-pending.ts). */
export async function GET() {
  try {
    return NextResponse.json(await loadOutsourcedLineCosts(createAdminClient()))
  } catch (error: any) {
    console.error("Inventory outsourced-costs GET:", error?.message || error)
    return NextResponse.json({ error: "Failed to load the outsourced costs" }, { status: 500 })
  }
}
