import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Fetch all active supplier credits (not yet used)
    const { data: credits, error } = await supabase
      .from("supplier_credits")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching supplier credits:", error)
      return NextResponse.json({ message: "Error fetching credits" }, { status: 500 })
    }

    // Transform the response to match expected format
    const transformed = (credits || []).map((credit: any) => ({
      credit_id: credit.credit_id,
      supplier_id: credit.supplier_id,
      amount: credit.amount,
      credit_type: credit.credit_type,
      description: credit.description,
      invoice_id: credit.invoice_id,
      reference_id: credit.reference_id,
      reference_type: credit.reference_type,
      status: credit.status,
      created_at: credit.created_at,
      created_by: credit.created_by,
      used_at: credit.used_at,
      used_in_po_id: credit.used_in_po_id,
      notes: credit.notes,
    }))

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("Unexpected error fetching supplier credits:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
