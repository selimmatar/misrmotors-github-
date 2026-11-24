// "Get the address from the portal": a business receiver (type B) can't be sent without its address. When the
// customer card (or the chosen tax identity) has none, this looks for an earlier portal document of that tax number -
// one the customer issued to us (received documents we already hold, then the portal's received search) or one we sent
// to it (the portal's sent search, filtered by receiver) - reads its details and copies the address into the EMPTY
// fields only. A field someone typed is never overwritten. Read-only toward the portal. Each fill is written to
// workflow_events (CUSTOMER_ADDRESS_FROM_PORTAL, new_value = the source document's uuid); a search that finds nothing
// is written too (CUSTOMER_ADDRESS_NOT_ON_PORTAL) and the automatic lookup skips that tax number for a day.
import { createPortal, EtaBusyError, type EtaEnv, type EtaPortal } from "./portal"
import { GOVERNORATES, toLatinDigits } from "./egypt"
import { loadCustomerIdentities, loadInvoiceIdentityId, pickIdentity } from "./identities"
import { DETAILS_GAP_MS, SEARCH_GAP_MS } from "./learn"
import { knownUserId } from "../po-history"

type Db = any

export const ADDRESS_FILLED_EVENT = "CUSTOMER_ADDRESS_FROM_PORTAL"
export const ADDRESS_MISS_EVENT = "CUSTOMER_ADDRESS_NOT_ON_PORTAL"
/** a "not found" is remembered this long per tax number (the automatic lookup does not search again) */
export const MISS_CACHE_MS = 24 * 60 * 60 * 1000
/** how far back the portal is searched: windows of 30 days (the search API's limit), newest first */
export const SENT_WINDOWS = 6
export const RECEIVED_WINDOWS = 3
const WINDOW_DAYS = 30
const MAX_PAGES = 3 // per window
const MAX_DETAILS = 6 // documents read in one lookup
/** one lookup stops starting new portal reads after this long (the server cuts requests at 60 s) */
export const ADDRESS_BUDGET_MS = 40_000

/** the e-invoice address columns (same names on customers and customer_tax_identities) */
const CORE = ["address_governorate", "address_region", "address_street", "address_building_number"] as const
/** optional columns (scripts/sql/2026-11-25-eta-address-autofill.sql); skipped while the migration is not applied */
const EXTRA = ["address_postal_code", "address_floor", "address_room", "address_landmark", "address_additional_info"] as const
type Column = (typeof CORE)[number] | (typeof EXTRA)[number]

export interface PortalAddress {
  country: string
  governate: string
  regionCity: string
  street: string
  buildingNumber: string
  postalCode: string
  floor: string
  room: string
  landmark: string
  additionalInformation: string
}

const PORTAL_KEY: Record<Column, keyof PortalAddress> = {
  address_governorate: "governate",
  address_region: "regionCity",
  address_street: "street",
  address_building_number: "buildingNumber",
  address_postal_code: "postalCode",
  address_floor: "floor",
  address_room: "room",
  address_landmark: "landmark",
  address_additional_info: "additionalInformation",
}

const text = (value: unknown) => (value == null ? "" : String(value).trim())
const digits = (value: unknown) => toLatinDigits(text(value)).replace(/[\s-]/g, "")
const notThereYet = (error: any) =>
  ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(error?.code || "")) || /does not exist|could not find/i.test(String(error?.message || ""))

/** the portal's governorate as the ERP's English name when it is one of the list (English or Arabic); else as written */
export function governorateName(value: string): string {
  const v = text(value).replace(/^محافظة\s+/, "").replace(/\s+governorate$/i, "")
  const low = v.toLowerCase()
  const hit = GOVERNORATES.find((g) => g.en.toLowerCase() === low || g.ar === v)
  return hit ? hit.en : text(value)
}

/** the document out of a details answer: it may be a JSON text, an object, or the body itself */
function documentOf(body: any): any {
  let doc = body?.document ?? body
  if (typeof doc === "string") {
    try { doc = JSON.parse(doc) } catch { doc = null }
  }
  return doc && typeof doc === "object" ? doc : body
}

/**
 * The receiver's (a document we sent) or issuer's (a document we received) address out of a details answer, when that
 * party is this tax number and its address has the four fields the portal requires; else null.
 */
export function addressFromDetails(details: any, taxId: string, side: "receiver" | "issuer"): PortalAddress | null {
  const doc = documentOf(details)
  const party = doc?.[side] ?? details?.[side]
  if (!party || typeof party !== "object") return null
  if (text(party.id) && digits(party.id) !== taxId) return null
  const a = party.address
  if (!a || typeof a !== "object") return null
  const out: PortalAddress = {
    country: text(a.country) || "EG",
    governate: governorateName(text(a.governate ?? a.governorate)),
    regionCity: text(a.regionCity),
    street: text(a.street),
    buildingNumber: text(a.buildingNumber),
    postalCode: text(a.postalCode),
    floor: text(a.floor),
    room: text(a.room),
    landmark: text(a.landmark),
    additionalInformation: text(a.additionalInformation),
  }
  if (out.country.toUpperCase() !== "EG") return null
  return out.governate && out.regionCity && out.street && out.buildingNumber ? out : null
}

// ---------------------------------------------------------------- whose address

export type AddressRequest = { invoiceId: number } | { customerId: number; identityId?: number | null }

export interface AddressTarget {
  customerId: number
  /** null: the customer card's own fields */
  identityId: number | null
  name: string
  taxId: string
}

export type AddressStatus =
  | "filled" // found and saved
  | "complete" // the address is already complete: nothing to do
  | "not_found" // no earlier portal document with an address for this tax number
  | "not_found_cached" // searched less than a day ago without finding one (automatic lookup only)
  | "busy" // the portal said "too many requests": nothing remembered, try again
  | "incomplete_search" // the time ran out before every window was searched: nothing remembered
  | "choose_identity" // 2+ companies and none chosen on the invoice
  | "no_tax_number" // not a business receiver with a 9-digit tax number
  | "not_found_record" // no such invoice / customer / identity

export interface AddressResult {
  status: AddressStatus
  target?: AddressTarget
  /** the columns filled (status "filled") */
  filled?: string[]
  sourceUuid?: string
  source?: "sent" | "received"
  address?: PortalAddress
}

async function loadTarget(db: Db, req: AddressRequest): Promise<AddressTarget | AddressStatus> {
  let customerId: number
  let identityId: number | null = null
  if ("invoiceId" in req) {
    const { data: inv, error } = await db.from("accounts_receivable").select("invoice_id, customer_id").eq("invoice_id", req.invoiceId).maybeSingle()
    if (error) throw new Error(`load invoice: ${error.message || error}`)
    if (!inv || inv.customer_id == null) return "not_found_record"
    customerId = Number(inv.customer_id)
    const active = await loadCustomerIdentities(db, customerId, { activeOnly: true })
    const pick = pickIdentity(active, active.length > 1 ? await loadInvoiceIdentityId(db, req.invoiceId) : null)
    if (pick.kind === "choose") return "choose_identity"
    if (pick.kind === "identity") identityId = pick.identity.identityId
  } else {
    customerId = req.customerId
    identityId = req.identityId ?? null
  }
  if (identityId != null) {
    const { data: row, error } = await db.from("customer_tax_identities").select("identity_id, customer_id, name, receiver_type, tax_registration_number").eq("identity_id", identityId).maybeSingle()
    if (error) throw new Error(`load tax identity: ${error.message || error}`)
    if (!row || Number(row.customer_id) !== customerId) return "not_found_record"
    const taxId = digits(row.tax_registration_number)
    if ((text(row.receiver_type) || "B") !== "B" || !/^\d{9}$/.test(taxId)) return "no_tax_number"
    return { customerId, identityId, name: text(row.name), taxId }
  }
  const { data: c, error } = await db.from("customers").select("customer_id, customer_name, eta_receiver_type, tax_registration_number").eq("customer_id", customerId).maybeSingle()
  if (error) throw new Error(`load customer: ${error.message || error}`)
  if (!c) return "not_found_record"
  const taxId = digits(c.tax_registration_number)
  if ((text(c.eta_receiver_type) || "B") !== "B" || !/^\d{9}$/.test(taxId)) return "no_tax_number"
  return { customerId, identityId: null, name: text(c.customer_name), taxId }
}

/** the row's address columns (the optional ones too when they exist); `extras` false while they are not migrated */
async function readAddress(db: Db, table: string, key: string, id: number): Promise<{ row: Record<string, any> | null; extras: boolean }> {
  const all = await db.from(table).select([key, ...CORE, ...EXTRA].join(", ")).eq(key, id).maybeSingle()
  if (!all.error) return { row: all.data, extras: true }
  if (!notThereYet(all.error)) throw new Error(`read address: ${all.error.message || all.error}`)
  const core = await db.from(table).select([key, ...CORE].join(", ")).eq(key, id).maybeSingle()
  if (core.error) throw new Error(`read address: ${core.error.message || core.error}`)
  return { row: core.data, extras: false }
}

const coreComplete = (row: Record<string, any> | null) => !!row && CORE.every((c) => text(row[c]))

/** fills the row's EMPTY columns from the address; returns the columns written */
async function fillRow(db: Db, table: string, key: string, id: number, address: PortalAddress): Promise<string[]> {
  const { row, extras } = await readAddress(db, table, key, id)
  if (!row) return []
  const patch: Record<string, string> = {}
  for (const c of extras ? [...CORE, ...EXTRA] : [...CORE]) {
    const value = address[PORTAL_KEY[c]]
    if (value && !text(row[c])) patch[c] = value
  }
  if (Object.keys(patch).length === 0) return []
  // each column is written only while it is still empty (a value typed meanwhile is kept)
  let q = db.from(table).update(patch).eq(key, id)
  for (const c of Object.keys(patch)) q = q.or(`${c}.is.null,${c}.eq.`)
  const up = await q
  if (up.error) throw new Error(`save address: ${up.error.message || up.error}`)
  return Object.keys(patch)
}

// ---------------------------------------------------------------- the portal search

export interface AddressDeps {
  portal?: EtaPortal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  budgetMs?: number
  userId?: unknown
  /** true (automatic lookup on opening the preview): a tax number searched without luck in the last day is skipped */
  useMissCache?: boolean
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** the 30-day windows ending today, newest first */
export function lookupWindows(nowMs: number, count: number): { from: string; to: string }[] {
  const DAY = 86_400_000
  const out: { from: string; to: string }[] = []
  for (let k = 0; k < count; k++) {
    const to = nowMs - k * WINDOW_DAYS * DAY
    out.push({ from: day(to - (WINDOW_DAYS - 1) * DAY), to: day(to) })
  }
  return out
}

type Found = { address: PortalAddress; uuid: string; source: "sent" | "received" }

/**
 * Looks for an earlier portal document of this tax number with a complete address: documents the customer issued to us
 * that we already hold, then our sent documents to it, then the portal's received documents from it. Waits between
 * portal calls (about 1 search per 2 s, 2 detail reads per second). "incomplete" when the time ran out first.
 */
export async function findPortalAddress(db: Db, env: EtaEnv, taxId: string, deps: AddressDeps = {}): Promise<Found | "not_found" | "incomplete"> {
  const portal = deps.portal || createPortal(env)
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now || (() => Date.now())
  const started = now()
  const budget = deps.budgetMs ?? ADDRESS_BUDGET_MS
  const seen = new Set<string>()
  let searches = 0
  let details = 0
  let outOfTime = false
  const timeUp = () => {
    if (now() - started > budget) outOfTime = true
    return outOfTime
  }

  const read = async (uuid: string, side: "receiver" | "issuer"): Promise<Found | null> => {
    if (!uuid || seen.has(uuid) || details >= MAX_DETAILS || timeUp()) return null
    seen.add(uuid)
    if (details > 0) await sleep(DETAILS_GAP_MS)
    details++
    const address = addressFromDetails(await portal.getDetails(uuid), taxId, side)
    return address ? { address, uuid, source: side === "receiver" ? "sent" : "received" } : null
  }

  // 1. documents this customer issued to us that are already stored (no search needed)
  const local = await db
    .from("eta_received_documents")
    .select("uuid, issuer_id, environment, date_issued")
    .eq("issuer_id", taxId)
    .eq("environment", env)
    .order("date_issued", { ascending: false })
    .limit(2)
  if (local.error && !notThereYet(local.error)) throw new Error(`read received documents: ${local.error.message || local.error}`)
  for (const d of (local.data || []) as any[]) {
    const hit = await read(text(d.uuid), "issuer")
    if (hit) return hit
  }

  // 2. the portal's sent (to this receiver) and received (from this issuer) documents, window by window
  const searchWindows = async (kind: "sent" | "received", count: number): Promise<Found | null> => {
    for (const w of lookupWindows(started, count)) {
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        if (timeUp()) return null
        if (searches > 0) await sleep(SEARCH_GAP_MS)
        searches++
        const range = { from: `${w.from}T00:00:00Z`, to: `${w.to}T23:59:59Z`, continuationToken: token }
        const body: any =
          kind === "sent" ? await portal.searchSentWindow({ ...range, receiverId: taxId }) : await portal.searchReceived({ ...range, issuerId: taxId })
        const rows: any[] = Array.isArray(body?.result) ? body.result : []
        // the search filter is trusted only as far as the summary agrees: the party's id must be this tax number
        const mine = rows.filter((d) => digits(kind === "sent" ? d?.receiverId : d?.issuerId) === taxId)
        for (const d of mine) {
          const hit = await read(text(d?.uuid), kind === "sent" ? "receiver" : "issuer")
          if (hit) return hit
        }
        const next = body?.metadata?.continuationToken
        if (!next || next === "EndofResultSet" || next === token) break
        token = String(next)
      }
    }
    return null
  }
  const sent = await searchWindows("sent", SENT_WINDOWS)
  if (sent) return sent
  const received = await searchWindows("received", RECEIVED_WINDOWS)
  if (received) return received
  return outOfTime ? "incomplete" : "not_found"
}

// ---------------------------------------------------------------- the whole step

async function missCached(db: Db, taxId: string, nowMs: number): Promise<boolean> {
  const { data, error } = await db
    .from("workflow_events")
    .select("event_id, performed_at")
    .eq("event_type", ADDRESS_MISS_EVENT)
    .eq("new_value", taxId)
    .gte("performed_at", new Date(nowMs - MISS_CACHE_MS).toISOString())
    .limit(1)
  if (error) return false
  return ((data || []) as any[]).length > 0
}

async function record(db: Db, row: Record<string, any>) {
  const ev = await db.from("workflow_events").insert(row)
  if (ev.error) console.error(`E-invoice: could not record ${row.event_type} for customer ${row.entity_id}`, ev.error)
}

/**
 * Fills the receiver's missing address from the portal (see the top of this file). Throws EtaBusyError / EtaError
 * only for portal failures other than "too many requests" (reported as "busy").
 */
export async function fillAddressFromPortal(db: Db, env: EtaEnv, req: AddressRequest, deps: AddressDeps = {}): Promise<AddressResult> {
  const now = deps.now || (() => Date.now())
  const target = await loadTarget(db, req)
  if (typeof target === "string") return { status: target }
  const table = target.identityId != null ? "customer_tax_identities" : "customers"
  const key = target.identityId != null ? "identity_id" : "customer_id"
  const id = target.identityId ?? target.customerId
  const { row } = await readAddress(db, table, key, id)
  if (coreComplete(row)) return { status: "complete", target }
  if (deps.useMissCache && (await missCached(db, target.taxId, now()))) return { status: "not_found_cached", target }

  let found: Awaited<ReturnType<typeof findPortalAddress>>
  try {
    found = await findPortalAddress(db, env, target.taxId, deps)
  } catch (e) {
    if (e instanceof EtaBusyError) return { status: "busy", target }
    throw e
  }
  const userId = await knownUserId(db, deps.userId)
  const at = new Date(now()).toISOString()
  if (found === "incomplete") return { status: "incomplete_search", target }
  if (found === "not_found") {
    await record(db, {
      entity_type: "CUSTOMER",
      entity_id: target.customerId,
      event_type: ADDRESS_MISS_EVENT,
      old_value: null,
      new_value: target.taxId,
      notes: `No earlier ${env} portal document with an address for tax number ${target.taxId} (${target.name})`,
      performed_by: userId,
      performed_at: at,
    })
    return { status: "not_found", target }
  }

  const filled = await fillRow(db, table, key, id, found.address)
  // an identity with the card's own tax number: the card's empty fields are filled as well (its fallback stays in step)
  if (target.identityId != null) {
    const { data: card } = await db.from("customers").select("customer_id, tax_registration_number").eq("customer_id", target.customerId).maybeSingle()
    if (card && digits(card.tax_registration_number) === target.taxId) await fillRow(db, "customers", "customer_id", target.customerId, found.address)
  }
  if (filled.length === 0) return { status: "complete", target }
  await record(db, {
    entity_type: "CUSTOMER",
    entity_id: target.customerId,
    event_type: ADDRESS_FILLED_EVENT,
    old_value: null,
    new_value: found.uuid,
    notes:
      `Address of ${target.name} (tax number ${target.taxId}${target.identityId != null ? `, tax identity ${target.identityId}` : ""}) ` +
      `filled from ${found.source} ${env} portal document ${found.uuid}: ${filled.join(", ")}`,
    performed_by: userId,
    performed_at: at,
  })
  return { status: "filled", target, filled, sourceUuid: found.uuid, source: found.source, address: found.address }
}
