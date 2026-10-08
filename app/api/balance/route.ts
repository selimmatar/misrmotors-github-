import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"

export const dynamic = "force-dynamic"

export async function GET() {
  try {

    const result = await withRetry(async () => {
      const supabase = getAdminClient()
      const { data, error } = await (supabase as any)
        .from("balance_entries")
        .select("*")
        .order("created_at", { ascending: false })
      if (error) throw error
      return data || []
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Balance API - Error fetching balance entries:", error)
    return NextResponse.json({ error: "Failed to fetch balance entries" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const result = await withRetry(async () => {
      const supabase = getAdminClient()
      const { data, error } = await (supabase as any)
        .from("balance_entries")
        .insert([
          {
            entry_type: body.type,
            reference_type: body.referenceType,
            reference_id: body.referenceId,
            reference_number: body.referenceNumber,
            amount: body.amount,
            description: body.description,
            status: body.status || "active",
            created_by: body.createdBy,
          },
        ])
        .select()

      if (error) throw error
      return data[0]
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Balance API - Error adding balance entry:", error)
    return NextResponse.json({ error: "Failed to add balance entry" }, { status: 500 })
  }
}

// Hardening: this handler used to delete EVERY balance entry on an unauthenticated, id-less DELETE. No UI caller
// uses it, and a ledger row must not be deletable through it (voiding is the supported way), so it now refuses.
export async function DELETE() {
  return NextResponse.json(
    { error: "Deleting balance entries is not allowed. Void the entry instead." },
    { status: 400 },
  )
}
