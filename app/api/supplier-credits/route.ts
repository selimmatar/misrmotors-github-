import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { markSupplierCreditsCredited } from "@/lib/supplier-credit-status"

// Marks active supplier credits as credited (status used + used_at). Status flag only: AP, payments and balances are untouched.
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await markSupplierCreditsCredited(createAdminClient(), body)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error("Unexpected error marking supplier credits:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

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

    // Read-only enrichment: the AP invoice a credit is linked to and that invoice's PO (additive fields).
    const invoiceIds = [...new Set((credits || []).map((c: any) => c.invoice_id).filter((id: any) => id != null))]
    const invoiceById = new Map<number, any>()
    const poById = new Map<number, any>()
    if (invoiceIds.length > 0) {
      const { data: invoices } = await supabase.from("accounts_payable").select("invoice_id, invoice_number, po_id").in("invoice_id", invoiceIds)
      for (const inv of invoices || []) invoiceById.set(inv.invoice_id, inv)
      const poIds = [...new Set((invoices || []).map((i: any) => i.po_id).filter((id: any) => id != null))]
      if (poIds.length > 0) {
        const { data: pos } = await supabase.from("purchase_orders").select("po_id, po_number").in("po_id", poIds)
        for (const po of pos || []) poById.set(po.po_id, po)
      }
    }

    // Transform the response to match expected format
    const transformed = (credits || []).map((credit: any) => ({
      invoice_number: invoiceById.get(credit.invoice_id)?.invoice_number ?? null,
      po_id: invoiceById.get(credit.invoice_id)?.po_id ?? null,
      po_number: poById.get(invoiceById.get(credit.invoice_id)?.po_id)?.po_number ?? null,
      unapplied: credit.status === "active",
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
