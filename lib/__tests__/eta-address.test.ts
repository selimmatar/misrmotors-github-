// E-invoice: "Get address from the portal" - a business receiver's missing address is copied from an earlier portal
// document of its tax number (sent by us, or issued to us), only into empty fields, with a workflow_events record.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { useDb, call } from "./route-harness"
import { FakeDb, type Row } from "./fake-db"
import { createDpInvoices } from "../invoicing"
import { buildEtaPreview } from "../eta/preview"
import { EtaBusyError, type EtaPortal } from "../eta/portal"
import {
  ADDRESS_FILLED_EVENT, ADDRESS_MISS_EVENT, SENT_WINDOWS, RECEIVED_WINDOWS, addressFromDetails, fillAddressFromPortal, governorateName, lookupWindows,
} from "../eta/receiver-address"
import { chooseInvoiceIdentity } from "../eta/identities"
import { ruleFor, allows } from "../auth/permissions"
import * as addressRoute from "../../app/api/eta/receiver-address/route"

const TAX = "200300400"
const NOW_MS = Date.parse("2026-11-24T10:00:00Z")
const now = () => NOW_MS

function baseDb(customer: Row = {}) {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    sales_orders: [{ so_id: 1, so_number: "SO-1", customer_id: 5, total: 342, subtotal: 300, discount_amount: 0, payment_type: "cash" }],
    customers: [{
      customer_id: 5, customer_name: "Acme Trading", eta_receiver_type: "B", tax_registration_number: TAX,
      address_governorate: "", address_region: null, address_street: "", address_building_number: "", ...customer,
    }],
    sales_order_items: [{ so_id: 1, product_id: 100, outsourced_name: null, quantity: 3, unit_price: 100, total: 300 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-1", sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: [{ permit_id: 1, product_id: 100, item_name_snapshot: "Wrench", quantity: 3, unit_price: 100, total: 300 }],
    invoice_delivery_permits: [], accounts_receivable: [], product_returns: [], return_items: [], customer_payments: [],
    products: [{ product_id: 100, product_name: "Wrench", eta_code_id: 1, eta_unit_type: "EA" }],
    eta_item_codes: [{ code_id: 1, item_code: "EG-100060455-P1", name: "Tools", keywords: [], default_unit: "EA", active: true }],
    eta_code_memory: [], eta_documents: [], eta_signers: [], eta_received_documents: [], customer_tax_identities: [], workflow_events: [],
    company_settings: [
      { setting_key: "eta_rin", setting_value: "100060455" }, { setting_key: "eta_registered_name", setting_value: "Misr Motors" },
      { setting_key: "eta_activity_code", setting_value: "4530" }, { setting_key: "eta_branch_governorate", setting_value: "Cairo" },
      { setting_key: "eta_branch_region", setting_value: "Nasr City" }, { setting_key: "eta_branch_street", setting_value: "Abbas" },
      { setting_key: "eta_branch_building_number", setting_value: "12" }, { setting_key: "eta_go_live_at", setting_value: "2026-01-01T00:00:00Z" },
      { setting_key: "eta_environment", setting_value: "real" },
    ],
  })
  db.jitter = false
  return db
}
async function withInvoice(customer: Row = {}) {
  const db = baseDb(customer)
  const r = await createDpInvoices(db, [1])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return { db, id: db.tables.accounts_receivable[0].invoice_id as number }
}

const ADDRESS = {
  country: "EG", governate: "الجيزة", regionCity: "Dokki", street: "Tahrir St", buildingNumber: "4", postalCode: "12611", floor: "2", landmark: "Near the bank",
}
const sentDetails = (uuid: string, receiverId = TAX, address: any = ADDRESS) => ({
  uuid, document: JSON.stringify({ issuer: { id: "100060455", address: { governate: "Cairo" } }, receiver: { type: "B", id: receiverId, name: "Acme", address } }),
})
const receivedDetails = (uuid: string, issuerId = TAX, address: any = ADDRESS) => ({ uuid, issuer: { type: "B", id: issuerId, name: "Acme", address }, receiver: { id: "100060455" } })

/** a fake read-only portal recording each call */
function fakePortal(opts: { sent?: (p: any) => any; received?: (p: any) => any; details?: Record<string, any>; busy?: boolean } = {}) {
  const calls = { sent: [] as any[], received: [] as any[], details: [] as string[] }
  const no = async (): Promise<any> => { throw new Error("not read-only") }
  const portal: EtaPortal = {
    submit: no, getSubmission: no, cancel: no, printout: no, documentType: no, myCodes: no, searchSent: no,
    async getDetails(uuid) { calls.details.push(uuid); return opts.details?.[uuid] ?? {} },
    async searchSentWindow(p) { calls.sent.push(p); if (opts.busy) throw new EtaBusyError(30); return opts.sent ? opts.sent(p) : { result: [] } },
    async searchReceived(p) { calls.received.push(p); return opts.received ? opts.received(p) : { result: [] } },
  }
  const sleeps: number[] = []
  return { portal, calls, deps: { portal, now, sleep: async (ms: number) => { sleeps.push(ms) }, userId: 7 }, sleeps }
}

test("A1. found in a document we sent: the card's empty address is saved, the event names the document, the preview no longer asks", async () => {
  const { db, id } = await withInvoice()
  assert.ok((await buildEtaPreview(db, id))!.missing.includes("customer_address"))
  const fp = fakePortal({
    // the second window (one month back) holds the document; its summary carries the receiver's id
    sent: (p) => (p.from.startsWith("2026-09") ? { result: [{ uuid: "U-OTHER", receiverId: "999999999" }, { uuid: "U-SENT", receiverId: TAX }], metadata: { continuationToken: "EndofResultSet" } } : { result: [] }),
    details: { "U-SENT": sentDetails("U-SENT") },
  })
  const r = await fillAddressFromPortal(db, "real", { invoiceId: id }, fp.deps)
  assert.equal(r.status, "filled")
  assert.equal(r.sourceUuid, "U-SENT")
  assert.equal(r.source, "sent")
  const c = db.tables.customers[0]
  assert.deepEqual(
    [c.address_governorate, c.address_region, c.address_street, c.address_building_number, c.address_postal_code, c.address_floor, c.address_landmark],
    ["Giza", "Dokki", "Tahrir St", "4", "12611", "2", "Near the bank"],
    "the Arabic governorate is stored as the list's name; the optional parts are kept",
  )
  assert.equal(c.address_room, undefined, "a part the portal did not have stays untouched")
  // the search used the receiver filter, read only the document whose summary is this customer
  assert.ok(fp.calls.sent.every((p) => p.receiverId === TAX))
  assert.deepEqual(fp.calls.details, ["U-SENT"])
  assert.ok(fp.sleeps.includes(2000), "searches are spaced for the portal's limit")
  const ev = db.tables.workflow_events.filter((e) => e.event_type === ADDRESS_FILLED_EVENT)
  assert.equal(ev.length, 1)
  assert.equal(ev[0].entity_type, "CUSTOMER")
  assert.equal(ev[0].entity_id, 5)
  assert.equal(ev[0].new_value, "U-SENT")
  assert.equal(ev[0].performed_by, 7)
  const p = (await buildEtaPreview(db, id))!
  assert.ok(!p.missing.includes("customer_address"), JSON.stringify(p.missing))
  assert.deepEqual(p.customer.address, { governorate: "Giza", regionCity: "Dokki", street: "Tahrir St", buildingNumber: "4" })
})

test("A2. a typed address is never overwritten: only the empty fields are filled; a complete one is not searched", async () => {
  const { db, id } = await withInvoice({ address_street: "Typed street", address_building_number: "88" })
  const fp = fakePortal({ sent: () => ({ result: [{ uuid: "U1", receiverId: TAX }] }), details: { U1: sentDetails("U1") } })
  const r = await fillAddressFromPortal(db, "real", { invoiceId: id }, fp.deps)
  assert.equal(r.status, "filled")
  assert.deepEqual(r.filled!.sort(), ["address_floor", "address_governorate", "address_landmark", "address_postal_code", "address_region"])
  const c = db.tables.customers[0]
  assert.equal(c.address_street, "Typed street")
  assert.equal(c.address_building_number, "88")
  assert.equal(c.address_region, "Dokki")

  const again = fakePortal({ sent: () => { throw new Error("must not search") } })
  assert.equal((await fillAddressFromPortal(db, "real", { invoiceId: id }, again.deps)).status, "complete")
  assert.equal(again.calls.sent.length + again.calls.received.length + again.calls.details.length, 0)
  assert.equal(db.tables.workflow_events.filter((e) => e.event_type === ADDRESS_FILLED_EVENT).length, 1)
})

test("A3. not found: a clear status, remembered for a day; the automatic lookup skips it, the button searches again", async () => {
  const { db, id } = await withInvoice()
  const fp = fakePortal()
  const r = await fillAddressFromPortal(db, "real", { invoiceId: id }, { ...fp.deps, useMissCache: true })
  assert.equal(r.status, "not_found")
  assert.equal(fp.calls.sent.length, SENT_WINDOWS)
  assert.equal(fp.calls.received.length, RECEIVED_WINDOWS)
  assert.ok(fp.calls.received.every((p) => p.issuerId === TAX))
  const miss = db.tables.workflow_events.filter((e) => e.event_type === ADDRESS_MISS_EVENT)
  assert.equal(miss.length, 1)
  assert.equal(miss[0].new_value, TAX)
  assert.equal(db.tables.customers[0].address_street, "", "nothing written")

  const auto = fakePortal()
  assert.equal((await fillAddressFromPortal(db, "real", { invoiceId: id }, { ...auto.deps, useMissCache: true })).status, "not_found_cached")
  assert.equal(auto.calls.sent.length, 0, "no portal search within the day")
  // a day later the automatic lookup searches again
  const later = fakePortal()
  const r2 = await fillAddressFromPortal(db, "real", { invoiceId: id }, { ...later.deps, now: () => NOW_MS + 25 * 3600_000, useMissCache: true })
  assert.equal(r2.status, "not_found")
  assert.ok(later.calls.sent.length > 0)
  // the button (no cache) always searches
  const manual = fakePortal()
  assert.equal((await fillAddressFromPortal(db, "real", { invoiceId: id }, manual.deps)).status, "not_found")
  assert.ok(manual.calls.sent.length > 0)

  // "busy" and a search cut short are not remembered as "not found"
  const before = db.tables.workflow_events.length
  assert.equal((await fillAddressFromPortal(db, "real", { invoiceId: id }, fakePortal({ busy: true }).deps)).status, "busy")
  let t = NOW_MS
  const slow = fakePortal()
  const cut = await fillAddressFromPortal(db, "real", { invoiceId: id }, { ...slow.deps, now: () => (t += 10_000), budgetMs: 25_000 })
  assert.equal(cut.status, "incomplete_search")
  assert.equal(db.tables.workflow_events.length, before)
})

test("A4. identity-level: the chosen tax identity's address is filled from a document the company issued to us", async () => {
  const { db, id } = await withInvoice({ address_governorate: "Cairo", address_region: "Heliopolis", address_street: "Card street", address_building_number: "1" })
  const identity = (n: number, tax: string): Row => ({
    identity_id: n, customer_id: 5, name: `Acme ${n}`, receiver_type: "B", tax_registration_number: tax,
    address_governorate: "", address_region: "", address_street: "", address_building_number: "", active: true,
  })
  db.tables.customer_tax_identities = [identity(1, "300400501"), identity(2, "300400502")]
  // two companies and none chosen: choose first
  assert.equal((await fillAddressFromPortal(db, "real", { invoiceId: id }, fakePortal().deps)).status, "choose_identity")
  await chooseInvoiceIdentity(db, id, 2)
  assert.ok((await buildEtaPreview(db, id))!.missing.includes("customer_address"))
  // a received document of that company we already hold: read its details, no search
  db.tables.eta_received_documents = [
    { received_id: 1, uuid: "R-OLD", environment: "real", issuer_id: "300400502", date_issued: "2026-10-01T00:00:00Z" },
    { received_id: 2, uuid: "R-TEST", environment: "test", issuer_id: "300400502", date_issued: "2026-11-01T00:00:00Z" },
  ]
  const fp = fakePortal({ details: { "R-OLD": receivedDetails("R-OLD", "300400502") } })
  const r = await fillAddressFromPortal(db, "real", { invoiceId: id }, fp.deps)
  assert.equal(r.status, "filled")
  assert.equal(r.source, "received")
  assert.deepEqual(fp.calls.details, ["R-OLD"], "only this environment's documents")
  assert.equal(fp.calls.sent.length, 0)
  const two = db.tables.customer_tax_identities[1]
  assert.deepEqual([two.address_governorate, two.address_region, two.address_street, two.address_building_number], ["Giza", "Dokki", "Tahrir St", "4"])
  assert.equal(db.tables.customer_tax_identities[0].address_street, "", "the other identity is untouched")
  assert.equal(db.tables.customers[0].address_street, "Card street", "the card (another tax number) is untouched")
  const ev = db.tables.workflow_events.find((e) => e.event_type === ADDRESS_FILLED_EVENT)!
  assert.equal(ev.new_value, "R-OLD")
  assert.match(ev.notes, /tax identity 2/)
  assert.ok(!(await buildEtaPreview(db, id))!.missing.includes("customer_address"))

  // from the tax identity form: { customerId, identityId }; a document whose issuer is another tax number is ignored
  const fp2 = fakePortal({
    received: () => ({ result: [{ uuid: "R-X", issuerId: "300400501" }] }),
    details: { "R-X": receivedDetails("R-X", "777777777") },
  })
  assert.equal((await fillAddressFromPortal(db, "real", { customerId: 5, identityId: 1 }, fp2.deps)).status, "not_found")
  assert.deepEqual(fp2.calls.details, ["R-X"])
  assert.equal(db.tables.customer_tax_identities[0].address_street, "")
  // an identity of another customer is refused
  assert.equal((await fillAddressFromPortal(db, "real", { customerId: 6, identityId: 1 }, fakePortal().deps)).status, "not_found_record")
})

test("A5. reading the portal answers: party id, required fields, governorate names, windows", () => {
  assert.equal(addressFromDetails(sentDetails("U", "111111111"), TAX, "receiver"), null, "another receiver")
  assert.equal(addressFromDetails(sentDetails("U", TAX, { ...ADDRESS, street: "" }), TAX, "receiver"), null, "an incomplete address")
  assert.equal(addressFromDetails(sentDetails("U", TAX, { ...ADDRESS, country: "US" }), TAX, "receiver"), null, "a foreign address")
  assert.equal(addressFromDetails({ document: "{bad json" }, TAX, "receiver"), null)
  assert.equal(addressFromDetails(receivedDetails("R"), TAX, "issuer")!.governate, "Giza")
  assert.equal(governorateName("Alexandria"), "Alexandria")
  assert.equal(governorateName("محافظة القاهرة"), "Cairo")
  assert.equal(governorateName("Some place"), "Some place")
  assert.deepEqual(lookupWindows(NOW_MS, 2), [{ from: "2026-10-26", to: "2026-11-24" }, { from: "2026-09-26", to: "2026-10-25" }])
})

test("A6. no tax number: nothing searched; a person receiver is not looked up", async () => {
  const { db, id } = await withInvoice({ tax_registration_number: "12" })
  const fp = fakePortal()
  assert.equal((await fillAddressFromPortal(db, "real", { invoiceId: id }, fp.deps)).status, "no_tax_number")
  db.tables.customers[0].eta_receiver_type = "P"
  db.tables.customers[0].tax_registration_number = TAX
  assert.equal((await fillAddressFromPortal(db, "real", { customerId: 5 }, fp.deps)).status, "no_tax_number")
  assert.equal(fp.calls.sent.length, 0)
})

test("A7. the route: /api/eta rule (accountant, CEO, admin), portal login checked first, plain messages in both languages", async () => {
  const rule = ruleFor("/api/eta/receiver-address")!
  for (const role of ["accountant", "ceo", "admin"]) assert.equal(allows(rule, "POST", [role] as any), true, role)
  for (const role of ["sales-rep", "po-rep", "warehouse-rep"]) assert.equal(allows(rule, "POST", [role] as any), false, role)

  const { db } = await withInvoice({ address_governorate: "Giza", address_region: "Dokki", address_street: "Tahrir", address_building_number: "4" })
  useDb(db)
  assert.equal((await call(addressRoute.POST, "POST", {})).status, 400)
  assert.equal((await call(addressRoute.POST, "POST", { invoiceId: "x" })).status, 400)
  const saved = { id: process.env.ETA_CLIENT_ID, secret: process.env.ETA_CLIENT_SECRET }
  try {
    delete process.env.ETA_CLIENT_ID
    delete process.env.ETA_CLIENT_SECRET
    const noLogin = await call(addressRoute.POST, "POST", { customerId: 5 })
    assert.equal(noLogin.status, 400)
    assert.match(noLogin.body.error, /portal login is not set up/)
    process.env.ETA_CLIENT_ID = "id"
    process.env.ETA_CLIENT_SECRET = "secret"
    const done = await call(addressRoute.POST, "POST", { customerId: 5 })
    assert.equal(done.status, 200)
    assert.equal(done.body.status, "complete")
    db.tables.customers[0].tax_registration_number = ""
    const noTax = await call(addressRoute.POST, "POST", { customerId: 5, auto: true })
    assert.equal(noTax.status, 400)
    assert.equal(noTax.body.status, "no_tax_number")
    assert.ok(noTax.body.errorAr && noTax.body.error)
  } finally {
    if (saved.id === undefined) delete process.env.ETA_CLIENT_ID; else process.env.ETA_CLIENT_ID = saved.id
    if (saved.secret === undefined) delete process.env.ETA_CLIENT_SECRET; else process.env.ETA_CLIENT_SECRET = saved.secret
  }
})

test("A8. screens and words: the button in the preview checklist and on the customer's tax identities, both languages", () => {
  const root = process.env.REPO_ROOT || process.cwd()
  const preview = readFileSync(join(root, "components/accounting/eta-preview-dialog.tsx"), "utf8")
  assert.ok(preview.includes("/api/eta/receiver-address"))
  assert.match(preview, /m === "customer_address"/)
  assert.match(preview, /addressFromPortal\(true\)/, "automatic lookup once on opening")
  const identities = readFileSync(join(root, "components/parties/customer-tax-identities.tsx"), "utf8")
  assert.ok(identities.includes("/api/eta/receiver-address"))
  const i18n = readFileSync(join(root, "lib/i18n-context.tsx"), "utf8")
  for (const key of ["eta.address-from-portal", "eta.address-from-portal-named", "eta.address-portal-filled", "eta.address-portal-not-found", "eta.address-portal-failed", "eta.card-address"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2, `${key} in both languages`)
  }
  const sql = readFileSync(join(root, "scripts/sql/2026-11-25-eta-address-autofill.sql"), "utf8")
  assert.match(sql, /WRITTEN, NOT APPLIED/)
  const statements = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").split(";").map((s) => s.trim().toLowerCase()).filter(Boolean)
  for (const s of statements) assert.match(s, /^(alter table public\.\w+ add column if not exists \w+ text|create index if not exists)/, s)
})
