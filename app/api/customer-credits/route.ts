import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const USED_CREDITS_LIMIT = 500

// Customer credits (raised by overpayments). Default: the open (active) credits; `?customer_id=` limits them to one
// customer and `?include=used` also returns the used ones, with the invoice they were used on.
export async function GET(request?: Request) {
  try {
    const supabase = createAdminClient()
    const params = request ? new URL(request.url).searchParams : new URLSearchParams()
    const includeUsed = params.get("include") === "used"
    const rawCustomer = params.get("customer_id")
    const customerId = rawCustomer === null || rawCustomer === "" ? null : Number(rawCustomer)
    if (customerId !== null && (!Number.isSafeInteger(customerId) || customerId <= 0)) {
      return NextResponse.json({ message: "customer_id is not valid" }, { status: 400 })
    }
    const forCustomer = (query: any) => (customerId === null ? query : query.eq("customer_id", customerId))

    // Open credits are always read in full (they drive the totals); the used ones are read separately and capped.
    const { data: active, error } = await forCustomer(supabase.from("customer_credits").select("*").eq("status", "active")).order(
      "created_at",
      { ascending: false },
    )
    if (error) {
      console.error("Error fetching customer credits:", error)
      return NextResponse.json({ message: "Error fetching credits" }, { status: 500 })
    }
    let credits = active || []
    if (includeUsed) {
      const { data: used, error: usedError } = await forCustomer(
        supabase.from("customer_credits").select("*").eq("status", "used").gt("used_in_invoice_id", 0),
      )
        .order("used_at", { ascending: false })
        .limit(USED_CREDITS_LIMIT)
      if (usedError) console.error("Error fetching used customer credits:", usedError)
      credits = [...credits, ...(used || [])]
    }

    // Read-only enrichment: the invoice a credit came from and the invoice it was used on.
    const invoiceIds = [
      ...new Set(credits.flatMap((c: any) => [c.invoice_id, c.used_in_invoice_id]).filter((id: any) => id !== null && id !== undefined)),
    ]
    const invoiceById = new Map<number, any>()
    if (invoiceIds.length > 0) {
      const { data: invoices } = await supabase.from("accounts_receivable").select("invoice_id, invoice_number").in("invoice_id", invoiceIds)
      for (const inv of invoices || []) invoiceById.set(inv.invoice_id, inv)
    }

    const transformed = credits.map((credit: any) => ({
      invoice_number: invoiceById.get(credit.invoice_id)?.invoice_number ?? null,
      unapplied: credit.status === "active",
      credit_id: credit.credit_id,
      customer_id: credit.customer_id,
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
      used_in_invoice_id: credit.used_in_invoice_id,
      used_in_invoice_number: credit.used_in_invoice_id != null ? (invoiceById.get(credit.used_in_invoice_id)?.invoice_number ?? null) : null,
      notes: credit.notes,
    }))

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("Unexpected error fetching customer credits:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
