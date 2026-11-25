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

// "Accountant e-mail" (owner request 2026-11-24): where our invoice e-mails go for this customer (comma-separated
// allowed); lib/eta/invoice-email.ts prefers it over the main e-mail. Saved only when the column exists
// (scripts/sql/2026-11-25-invoice-email.sql); until then the rest of the save goes through with a warning.
// "Purchasing contact e-mail" (salesperson_email, owner request 2026-11-27): where quotations and sales orders are
// e-mailed (lib/email/document-email.ts). Same rule: saved only when its column exists
// (scripts/sql/2026-11-27-document-email.sql).
const accountantField = (b: any): Record<string, string> => ({
  ...(b.accountantEmail !== undefined ? { accountant_email: String(b.accountantEmail ?? "").trim() } : {}),
  ...(b.salespersonEmail !== undefined ? { salesperson_email: String(b.salespersonEmail ?? "").trim() } : {}),
})
const OPTIONAL_COLUMNS = ["accountant_email", "salesperson_email"] as const
/** The optional e-mail column the database says it does not have, if that is the error. */
const missingColumn = (error: any): (typeof OPTIONAL_COLUMNS)[number] | null => {
  if (!["42703", "PGRST204"].includes(String(error?.code || ""))) return null
  return OPTIONAL_COLUMNS.find((c) => String(error?.message || "").includes(c)) || null
}
const ACCOUNTANT_NOT_SAVED = "accountant_email: not saved, database update needed"
const notSaved = (column: string) => `${column}: not saved, database update needed`
/** Saves; when an optional e-mail column is missing, saves without it (each at most once) and warns if it had a value. */
async function saveWithout(save: (patch: any) => PromiseLike<any>, patch: Record<string, any>, warnings: string[]) {
  let current = { ...patch }
  let res = await save(current)
  for (let i = 0; i < OPTIONAL_COLUMNS.length && res.error; i++) {
    const column = missingColumn(res.error)
    if (!column || !(column in current)) break
    const { [column]: value, ...rest } = current
    current = rest
    res = await save(current)
    if (!res.error && value) warnings.push(column === "accountant_email" ? ACCOUNTANT_NOT_SAVED : notSaved(column))
  }
  return res
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
        accountantEmail: item.accountant_email || "",
        salespersonEmail: item.salesperson_email || "",
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
      ...accountantField(body),
    }


    const { data, error } = await saveWithout((row) => supabase.from("customers").insert(row).select().single(), dbData, warnings)

    if (error) {
      throw error
    }


    revalidatePath("/api/customers")

    const transformed = {
      id: data.customer_id.toString(),
      name: data.customer_name,
      email: data.email || "",
      accountantEmail: data.accountant_email || "",
      salespersonEmail: data.salesperson_email || "",
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
    Object.assign(dbUpdates, etaDbFields(updates, warnings), accountantField(updates))

    const save = (patch: any) => supabase.from("customers").update(patch).eq("customer_id", Number.parseInt(id)).select().single()
    const { data, error } = await saveWithout(save, dbUpdates, warnings)

    if (error) throw error

    revalidatePath("/api/customers")

    const transformed = {
      id: data.customer_id.toString(),
      name: data.customer_name,
      email: data.email || "",
      accountantEmail: data.accountant_email || "",
      salespersonEmail: data.salesperson_email || "",
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
