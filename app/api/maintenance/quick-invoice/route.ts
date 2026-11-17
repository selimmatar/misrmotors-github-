import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createQuickMaintenanceInvoice, validateQuickInvoice } from "@/lib/maintenance-quick-invoice"

// Maintenance quick invoice (spec 2026-11-17). Who may: maintenance, accountant, CEO, admin (lib/auth/permissions.ts).
// The maintenance role reaches nothing else, so the customer list it picks from comes from here (id and name only).
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { data, error } = await createAdminClient().from("customers").select("customer_id, customer_name").order("customer_name", { ascending: true })
    if (error) throw error
    return NextResponse.json({ customers: (data || []).map((c: any) => ({ id: c.customer_id, name: c.customer_name || "" })) })
  } catch (error: any) {
    console.error("[quick-invoice] customers:", error?.message || error)
    return NextResponse.json({ error: "Could not load the customers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Missing details" }, { status: 400 })
  }
  const checked = validateQuickInvoice(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const result = await createQuickMaintenanceInvoice(createAdminClient(), checked.value)
  return NextResponse.json(result.body, { status: result.status })
}
