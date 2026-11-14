// GET -> sales orders with approved delivery permits not invoiced yet, ready or not and why (lib/ready-to-invoice.ts).
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ordersToInvoice } from "@/lib/ready-to-invoice"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json({ orders: await ordersToInvoice(createAdminClient()) })
  } catch (error) {
    console.error("Orders to invoice error:", error)
    return NextResponse.json({ error: "Could not load the orders to invoice" }, { status: 500 })
  }
}
