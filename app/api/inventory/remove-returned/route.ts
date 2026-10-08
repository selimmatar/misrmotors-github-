import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { removeReturnedItem } from "@/lib/returns"

// Writes a returned-holding inventory row off (and records the supplier credit). The holding row is claimed with a
// guarded delete first, so a repeated or concurrent request can never write the same quantity off twice or create
// a second supplier credit (lib/returns.ts).
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await removeReturnedItem(createAdminClient(), body)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error("Error in remove-returned endpoint:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
