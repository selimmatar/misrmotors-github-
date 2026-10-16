import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("customer_payments")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error

    const transformed =
      data?.map((payment: any) => ({
        id: payment.payment_id?.toString(),
        invoiceId: payment.invoice_id?.toString(),
        customerId: payment.customer_id?.toString(),
        amount: payment.amount,
        paymentDate: payment.payment_date,
        paymentMethod: payment.payment_method,
        referenceNumber: payment.reference_number,
        recordedBy: payment.recorded_by?.toString(),
        createdAt: payment.created_at,
      })) || []

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("Error fetching customer payments:", error)
    return NextResponse.json({ error: "Failed to fetch customer payments" }, { status: 500 })
  }
}

// RETIRED (BIZ-S-010). A bare customer_payments row moved no invoice and wrote no ledger entry. Customer payments are
// recorded with POST /api/accounts-receivable/payments, which updates the invoice and writes both rows.
export async function POST() {
  return NextResponse.json({ error: "Use POST /api/accounts-receivable/payments", code: "ENDPOINT_RETIRED" }, { status: 410 })
}
