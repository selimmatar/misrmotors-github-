import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { CACHE_TAGS } from "@/lib/cache-config"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    console.log("[v0] Customers GET: Starting fetch")

    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false })

      if (error) {
        console.log("[v0] Customers GET error:", error)
        throw error
      }

      return data
    })

    console.log("[v0] Customers GET: Fetched", result?.length, "customers")

    const transformed = result?.map((item: any) => {
      return {
        id: item.customer_id.toString(),
        name: item.customer_name,
        email: item.email || "",
        phone: item.phone || "",
        address: item.address || "",
        city: item.city || "",
        country: item.country || "",
        creditLimit: item.credit_limit || 0,
        paymentTerms: item.payment_terms_days || 30,
        status: item.status || "active",
        createdDate: item.created_at,
      }
    })

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error fetching customers:", error)
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log("[v0] Customers POST: Received data", body)

    const supabase = createAdminClient()

    const dbData = {
      customer_name: body.name,
      status: body.status || "active",
      email: body.email || "",
      phone: body.phone || "",
      address: body.address || "",
      city: body.city || "",
      country: body.country || "",
    }

    console.log("[v0] Customers POST: Inserting to DB", dbData)

    const { data, error } = await supabase.from("customers").insert(dbData).select().single()

    if (error) {
      console.log("[v0] Customers POST error:", error)
      throw error
    }

    console.log("[v0] Customers POST: Success, created customer", data)

    revalidateTag(CACHE_TAGS.CUSTOMERS)

    const transformed = {
      id: data.customer_id.toString(),
      name: data.customer_name,
      email: data.email || "",
      phone: data.phone || "",
      address: data.address || "",
      city: data.city || "",
      country: data.country || "",
      creditLimit: 0,
      paymentTerms: 30,
      status: data.status || "active",
      createdDate: data.created_at,
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error creating customer:", error)
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { id, ...updates } = body

    const dbUpdates: any = {}
    if (updates.name) dbUpdates.customer_name = updates.name
    if (updates.status) dbUpdates.status = updates.status
    if (updates.email !== undefined) dbUpdates.email = updates.email
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone
    if (updates.address !== undefined) dbUpdates.address = updates.address
    if (updates.city !== undefined) dbUpdates.city = updates.city
    if (updates.country !== undefined) dbUpdates.country = updates.country

    const { data, error } = await supabase
      .from("customers")
      .update(dbUpdates)
      .eq("customer_id", Number.parseInt(id))
      .select()
      .single()

    if (error) throw error

    revalidateTag(CACHE_TAGS.CUSTOMERS)

    const transformed = {
      id: data.customer_id.toString(),
      name: data.customer_name,
      email: data.email || "",
      phone: data.phone || "",
      address: data.address || "",
      city: data.city || "",
      country: data.country || "",
      creditLimit: 0,
      paymentTerms: 30,
      status: data.status || "active",
      createdDate: data.created_at,
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("[v0] Error updating customer:", error)
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (id) {
      const { error } = await supabase.from("customers").delete().eq("customer_id", Number.parseInt(id))
      if (error) throw error
    } else {
      const { error } = await supabase.from("customers").delete().gt("customer_id", 0)
      if (error) throw error
    }

    revalidateTag(CACHE_TAGS.CUSTOMERS)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting customers:", error)
    return NextResponse.json({ error: "Failed to delete customers" }, { status: 500 })
  }
}
