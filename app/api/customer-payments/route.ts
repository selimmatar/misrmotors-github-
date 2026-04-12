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

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    console.log("[v0] Customer Payments API - Received body:", body)
    console.log("[v0] Customer Payments API - invoiceId value:", body.invoiceId, "Type:", typeof body.invoiceId)
    
    let invoiceIdNumeric: number
    const invoiceIdStr = String(body.invoiceId)
    
    // If it starts with "INV-CUST-", extract the timestamp and find the actual invoice_id
    if (invoiceIdStr.startsWith("INV-CUST-")) {
      console.error("[v0] ERROR: Received invoice NUMBER instead of invoice ID:", invoiceIdStr)
      return NextResponse.json({ 
        error: "Invalid invoiceId: expected database invoice_id (integer), received invoice number string" 
      }, { status: 400 })
    }
    
    invoiceIdNumeric = Number.parseInt(invoiceIdStr)
    
    if (isNaN(invoiceIdNumeric)) {
      console.error("[v0] ERROR: Could not parse invoiceId to integer:", body.invoiceId)
      return NextResponse.json({ error: "Invalid invoiceId format" }, { status: 400 })
    }

    console.log("[v0] Customer Payments API - Parsed invoice_id:", invoiceIdNumeric)

    const dbData = {
      invoice_id: invoiceIdNumeric,
      customer_id: Number.parseInt(body.customerId),
      amount: body.amount,
      payment_date: body.paymentDate || new Date().toISOString().split("T")[0],
      payment_method: body.paymentMethod || "bank_transfer",
      reference_number: body.referenceNumber,
      recorded_by: body.recordedBy ? Number.parseInt(body.recordedBy) : null,
    }

    console.log("[v0] Customer Payments API - Inserting:", dbData)

    const { data, error } = await supabase.from("customer_payments").insert(dbData).select().single()

    if (error) {
      console.error("[v0] Customer Payments API - Database error:", error)
      throw error
    }

    console.log("[v0] Customer Payments API - Success:", data)
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error creating customer payment:", error.message)
    return NextResponse.json({ error: error.message || "Failed to create customer payment" }, { status: 500 })
  }
}
