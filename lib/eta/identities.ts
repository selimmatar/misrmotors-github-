// A customer's tax identities: a mother company and its sister companies / branches, each with its own name (as on
// the portal), receiver type, tax number / national ID and address. The identities table is the source of truth; a
// customer with none falls back to the e-invoice fields of its card. An invoice of a customer with 2+ active identities
// says which one it is issued for (accounts_receivable.eta_identity_id); with exactly 1 that one is used.
import { cleanNationalId, cleanTaxNumber, taxField } from "./egypt"
import { liveRealDocument } from "./live"

type Db = any

export const RECEIVER_TYPES = ["B", "P", "F"] as const

export interface TaxIdentity {
  identityId: number
  customerId: number
  name: string
  receiverType: string
  taxRegistrationNumber: string
  nationalId: string
  governorate: string
  region: string
  street: string
  buildingNumber: string
  active: boolean
}

const text = (value: unknown) => (value == null ? "" : String(value).trim())

/** Postgres / PostgREST "no such table / column": the migration is not applied yet, so there are no identities. */
const notThereYet = (error: any) =>
  ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(error?.code || "")) || /does not exist|could not find/i.test(String(error?.message || ""))

export const identityFromRow = (r: any): TaxIdentity => ({
  identityId: Number(r.identity_id),
  customerId: Number(r.customer_id),
  name: text(r.name),
  receiverType: RECEIVER_TYPES.includes(r.receiver_type) ? r.receiver_type : "B",
  taxRegistrationNumber: text(r.tax_registration_number),
  nationalId: text(r.national_id),
  governorate: text(r.address_governorate),
  region: text(r.address_region),
  street: text(r.address_street),
  buildingNumber: text(r.address_building_number),
  active: r.active !== false,
})

const COLUMNS =
  "identity_id, customer_id, name, receiver_type, tax_registration_number, national_id, address_governorate, address_region, address_street, address_building_number, active, created_at"

/** A customer's identities, oldest first (all, or only the active ones). */
export async function loadCustomerIdentities(db: Db, customerId: number, opts: { activeOnly?: boolean } = {}): Promise<TaxIdentity[]> {
  const { data, error } = await db.from("customer_tax_identities").select(COLUMNS).eq("customer_id", customerId).order("identity_id", { ascending: true })
  if (error) {
    if (notThereYet(error)) return []
    throw new Error(`load tax identities: ${error.message || error}`)
  }
  const all = ((data || []) as any[]).map(identityFromRow)
  return opts.activeOnly ? all.filter((i) => i.active) : all
}

/** The identity an invoice was set to (accounts_receivable.eta_identity_id); null when none or not migrated yet. */
export async function loadInvoiceIdentityId(db: Db, invoiceId: number): Promise<number | null> {
  const { data, error } = await db.from("accounts_receivable").select("eta_identity_id").eq("invoice_id", invoiceId).maybeSingle()
  if (error) {
    if (notThereYet(error)) return null
    throw new Error(`load the invoice's tax identity: ${error.message || error}`)
  }
  const id = Number(data?.eta_identity_id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Which identity an invoice is issued for, from the customer's ACTIVE identities and the invoice's stored choice:
 * none -> "card" (the customer card fields); one -> that one; 2+ -> the chosen one, or "choose" when none of them is.
 */
export function pickIdentity(active: TaxIdentity[], chosenId: number | null): { kind: "card" } | { kind: "identity"; identity: TaxIdentity } | { kind: "choose" } {
  if (active.length === 0) return { kind: "card" }
  if (active.length === 1) return { kind: "identity", identity: active[0] }
  const chosen = chosenId != null ? active.find((i) => i.identityId === chosenId) : undefined
  return chosen ? { kind: "identity", identity: chosen } : { kind: "choose" }
}

// ---------------------------------------------------------------- writes

export type IdentityResult<T = unknown> = { ok: true; value: T; warnings: string[] } | { ok: false; status: number; code: string; error: string }

/** The body's identity fields (only those present) as columns; a bad tax number / national ID is kept as typed with a warning. */
export function identityDbFields(b: any, warnings: string[]): Record<string, any> {
  const o: Record<string, any> = {}
  if (b.name !== undefined) o.name = String(b.name ?? "").trim()
  if (b.receiverType !== undefined && RECEIVER_TYPES.includes(b.receiverType)) o.receiver_type = b.receiverType
  if (b.taxRegistrationNumber !== undefined) o.tax_registration_number = taxField("tax_registration_number", b.taxRegistrationNumber, cleanTaxNumber, 9, warnings) || null
  if (b.nationalId !== undefined) o.national_id = taxField("national_id", b.nationalId, cleanNationalId, 14, warnings) || null
  if (b.governorate !== undefined) o.address_governorate = String(b.governorate ?? "").trim()
  if (b.region !== undefined) o.address_region = String(b.region ?? "").trim()
  if (b.street !== undefined) o.address_street = String(b.street ?? "").trim()
  if (b.buildingNumber !== undefined) o.address_building_number = String(b.buildingNumber ?? "").trim()
  if (b.active !== undefined) o.active = b.active !== false
  return o
}

export async function addIdentity(db: Db, customerId: number, body: any): Promise<IdentityResult<TaxIdentity>> {
  const warnings: string[] = []
  const fields = identityDbFields(body, warnings)
  if (!fields.name) return { ok: false, status: 400, code: "NAME_REQUIRED", error: "The company name is required." }
  const { data: customer, error: cErr } = await db.from("customers").select("customer_id").eq("customer_id", customerId).maybeSingle()
  if (cErr) return { ok: false, status: 500, code: "READ_FAILED", error: "Could not read the customer." }
  if (!customer) return { ok: false, status: 404, code: "NOT_FOUND", error: "Customer not found." }
  const { data, error } = await db
    .from("customer_tax_identities")
    .insert({ receiver_type: "B", active: true, ...fields, customer_id: customerId })
    .select(COLUMNS)
    .single()
  if (error || !data) return { ok: false, status: 500, code: "WRITE_FAILED", error: "Could not save the tax identity." }
  return { ok: true, value: identityFromRow(data), warnings }
}

export async function updateIdentity(db: Db, customerId: number, identityId: number, body: any): Promise<IdentityResult<TaxIdentity>> {
  const warnings: string[] = []
  const fields = identityDbFields(body, warnings)
  if ("name" in fields && !fields.name) return { ok: false, status: 400, code: "NAME_REQUIRED", error: "The company name is required." }
  const { data: row, error: rErr } = await db.from("customer_tax_identities").select("identity_id, customer_id").eq("identity_id", identityId).maybeSingle()
  if (rErr) return { ok: false, status: 500, code: "READ_FAILED", error: "Could not read the tax identity." }
  if (!row || Number(row.customer_id) !== customerId) return { ok: false, status: 404, code: "NOT_FOUND", error: "Tax identity not found." }
  if (Object.keys(fields).length === 0) return { ok: false, status: 400, code: "NOTHING_TO_SAVE", error: "Nothing to save." }
  const { data, error } = await db.from("customer_tax_identities").update(fields).eq("identity_id", identityId).eq("customer_id", customerId).select(COLUMNS).single()
  if (error || !data) return { ok: false, status: 500, code: "WRITE_FAILED", error: "Could not save the tax identity." }
  return { ok: true, value: identityFromRow(data), warnings }
}

/**
 * Sets which of its customer's active identities an invoice is issued for (null clears the choice). Refused once a
 * real document is live for the invoice: the portal already has it under the chosen company.
 */
export async function chooseInvoiceIdentity(db: Db, invoiceId: number, identityId: number | null): Promise<IdentityResult<number | null>> {
  const { data: inv, error } = await db.from("accounts_receivable").select("invoice_id, customer_id, status").eq("invoice_id", invoiceId).maybeSingle()
  if (error) return { ok: false, status: 500, code: "READ_FAILED", error: "Could not read the invoice." }
  if (!inv) return { ok: false, status: 404, code: "NOT_FOUND", error: "Invoice not found." }
  if (inv.status === "replaced") return { ok: false, status: 409, code: "REPLACED", error: "This invoice was replaced; use its new invoice instead." }
  if (await liveRealDocument(db, invoiceId)) return { ok: false, status: 409, code: "ETA_LIVE", error: "This invoice is already on the portal; the company it was issued for can't change." }
  if (identityId !== null) {
    const active = inv.customer_id != null ? await loadCustomerIdentities(db, Number(inv.customer_id), { activeOnly: true }) : []
    if (!active.some((i) => i.identityId === identityId)) {
      return { ok: false, status: 400, code: "NOT_CUSTOMER_IDENTITY", error: "That company is not an active tax identity of this invoice's customer." }
    }
  }
  const up = await db.from("accounts_receivable").update({ eta_identity_id: identityId }).eq("invoice_id", invoiceId)
  if (up.error) return { ok: false, status: 500, code: "WRITE_FAILED", error: "Could not save the choice." }
  return { ok: true, value: identityId, warnings: [] }
}
