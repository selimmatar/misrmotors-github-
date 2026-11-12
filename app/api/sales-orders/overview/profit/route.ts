// GET ?soId=N -> selling total, cost and profit of one sales order. CEO and admins only (lib/auth/permissions.ts).
import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { soProfit } from "@/lib/so-overview"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("soId") || ""
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) return NextResponse.json({ error: "Choose a sales order" }, { status: 400 })
  try {
    const profit = await soProfit(createAdminClient(), Number(raw))
    if (!profit) return NextResponse.json({ error: "Sales order not found" }, { status: 404 })
    return NextResponse.json(profit)
  } catch (error) {
    console.error("Order profit error:", error)
    return NextResponse.json({ error: "Could not work out the profit" }, { status: 500 })
  }
}
