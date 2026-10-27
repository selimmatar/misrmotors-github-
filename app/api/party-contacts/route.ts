// Extra contact people for a customer or a supplier. The main phone/email stay on the customer/supplier itself.
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const toContact = (row: any) => ({
  id: String(row.contact_id),
  customerId: row.customer_id == null ? null : String(row.customer_id),
  supplierId: row.supplier_id == null ? null : String(row.supplier_id),
  name: row.contact_name || "",
  jobTitle: row.job_title || "",
  phone: row.phone || "",
  email: row.email || "",
  notes: row.notes || "",
})

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** Owner of the contact: exactly one of customerId / supplierId. */
function ownerOf(source: { customerId?: unknown; supplierId?: unknown }) {
  const customerId = source.customerId == null || source.customerId === "" ? null : parsePositiveId(String(source.customerId))
  const supplierId = source.supplierId == null || source.supplierId === "" ? null : parsePositiveId(String(source.supplierId))
  if ((customerId === null) === (supplierId === null)) return null
  return { customer_id: customerId, supplier_id: supplierId }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const owner = ownerOf({ customerId: searchParams.get("customerId"), supplierId: searchParams.get("supplierId") })
    if (!owner) return NextResponse.json({ error: "customerId or supplierId is required" }, { status: 400 })
    const supabase = createAdminClient()
    let query = supabase.from("party_contacts").select("*").order("contact_id", { ascending: true })
    query = owner.customer_id !== null ? query.eq("customer_id", owner.customer_id) : query.eq("supplier_id", owner.supplier_id)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json((data || []).map(toContact))
  } catch (error) {
    console.error("Error fetching contacts:", error)
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const owner = ownerOf(body)
    if (!owner) return NextResponse.json({ error: "customerId or supplierId is required" }, { status: 400 })
    const name = text(body.name)
    if (!name) return NextResponse.json({ error: "Contact name is required" }, { status: 400 })
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("party_contacts")
      .insert({ ...owner, contact_name: name, job_title: text(body.jobTitle), phone: text(body.phone), email: text(body.email), notes: text(body.notes) })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(toContact(data))
  } catch (error) {
    console.error("Error creating contact:", error)
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const id = parsePositiveId(String(body.id ?? ""))
    if (id === null) return NextResponse.json({ error: "A valid numeric id is required" }, { status: 400 })
    const name = text(body.name)
    if (!name) return NextResponse.json({ error: "Contact name is required" }, { status: 400 })
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("party_contacts")
      .update({ contact_name: name, job_title: text(body.jobTitle), phone: text(body.phone), email: text(body.email), notes: text(body.notes), updated_at: new Date().toISOString() })
      .eq("contact_id", id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(toContact(data))
  } catch (error) {
    console.error("Error updating contact:", error)
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const id = parsePositiveId(new URL(request.url).searchParams.get("id"))
    if (id === null) return NextResponse.json({ error: "A valid numeric id is required" }, { status: 400 })
    const supabase = createAdminClient()
    const { error } = await supabase.from("party_contacts").delete().eq("contact_id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting contact:", error)
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 })
  }
}
