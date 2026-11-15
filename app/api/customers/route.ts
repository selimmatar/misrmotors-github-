import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { NextResponse } from "next/server"
import { cleanNationalId, cleanTaxNumber, taxField } from "@/lib/eta/egypt"
import { revalidatePath } from "next/cache"

export const dynamic = "force-dynamic"

const RECEIVER_TYPES = ["B", "P", "F"]
const etaFields = (d: any) => ({
  receiverType: RECEIVER_TYPES.includes(d.eta_receiver_type) ? d.eta_receiver_type : "B",
  taxRegistrationNumber: d.tax_registration_number || "",
  nationalId: d.national_id || "",
  governorate: d.address_governorate || "",
  region: d.address_region || "",
  street: d.address_street || "",
  buildingNumber: d.address_building_number || "",
})
// Maps the body's e-invoice fields (only those present) to columns. A bad tax number / national ID is saved as typed
// and reported in `warnings` — the save is never refused.
function etaDbFields(b: any, warnings: string[]) {
  const o: any = {}
  if (b.receiverType !== undefined && RECEIVER_TYPES.includes(b.receiverType)) o.eta_receiver_type = b.receiverType
  if (b.taxRegistrationNumber !== undefined) o.tax_registration_number = taxField("tax_registration_number", b.taxRegistrationNumber, cleanTaxNumber, 9, warnings)
  if (b.nationalId !== undefined) o.national_id = taxField("national_id", b.nationalId, cleanNationalId, 14, warnings)
  if (b.governorate !== undefined) o.address_governorate = String(b.governorate ?? "")
  if (b.region !== undefined) o.address_region = String(b.region ?? "")
  if (b.street !== undefined) o.address_street = String(b.street ?? "")
  if (b.buildingNumber !== undefined) o.address_building_number = String(b.buildingNumber ?? "")
  return o
}

export async function GET() {
  try {

    const result = await withRetry(async () => {
      const supabase = createAdminClient()

      const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false })

      if (error) {
        throw error
      }

      return data
    })


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
        ...etaFields(item),
      }
    })

    return NextResponse.json(transformed)
  } catch (error) {
    console.error("Error fetching customers:", error)
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const warnings: string[] = []

    const supabase = createAdminClient()

    const dbData = {
      customer_name: body.name,
      status: body.status || "active",
      email: body.email || "",
      phone: body.phone || "",
      address: body.address || "",
      city: body.city || "",
      country: body.country || "",
      ...etaDbFields(body, warnings),
    }


    const { data, error } = await supabase.from("customers").insert(dbData).select().single()

    if (error) {
      throw error
    }


    revalidatePath("/api/customers")

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
      ...etaFields(data),
    }

    return NextResponse.json(warnings.length ? { ...transformed, taxWarnings: warnings } : transformed)
  } catch (error) {
    console.error("Error creating customer:", error)
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { id, ...updates } = body
    const warnings: string[] = []

    const dbUpdates: any = {}
    if (updates.name) dbUpdates.customer_name = updates.name
    if (updates.status) dbUpdates.status = updates.status
    if (updates.email !== undefined) dbUpdates.email = updates.email
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone
    if (updates.address !== undefined) dbUpdates.address = updates.address
    if (updates.city !== undefined) dbUpdates.city = updates.city
    if (updates.country !== undefined) dbUpdates.country = updates.country
    Object.assign(dbUpdates, etaDbFields(updates, warnings))

    const { data, error } = await supabase
      .from("customers")
      .update(dbUpdates)
      .eq("customer_id", Number.parseInt(id))
      .select()
      .single()

    if (error) throw error

    revalidatePath("/api/customers")

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
      ...etaFields(data),
    }

    return NextResponse.json(warnings.length ? { ...transformed, taxWarnings: warnings } : transformed)
  } catch (error) {
    console.error("Error updating customer:", error)
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    const numericId = parsePositiveId(id)
    if (numericId === null) {
      return NextResponse.json({ error: "A valid numeric id is required" }, { status: 400 })
    }

    const { error } = await supabase.from("customers").delete().eq("customer_id", numericId)
    if (error) throw error

    revalidatePath("/api/customers")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting customers:", error)
    return NextResponse.json({ error: "Failed to delete customers" }, { status: 500 })
  }
}
