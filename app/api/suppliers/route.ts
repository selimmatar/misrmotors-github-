import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    console.log("[v0] Suppliers GET: Starting fetch")

    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data, error } = await supabase
        .from("suppliers")
        .select("*") // Selected all columns directly
        .order("created_at", { ascending: false })

      if (error) {
        console.log("[v0] Suppliers GET error:", error)
        throw error
      }

      return data
    })

    console.log("[v0] Suppliers GET: Fetched", result?.length, "suppliers")

    const transformed = result?.map((item: any) => {
      return {
        id: item.supplier_id.toString(),
        name: item.supplier_name,
        email: item.email || "",
        phone: item.phone || "",
        address: item.address || "",
        city: item.city || "",
        country: item.country || "",
        paymentTerms: item.payment_terms || "prepaid",
        createdDate: item.created_at,
        leadTimeDays: item.lead_time_days || 7,
      }
    })

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error fetching suppliers:", error)
    return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log("[v0] Suppliers POST: Received data", body)

    const supabase = createAdminClient()

    const dbData = {
      supplier_name: body.name,
      payment_terms: body.paymentTerms === "installment" ? "installment" : "prepaid",
      is_active: true,
      email: body.email || "",
      phone: body.phone || "",
      address: body.address || "",
      city: body.city || "",
      country: body.country || "",
      lead_time_days: body.leadTimeDays || 7,
    }

    console.log("[v0] Suppliers POST: Inserting to DB", dbData)

    const { data, error } = await supabase.from("suppliers").insert(dbData).select().single()

    if (error) {
      console.log("[v0] Suppliers POST error:", error)
      throw error
    }

    console.log("[v0] Suppliers POST: Success, created supplier", data)

    const transformed = {
      id: data.supplier_id.toString(),
      name: data.supplier_name,
      email: data.email || "",
      phone: data.phone || "",
      address: data.address || "",
      city: data.city || "",
      country: data.country || "",
      paymentTerms: data.payment_terms || "prepaid",
      createdDate: data.created_at,
      leadTimeDays: data.lead_time_days || 7,
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error creating supplier:", error)
    return NextResponse.json({ error: "Failed to create supplier" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { id, ...updates } = body

    const dbUpdates: any = {}
    if (updates.name) dbUpdates.supplier_name = updates.name
    if (updates.paymentTerms !== undefined)
      dbUpdates.payment_terms = updates.paymentTerms === "installment" ? "installment" : "prepaid"

    if (updates.email !== undefined) dbUpdates.email = updates.email
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone
    if (updates.address !== undefined) dbUpdates.address = updates.address
    if (updates.city !== undefined) dbUpdates.city = updates.city
    if (updates.country !== undefined) dbUpdates.country = updates.country
    if (updates.leadTimeDays !== undefined) dbUpdates.lead_time_days = updates.leadTimeDays

    const { data, error } = await supabase
      .from("suppliers")
      .update(dbUpdates)
      .eq("supplier_id", Number.parseInt(id))
      .select()
      .single()

    if (error) throw error

    const transformed = {
      id: data.supplier_id.toString(),
      name: data.supplier_name,
      email: data.email || "",
      phone: data.phone || "",
      address: data.address || "",
      city: data.city || "",
      country: data.country || "",
      paymentTerms: data.payment_terms || "prepaid",
      createdDate: data.created_at,
      leadTimeDays: data.lead_time_days || 7,
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error updating supplier:", error)
    return NextResponse.json({ error: "Failed to update supplier" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (id) {
      const { error } = await supabase.from("suppliers").delete().eq("supplier_id", Number.parseInt(id))
      if (error) throw error
    } else {
      const { error } = await supabase.from("suppliers").delete().gt("supplier_id", 0)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting suppliers:", error)
    return NextResponse.json({ error: "Failed to delete suppliers" }, { status: 500 })
  }
}
