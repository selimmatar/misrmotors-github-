import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exchangeReturnedItem, previewReturnedExchange } from "@/lib/returns"

// "Exchange with supplier" for a returned item (owner request, 2026-11-12): the item goes back to the supplier in
// exchange for another one on the PO it came from (no credit); see lib/returns.ts exchangeReturnedItem.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await exchangeReturnedItem(createAdminClient(), body)
    return NextResponse.json({ ...result.body, error: result.body.error ?? undefined }, { status: result.status })
  } catch (error) {
    console.error("Error in exchange-returned endpoint:", error)
    return NextResponse.json({ error: "Internal server error", message: "Internal server error" }, { status: 500 })
  }
}

// Read-only: what the exchange window shows (the returned item, its PO and cost, whether the PO must be reopened).
export async function GET(request: Request) {
  try {
    const result = await previewReturnedExchange(createAdminClient(), { inventoryId: new URL(request.url).searchParams.get("inventoryId") })
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error("Error in exchange-returned preview:", error)
    return NextResponse.json({ error: "Internal server error", message: "Internal server error" }, { status: 500 })
  }
}
