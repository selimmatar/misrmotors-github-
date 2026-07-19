import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = getAdminClient()

    const { data: payments, error } = await supabase
      .from("supplier_payments")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Supplier Payments GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }


    return NextResponse.json(payments || [])
  } catch (error) {
    console.error("Supplier Payments GET exception:", error)
    return NextResponse.json({ error: "Failed to fetch supplier payments" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const { data, error } = await supabase
      .from("supplier_payments")
      .insert({
        supplier_invoice_id: body.supplierInvoiceId,
        supplier_id: body.supplierId,
        amount: body.amount,
        payment_date: body.paymentDate || new Date().toISOString().split("T")[0],
        receipt_url: body.receiptUrl || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Supplier Payments POST error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }


    return NextResponse.json(data)
  } catch (error) {
    console.error("Supplier Payments POST exception:", error)
    return NextResponse.json({ error: "Failed to create supplier payment" }, { status: 500 })
  }
}
