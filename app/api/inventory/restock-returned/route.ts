import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { restockReturnedItem } from "@/lib/returns"

// Moves a returned-holding inventory row's quantity back into the warehouse's regular sellable stock, then
// removes the holding row. This is the counterpart to /api/inventory/remove-returned (write-off + supplier credit).
// The holding row is claimed with a guarded delete first, so repeated, stale or concurrent requests can never add
// the same quantity twice (lib/returns.ts).
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await restockReturnedItem(createAdminClient(), body)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error("Error in restock-returned endpoint:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
