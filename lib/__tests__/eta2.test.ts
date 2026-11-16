// E-invoice (Egyptian Tax Authority) step 2.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("F1. step-2 migration", () => {
  const raw = readFileSync(join(process.env.REPO_ROOT || process.cwd(), "scripts/sql/2026-11-15-eta-step2.sql"), "utf8")
  const noComments = raw.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")
  const flat = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

  // do $$ ... $$ blocks are allowed only to look up and drop the named constraints; they are checked separately
  const blocks: string[] = []
  // functions (task 7, ruling P1) are checked on their own below: security definer, fixed search_path, execute revoked
  const functions: { name: string; head: string; body: string }[] = []
  const withoutFunctions = noComments.replace(/create or replace function public\.(\w+)\(([\s\S]*?)\$fn\$([\s\S]*?)\$fn\$\s*;/gi, (_m, name: string, head: string, body: string) => {
    functions.push({ name, head: flat(head), body: flat(body) })
    return ";"
  })
  const rest = withoutFunctions.replace(/do\s+\$\$([\s\S]*?)\$\$\s*;/gi, (_m, body: string) => { blocks.push(flat(body)); return ";" })
  assert.ok(blocks.length > 0, "expected constraint blocks")
  assert.ok(!rest.includes("$$"), "no other dollar-quoted code")

  const statements = rest.split(";").map(flat).filter(Boolean)
  assert.ok(statements.length > 0)
  for (const s of statements) {
    assert.ok(!/^(drop|update|delete|truncate)\b/.test(s), `destructive statement: ${s.slice(0, 60)}`)
    assert.ok(!/^alter table\b.*\b(drop|rename)\b/.test(s) || /^alter table public\.\w+ drop constraint if exists \w+$/.test(s), `alter drop/rename: ${s.slice(0, 60)}`)
    assert.ok(!/^insert\b/.test(s), `insert: ${s.slice(0, 60)}`)
  }

  const dropped: string[] = []
  for (const b of blocks) {
    assert.ok(!/\b(drop table|drop column|rename|delete|update|truncate|insert)\b/.test(b), `block not allowed: ${b.slice(0, 80)}`)
    const targets = [...b.matchAll(/alter table ([a-z_.]+) drop constraint/g)].map((m) => m[1].replace("public.", ""))
    for (const t of targets) { assert.ok(["eta_documents", "accounts_receivable"].includes(t), `drop on ${t}`); dropped.push(b) }
    if (targets.length === 0 && /drop constraint/.test(b)) assert.fail("drop constraint on an unnamed table")
  }
  assert.ok(dropped.length >= 2, "expected drops on eta_documents and accounts_receivable")

  // rerunnable: every `add constraint <name>` is preceded by `drop constraint if exists <name>` on the same table
  statements.forEach((s, i) => {
    const m = s.match(/^alter table (public\.\w+) add constraint (\w+)\b/)
    if (!m) return
    const prev = statements.slice(0, i).map((x) => x)
    assert.ok(prev.includes(`alter table ${m[1]} drop constraint if exists ${m[2]}`), `add constraint ${m[2]} has no preceding drop if exists`)
  })

  const lower = flat(noComments)
  // every dropped constraint is re-added, by name, in the same file
  for (const name of [
    "eta_documents_invoice_doc_env_version_key", "eta_documents_invoice_id_fkey",
    "eta_documents_status_check", "accounts_receivable_status_check",
  ]) assert.match(lower, new RegExp(`add constraint ${name}\\b`), `missing re-add of ${name}`)
  assert.match(lower, /unique \(invoice_id, document_type, environment, version\)/)
  assert.match(lower, /foreign key \(invoice_id\) references public\.accounts_receivable ?\(invoice_id\) on delete restrict/)
  assert.match(lower, /'needs_review'/)
  assert.match(lower, /'replaced'/)
  for (const v of ["pending", "partially_paid", "paid", "overdue"]) assert.ok(lower.includes(`'${v}'`), `AR status ${v}`)
  assert.ok(!/needs_review boolean/.test(lower), "no needs_review column")
  assert.deepEqual(functions.map((f) => f.name).sort(), ["eta_reissue_invoice", "eta_undo_reissue"])
  for (const f of functions) {
    assert.match(f.head, /language plpgsql security definer set search_path = public as$/, `${f.name}: security definer with a fixed search_path`)
    assert.ok(!/\b(drop|truncate|alter)\b/.test(f.body), `${f.name}: no DDL`)
    assert.match(lower, new RegExp(`revoke execute on function public\\.${f.name}\\([^)]*\\) from public, anon, authenticated`), `${f.name}: execute revoked`)
  }
  const reissue = functions.find((f) => f.name === "eta_reissue_invoice")!.body
  for (const part of [
    "for update", "hint = 'payments_other_customer'", "hint = 'reissue_overpaid'", "update public.customer_payments set invoice_id = v_new_id",
    "update public.payment_schedules set invoice_id = v_new_id", "update public.customer_credits set used_in_invoice_id = v_new_id",
    "update public.invoice_delivery_permits set invoice_id = v_new_id", "update public.delivery_permits set invoice_id = v_new_id",
    "replaced_by_invoice_id = v_new_id, collected_amount = 0", "'overpayment', 'eta_reissue'", "replaces_invoice_id",
  ]) assert.ok(reissue.includes(part), `eta_reissue_invoice: ${part}`)

  for (const c of [
    "environment", "version", "canonical", "document", "signature", "references", "submitted_at", "checked_at", "validated_at",
    "replaces_invoice_id", "replaced_by_invoice_id",
  ]) assert.match(lower, new RegExp(`add column if not exists "?${c}"?\\b`), `missing add column ${c}`)
  for (const t of ["eta_signers", "eta_received_documents", "dp_corrections"]) {
    assert.ok(lower.includes(`create table if not exists public.${t}`), `missing table ${t}`)
    assert.ok(lower.includes(`alter table public.${t} enable row level security`), `rls ${t}`)
    assert.ok(!new RegExp(`create policy[^;]*${t}`).test(lower), `no policy on ${t}`)
  }
  for (const c of ["signer_id", "key_hash text unique not null", "unlocked boolean default false", "revoked_at", "received_id", "unique (uuid, environment)", "correction_id", "stock_moves jsonb"])
    assert.ok(lower.includes(c), `missing ${c}`)
})

// ---- canonical text and document builder (task 2) ----
import { canonicalize, etaNumber, toEtaJson } from "../eta/serialize"
import { buildCreditNoteDocument, buildInvoiceDocument, type EtaDocument } from "../eta/document"
import { etaItemType, type EtaPreview } from "../eta/preview"
import { etaLines } from "../eta/totals"

test("F2. canonical text matches the SDK rules", () => {
  const text = '{ "issuer": { "address": { "branchID": "0" } }, "invoiceLines": [{ "quantity": 1.0, "taxableItems": [{ "taxType": "T1" }] }] }'
  const expected = '"ISSUER""ADDRESS""BRANCHID""0""INVOICELINES""INVOICELINES""QUANTITY""1.0""TAXABLEITEMS""TAXABLEITEMS""TAXTYPE""T1"'
  assert.equal(canonicalize(text), expected, "from JSON text: number literals kept as written")
  // a parsed value: numbers as JS writes them; the same text once no literal differs
  assert.equal(canonicalize(JSON.parse(text.replace("1.0", "1"))), expected.replace('"1.0"', '"1"'))
  // simple values unescaped and unprocessed; array of simple values; signatures excluded; names invariant upper-case
  const t2 = '{"description":"لقمة \\"17\\" mm","references":["u1","u2"],"internalID":"10363","signatures":[{"signatureType":"I","value":"x"}]}'
  assert.equal(canonicalize(t2), '"DESCRIPTION""لقمة "17" mm""REFERENCES""REFERENCES""u1""REFERENCES""u2""INTERNALID""10363"')
  assert.equal(canonicalize(JSON.parse(t2)), canonicalize(t2))
  assert.equal(canonicalize('{"a":-0.50,"b":true,"c":null,"d":[]}'), '"A""-0.50""B""true""C""null""D"')
  assert.throws(() => canonicalize("[1]"), /object/)
  assert.throws(() => canonicalize('{"a":1'), /JSON/)
  assert.throws(() => canonicalize({ a: 1e-7 }), /number/)
})

const sampleSettings: Record<string, string> = {
  eta_rin: "100060455", eta_registered_name: "Misr Motors", eta_activity_code: "4530", eta_branch_id: "0",
  eta_branch_governorate: "Cairo", eta_branch_region: "Nasr City", eta_branch_street: "Abbas El Akkad", eta_branch_building_number: "12",
  eta_environment: "preprod",
}
function samplePreview(): EtaPreview {
  const priced = etaLines([{ name: "Hand tools set", quantity: 1, unitPrice: 30948 }, { name: "Garage trolley", quantity: 1, unitPrice: 14200 }], 0)
  const codes = ["EG-100060455-P13", "EG-100060455-P52"]
  return {
    invoiceId: 77, invoiceNumber: "10363", handledManually: false, manualEtaUuid: null, storedAmount: priced.totals.total,
    customer: {
      name: "Acme Trading", receiverType: "B", taxRegistrationNumber: "200300400", nationalId: null,
      address: { governorate: "Giza", regionCity: "Dokki", street: "Tahrir", buildingNumber: "4" },
    },
    lines: priced.lines.map((l, i) => ({ ...l, codeId: i + 1, itemCode: codes[i], itemType: etaItemType(codes[i]), discountRate: 0, unit: "EA", state: "green" as const })),
    totals: priced.totals,
    missing: [],
  }
}

test("F3. invoice document from a preview", () => {
  const d = buildInvoiceDocument(samplePreview(), sampleSettings, "2026-11-14T08:30:15.123Z")
  assert.deepEqual(d.issuer, {
    address: { branchID: "0", country: "EG", governate: "Cairo", regionCity: "Nasr City", street: "Abbas El Akkad", buildingNumber: "12" },
    type: "B", id: "100060455", name: "Misr Motors",
  })
  assert.deepEqual(d.receiver, {
    address: { country: "EG", governate: "Giza", regionCity: "Dokki", street: "Tahrir", buildingNumber: "4" },
    type: "B", id: "200300400", name: "Acme Trading",
  })
  assert.equal(d.documentType, "i")
  assert.equal(d.documentTypeVersion, "1.0")
  assert.equal(d.dateTimeIssued, "2026-11-14T08:30:15Z")
  assert.equal(d.taxpayerActivityCode, "4530")
  assert.equal(d.internalID, "10363")
  assert.equal(d.references, undefined)
  assert.deepEqual(d.invoiceLines.map((l) => [l.itemType, l.itemCode, l.unitType, l.quantity]), [["EGS", "EG-100060455-P13", "EA", 1], ["EGS", "EG-100060455-P52", "EA", 1]])
  assert.deepEqual(d.invoiceLines[0], {
    description: "Hand tools set", itemType: "EGS", itemCode: "EG-100060455-P13", unitType: "EA", quantity: 1, internalCode: "1",
    salesTotal: 30948, total: 35280.72, valueDifference: 0, totalTaxableFees: 0, netTotal: 30948, itemsDiscount: 0,
    unitValue: { currencySold: "EGP", amountEGP: 30948 }, discount: { rate: 0, amount: 0 },
    taxableItems: [{ taxType: "T1", amount: 4332.72, subType: "V009", rate: 14 }],
  })
  assert.deepEqual(d.invoiceLines[1].taxableItems, [{ taxType: "T1", amount: 1988, subType: "V009", rate: 14 }])
  assert.equal(d.totalSalesAmount, 45148)
  assert.equal(d.netAmount, 45148)
  assert.equal(d.totalDiscountAmount, 0)
  assert.deepEqual(d.taxTotals, [{ taxType: "T1", amount: 6320.72 }])
  assert.equal(d.totalAmount, 51468.72)
  assert.equal(d.extraDiscountAmount, 0)
  assert.equal(d.totalItemsDiscountAmount, 0)
  // header order as the portal sample
  assert.deepEqual(Object.keys(d), ["issuer", "receiver", "documentType", "documentTypeVersion", "dateTimeIssued", "taxpayerActivityCode", "internalID",
    "invoiceLines", "totalDiscountAmount", "totalSalesAmount", "netAmount", "taxTotals", "totalAmount", "extraDiscountAmount", "totalItemsDiscountAmount"])
  // portal equations hold on every line
  for (const l of d.invoiceLines) {
    assert.equal(Math.round(l.quantity * l.unitValue.amountEGP * 100) / 100, l.salesTotal)
    assert.equal(Math.round((l.salesTotal - l.discount.amount) * 100) / 100, l.netTotal)
    assert.equal(Math.round((l.netTotal + l.taxableItems[0].amount) * 100) / 100, l.total)
  }

  // with an order discount: rate in percent, amount from the line
  const p = samplePreview()
  const disc = etaLines([{ name: "x", quantity: 3, unitPrice: 33.33 }], 0.1)
  p.lines = [{ ...disc.lines[0], codeId: 1, itemCode: "10003752", itemType: etaItemType("10003752"), discountRate: 0.1, unit: "SET", state: "green" }]
  p.totals = disc.totals
  const dd = buildInvoiceDocument(p, sampleSettings, "2026-11-14T08:30:15Z")
  assert.deepEqual(dd.invoiceLines[0].discount, { rate: 10, amount: 10 })
  assert.equal(dd.invoiceLines[0].itemType, "GS1")
  assert.equal(etaItemType("EG-100060455-P13"), "EGS")
  assert.equal(etaItemType("EG-100060455-P13", "GS1"), "GS1", "the type stored on the code wins")
  assert.equal(dd.invoiceLines[0].unitType, "SET")
  assert.equal(dd.totalDiscountAmount, 10)
  assert.equal(dd.netAmount, 89.99)

  // a person: the national ID; empty branch id defaults to "0"
  const pp = samplePreview()
  pp.customer = { name: "Ahmed", receiverType: "P", taxRegistrationNumber: null, nationalId: "29001011234567", address: { governorate: "", regionCity: "", street: "", buildingNumber: "" } }
  const pd = buildInvoiceDocument(pp, { ...sampleSettings, eta_branch_id: "" }, "2026-11-14T08:30:15Z")
  assert.equal(pd.receiver.type, "P")
  assert.equal(pd.receiver.id, "29001011234567")
  assert.equal(pd.issuer.address.branchID, "0")

  assert.throws(() => buildInvoiceDocument(samplePreview(), sampleSettings, "not a date"), /date/)
  const red = samplePreview()
  red.lines[1] = { ...red.lines[1], itemCode: null, codeId: null }
  assert.throws(() => buildInvoiceDocument(red, sampleSettings, "2026-11-14T08:30:15Z"), /item code/)
})

test("F4. credit note mirrors the invoice", () => {
  const inv = buildInvoiceDocument(samplePreview(), sampleSettings, "2026-11-14T08:30:15Z")
  const uuid = "R9T6XEZG3PB1QX7SK1V5KQ7G10"
  // the snapshot comes back from jsonb with keys in another order: the credit note is still written in the portal order
  const reordered = JSON.parse(JSON.stringify(inv), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))
  const c = buildCreditNoteDocument(reordered as EtaDocument, uuid, "2026-11-15T09:00:00Z")
  assert.equal(c.documentType, "c")
  assert.deepEqual(c.references, [uuid])
  assert.equal(c.internalID, inv.internalID)
  assert.equal(c.dateTimeIssued, "2026-11-15T09:00:00Z")
  assert.deepEqual(c.invoiceLines, inv.invoiceLines)
  assert.deepEqual(c.issuer, inv.issuer)
  assert.deepEqual(c.receiver, inv.receiver)
  for (const k of ["totalDiscountAmount", "totalSalesAmount", "netAmount", "taxTotals", "totalAmount", "extraDiscountAmount", "totalItemsDiscountAmount"] as const)
    assert.deepEqual(c[k], inv[k], k)
  assert.deepEqual(Object.keys(c), ["issuer", "receiver", "documentType", "documentTypeVersion", "dateTimeIssued", "taxpayerActivityCode", "internalID", "references",
    "invoiceLines", "totalDiscountAmount", "totalSalesAmount", "netAmount", "taxTotals", "totalAmount", "extraDiscountAmount", "totalItemsDiscountAmount"])
  // same text as the invoice apart from type, date and references
  const strip = (s: string) => s.replace(/"documentType":"[ic]",/, "").replace(/"dateTimeIssued":"[^"]*",/, "").replace(/"references":\[[^\]]*\],/, "")
  assert.equal(strip(toEtaJson(c)), strip(toEtaJson(inv)))
  assert.equal(inv.references, undefined, "invoice untouched")
  assert.throws(() => buildCreditNoteDocument(inv, " ", "2026-11-15T09:00:00Z"), /uuid/)
})

test("F5. signed text equals sent text", () => {
  assert.equal(etaNumber(0.1 + 0.2), "0.3")
  assert.equal(etaNumber(1234.5), "1234.5")
  assert.equal(etaNumber(51468.72), "51468.72")
  assert.equal(etaNumber(14), "14")
  assert.equal(etaNumber(1e-7), "0")
  assert.equal(etaNumber(-0.000001), "0")
  assert.equal(etaNumber(0.123456), "0.12346")
  assert.equal(etaNumber(12345678.9), "12345678.9")
  assert.throws(() => etaNumber(Number.NaN))
  assert.throws(() => etaNumber(1e21))

  const p = samplePreview()
  p.lines[0] = { ...p.lines[0], unitPrice: 0.1 + 0.2, salesTotal: 0.1 + 0.2, netTotal: 1234.5 }
  const d = buildInvoiceDocument(p, sampleSettings, "2026-11-14T08:30:15Z")
  const sent = toEtaJson(d)
  assert.ok(!/\d[eE][+-]?\d/.test(sent), "no exponent")
  assert.ok(!sent.includes("0.30000000000000004"), "no float noise")
  assert.match(sent, /"amountEGP":0\.3\}/)
  assert.match(sent, /"netTotal":1234\.5,/)
  assert.deepEqual(JSON.parse(sent), JSON.parse(JSON.stringify(d, (_k, v) => (typeof v === "number" ? Number(etaNumber(v)) : v))))
  const signed = canonicalize(JSON.parse(sent))
  assert.equal(signed, canonicalize(sent), "the parsed body and the body text give the same canonical text")
  assert.equal(canonicalize(JSON.parse(toEtaJson(JSON.parse(sent)))), signed, "stable on a round trip")
  assert.ok(signed.startsWith('"ISSUER""ADDRESS""BRANCHID""0""COUNTRY""EG""GOVERNATE""Cairo"'))
  assert.ok(signed.includes('"INVOICELINES""INVOICELINES""DESCRIPTION""Hand tools set""ITEMTYPE""EGS"'))
  assert.ok(signed.includes('"AMOUNTEGP""0.3"'))
  assert.ok(signed.includes('"TAXTOTALS""TAXTOTALS""TAXTYPE""T1""AMOUNT""6320.72""TOTALAMOUNT""51468.72"'))
  assert.ok(!/[\n\t]|": |, /.test(sent), "compact body")
})

// ---- F6-F10: portal client and plain-word errors ----
import { createPortal, credentialsSet, resetPortalTokens, EtaBusyError, EtaError } from "../eta/portal"
import { plainError } from "../eta/portal-errors"

type Call = { url: string; init: any }
function fakePortal(handler: (c: Call, n: number) => Response, clock = { t: 0 }) {
  const calls: Call[] = []
  const sleeps: number[] = []
  const f = (async (url: any, init: any) => { const c = { url: String(url), init }; calls.push(c); return handler(c, calls.length) }) as typeof fetch
  const portal = createPortal("test", { fetch: f, now: () => clock.t, sleep: async (ms) => { sleeps.push(ms) } })
  return { portal, calls, sleeps, clock }
}
const jres = (status: number, body: any, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
function withCreds<T>(fn: () => Promise<T>) {
  const keep = { i: process.env.ETA_TEST_CLIENT_ID, s: process.env.ETA_TEST_CLIENT_SECRET }
  process.env.ETA_TEST_CLIENT_ID = "my-id"; process.env.ETA_TEST_CLIENT_SECRET = "my-secret-xyz"
  resetPortalTokens()
  return fn().finally(() => {
    if (keep.i === undefined) delete process.env.ETA_TEST_CLIENT_ID; else process.env.ETA_TEST_CLIENT_ID = keep.i
    if (keep.s === undefined) delete process.env.ETA_TEST_CLIENT_SECRET; else process.env.ETA_TEST_CLIENT_SECRET = keep.s
    resetPortalTokens()
  })
}
const okHandler = (c: Call) =>
  c.url.endsWith("/connect/token") ? jres(200, { access_token: "tok" + c.init.headers.Authorization.length, token_type: "Bearer", expires_in: 3600 }) : jres(200, { ok: true })

test("F6. token cached until expiry; Basic header", () => withCreds(async () => {
  const { portal, calls, clock } = fakePortal(okHandler)
  await portal.getSubmission("u1"); await portal.getDetails("u1")
  const tokens = calls.filter((c) => c.url.endsWith("/connect/token"))
  assert.equal(tokens.length, 1)
  assert.equal(tokens[0].url, "https://id.preprod.eta.gov.eg/connect/token")
  assert.equal(tokens[0].init.headers.Authorization, "Basic " + Buffer.from("my-id:my-secret-xyz").toString("base64"))
  assert.match(String(tokens[0].init.body), /grant_type=client_credentials/)
  assert.equal(calls[1].url, "https://api.preprod.invoicing.eta.gov.eg/api/v1.0/documentsubmissions/u1?pageNo=1&pageSize=100")
  assert.match(calls[1].init.headers.Authorization, /^Bearer tok/)
  clock.t = 3600 * 1000 + 1
  await portal.getDetails("u1")
  assert.equal(calls.filter((c) => c.url.endsWith("/connect/token")).length, 2)
}))

test("F7. submit posts raw documents text and returns accepted / rejected", () => withCreds(async () => {
  const { portal, calls } = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : jres(202, {
    submissionUUID: "S1",
    acceptedDocuments: [{ uuid: "U1", longId: "L1", internalId: "A" }],
    rejectedDocuments: [{ internalId: "B", error: { code: "x", message: "bad", target: "t", details: [] } }],
  }))
  const docs = ['{"a": 1,"b":"\\u0627"}', '{"c":2}']
  const r = await portal.submit(docs)
  const post = calls[1]
  assert.equal(post.url, "https://api.preprod.invoicing.eta.gov.eg/api/v1.0/documentsubmissions/")
  assert.equal(post.init.method, "POST")
  assert.equal(post.init.body, `{"documents":[${docs[0]},${docs[1]}]}`)
  assert.equal(r.submissionUUID, "S1")
  assert.equal(r.acceptedDocuments[0].uuid, "U1")
  assert.equal(r.rejectedDocuments[0].internalId, "B")
}))

test("F8. 429 with Retry-After is retried; persistent 429 throws EtaBusyError", () => withCreds(async () => {
  let hits = 0
  const a = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : (++hits === 1 ? jres(429, {}, { "retry-after": "1" }) : jres(200, { overallStatus: "valid" })))
  const r = await a.portal.getSubmission("u")
  assert.equal(r.overallStatus, "valid")
  assert.deepEqual(a.sleeps, [1000])
  const b = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : jres(429, {}, { "retry-after": "1" }))
  await assert.rejects(() => b.portal.getSubmission("u"), (e: any) => e instanceof EtaBusyError)
  assert.equal(b.sleeps.length, 2)
}))

test("F9. missing credentials: readable error, no secret in it", async () => {
  const keep = { i: process.env.ETA_TEST_CLIENT_ID, s: process.env.ETA_TEST_CLIENT_SECRET }
  delete process.env.ETA_TEST_CLIENT_ID; delete process.env.ETA_TEST_CLIENT_SECRET
  resetPortalTokens()
  try {
    assert.equal(credentialsSet("test"), false)
    const { portal, calls } = fakePortal(okHandler)
    await assert.rejects(() => portal.getDetails("u"), (e: any) => /ETA_TEST_CLIENT_ID/.test(e.message) && e instanceof EtaError)
    assert.equal(calls.length, 0)
  } finally {
    if (keep.i !== undefined) process.env.ETA_TEST_CLIENT_ID = keep.i
    if (keep.s !== undefined) process.env.ETA_TEST_CLIENT_SECRET = keep.s
  }
  // a rejected login never echoes the secret
  await withCreds(async () => {
    assert.equal(credentialsSet("test"), true)
    const { portal } = fakePortal(() => jres(400, { error: "invalid_client" }))
    await assert.rejects(() => portal.getDetails("u"), (e: any) => e.code === "invalid_client" && !e.message.includes("my-secret-xyz") && !e.message.includes("my-id"))
  })
})

test("F10. plain-word errors in English and Arabic", () => {
  const ar = plainError("OperationPeriodOver", "x", "ar")
  assert.match(ar, /[؀-ۿ]/)
  assert.ok(!/OperationPeriodOver/.test(ar))
  assert.match(plainError("OperationPeriodOver", undefined, "en"), /credit note/i)
  for (const c of ["BadStructure", "MaximumSizeExceeded", "DuplicateSubmission", "IncorrectSubmitter", "Forbidden", "IncorrectState", "ActiveReferencingDocuments", "NotReady", "TooManyRequests", "invalid_client"]) {
    assert.ok(plainError(c, undefined, "en").length > 20); assert.match(plainError(c, undefined, "ar"), /[؀-ۿ]/)
  }
  const g = plainError("Weird42", "the portal said so", "en")
  assert.ok(g.includes("the portal said so") && g.includes("Weird42"))
})

// ---- fix round 1: embedded CA, retry cap, timeouts ----
import { caFetch, defaultFetchFor, parseRetryAfter, MAX_RETRY_WAIT_SECONDS } from "../eta/portal"
import { PREPROD_ROOT_CA } from "../eta/preprod-root-ca"
import { X509Certificate } from "node:crypto"
import { EventEmitter } from "node:events"

test("F11. test env uses CA-aware fetch with the embedded CA; real env does not", async () => {
  const cert = new X509Certificate(PREPROD_ROOT_CA)
  assert.match(cert.subject, /EEI-RootCA-PREPROD/)
  assert.equal(defaultFetchFor("test").ca, PREPROD_ROOT_CA)
  assert.equal(defaultFetchFor("real").ca, undefined)
  assert.equal(defaultFetchFor("real").fn, fetch)
  assert.notEqual(defaultFetchFor("test").fn, fetch)
  // the CA-aware fetch passes the CA (plus default roots) to https and keeps verification on
  let seen: any
  const fakeRequest = ((url: any, opts: any, cb: any) => {
    seen = { url: String(url), opts }
    const req: any = new EventEmitter()
    req.write = () => {}; req.destroy = () => {}
    req.end = () => {
      const res: any = new EventEmitter(); res.statusCode = 200; res.headers = { "content-type": "application/json" }
      cb(res); res.emit("data", Buffer.from('{"a":1}')); res.emit("end")
    }
    return req
  }) as any
  const r = await caFetch(PREPROD_ROOT_CA, fakeRequest)("https://id.preprod.eta.gov.eg/connect/token", { method: "POST", headers: { a: "b" }, body: "x" })
  assert.deepEqual(await r.json(), { a: 1 })
  assert.ok(seen.opts.ca.includes(PREPROD_ROOT_CA) && seen.opts.ca.length > 1)
  assert.notEqual(seen.opts.rejectUnauthorized, false)
})

test("F12. timeout gives a readable error (injected and CA-aware fetch)", () => withCreds(async () => {
  const hang = ((_u: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))) as any
  const p = createPortal("test", { fetch: hang, timeoutMs: 20 })
  await assert.rejects(() => p.getDetails("u"), (e: any) => e instanceof EtaError && e.code === "Timeout" && /did not answer in time/.test(e.message))
  const neverReq = (() => { const req: any = new EventEmitter(); req.write = () => {}; req.end = () => {}; req.destroy = () => { req.destroyed = true }; return req }) as any
  const p2 = createPortal("test", { fetch: caFetch(PREPROD_ROOT_CA, neverReq), timeoutMs: 20 })
  await assert.rejects(() => p2.getDetails("u"), (e: any) => e.code === "Timeout")
}))

test("F13. Retry-After: seconds, HTTP date, cap", () => withCreds(async () => {
  assert.equal(parseRetryAfter("3", 0), 3)
  assert.equal(parseRetryAfter(new Date(5000).toUTCString(), 2000), 3)
  assert.equal(parseRetryAfter("garbage", 0), undefined)
  // HTTP date within the cap is honoured
  let n = 0
  const a = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : (++n === 1 ? jres(429, {}, { "retry-after": new Date(4000).toUTCString() }) : jres(200, { ok: 1 })), { t: 1000 })
  await a.portal.getDetails("u")
  assert.deepEqual(a.sleeps, [3000])
  // over the cap: no sleep, busy error carries the wait
  const b = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : jres(429, {}, { "retry-after": "3600" }))
  await assert.rejects(() => b.portal.getDetails("u"), (e: any) => e instanceof EtaBusyError && e.retryAfter === 3600)
  assert.equal(b.sleeps.length, 0)
  assert.ok(MAX_RETRY_WAIT_SECONDS <= 10)
}))

// ---- F14-F19: send queue, signer access, submit and follow-up (task 4) ----
import { useDb } from "./route-harness"
import { FakeDb, type Row } from "./fake-db"
import * as asn1js from "asn1js"
import * as pkijs from "pkijs"
import { createHash, webcrypto } from "node:crypto"
import { createDpInvoices } from "../invoicing"
import { acceptSignatures, etaSendDefaults, followUp, nextForSigner, queueSend, signedBody, type SendDeps } from "../eta/send"
import { liveRealDocument } from "../eta/live"
import { checkSignature, holdsRin } from "../eta/cms"
import { PUBLIC_PATHS, ruleFor, allows } from "../auth/permissions"
import { decide } from "../auth/decide"
import type { EtaPortal } from "../eta/portal"
import * as sendRoute from "../../app/api/eta/send/route"
import * as signerRoute from "../../app/api/eta/signer/route"
import * as signerNext from "../../app/api/eta-signer/next/route"
import * as signerSigned from "../../app/api/eta-signer/signed/route"
import * as signerPingRoute from "../../app/api/eta-signer/ping/route"
import * as arRoute from "../../app/api/accounts-receivable/route"
import * as etaSettings2 from "../../app/api/eta/settings/route"

const RIN = "100060455"
function sendDb(env: "test" | "real" = "real", extra: Row[] = []) {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    sales_orders: [{ so_id: 1, so_number: "SO-1", customer_id: 5, total: 342, subtotal: 300, discount_amount: 0, payment_type: "cash" }],
    customers: [{ customer_id: 5, customer_name: "Acme Trading", eta_receiver_type: "B", tax_registration_number: "200300400", address_governorate: "Giza", address_region: "Dokki", address_street: "Tahrir", address_building_number: "4" }],
    sales_order_items: [
      { so_id: 1, product_id: 100, outsourced_name: null, quantity: 2, unit_price: 100, total: 200 },
      { so_id: 1, product_id: 101, outsourced_name: null, quantity: 1, unit_price: 100, total: 100 },
    ],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-1", sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: [
      { permit_id: 1, product_id: 100, item_name_snapshot: "Wrench", quantity: 2, unit_price: 100, total: 200 },
      { permit_id: 1, product_id: 101, item_name_snapshot: "Trolley", quantity: 1, unit_price: 100, total: 100 },
    ],
    invoice_delivery_permits: [], accounts_receivable: [], product_returns: [], return_items: [], customer_payments: [],
    products: [
      { product_id: 100, product_name: "Wrench", eta_code_id: 1, eta_unit_type: "EA" },
      { product_id: 101, product_name: "Trolley", eta_code_id: 1, eta_unit_type: "EA" },
    ],
    eta_item_codes: [{ code_id: 1, item_code: "EG-100060455-P1", name: "Tools", keywords: [], default_unit: "EA", active: true }],
    eta_code_memory: [], eta_documents: [], eta_signers: [],
    company_settings: [
      { setting_key: "eta_rin", setting_value: RIN }, { setting_key: "eta_registered_name", setting_value: "Misr Motors" },
      { setting_key: "eta_activity_code", setting_value: "4530" }, { setting_key: "eta_branch_governorate", setting_value: "Cairo" },
      { setting_key: "eta_branch_region", setting_value: "Nasr City" }, { setting_key: "eta_branch_street", setting_value: "Abbas" },
      { setting_key: "eta_branch_building_number", setting_value: "12" }, { setting_key: "eta_go_live_at", setting_value: "2026-01-01T00:00:00Z" },
      { setting_key: "eta_environment", setting_value: env }, ...extra,
    ],
  })
  db.jitter = false
  return db
}
async function withInvoice(env: "test" | "real" = "real") {
  const db = sendDb(env)
  const r = await createDpInvoices(db, [1])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return { db, id: db.tables.accounts_receivable[0].invoice_id as number }
}
const NOW = () => new Date("2026-11-15T10:00:00Z")
const yes = () => true

// a fake portal that records every call
function portalFake(opts: {
  submit?: (docs: string[], n: number) => any; getSubmission?: (uuid: string, n: number) => any; getDetails?: (uuid: string) => any; searchSent?: (p: { internalId: string; from: string; to: string }) => any
  cancel?: (uuid: string, reason: string) => any; printout?: (uuid: string) => any; documentType?: (id: number | string) => any
} = {}) {
  const calls = {
    submit: [] as string[][], getSubmission: [] as string[], getDetails: [] as string[], searchSent: [] as { internalId: string; from: string; to: string }[],
    cancel: [] as [string, string][], printout: [] as string[], documentType: [] as (number | string)[],
  }
  const portal: EtaPortal = {
    async submit(docs) { calls.submit.push(docs); return opts.submit ? opts.submit(docs, calls.submit.length) : { submissionUUID: "SUB1", acceptedDocuments: docs.map((d, i) => ({ uuid: `UUID${i}`, longId: `LONG${i}`, internalId: JSON.parse(d).internalID })), rejectedDocuments: [] } },
    async getSubmission(uuid) { calls.getSubmission.push(uuid); return opts.getSubmission ? opts.getSubmission(uuid, calls.getSubmission.length) : { overallStatus: "InProgress", documentSummary: [] } },
    async getDetails(uuid) { calls.getDetails.push(uuid); return opts.getDetails ? opts.getDetails(uuid) : {} },
    async cancel(uuid, reason) { calls.cancel.push([uuid, reason]); if (!opts.cancel) throw new Error("no"); await opts.cancel(uuid, reason) },
    async searchReceived() { throw new Error("no") },
    async searchSent(p) { calls.searchSent.push(p); return opts.searchSent ? opts.searchSent(p) : { result: [] } },
    async printout(uuid) { calls.printout.push(uuid); if (!opts.printout) throw new Error("no"); return opts.printout(uuid) },
    async documentType(id) { calls.documentType.push(id); if (!opts.documentType) throw new Error("no"); return opts.documentType(id) },
  }
  const deps: SendDeps = { now: NOW, portalFor: () => portal, credentialsSet: yes }
  return { portal, calls, deps }
}

// ---- a test e-seal: self-signed certificate + detached CAdES-style CMS, made with node:crypto + pkijs ----
pkijs.setEngine("test", new pkijs.CryptoEngine({ name: "test", crypto: webcrypto as unknown as Crypto }))
type Seal = { keys: CryptoKeyPair; cert: pkijs.Certificate }
const seals = new Map<string, Promise<Seal>>()
function seal(rin: string): Promise<Seal> {
  if (!seals.has(rin)) seals.set(rin, (async () => {
    const keys = (await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair
    const cert = new pkijs.Certificate()
    cert.version = 2
    cert.serialNumber = new asn1js.Integer({ value: 4242 })
    const name = (t: pkijs.RelativeDistinguishedNames) => {
      t.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Misr Motors e-seal" }) }))
      t.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.97", value: new asn1js.Utf8String({ value: `EG-${rin}` }) }))
    }
    name(cert.issuer); name(cert.subject)
    cert.notBefore.value = new Date("2026-01-01T00:00:00Z")
    cert.notAfter.value = new Date("2028-01-01T00:00:00Z")
    await cert.subjectPublicKeyInfo.importKey(keys.publicKey)
    await cert.sign(keys.privateKey, "SHA-256")
    return { keys, cert }
  })())
  return seals.get(rin)!
}
async function signCms(text: string, rin = RIN): Promise<string> {
  const { keys, cert } = await seal(rin)
  const data = new TextEncoder().encode(text)
  const digest = createHash("sha256").update(data).digest()
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.7.1" }),
    signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }) })],
    certificates: [cert],
  })
  sd.signerInfos[0].signedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
    new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: "1.2.840.113549.1.7.1" })] }),
    new pkijs.Attribute({ type: "1.2.840.113549.1.9.5", values: [new asn1js.UTCTime({ valueDate: new Date("2026-11-15T09:59:00Z") })] }),
    new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: digest })] }),
  ] })
  await sd.sign(keys.privateKey, 0, "SHA-256")
  const ci = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: sd.toSchema(true) })
  return Buffer.from(ci.toSchema().toBER(false)).toString("base64")
}

test("F14. queueSend: missing data and handled-manually refused, a ready invoice queued once", async () => {
  // ready
  const { db, id } = await withInvoice("real")
  const r = await queueSend(db, [id], "real", 7, { now: NOW })
  assert.deepEqual(r, { queued: [id], refused: [] })
  const row = db.tables.eta_documents[0]
  assert.equal(row.status, "pending_signature")
  assert.equal(row.environment, "real")
  assert.equal(row.version, 1)
  assert.equal(row.document_type, "I")
  assert.equal(row.created_by, 7)
  assert.equal(typeof row.document, "string", "P5: the exact body text, as a jsonb string")
  assert.equal(row.canonical, canonicalize(row.document))
  const body = JSON.parse(row.document)
  assert.equal(body.internalID, db.tables.accounts_receivable[0].invoice_number)
  assert.equal(body.totalAmount, 342)
  assert.equal(body.issuer.id, RIN)
  assert.equal(body.dateTimeIssued, etaIso(db.tables.accounts_receivable[0].created_at), "P6: the invoice's creation time")
  // a second Send of the same invoice is refused as already live
  assert.deepEqual((await queueSend(db, [id], "real", 7, { now: NOW })).refused, [{ invoiceId: id, reasons: ["already_live"] }])
  assert.equal(db.tables.eta_documents.length, 1)

  // missing customer tax number and address
  const m = await withInvoice("real")
  Object.assign(m.db.tables.customers[0], { tax_registration_number: null, address_street: "" })
  const mr = await queueSend(m.db, [m.id], "real", 7, { now: NOW })
  assert.deepEqual(mr.queued, [])
  assert.deepEqual([...mr.refused[0].reasons].sort(), ["customer_address", "customer_tax_number"])
  assert.equal(m.db.tables.eta_documents.length, 0)

  // handled manually (created before go-live): refused on the real portal, allowed on the test portal (labelled test)
  const h = await withInvoice("real")
  h.db.tables.accounts_receivable[0].created_at = "2025-12-01T00:00:00Z"
  assert.deepEqual((await queueSend(h.db, [h.id], "real", 7, { now: NOW })).refused, [{ invoiceId: h.id, reasons: ["handled_manually"] }])
  assert.deepEqual((await queueSend(h.db, [h.id], "test", 7, { now: NOW })).queued, [h.id])
  assert.equal(h.db.tables.eta_documents[0].environment, "test")
  // a test send still refuses an amount that differs from what the ERP billed
  h.db.tables.eta_documents = []
  h.db.tables.accounts_receivable[0].amount = 999
  assert.deepEqual((await queueSend(h.db, [h.id], "test", 7, { now: NOW })).refused[0].reasons, ["amount_mismatch"])

  // a future creation time (clock skew) is clamped to now; unknown invoice refused
  const f = await withInvoice("real")
  f.db.tables.accounts_receivable[0].created_at = "2026-12-01T00:00:00Z"
  await queueSend(f.db, [f.id, 999], "real", 7, { now: NOW }).then((x) => assert.deepEqual(x.refused, [{ invoiceId: 999, reasons: ["not_found"] }]))
  assert.equal(JSON.parse(f.db.tables.eta_documents[0].document).dateTimeIssued, "2026-11-15T10:00:00Z")
  // a needs-review or invalid document can be sent again: a new version
  f.db.tables.eta_documents[0].status = "invalid"
  assert.deepEqual((await queueSend(f.db, [f.id], "real", 7, { now: NOW })).queued, [f.id])
  assert.deepEqual(f.db.tables.eta_documents.map((d) => [d.version, d.status]), [[1, "invalid"], [2, "pending_signature"]])
  // a cancelled real document is final
  f.db.tables.eta_documents[1].status = "cancelled"
  assert.deepEqual((await queueSend(f.db, [f.id], "real", 7, { now: NOW })).refused[0].reasons, ["final"])

  // the route: the portal from settings, ids checked
  useDb(db)
  db.tables.eta_documents = []
  const res = await sendRoute.POST(rq("POST", "/api/eta/send", { invoiceIds: [id] }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { environment: "real", queued: [id], refused: [] })
  assert.equal((await sendRoute.POST(rq("POST", "/api/eta/send", { invoiceIds: ["x"] }))).status, 400)
  assert.equal((await sendRoute.POST(rq("POST", "/api/eta/send", {}))).status, 400)
})
const etaIso = (s: string) => new Date(s).toISOString().replace(/\.\d{3}Z$/, "Z")
function rq(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): any {
  const url = `http://test.local${path}`
  const r = new Request(url, { method, headers: { "content-type": "application/json", "x-mm-roles": "accountant", "x-mm-user-id": "7", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return Object.assign(r, { nextUrl: new URL(url) })
}
const signerRq = (method: string, path: string, key: string | null, body?: unknown) =>
  rq(method, path, body, { "x-mm-roles": "", ...(key === null ? {} : { "x-eta-signer-key": key }) })

test("F15. signer access: key checks on every signer route; only four new public paths", async () => {
  const { db, id } = await withInvoice("real")
  useDb(db)
  const fake = portalFake()
  Object.assign(etaSendDefaults, { portalFor: fake.deps.portalFor, credentialsSet: yes })
  try {
    await queueSend(db, [id], "real", 7)
    // pairing is CEO / admin only; status is readable by the accountant and never shows the key
    assert.equal((await signerRoute.POST(rq("POST", "/api/eta/signer", { name: "Accounts PC" }))).status, 403)
    const paired = await (await signerRoute.POST(rq("POST", "/api/eta/signer", { name: "Accounts PC" }, { "x-mm-roles": "ceo" }))).json()
    assert.match(paired.key, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(db.tables.eta_signers.length, 1)
    assert.equal(db.tables.eta_signers[0].key_hash, createHash("sha256").update(paired.key).digest("hex"), "only the hash is stored")
    assert.ok(!JSON.stringify(db.tables.eta_signers).includes(paired.key))
    const st = await (await signerRoute.GET()).json()
    assert.equal(st.paired, true)
    assert.equal(st.name, "Accounts PC")
    assert.ok(!JSON.stringify(st).includes(paired.key) && !("keyHash" in st) && !("key_hash" in st))

    const routes: [string, (r: any) => Promise<Response>, string, unknown][] = [
      ["GET", signerNext.GET, "/api/eta-signer/next", undefined],
      ["POST", signerSigned.POST, "/api/eta-signer/signed", { items: [] }],
      ["POST", signerPingRoute.POST, "/api/eta-signer/ping", { unlocked: true, version: "1.0" }],
    ]
    for (const [m, h, p, b] of routes) {
      assert.equal((await h(signerRq(m, p, null, b))).status, 401, `${p} no key`)
      assert.equal((await h(signerRq(m, p, "x".repeat(43), b))).status, 401, `${p} wrong key`)
      assert.equal((await h(signerRq(m, p, paired.key.slice(0, 42) + (paired.key.endsWith("A") ? "B" : "A"), b))).status, 401, `${p} near key`)
      // a logged-in person is not a signer
      assert.equal((await h(rq(m, p, b, { "x-mm-roles": "admin" }))).status, 401, `${p} login only`)
    }
    const next = await signerNext.GET(signerRq("GET", "/api/eta-signer/next", paired.key))
    assert.equal(next.status, 200)
    const nb = await next.json()
    assert.equal(nb.environment, "real")
    assert.equal(nb.rin, RIN)
    assert.deepEqual(nb.documents, [{ docId: db.tables.eta_documents[0].doc_id, canonical: db.tables.eta_documents[0].canonical }])
    assert.ok(db.tables.eta_signers[0].last_seen_at, "last seen updated")
    assert.equal((await signerPingRoute.POST(signerRq("POST", "/api/eta-signer/ping", paired.key, { unlocked: true, version: "1.0" }))).status, 200)
    assert.equal(db.tables.eta_signers[0].unlocked, true)

    // pairing again revokes the previous signer (one at a time); disconnect revokes the current one
    const second = await (await signerRoute.POST(rq("POST", "/api/eta/signer", {}, { "x-mm-roles": "admin" }))).json()
    assert.equal((await signerNext.GET(signerRq("GET", "/api/eta-signer/next", paired.key))).status, 401, "old key revoked")
    assert.equal((await signerNext.GET(signerRq("GET", "/api/eta-signer/next", second.key))).status, 200)
    assert.equal((await signerRoute.DELETE(rq("DELETE", "/api/eta/signer"))).status, 403)
    assert.equal((await signerRoute.DELETE(rq("DELETE", "/api/eta/signer", undefined, { "x-mm-roles": "ceo" }))).status, 200)
    assert.equal((await signerNext.GET(signerRq("GET", "/api/eta-signer/next", second.key))).status, 401, "revoked key")
    assert.equal((await (await signerRoute.GET()).json()).paired, false)
    assert.equal(fake.calls.submit.length, 0)
  } finally {
    for (const k of Object.keys(etaSendDefaults)) delete (etaSendDefaults as any)[k]
  }

  // exactly four new public paths; /api/eta/signer still needs a login
  assert.deepEqual(PUBLIC_PATHS, ["/api/auth/login", "/api/auth/logout", "/api/auth/forgot", "/api/auth/me", "/api/eta-signer/next", "/api/eta-signer/signed", "/api/eta-signer/ping", "/api/eta-sync"])
  for (const p of ["/api/eta-signer/next", "/api/eta-signer/signed", "/api/eta-signer/ping", "/api/eta-sync"])
    assert.deepEqual(decide({ mode: "on", path: p, method: "POST", identity: null, idle: false }), { kind: "allow" })
  for (const p of ["/api/eta/signer", "/api/eta-signer", "/api/eta-signer/next/x", "/api/eta/send", "/api/eta-sync/x"]) {
    const d = decide({ mode: "on", path: p, method: "GET", identity: null, idle: false })
    assert.equal(d.kind === "refuse" && d.status, 401, p)
  }
  assert.equal(allows(ruleFor("/api/eta/signer")!, "GET", ["accountant"]), true)
  assert.equal(allows(ruleFor("/api/eta/signer")!, "GET", ["sales-rep"]), false)
})

test("F16. invoice changed after Send: not handed to the signer, row needs review", async () => {
  const { db, id } = await withInvoice("real")
  await queueSend(db, [id], "real", 7, { now: NOW })
  db.tables.accounts_receivable[0].amount = 400 // the amount changed after Send
  assert.deepEqual(await nextForSigner(db, 1, 20, { credentialsSet: yes, now: NOW }), [])
  assert.equal(db.tables.eta_documents[0].status, "needs_review")
  assert.equal(db.tables.eta_documents[0].errors[0].code, "CHANGED_AFTER_SEND")

  // the customer's name changed: the rebuilt text differs
  const b = await withInvoice("real")
  await queueSend(b.db, [b.id], "real", 7, { now: NOW })
  b.db.tables.customers[0].customer_name = "Acme Trading Co"
  assert.deepEqual(await nextForSigner(b.db, 1, 20, { credentialsSet: yes }), [])
  assert.equal(b.db.tables.eta_documents[0].status, "needs_review")

  // unchanged: handed out; nothing handed out on the other portal or without its login
  const c = await withInvoice("real")
  await queueSend(c.db, [c.id], "real", 7, { now: NOW })
  assert.deepEqual(await nextForSigner(c.db, 1, 20, { credentialsSet: () => false }), [])
  assert.equal((await nextForSigner(c.db, 1, 20, { credentialsSet: yes })).length, 1)
  c.db.tables.company_settings.find((s) => s.setting_key === "eta_environment")!.setting_value = "test"
  assert.deepEqual(await nextForSigner(c.db, 1, 20, { credentialsSet: yes }), [])
  assert.equal(c.db.tables.eta_documents[0].status, "pending_signature")
})

test("F17. signature checked against the stored text before one submit", async () => {
  const { db, id } = await withInvoice("real")
  await queueSend(db, [id], "real", 7, { now: NOW })
  const row = db.tables.eta_documents[0]
  const fake = portalFake()

  // signed over different text -> refused, row unchanged, no portal call
  const wrong = await acceptSignatures(db, [{ docId: row.doc_id, signature: await signCms(row.canonical + " ") }], fake.deps)
  assert.equal(wrong.refused.length, 1)
  assert.match(wrong.refused[0].reason, /different text/)
  // a certificate issued to another RIN; garbage; a CMS that carries the content
  assert.match((await acceptSignatures(db, [{ docId: row.doc_id, signature: await signCms(row.canonical, "200300400") }], fake.deps)).refused[0].reason, /not issued to tax registration number 100060455/)
  assert.equal((await acceptSignatures(db, [{ docId: row.doc_id, signature: "bm90IGEgY21z" }], fake.deps)).refused.length, 1)
  assert.equal((await checkSignature("%%%", row.canonical, RIN)).ok, false)
  assert.equal(row.status, "pending_signature")
  assert.equal(fake.calls.submit.length, 0)

  // pure check: good signature; expired certificate; tampered signature value
  const good = await signCms(row.canonical)
  assert.deepEqual(await checkSignature(good, row.canonical, RIN, NOW()), { ok: true })
  assert.equal((await checkSignature(good, row.canonical, RIN, new Date("2029-01-01T00:00:00Z"))).ok, false)
  const der = Buffer.from(good, "base64"); der[der.length - 5] ^= 0xff
  assert.equal((await checkSignature(der.toString("base64"), row.canonical, RIN, NOW())).ok, false)
  assert.equal(holdsRin("EG-100060455", RIN), true)
  assert.equal(holdsRin("1100060455", RIN), false)

  // good signature -> one submit with exactly the stored text plus the signature; row submitted with its ids
  const ok = await acceptSignatures(db, [{ docId: row.doc_id, signature: good }], fake.deps)
  assert.deepEqual(ok, { submitted: [row.doc_id], invalid: [], unconfirmed: [], refused: [] })
  assert.equal(fake.calls.submit.length, 1)
  assert.deepEqual(fake.calls.submit[0], [signedBody(row.document, good)])
  assert.ok(fake.calls.submit[0][0].startsWith(row.document.slice(0, -1) + ',"signatures":[{"signatureType":"I","value":"'))
  assert.equal(canonicalize(fake.calls.submit[0][0]), row.canonical, "the signatures section is not part of the signed text")
  const saved = db.tables.eta_documents[0]
  assert.deepEqual([saved.status, saved.eta_uuid, saved.eta_long_id, saved.submission_uuid, saved.signature], ["submitted", "UUID0", "LONG0", "SUB1", good])
  assert.ok(saved.submitted_at)
  // sending the same signature again: not waiting any more, no second submit
  assert.equal((await acceptSignatures(db, [{ docId: row.doc_id, signature: good }], fake.deps)).refused.length, 1)
  assert.equal(fake.calls.submit.length, 1)

  // a document the portal rejects in the submission -> invalid with its reasons
  const r = await withInvoice("real")
  await queueSend(r.db, [r.id], "real", 7, { now: NOW })
  const rr = r.db.tables.eta_documents[0]
  const rej = portalFake({ submit: (docs) => ({ submissionUUID: "SUB2", acceptedDocuments: [], rejectedDocuments: [{ internalId: JSON.parse(docs[0]).internalID, error: { code: "BadStructure", message: "bad", details: [{ code: "x1", message: "Receiver id is wrong", target: "receiver.id" }] } }] }) })
  const out2 = await acceptSignatures(r.db, [{ docId: rr.doc_id, signature: await signCms(rr.canonical) }], rej.deps)
  assert.deepEqual(out2.invalid, [rr.doc_id])
  assert.equal(r.db.tables.eta_documents[0].status, "invalid")
  assert.deepEqual(r.db.tables.eta_documents[0].errors, [{ code: "x1", message: "Receiver id is wrong", path: "receiver.id" }])
  // more than 20 per delivery is refused by the route
  useDb(r.db)
  const paired = await (await signerRoute.POST(rq("POST", "/api/eta/signer", {}, { "x-mm-roles": "ceo" }))).json()
  const many = Array.from({ length: 21 }, (_, i) => ({ docId: i + 1, signature: "x" }))
  assert.equal((await signerSigned.POST(signerRq("POST", "/api/eta-signer/signed", paired.key, { items: many }))).status, 400)
})

test("F18. follow-up never resubmits; 422 duplicate is 'already submitted - check status'", async () => {
  const { db, id } = await withInvoice("real")
  await queueSend(db, [id], "real", 7, { now: NOW })
  const row = db.tables.eta_documents[0]
  let mode: "throw" | "valid" | "invalid" = "throw"
  const fake = portalFake({
    getSubmission: () => {
      if (mode === "throw") throw new EtaError(0, "Timeout", "The ETA portal did not answer in time.")
      return { overallStatus: mode, documentSummary: [{ uuid: "UUID0", longId: "LONG0", internalId: JSON.parse(row.document).internalID, status: mode === "valid" ? "Valid" : "Invalid" }] }
    },
    getDetails: () => ({ validationResults: { status: "Invalid", validationSteps: [
      { status: "Valid", name: "Structure" },
      { status: "Invalid", name: "Taxpayer", error: { errorCode: "E1", error: "Receiver not registered", innerError: [{ errorCode: "E1.1", error: "Receiver id 200300400 not found", errorAr: "الرقم غير موجود", propertyPath: "receiver.id" }] } },
    ] } }),
  })
  await acceptSignatures(db, [{ docId: row.doc_id, signature: await signCms(row.canonical) }], fake.deps)
  assert.equal(db.tables.eta_documents[0].status, "submitted")

  // the check fails after the 202: still submitted, no second submit
  const t0 = Date.parse("2026-11-15T10:00:00Z")
  await followUp(db, fake.deps, { now: t0 })
  assert.equal(fake.calls.getSubmission.length, 1)
  assert.equal(db.tables.eta_documents[0].status, "submitted")
  // within 30 s: not asked again
  mode = "valid"
  await followUp(db, fake.deps, { now: t0 + 10_000 })
  assert.equal(fake.calls.getSubmission.length, 1, "throttled")
  // later: valid
  await followUp(db, fake.deps, { now: t0 + 31_000 })
  assert.equal(fake.calls.getSubmission.length, 2)
  assert.equal(db.tables.eta_documents[0].status, "valid")
  assert.ok(db.tables.eta_documents[0].validated_at)
  assert.equal(fake.calls.submit.length, 1, "never resubmitted")
  await followUp(db, fake.deps, { now: t0 + 90_000 })
  assert.equal(fake.calls.getSubmission.length, 2, "a valid document is not checked again")

  // invalid: the portal's reasons from the document details
  const iv = await withInvoice("real")
  await queueSend(iv.db, [iv.id], "real", 7, { now: NOW })
  const ir = iv.db.tables.eta_documents[0]
  mode = "invalid"
  await acceptSignatures(iv.db, [{ docId: ir.doc_id, signature: await signCms(ir.canonical) }], fake.deps)
  await followUp(iv.db, fake.deps, { now: t0 })
  assert.equal(iv.db.tables.eta_documents[0].status, "invalid")
  assert.deepEqual(iv.db.tables.eta_documents[0].errors, [{ code: "E1.1", message: "Receiver id 200300400 not found", messageAr: "الرقم غير موجود", path: "receiver.id", step: "Taxpayer" }])

  // 422 DuplicateSubmission on submit: kept as submitted with the plain message, never handed out or submitted again
  const d = await withInvoice("real")
  await queueSend(d.db, [d.id], "real", 7, { now: NOW })
  const dr = d.db.tables.eta_documents[0]
  const dup = portalFake({ submit: () => { throw new EtaError(422, "DuplicateSubmission", plainError("DuplicateSubmission")) } })
  const sig = await signCms(dr.canonical)
  assert.deepEqual((await acceptSignatures(d.db, [{ docId: dr.doc_id, signature: sig }], dup.deps)).unconfirmed, [dr.doc_id])
  assert.equal(d.db.tables.eta_documents[0].status, "submitted")
  assert.equal(d.db.tables.eta_documents[0].errors[0].code, "DuplicateSubmission")
  assert.match(d.db.tables.eta_documents[0].errors[0].message, /already sent/)
  assert.deepEqual(await nextForSigner(d.db, 1, 20, { credentialsSet: yes }), [])
  await acceptSignatures(d.db, [{ docId: dr.doc_id, signature: sig }], dup.deps)
  assert.equal(dup.calls.submit.length, 1)
  // a timeout on submit: unknown outcome, kept as submitted (never sent again by itself)
  const to = await withInvoice("real")
  await queueSend(to.db, [to.id], "real", 7, { now: NOW })
  const tr = to.db.tables.eta_documents[0]
  const slow = portalFake({ submit: () => { throw new EtaError(0, "Timeout", "x") } })
  assert.deepEqual((await acceptSignatures(to.db, [{ docId: tr.doc_id, signature: await signCms(tr.canonical) }], slow.deps)).unconfirmed, [tr.doc_id])
  assert.equal(to.db.tables.eta_documents[0].status, "submitted")
  assert.equal(to.db.tables.eta_documents[0].errors[0].code, "Unconfirmed")
  // the portal busy (429): nothing was taken, back to the waiting list
  const bz = await withInvoice("real")
  await queueSend(bz.db, [bz.id], "real", 7, { now: NOW })
  const br = bz.db.tables.eta_documents[0]
  const busy = portalFake({ submit: () => { throw new EtaBusyError(30) } })
  await acceptSignatures(bz.db, [{ docId: br.doc_id, signature: await signCms(br.canonical) }], busy.deps)
  assert.equal(bz.db.tables.eta_documents[0].status, "pending_signature")
  assert.equal(bz.db.tables.eta_documents[0].signature, null)
})

test("F19. AR delete: test rows never block, a real valid row does (ETA_LIVE); environment is CEO / admin only", async () => {
  const del = (db: FakeDb, id: number) => { useDb(db); return arRoute.DELETE(rq("DELETE", `/api/accounts-receivable?id=${id}`)) }
  const t = await withInvoice("test")
  await queueSend(t.db, [t.id], "test", 7, { now: NOW })
  t.db.tables.eta_documents[0].status = "valid"
  t.db.tables.eta_documents.push({ doc_id: 90, invoice_id: t.id, document_type: "I", environment: "real", version: 1, status: "invalid" })
  assert.equal(await liveRealDocument(t.db, t.id), false)
  const ok = await del(t.db, t.id)
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()))
  assert.equal(t.db.tables.accounts_receivable.length, 0)
  assert.equal(t.db.tables.eta_documents.length, 0, "the test and invalid rows go with the invoice")

  for (const [status, type] of [["valid", "I"], ["pending_signature", "I"], ["submitted", "I"], ["cancelled", "I"], ["invalid", "C"]]) {
    const r = await withInvoice("real")
    r.db.tables.eta_documents.push({ doc_id: 91, invoice_id: r.id, document_type: type, environment: "real", version: 1, status })
    const res = await del(r.db, r.id)
    assert.equal(res.status, 409, `${type} ${status}`)
    const b = await res.json()
    assert.equal(b.code, "ETA_LIVE")
    assert.match(b.error, /cancel it on the portal or issue a credit note first/)
    assert.equal(r.db.tables.accounts_receivable.length, 1)
    assert.equal(r.db.tables.eta_documents.length, 1)
  }
  const mn = await withInvoice("real")
  mn.db.tables.eta_documents.push({ doc_id: 92, invoice_id: mn.id, document_type: "I", environment: "real", version: 1, status: "manual" })
  assert.equal((await del(mn.db, mn.id)).status, 200)

  // eta_environment: only the CEO / admin may change it; saving the unchanged value is fine for the accountant
  const s = sendDb("test")
  s.tables.company_settings = s.tables.company_settings.filter((x) => x.setting_key !== "eta_environment")
  useDb(s)
  const put = (body: unknown, roles: string) => etaSettings2.PUT(rq("PUT", "/api/eta/settings", body, { "x-mm-roles": roles }))
  assert.equal((await put({ eta_environment: "test", eta_registered_name: "Misr Motors" }, "accountant")).status, 200)
  assert.equal((await put({ eta_environment: "real" }, "accountant")).status, 403)
  assert.equal((await put({ eta_environment: "real" }, "ceo")).status, 200)
  assert.equal((await put({ eta_environment: "real" }, "accountant")).status, 200, "unchanged")
  assert.equal((await put({ eta_environment: "test" }, "accountant")).status, 403)
  assert.equal((await put({ eta_environment: "preprod" }, "admin")).status, 400)
})

// ---- fix round 1: lost sends reconciled (P8), bounded follow-up ----
test("F20. portal searchSent: the company's sent documents by internal number", () => withCreds(async () => {
  const { portal, calls } = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : jres(200, { result: [{ uuid: "U9", internalId: "10363" }], metadata: {} }))
  const r = await portal.searchSent({ internalId: "10363", from: "2026-11-15T09:00:00.000Z", to: "2026-11-15T11:00:00.000Z" })
  assert.equal(r.result[0].uuid, "U9")
  const u = new URL(calls[1].url)
  assert.equal(u.origin + u.pathname, "https://api.preprod.invoicing.eta.gov.eg/api/v1.0/documents/search")
  assert.equal(u.searchParams.get("direction"), "Sent")
  assert.equal(u.searchParams.get("internalID"), "10363")
  assert.equal(u.searchParams.get("submissionDateFrom"), "2026-11-15T09:00:00.000Z")
  assert.equal(u.searchParams.get("submissionDateTo"), "2026-11-15T11:00:00.000Z")
  assert.equal(calls[1].init.method, "GET")
  // same 429 policy as every call
  let n = 0
  const b = fakePortal((c) => c.url.endsWith("/connect/token") ? okHandler(c) : (++n === 1 ? jres(429, {}, { "retry-after": "1" }) : jres(200, { result: [] })))
  await b.portal.searchSent({ internalId: "1", from: "a", to: "b" })
  assert.deepEqual(b.sleeps, [1000])
  assert.match(plainError("NotReceived", undefined, "en"), /never received it/)
  assert.match(plainError("NotReceived", undefined, "ar"), /[؀-ۿ]/)
}))

// an invoice sent, whose portal answer was lost (no submission id)
async function lostSend(failure: () => never) {
  const { db, id } = await withInvoice("real")
  await queueSend(db, [id], "real", 7, { now: NOW })
  const row = db.tables.eta_documents[0]
  const lost = portalFake({ submit: failure })
  await acceptSignatures(db, [{ docId: row.doc_id, signature: await signCms(row.canonical) }], lost.deps)
  assert.equal(db.tables.eta_documents[0].status, "submitted")
  assert.equal(db.tables.eta_documents[0].submission_uuid ?? null, null)
  return { db, id, row: db.tables.eta_documents[0], internalId: JSON.parse(row.document).internalID as string }
}

test("F21. lost sends: found on the portal -> adopted; not found -> left for 30 min, then NotReceived and sendable again", async () => {
  const t0 = Date.parse("2026-11-15T10:00:00Z")
  // 422 duplicate: found among sent documents (an older version's uuid is never adopted)
  const a = await lostSend(() => { throw new EtaError(422, "DuplicateSubmission", "dup") })
  a.db.tables.eta_documents.push({ doc_id: 77, invoice_id: a.id, document_type: "I", environment: "real", version: 9, status: "invalid", eta_uuid: "OLD" })
  const found = portalFake({
    searchSent: (p) => ({ result: [
      { uuid: "OLD", internalId: p.internalId, status: "Invalid", dateTimeReceived: "2026-11-15T09:59:30Z" },
      { uuid: "NEWU", longId: "NEWL", submissionUUID: "SUBX", internalId: p.internalId, status: "Valid", dateTimeReceived: "2026-11-15T10:00:01Z" },
    ] }),
  })
  await followUp(a.db, found.deps, { now: t0 + 60_000 })
  assert.equal(found.calls.searchSent.length, 1)
  assert.equal(found.calls.searchSent[0].internalId, a.internalId)
  assert.ok(found.calls.searchSent[0].from < "2026-11-15T10:00:00Z" && found.calls.searchSent[0].to > "2026-11-15T10:00:00Z", "a window around the attempt")
  const ar = a.db.tables.eta_documents[0]
  assert.deepEqual([ar.status, ar.eta_uuid, ar.eta_long_id, ar.submission_uuid], ["valid", "NEWU", "NEWL", "SUBX"])
  assert.equal(found.calls.submit.length, 0)

  // found but still being checked: ids adopted, stays submitted, later followed by submission
  const s = await lostSend(() => { throw new EtaError(0, "Timeout", "x") })
  const pending = portalFake({ searchSent: (p) => ({ result: [{ uuid: "U2", longId: "L2", submissionUUID: "S2", internalId: p.internalId, status: "Submitted" }] }) })
  await followUp(s.db, pending.deps, { now: t0 + 60_000 })
  assert.deepEqual([s.db.tables.eta_documents[0].status, s.db.tables.eta_documents[0].eta_uuid, s.db.tables.eta_documents[0].submission_uuid, s.db.tables.eta_documents[0].errors], ["submitted", "U2", "S2", null])

  // not found: unchanged under 30 min, also when the request was cut off between claim and answer
  const n = await lostSend(() => { throw new EtaError(503, "HTTP503", "down") })
  const none = portalFake()
  await followUp(n.db, none.deps, { now: t0 + 10 * 60_000 })
  assert.equal(n.db.tables.eta_documents[0].status, "submitted")
  assert.equal(await liveRealDocument(n.db, n.id), true)
  assert.deepEqual((await queueSend(n.db, [n.id], "real", 7, { now: NOW })).refused[0].reasons, ["already_live"])
  // throttled like any check: not searched again within 30 s
  await followUp(n.db, none.deps, { now: t0 + 10 * 60_000 + 5_000 })
  assert.equal(none.calls.searchSent.length, 1)
  // 30 min after the attempt and still not found: invalid NotReceived -> Send again allowed, delete no longer blocked
  await followUp(n.db, none.deps, { now: t0 + 31 * 60_000 })
  const nr = n.db.tables.eta_documents[0]
  assert.equal(nr.status, "invalid")
  assert.deepEqual(nr.errors.map((e: any) => [e.code, e.message]), [["NotReceived", "The portal never received it — send again"]])
  assert.equal(await liveRealDocument(n.db, n.id), false)
  assert.deepEqual((await queueSend(n.db, [n.id], "real", 7, { now: NOW })).queued, [n.id])
  assert.deepEqual(n.db.tables.eta_documents.map((r) => [r.version, r.status]), [[1, "invalid"], [2, "pending_signature"]])
  n.db.tables.eta_documents.pop()
  useDb(n.db)
  assert.equal((await arRoute.DELETE(rq("DELETE", `/api/accounts-receivable?id=${n.id}`))).status, 200)

  // a search that fails leaves the row as it is, even after 30 min
  const f = await lostSend(() => { throw new EtaError(0, "Network", "x") })
  const broken = portalFake({ searchSent: () => { throw new EtaError(0, "Timeout", "x") } })
  await followUp(f.db, broken.deps, { now: t0 + 60 * 60_000 })
  assert.equal(f.db.tables.eta_documents[0].status, "submitted")
})

test("F22. follow-up is bounded: a slow portal never holds the signer's answer beyond the budget", async () => {
  const { db, id } = await withInvoice("real")
  await queueSend(db, [id], "real", 7, { now: NOW })
  // another document of this portal already sent, whose check hangs
  db.tables.eta_documents.push({ doc_id: 500, invoice_id: id, document_type: "I", environment: "real", version: 5, status: "submitted", submission_uuid: "HANG", document: db.tables.eta_documents[0].document })
  db.tables.eta_documents.push({ doc_id: 501, invoice_id: id, document_type: "I", environment: "real", version: 6, status: "submitted", submission_uuid: "HANG2", document: db.tables.eta_documents[0].document })
  const hang = portalFake({ getSubmission: () => new Promise(() => {}) })
  // lib: stops at the budget, and starts no new call once it is spent
  const t = Date.now()
  await followUp(db, hang.deps, { now: NOW(), budgetMs: 80 })
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`)
  assert.equal(hang.calls.getSubmission.length, 1, "no second call after the budget ran out")
  assert.equal(db.tables.eta_documents.find((r) => r.doc_id === 500)!.status, "submitted")

  // route: the signer's documents come back, the follow-up runs after them within its budget
  useDb(db)
  db.tables.eta_documents.forEach((r) => { if (r.status === "submitted") r.checked_at = null })
  Object.assign(etaSendDefaults, { portalFor: hang.deps.portalFor, credentialsSet: yes, followUpBudgetMs: 150 })
  try {
    const paired = await (await signerRoute.POST(rq("POST", "/api/eta/signer", {}, { "x-mm-roles": "ceo" }))).json()
    const t1 = Date.now()
    const res = await signerNext.GET(signerRq("GET", "/api/eta-signer/next", paired.key))
    assert.ok(Date.now() - t1 < 1500, `next took ${Date.now() - t1} ms`)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).documents.length, 1)
    const t2 = Date.now()
    assert.equal((await signerPingRoute.POST(signerRq("POST", "/api/eta-signer/ping", paired.key, { unlocked: false, version: "1.2" }))).status, 200)
    assert.ok(Date.now() - t2 < 1500)
    // a follow-up that throws never fails the signer's answer
    Object.assign(etaSendDefaults, { portalFor: () => { throw new Error("boom") } })
    db.tables.eta_documents.forEach((r) => { if (r.status === "submitted") r.checked_at = null })
    assert.equal((await signerNext.GET(signerRq("GET", "/api/eta-signer/next", paired.key))).status, 200)
  } finally {
    for (const k of Object.keys(etaSendDefaults)) delete (etaSendDefaults as any)[k]
  }
})

// ---- F23-F26: credit note, cancel, send again, portal PDF (task 5) ----
import { LIVE_STATUSES, queueCreditNote, sendAgain } from "../eta/send"
import {
  cancelOnPortal, cancelWindowHours, CANCEL_WINDOW_RETRY_MS, ETA_DOCUMENT_TYPE_IDS, invoiceDocuments, portalPrintout, PRINTOUT_EVERY_MS,
  resetCancelWindowCache, resetPrintoutGuard, windowHoursOf,
} from "../eta/after-send"
import * as creditNoteRoute from "../../app/api/eta/credit-note/route"
import * as cancelRoute from "../../app/api/eta/cancel/route"
import * as printoutRoute from "../../app/api/eta/printout/route"
import * as sendAgainRoute from "../../app/api/eta/send-again/route"
import * as previewRoute2 from "../../app/api/eta/preview/route"
import { cancelConfirmed, cancelPending, CANCEL_CONFIRM_DAYS } from "../eta/send"
import { confirmCancelled } from "../eta/after-send"

// an invoice whose document is valid on the given portal
async function validInvoice(env: "test" | "real" = "real") {
  const { db, id } = await withInvoice(env)
  await queueSend(db, [id], env, 7, { now: NOW })
  Object.assign(db.tables.eta_documents[0], { status: "valid", eta_uuid: "INV-UUID", eta_long_id: "INV-LONG", submission_uuid: "SUB1", submitted_at: "2026-11-15T10:00:00Z", validated_at: "2026-11-15T10:01:00Z" })
  return { db, id, inv: db.tables.eta_documents[0] }
}
const creditNotes = (db: FakeDb) => db.tables.eta_documents.filter((r) => r.document_type === "C")
const withDefaults = async (deps: SendDeps, fn: () => Promise<void>) => {
  Object.assign(etaSendDefaults, deps)
  try { await fn() } finally { for (const k of Object.keys(etaSendDefaults)) delete (etaSendDefaults as any)[k] }
}

test("F23. credit note: only after valid, references the uuid, built from the sent snapshot; one active at a time", async () => {
  // not valid yet (waiting to be signed): refused, nothing saved
  const w = await withInvoice("real")
  await queueSend(w.db, [w.id], "real", 7, { now: NOW })
  const nv = await queueCreditNote(w.db, w.id, "real", 7, { now: NOW })
  assert.equal(nv.ok, false)
  assert.equal(!nv.ok && nv.code, "not_valid")
  assert.equal(creditNotes(w.db).length, 0)
  assert.equal((await queueCreditNote(w.db, 999, "real", 7) as any).code, "not_found")

  const { db, id, inv } = await validInvoice("real")
  const sent = JSON.parse(inv.document)
  // the invoice changes after it was sent: the credit note still repeats what was sent
  db.tables.customers[0].customer_name = "Acme Trading Co"
  db.tables.accounts_receivable[0].amount = 999
  const later = () => new Date("2026-11-16T08:00:00Z")
  const cn = await queueCreditNote(db, id, "real", 7, { now: later })
  assert.ok(cn.ok, JSON.stringify(cn))
  const [c] = creditNotes(db)
  assert.equal(cn.ok && cn.docId, c.doc_id)
  assert.deepEqual([c.document_type, c.environment, c.version, c.status, c.invoice_id, c.created_by], ["C", "real", 1, "pending_signature", id, 7])
  assert.deepEqual(c.references, ["INV-UUID"])
  assert.equal(typeof c.document, "string", "P5: the exact body text")
  assert.equal(c.canonical, canonicalize(c.document))
  const body = JSON.parse(c.document)
  assert.equal(body.documentType, "c")
  assert.deepEqual(body.references, ["INV-UUID"])
  assert.equal(body.internalID, sent.internalID, "same internal number")
  assert.equal(body.receiver.name, "Acme Trading", "the sent receiver, not the edited customer")
  assert.deepEqual(body.invoiceLines, sent.invoiceLines)
  assert.equal(body.totalAmount, 342)
  assert.equal(body.dateTimeIssued, "2026-11-16T08:00:00Z")
  assert.equal(c.document, toEtaJson(buildCreditNoteDocument(sent, "INV-UUID", "2026-11-16T08:00:00Z")))
  assert.equal(inv.status, "valid", "the invoice document is untouched")

  // the signer gets it although the invoice changed (a credit note is not rebuilt from the current invoice)
  const handed = await nextForSigner(db, 1, 20, { credentialsSet: yes, now: NOW })
  assert.deepEqual(handed, [{ docId: c.doc_id, canonical: c.canonical }])
  assert.equal(c.status, "pending_signature")
  // signed and submitted like any document: the submitted text carries the reference
  const fake = portalFake()
  const ok = await acceptSignatures(db, [{ docId: c.doc_id, signature: await signCms(c.canonical) }], fake.deps)
  assert.deepEqual(ok.submitted, [c.doc_id])
  assert.ok(fake.calls.submit[0][0].includes('"documentType":"c"') && fake.calls.submit[0][0].includes('"references":["INV-UUID"]'))

  // a second credit note while one is waiting, sent or valid: refused
  for (const status of LIVE_STATUSES) {
    c.status = status
    const again = await queueCreditNote(db, id, "real", 7, { now: later })
    assert.equal(!again.ok && again.code, "credit_note_active", status)
    assert.equal(creditNotes(db).length, 1)
  }
  // the other portal has no valid invoice: refused there
  assert.equal((await queueCreditNote(db, id, "test", 7)).ok, false)
  // after an invalid credit note a new one can be made: version 2, from the same snapshot
  c.status = "invalid"
  const v2 = await queueCreditNote(db, id, "real", 7, { now: later })
  assert.ok(v2.ok && v2.version === 2)
  assert.equal(creditNotes(db)[1].document, c.document)

  // the route: the portal from settings
  const r = await validInvoice("real")
  useDb(r.db)
  assert.equal((await creditNoteRoute.POST(rq("POST", "/api/eta/credit-note", {}))).status, 400)
  assert.equal((await creditNoteRoute.POST(rq("POST", "/api/eta/credit-note", { invoiceId: "x" }))).status, 400)
  const res = await creditNoteRoute.POST(rq("POST", "/api/eta/credit-note", { invoiceId: r.id }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { environment: "real", docId: creditNotes(r.db)[0].doc_id, version: 1 })
  const dup = await creditNoteRoute.POST(rq("POST", "/api/eta/credit-note", { invoiceId: r.id }))
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).code, "credit_note_active")
  assert.equal((await creditNoteRoute.POST(rq("POST", "/api/eta/credit-note", { invoiceId: 999 }))).status, 404)
})

test("F24. cancel: refused with an active credit note; portal refusals in plain words, status unchanged; valid -> cancelled", async () => {
  const { db, id, inv } = await validInvoice("real")
  await queueCreditNote(db, id, "real", 7, { now: NOW })
  const [c] = creditNotes(db)
  const okPortal = portalFake({ cancel: () => undefined })
  // the invoice has an active credit note (waiting / sent / valid): refused without asking the portal
  for (const status of LIVE_STATUSES) {
    c.status = status
    const r = await cancelOnPortal(db, inv.doc_id, "Wrong customer", okPortal.deps)
    assert.equal(!r.ok && r.code, "credit_note_active", status)
  }
  assert.equal(okPortal.calls.cancel.length, 0)
  assert.equal(inv.status, "valid")
  // a credit note on the other portal does not count
  c.environment = "test"
  c.status = "valid"

  // the portal says the cancel window has passed: plain words (EN / AR), the document stays valid
  const late = portalFake({ cancel: () => { throw new EtaError(400, "OperationPeriodOver", plainError("OperationPeriodOver")) } })
  const r = await cancelOnPortal(db, inv.doc_id, "Wrong customer", late.deps)
  assert.equal(r.ok, false)
  assert.ok(!r.ok)
  assert.equal(r.code, "OperationPeriodOver")
  assert.equal(r.message, plainError("OperationPeriodOver", undefined, "en"))
  assert.match(r.message, /time allowed for this action has passed/)
  assert.equal(r.messageAr, plainError("OperationPeriodOver", undefined, "ar"))
  assert.equal(r.status, 409)
  assert.deepEqual(late.calls.cancel, [["INV-UUID", "Wrong customer"]])
  assert.equal(inv.status, "valid")
  for (const code of ["IncorrectState", "ActiveReferencingDocuments"]) {
    const p = portalFake({ cancel: () => { throw new EtaError(400, code, plainError(code)) } })
    const x = await cancelOnPortal(db, inv.doc_id, "x", p.deps)
    assert.ok(!x.ok && x.message === plainError(code) && x.messageAr === plainError(code, undefined, "ar"), code)
    assert.equal(inv.status, "valid")
  }
  // a portal fault or timeout: unchanged too
  const down = portalFake({ cancel: () => { throw new EtaError(0, "Timeout", "The ETA portal did not answer in time. Try again in a minute.") } })
  assert.equal((await cancelOnPortal(db, inv.doc_id, "x", down.deps)).ok, false)
  assert.equal(inv.status, "valid")

  // a reason is required; only valid documents
  assert.equal((await cancelOnPortal(db, inv.doc_id, "  ", okPortal.deps) as any).code, "reason_required")
  assert.equal((await cancelOnPortal(db, inv.doc_id, "x".repeat(501), okPortal.deps) as any).code, "reason_too_long")
  assert.equal((await cancelOnPortal(db, 999, "x", okPortal.deps) as any).code, "not_found")
  assert.equal(okPortal.calls.cancel.length, 0)

  // accepted: cancelled; cancelling again is refused (not valid any more)
  assert.deepEqual(await cancelOnPortal(db, inv.doc_id, " Wrong customer ", okPortal.deps), { ok: true })
  assert.deepEqual(okPortal.calls.cancel, [["INV-UUID", "Wrong customer"]])
  assert.equal(inv.status, "cancelled")
  assert.deepEqual(inv.errors.map((e: any) => e.code), ["CancelRequested"], "P10: a request until the portal confirms it")
  assert.equal((await cancelOnPortal(db, inv.doc_id, "x", okPortal.deps) as any).code, "not_valid")
  // a valid credit note can be cancelled itself
  c.eta_uuid = "CN-UUID"
  assert.deepEqual(await cancelOnPortal(db, c.doc_id, "Credit note by mistake", okPortal.deps), { ok: true })
  assert.equal(c.status, "cancelled")
  assert.deepEqual(okPortal.calls.cancel[1], ["CN-UUID", "Credit note by mistake"])

  // the route
  const v = await validInvoice("real")
  useDb(v.db)
  await withDefaults({ portalFor: late.deps.portalFor, credentialsSet: yes, now: NOW }, async () => {
    assert.equal((await cancelRoute.POST(rq("POST", "/api/eta/cancel", { docId: v.inv.doc_id }))).status, 400)
    assert.equal((await cancelRoute.POST(rq("POST", "/api/eta/cancel", { reason: "x" }))).status, 400)
    const res = await cancelRoute.POST(rq("POST", "/api/eta/cancel", { docId: v.inv.doc_id, reason: "Wrong customer" }))
    assert.equal(res.status, 409)
    const b = await res.json()
    assert.deepEqual([b.code, b.error, b.errorAr], ["OperationPeriodOver", plainError("OperationPeriodOver"), plainError("OperationPeriodOver", undefined, "ar")])
    assert.equal(v.inv.status, "valid")
  })
  await withDefaults({ portalFor: okPortal.deps.portalFor, credentialsSet: yes, now: NOW }, async () => {
    const res = await cancelRoute.POST(rq("POST", "/api/eta/cancel", { docId: v.inv.doc_id, reason: "Wrong customer" }))
    assert.equal(res.status, 200)
    assert.equal(v.inv.status, "cancelled")
  })
})

test("F25. send again: after invalid a new version; refused while the earlier version is still live", async () => {
  const { db, id } = await withInvoice("real")
  assert.equal((await sendAgain(db, id, "real", 7, { now: NOW }) as any).code, "not_sent")
  await queueSend(db, [id], "real", 7, { now: NOW })
  const v1 = db.tables.eta_documents[0]
  for (const status of LIVE_STATUSES) {
    v1.status = status
    const r = await sendAgain(db, id, "real", 7, { now: NOW })
    assert.equal(!r.ok && r.code, "still_live", status)
    assert.equal(db.tables.eta_documents.length, 1)
  }
  for (const status of ["needs_review", "cancelled"]) {
    v1.status = status
    assert.equal((await sendAgain(db, id, "real", 7, { now: NOW }) as any).code, "not_invalid", status)
  }
  // invalid (e.g. the customer's address was wrong; fixed now): version 2, rebuilt from the invoice as it is now
  v1.status = "invalid"
  db.tables.customers[0].address_street = "Tahrir Sq"
  const r = await sendAgain(db, id, "real", 7, { now: NOW })
  assert.ok(r.ok, JSON.stringify(r))
  assert.deepEqual([r.documentType, r.version], ["I", 2])
  assert.deepEqual(db.tables.eta_documents.map((d) => [d.version, d.status]), [[1, "invalid"], [2, "pending_signature"]])
  assert.equal(r.docId, db.tables.eta_documents[1].doc_id)
  assert.equal(JSON.parse(db.tables.eta_documents[1].document).receiver.address.street, "Tahrir Sq")
  assert.equal(JSON.parse(db.tables.eta_documents[1].document).internalID, JSON.parse(v1.document).internalID, "same internal number")
  // version 2 is live: no third
  assert.equal((await sendAgain(db, id, "real", 7, { now: NOW }) as any).code, "still_live")
  // still something missing: refused with the reasons
  const m = await withInvoice("real")
  await queueSend(m.db, [m.id], "real", 7, { now: NOW })
  m.db.tables.eta_documents[0].status = "invalid"
  m.db.tables.customers[0].address_street = ""
  const mr = await sendAgain(m.db, m.id, "real", 7, { now: NOW })
  assert.ok(!mr.ok && mr.code === "customer_address" && mr.reasons?.includes("customer_address"))
  assert.equal(m.db.tables.eta_documents.length, 1)

  // an invalid credit note: sent again as credit note version 2, from the invoice's sent snapshot
  const c = await validInvoice("real")
  await queueCreditNote(c.db, c.id, "real", 7, { now: NOW })
  const [cn1] = creditNotes(c.db)
  assert.equal((await sendAgain(c.db, c.id, "real", 7, { now: NOW }) as any).code, "still_live")
  cn1.status = "invalid"
  const cr = await sendAgain(c.db, c.id, "real", 7, { now: NOW })
  assert.ok(cr.ok && cr.documentType === "C" && cr.version === 2, JSON.stringify(cr))
  const cn2 = creditNotes(c.db)[1]
  assert.deepEqual([cn2.status, cn2.references], ["pending_signature", ["INV-UUID"]])
  assert.equal(c.db.tables.eta_documents.filter((d) => d.document_type === "I").length, 1, "the invoice is not sent again")

  // the route
  const t = await withInvoice("test")
  await queueSend(t.db, [t.id], "test", 7, { now: NOW })
  useDb(t.db)
  const live = await sendAgainRoute.POST(rq("POST", "/api/eta/send-again", { invoiceId: t.id }))
  assert.equal(live.status, 409)
  assert.equal((await live.json()).code, "still_live")
  t.db.tables.eta_documents[0].status = "invalid"
  const ok = await sendAgainRoute.POST(rq("POST", "/api/eta/send-again", { invoiceId: t.id }))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { environment: "test", documentType: "I", docId: t.db.tables.eta_documents[1].doc_id, version: 2 })
  assert.equal((await sendAgainRoute.POST(rq("POST", "/api/eta/send-again", {}))).status, 400)
})

test("F26. portal PDF (one per 5 s, NotReady in plain words, received documents); the invoice window's documents and cancel window", async () => {
  const { db, id, inv } = await validInvoice("real")
  db.tables.eta_received_documents = [{ received_id: 3, uuid: "SUPP-UUID", environment: "real", internal_id: "S-77" }]
  const pdf = new TextEncoder().encode("%PDF-1.7 test").buffer
  let ready = true
  const fake = portalFake({ printout: () => { if (!ready) throw new EtaError(400, "NotReady", plainError("NotReady")); return pdf } })
  let t = 1_000_000
  const sleeps: number[] = []
  const deps = { ...fake.deps, clock: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms } }
  resetPrintoutGuard()
  const a = await portalPrintout(db, { docId: inv.doc_id }, deps)
  assert.ok(a.ok)
  assert.equal(a.pdf, pdf)
  assert.match(a.filename, /^invoice-.+\.pdf$/)
  assert.deepEqual(fake.calls.printout, ["INV-UUID"])
  // a second printout within 5 s waits for its turn
  t += 1_000
  const b = await portalPrintout(db, { receivedId: 3 }, deps)
  assert.ok(b.ok && b.filename === "supplier-S-77.pdf")
  assert.deepEqual(sleeps, [PRINTOUT_EVERY_MS - 1_000])
  assert.deepEqual(fake.calls.printout, ["INV-UUID", "SUPP-UUID"])
  // not ready yet on the portal: plain words
  t += 10_000
  ready = false
  const nr = await portalPrintout(db, { docId: inv.doc_id }, deps)
  assert.ok(!nr.ok && nr.code === "NotReady" && nr.message === plainError("NotReady") && nr.messageAr === plainError("NotReady", undefined, "ar"))
  // only valid / cancelled documents of ours
  t += 10_000
  inv.status = "submitted"
  assert.equal((await portalPrintout(db, { docId: inv.doc_id }, deps) as any).code, "not_on_portal")
  assert.equal((await portalPrintout(db, { receivedId: 9 }, deps) as any).code, "not_found")
  inv.status = "cancelled"
  ready = true
  assert.ok((await portalPrintout(db, { docId: inv.doc_id }, deps)).ok)

  // the route streams the PDF
  useDb(db)
  await withDefaults({ portalFor: fake.deps.portalFor, credentialsSet: yes }, async () => {
    resetPrintoutGuard()
    const res = await printoutRoute.GET(rq("GET", `/api/eta/printout?docId=${inv.doc_id}`))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("content-type"), "application/pdf")
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "%PDF-1.7 test")
    assert.equal((await printoutRoute.GET(rq("GET", "/api/eta/printout"))).status, 400)
    assert.equal((await printoutRoute.GET(rq("GET", "/api/eta/printout?docId=1&receivedId=3"))).status, 400)
    resetPrintoutGuard()
    assert.equal((await printoutRoute.GET(rq("GET", "/api/eta/printout?docId=999"))).status, 404)
  })

  // cancel window: read from the portal's document type, cached per environment; unknown -> null (retried later)
  assert.equal(windowHoursOf({ id: 1, cancellationPeriodInDays: 3 }), 72)
  assert.equal(windowHoursOf({ documentTypeVersions: [{ maxCancelPeriodHours: "48" }] }), 48)
  assert.equal(windowHoursOf({ id: 1, name: "Invoice" }), null)
  resetCancelWindowCache()
  const dt = portalFake({ documentType: () => ({ id: 1, cancelPeriodHours: 72 }) })
  assert.equal(await cancelWindowHours("real", dt.deps), 72)
  assert.equal(await cancelWindowHours("real", dt.deps), 72)
  assert.deepEqual(dt.calls.documentType, [ETA_DOCUMENT_TYPE_IDS.I], "cached")
  let clock = 0
  const broken = portalFake()
  assert.equal(await cancelWindowHours("test", { ...broken.deps, clock: () => clock }), null)
  assert.equal(await cancelWindowHours("test", { ...broken.deps, clock: () => clock }), null)
  assert.equal(broken.calls.documentType.length, 1)
  clock += CANCEL_WINDOW_RETRY_MS + 1
  await cancelWindowHours("test", { ...broken.deps, clock: () => clock })
  assert.equal(broken.calls.documentType.length, 2, "a failed read is retried later")
  assert.equal(await cancelWindowHours("test", { credentialsSet: () => false }), null)

  // the invoice window: documents per environment and the cancel window; opening it runs the follow-up first
  const p = await validInvoice("real")
  await queueCreditNote(p.db, p.id, "real", 7, { now: NOW })
  const [pc] = creditNotes(p.db)
  Object.assign(pc, { status: "submitted", submission_uuid: "SUBC", eta_uuid: "CN-UUID", submitted_at: "2026-11-15T10:05:00Z", checked_at: null })
  p.db.tables.eta_documents.push({ doc_id: 80, invoice_id: p.id, document_type: "I", environment: "test", version: 1, status: "invalid", errors: [{ code: "NotReceived", message: plainError("NotReceived"), messageAr: plainError("NotReceived", undefined, "ar") }, { code: "BadStructure" }] })
  const follow = portalFake({
    getSubmission: () => ({ documentSummary: [{ uuid: "CN-UUID", longId: "CN-LONG", internalId: JSON.parse(pc.document).internalID, status: "Valid" }] }),
    documentType: () => ({ cancellationPeriodInHours: 72 }),
  })
  useDb(p.db)
  resetCancelWindowCache()
  await withDefaults({ portalFor: follow.deps.portalFor, credentialsSet: yes, now: NOW }, async () => {
    const res = await previewRoute2.GET(rq("GET", `/api/eta/preview?invoiceId=${p.id}`))
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.invoiceId, p.id, "still the preview")
    assert.equal(body.environment, "real")
    assert.equal(body.cancelWindowHours, 72)
    assert.equal(follow.calls.getSubmission.length, 1, "follow-up ran")
    assert.deepEqual(body.documents.real.map((d: any) => [d.document_type, d.version, d.status, d.eta_uuid]), [["I", 1, "valid", "INV-UUID"], ["C", 1, "valid", "CN-UUID"]])
    assert.deepEqual(Object.keys(body.documents.real[0]).sort(), ["cancel_pending", "doc_id", "document_type", "errors", "eta_long_id", "eta_uuid", "status", "submitted_at", "validated_at", "version"])
    assert.equal(body.documents.real[1].eta_long_id, "CN-LONG")
    assert.ok(body.documents.real[1].validated_at)
    assert.deepEqual(body.documents.test[0].errors, [
      { code: "NotReceived", message: plainError("NotReceived"), messageAr: plainError("NotReceived", undefined, "ar") },
      { code: "BadStructure", message: plainError("BadStructure") },
    ])
    // nothing valid on the selected portal: the cancel window is not asked for
    p.db.tables.eta_documents.forEach((d) => { if (d.environment === "real") d.status = "cancelled" })
    resetCancelWindowCache()
    const again = await (await previewRoute2.GET(rq("GET", `/api/eta/preview?invoiceId=${p.id}`))).json()
    assert.equal(again.cancelWindowHours, null)
    assert.equal(follow.calls.documentType.length, 1)
  })
  assert.deepEqual((await invoiceDocuments(p.db, 999)), { test: [], real: [] })
})

test("F27. a cancellation is a request until the portal confirms it: declined -> valid again; confirmed; 8 days; confirmCancelled", async () => {
  const t0 = Date.parse("2026-11-15T10:00:00Z")
  // cancelled by us at t0 (pending confirmation)
  const cancelledAt = async (when: number) => {
    const v = await validInvoice("real")
    const ok = portalFake({ cancel: () => undefined })
    assert.deepEqual(await cancelOnPortal(v.db, v.inv.doc_id, "Wrong customer", { ...ok.deps, now: () => new Date(when) }), { ok: true })
    assert.ok(cancelPending(v.inv) && !cancelConfirmed(v.inv))
    return v
  }
  let details: any = { status: "Valid", declineCancelRequestDate: "2026-11-15T12:00:00Z" }
  const fake = portalFake({ getDetails: () => details })

  // the receiver declined: valid again with the plain note; the follow-up never resubmits
  const d = await cancelledAt(t0)
  await followUp(d.db, fake.deps, { now: t0 + 60_000 })
  assert.deepEqual(fake.calls.getDetails, ["INV-UUID"])
  assert.equal(d.inv.status, "valid")
  assert.deepEqual(d.inv.errors, [{ code: "CancelDeclined", message: "The customer declined the cancellation on the portal", messageAr: plainError("CancelDeclined", undefined, "ar") }])
  assert.match(d.inv.errors[0].messageAr, /[؀-ۿ]/)
  assert.equal(fake.calls.submit.length, 0)

  // still waiting for the receiver: unchanged; throttled like any check
  details = { status: "Valid", cancelRequestDate: "2026-11-15T10:00:00Z" }
  const w = await cancelledAt(t0)
  await followUp(w.db, fake.deps, { now: t0 + 60_000 })
  assert.ok(cancelPending(w.inv))
  await followUp(w.db, fake.deps, { now: t0 + 70_000 })
  assert.equal(fake.calls.getDetails.length, 2, "not asked again within 30 s")
  // the portal confirms: stays cancelled, note cleared, not asked again
  details = { status: "Cancelled" }
  await followUp(w.db, fake.deps, { now: t0 + 120_000 })
  assert.equal(w.inv.status, "cancelled")
  assert.ok(cancelConfirmed(w.inv))
  assert.equal(w.inv.errors, null)
  await followUp(w.db, fake.deps, { now: t0 + 10 * 60_000 })
  assert.equal(fake.calls.getDetails.length, 3)

  // requested more than 8 days ago: not re-checked
  const o = await cancelledAt(t0)
  const before = fake.calls.getDetails.length
  await followUp(o.db, fake.deps, { now: t0 + (CANCEL_CONFIRM_DAYS * 24 + 1) * 3600_000 })
  assert.equal(fake.calls.getDetails.length, before)
  assert.ok(cancelPending(o.inv))
  // a failed check leaves it as it is
  const f = await cancelledAt(t0)
  const broken = portalFake({ getDetails: () => { throw new EtaError(0, "Timeout", "x") } })
  await followUp(f.db, broken.deps, { now: t0 + 60_000 })
  assert.ok(cancelPending(f.inv))

  // confirmCancelled (for correct-and-reissue): true only when the portal says cancelled
  const c = await cancelledAt(t0)
  details = { status: "Valid", cancelRequestDate: "x" }
  assert.equal(await confirmCancelled(c.db, c.inv.doc_id, fake.deps), false)
  assert.ok(cancelPending(c.inv))
  details = { status: "Cancelled" }
  assert.equal(await confirmCancelled(c.db, c.inv.doc_id, fake.deps), true)
  assert.ok(cancelConfirmed(c.inv))
  assert.equal(await confirmCancelled(c.db, c.inv.doc_id, fake.deps), true, "asked again, still cancelled")
  assert.equal(await confirmCancelled(c.db, c.inv.doc_id, broken.deps), false, "portal unreachable")
  const n = await cancelledAt(t0)
  details = { status: "Valid" }
  assert.equal(await confirmCancelled(n.db, n.inv.doc_id, fake.deps), false)
  assert.equal(n.inv.status, "valid")
  assert.equal(n.inv.errors[0].code, "CancelDeclined")
  assert.equal(await confirmCancelled(n.db, n.inv.doc_id, fake.deps), false, "not cancelled")
  assert.equal(await confirmCancelled(n.db, 999, fake.deps), false)

  // the invoice window shows the pending cancellation
  const p = await cancelledAt(t0)
  assert.equal((await invoiceDocuments(p.db, p.id)).real[0].cancel_pending, true)

  // the preview GET: follow-up and cancel-window read side by side, bounded by the follow-up budget
  const hangDb = await validInvoice("real")
  hangDb.db.tables.eta_documents.push({ doc_id: 600, invoice_id: hangDb.id, document_type: "I", environment: "real", version: 9, status: "submitted", submission_uuid: "HANG", document: hangDb.inv.document })
  let windowAsked = 0
  const slow = portalFake({ getSubmission: () => new Promise(() => {}), documentType: () => { windowAsked++; return new Promise((r) => setTimeout(() => r({ cancelPeriodHours: 72 }), 300)) } })
  useDb(hangDb.db)
  resetCancelWindowCache()
  await withDefaults({ portalFor: slow.deps.portalFor, credentialsSet: yes, followUpBudgetMs: 400 }, async () => {
    const t = Date.now()
    const res = await previewRoute2.GET(rq("GET", `/api/eta/preview?invoiceId=${hangDb.id}`))
    const took = Date.now() - t
    assert.equal(res.status, 200)
    assert.equal((await res.json()).cancelWindowHours, 72)
    assert.equal(windowAsked, 1)
    assert.ok(took < 650, `in parallel: took ${took} ms`)
  })
})

// ---- F28-F30: a replaced invoice stops counting everywhere (task 6, spec 6.5a) ----
import { readdirSync, statSync } from "node:fs"
import { call as callRoute } from "./route-harness"
import { excludeReplaced, isReplacedInvoice, REPLACED_PAYMENT_MESSAGE } from "../ar-live"
import { loadSoInvoicingState } from "../invoicing"
import { arSummary, arAging, financialSummary } from "../reports/views"
import * as arPayRoute6 from "../../app/api/accounts-receivable/payments/route"
import * as applyCreditRoute6 from "../../app/api/accounts-receivable/apply-credit/route"
import * as scheduleRoute6 from "../../app/api/payment-schedules/route"
import * as arListRoute6 from "../../app/api/accounts-receivable/route"
import * as analyticsRoute6 from "../../app/api/analytics/financial/route"

const REPO6 = process.env.REPO_ROOT || process.cwd()

// Every place that names accounts_receivable in code is a "reader". A reader is either wrapped in excludeReplaced
// (lib/ar-live.ts) or listed here, ONE reason per unfiltered reader, in source order. The test counts them per file, so
// one more unfiltered reader anywhere (even in a file that already uses excludeReplaced) fails until it is filtered
// or given a reason.
export const UNFILTERED_READERS: Record<string, string[]> = {
  "app/api/accounts-receivable/route.ts": [
    "the receivables list shows a replaced invoice, labelled",
    "PUT: updates the VAT file of one invoice by id",
    "DELETE: reads one invoice by id for the has-payments refusal",
    "DELETE: removes one invoice by id",
  ],
  "app/api/invoices/ar/[id]/pdf/route.ts": ["the invoice's own PDF still opens for a replaced invoice"],
  "app/api/invoices/ar/[id]/[invoiceId]/pdf/route.ts": ["the invoice's own PDF still opens for a replaced invoice"],
  "app/api/sales-orders/route.ts": [
    "inserts the down-payment invoice",
    "inserts the invoice",
    "delete guard: an order that any invoice (replaced too) still points at is not deleted",
  ],
  "app/api/customer-credits/route.ts": ["only turns invoice ids into numbers for display; a credit's source invoice may be a replaced one"],
  "app/api/eta/preview/route.ts": ["looks one invoice up by id so its e-invoice window opens, replaced or not"],
  "app/api/maintenance/invoices/route.ts": [
    "number-taken check: maintenance invoices are never replaced and the number stays unique",
    "inserts the maintenance invoice",
    "rolls back that insert by id",
  ],
  "app/api/maintenance/work-orders/ready-for-invoice/route.ts": ["matches a work order to the maintenance invoice number it holds; never replaced"],
  "app/api/pending-counts/route.ts": ["counts maintenance work orders by the invoice number they hold; never replaced"],
  "app/api/system-health/route.ts": [
    "table-reachability list, reads no invoice",
    "integrity check of each row's amount, collected and balance: replaced rows too",
  ],
  "app/api/payment-schedules/route.ts": [
    "reads one invoice by id; the payment is refused when it is replaced (isReplacedInvoice)",
    "guarded update of one invoice by id, reached only after that refusal",
  ],
  "lib/ar-payments.ts": [
    "audit entity label, reads nothing",
    "idempotent replay returns the invoice as it is",
    "reads one invoice by id; the payment is refused when it is replaced",
    "guarded update of one invoice by id, reached only after that refusal",
    "ledger step label, reads nothing",
    "payment reference type label, reads nothing",
  ],
  "lib/customer-credit-apply.ts": [
    "audit entity label, reads nothing",
    "idempotent replay returns the invoice as it is",
    "reads one invoice by id; the credit is refused when it is replaced",
    "guarded update of one invoice by id, reached only after that refusal",
    "failure label, reads nothing",
    "restore of that same update by id",
  ],
  "lib/invoicing.ts": [
    "next invoice number must see replaced invoice numbers (unique)",
    "insert with the typed number",
    "insert with the generated number",
    "rollback delete of an invoice just inserted, by id",
  ],
  "lib/sales-orders/on-approved.ts": [
    "down-payment invoice number is unique: a replaced one still holds it",
    "inserts the down-payment invoice",
  ],
  "lib/supplier-credit-ap-apply.ts": ["failure label for the receivable ledger, reads nothing"],
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n")
}
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(REPO6, dir))) {
    if (name === "node_modules" || name === "__tests__" || name === ".next") continue
    const rel = `${dir}/${name}`
    if (statSync(join(REPO6, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}
/** readers that name accounts_receivable in code, and how many of the file's uses are excludeReplaced */
export function arReaderCounts(text: string): { readers: number; filtered: number } {
  const code = stripComments(text)
  // a quoted table name, also split over a "+" chain
  const readers = (code.match(/(["'`])accounts_receivable\1|accounts_["'`]\s*\+\s*["'`]receivable/g) || []).length
  const filtered = code.split("\n").filter((l) => !/^\s*import\b/.test(l)).join("\n").match(/\bexcludeReplaced\b/g)?.length ?? 0
  return { readers, filtered }
}
/** the files whose number of unfiltered readers differs from the explicit expectation */
export function arGuardProblems(files: Record<string, string>, expected: Record<string, string[]> = UNFILTERED_READERS): string[] {
  const problems: string[] = []
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith("lib/eta/") || path === "lib/ar-live.ts") continue
    const { readers, filtered } = arReaderCounts(text)
    const unfiltered = Math.max(0, readers - filtered)
    const want = (expected[path] || []).length
    if (unfiltered !== want) problems.push(`${path}: ${unfiltered} unfiltered accounts_receivable reader(s), ${want} listed with a reason`)
  }
  return problems
}
const staleEntries = (files: Record<string, string>) => Object.keys(UNFILTERED_READERS).filter((path) => !(path in files))

test("F28. guard: every accounts_receivable reader excludes replaced invoices or is listed with its own reason", () => {
  const files: Record<string, string> = {}
  for (const f of [...walk("app"), ...walk("lib")]) files[f] = readFileSync(join(REPO6, f), "utf8")
  assert.deepEqual(arGuardProblems(files), [], "a new accounts_receivable reader needs excludeReplaced (lib/ar-live.ts) or one more reasoned UNFILTERED_READERS entry")
  assert.deepEqual(staleEntries(files), [], "listed files that no longer exist")
  for (const [path, reasons] of Object.entries(UNFILTERED_READERS)) {
    assert.ok(reasons.length > 0 && reasons.every((r) => r.length >= 15), `${path}: a reason per reader`)
  }

  // synthetic: a new unfiltered reader fails
  const fresh = { "app/api/new-report/route.ts": 'const { data } = await db.from("accounts_receivable").select("*")' }
  assert.equal(arGuardProblems(fresh).length, 1)
  assert.deepEqual(arGuardProblems(fresh, { "app/api/new-report/route.ts": ["shows history, reason given"] }), [])
  assert.equal(arGuardProblems({ "lib/x.ts": 'db.from(`accounts_receivable`).select("amount")' }).length, 1)
  assert.equal(arGuardProblems({ "lib/x.ts": 'db.from("accounts_" + "receivable").select("amount")' }).length, 1, "split chain")
  assert.deepEqual(arGuardProblems({ "lib/x.ts": 'import { excludeReplaced } from "./ar-live"\nconst q = excludeReplaced(db.from("accounts_receivable").select("*"))' }), [])
  assert.deepEqual(arGuardProblems({ "lib/x.ts": "// reads accounts_receivable later\nconst a = 1" }), [], "a comment is not a reader")
  assert.deepEqual(arGuardProblems({ "lib/eta/y.ts": 'db.from("accounts_receivable")' }), [], "lib/eta is outside this guard")
  // a file that already filters (or is allowlisted) fails when it gains one more unfiltered reader; filtered, it passes
  for (const path of ["lib/invoicing.ts", "lib/so-overview.ts", "lib/ar-payments.ts", "lib/reports/views.ts"]) {
    const bare = 'async function newReader(db: any) { return db.from("accounts_receivable").select("amount, balance") }\n'
    const problems = arGuardProblems({ ...files, [path]: files[path] + "\n" + bare })
    assert.equal(problems.length, 1, `${path} + one unfiltered reader`)
    assert.ok(problems[0].startsWith(path + ":"), problems[0])
    const withFilter = 'async function newReader(db: any) { return excludeReplaced(db.from("accounts_receivable").select("amount, balance")) }\n'
    assert.deepEqual(arGuardProblems({ ...files, [path]: files[path] + "\n" + withFilter }), [], `${path} + one filtered reader`)
  }
})

const ar6 = (id: number, status: string | null, extra: Row = {}): Row => ({
  invoice_id: id, invoice_number: `INV-6-${id}`, customer_id: 3, so_id: 1, amount: 100, collected_amount: 0, balance: 100, months_paid: 0,
  installment_months: 1, due_date: "2026-01-01", invoice_date: "2026-01-01", status, created_at: "2026-01-01T00:00:00Z", ...extra,
})

test("F29. excludeReplaced keeps every live status and a missing status; only replaced drops out", async () => {
  const db = new FakeDb({ accounts_receivable: [ar6(1, "pending"), ar6(2, "partially_paid"), ar6(3, "paid"), ar6(4, "overdue"), ar6(5, null), ar6(6, "replaced")] })
  const { data } = await excludeReplaced(db.from("accounts_receivable").select("invoice_id"))
  assert.deepEqual(data.map((r: any) => r.invoice_id), [1, 2, 3, 4, 5])
  // composes with the other filters and the sums that follow
  const some = await excludeReplaced(db.from("accounts_receivable").select("invoice_id").in("invoice_id", [5, 6]))
  assert.deepEqual(some.data.map((r: any) => r.invoice_id), [5])
  assert.equal(isReplacedInvoice({ status: "replaced" }), true)
  assert.equal(isReplacedInvoice({ status: null }), false)
  assert.equal(isReplacedInvoice(null), false)
  // the real FakeDb check for the PostgREST text: a null status is kept
  assert.equal(excludeReplaced({ or: (e: string) => e } as any), "status.is.null,status.neq.replaced")
})

function soDb6(arRows: Row[], links: Row[] = []) {
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-6", customer_id: 3, total: 114, subtotal: 100, discount_amount: 0, payment_type: "cash" }],
    customers: [{ customer_id: 3, customer_name: "C" }],
    sales_order_items: [{ so_id: 1, product_id: 100, outsourced_name: null, quantity: 1, unit_price: 100, total: 100 }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-6-1", sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: [{ permit_id: 1, product_id: 100, item_name_snapshot: "item", quantity: 1, unit_price: 100, total: 100 }],
    invoice_delivery_permits: links,
    accounts_receivable: arRows,
  })
}

test("F29b. over-invoicing / already-invoiced: a replaced invoice is left out of the order's invoices", async () => {
  const live = await loadSoInvoicingState(soDb6([ar6(1, "pending")], [{ invoice_id: 1, permit_id: 1 }]), 1)
  assert.deepEqual(live!.invoices.map((i) => i.invoice_id), [1])
  const replaced = await loadSoInvoicingState(soDb6([ar6(1, "replaced")], [{ invoice_id: 1, permit_id: 1 }]), 1)
  assert.deepEqual(replaced!.invoices, [], "by sales order and by permit link")
  const noStatus = await loadSoInvoicingState(soDb6([ar6(1, null)], [{ invoice_id: 1, permit_id: 1 }]), 1)
  assert.equal(noStatus!.invoices.length, 1)
  // a whole-order invoice (no links) as well
  const whole = await loadSoInvoicingState(soDb6([ar6(2, "replaced")]), 1)
  assert.deepEqual(whole!.invoices, [])
})

test("F29c. reports, ageing, customer balance and analytics leave a replaced invoice out", async () => {
  const rows = [ar6(1, "pending"), ar6(2, "replaced", { amount: 900, balance: 900 }), ar6(3, "paid", { amount: 50, collected_amount: 50, balance: 0 })]
  const db = new FakeDb({ accounts_receivable: rows, customers: [{ customer_id: 3, customer_name: "C" }], sales_orders: [], purchase_orders: [], accounts_payable: [], suppliers: [], inventory: [] })
  const summary = await arSummary(db as any)
  assert.equal(summary.total_invoices, 2)
  assert.equal(summary.total_invoiced, 150)
  assert.equal(summary.total_outstanding, 100)
  assert.deepEqual((await arAging(db as any)).map((r) => r.invoice_id), [1, 3])
  assert.equal((await financialSummary(db as any)).ar_outstanding, 100)
  useDb(db)
  const analytics = await analyticsRoute6.GET()
  const body = await analytics.json()
  const total = (Object.values((body as any).arAging || {}) as number[]).reduce((s, v) => s + (Number(v) || 0), 0)
  assert.ok(total <= 100, `analytics ageing counted a replaced invoice: ${total}`)
  // the receivables list still returns it, with its status, so the screen can label it
  const list = await arListRoute6.GET()
  const listed = (await list.json()) as any[]
  assert.equal(listed.length, 3)
  assert.ok(listed.some((r) => r.status === "replaced"))
})

test("F30. no payment, credit or schedule payment can be recorded on a replaced invoice", async () => {
  const mk = () => {
    const db = new FakeDb({
      accounts_receivable: [ar6(5, "replaced", { amount: 300 })],
      payment_schedules: [{ schedule_id: 1, invoice_id: 5, installment_number: 1, amount: 100, paid_amount: 0, status: "pending", schedule_type: "receivable" }],
      customer_payments: [], balance_entries: [], idempotency_log: [],
      customer_credits: [{ credit_id: 1, customer_id: 3, amount: 80, status: "active", credit_type: "overpayment", invoice_id: 9, reference_type: "ar_payment", reference_id: 1, used_at: null, used_in_invoice_id: null }],
    })
    useDb(db)
    return db
  }
  const untouched = (db: FakeDb) => {
    assert.equal(db.tables.accounts_receivable[0].collected_amount, 0)
    assert.equal(db.tables.accounts_receivable[0].status, "replaced")
    assert.equal(db.tables.customer_payments.length, 0)
    assert.equal(db.tables.balance_entries.length, 0)
    assert.equal(db.tables.payment_schedules[0].paid_amount, 0)
    assert.equal(db.tables.customer_credits[0].status, "active")
  }
  let db = mk()
  const pay = await callRoute(arPayRoute6.POST, "POST", { invoiceId: 5, amount: 100, idempotencyKey: "f30-pay-1" })
  assert.equal(pay.status, 409)
  assert.equal(pay.body.error, REPLACED_PAYMENT_MESSAGE)
  untouched(db)
  db = mk()
  const credit = await callRoute(applyCreditRoute6.POST, "POST", { invoiceId: 5, idempotencyKey: "f30-credit-1", credits: [{ creditId: 1, amount: 80 }] })
  assert.equal(credit.status, 409)
  assert.equal(credit.body.error, REPLACED_PAYMENT_MESSAGE)
  untouched(db)
  db = mk()
  const sched = await callRoute(scheduleRoute6.PUT, "PUT", { scheduleId: "1", paidAmount: 100, invoiceId: 5, paymentDate: "2026-10-08" })
  assert.equal(sched.status, 409)
  assert.equal(sched.body.error, REPLACED_PAYMENT_MESSAGE)
  untouched(db)
  // a live invoice is unaffected
  db = mk()
  db.tables.accounts_receivable[0].status = "pending"
  assert.equal((await callRoute(arPayRoute6.POST, "POST", { invoiceId: 5, amount: 100, idempotencyKey: "f30-pay-2" })).status, 200)
})

// ---- F31-F36: correct and reissue (task 7, spec 6.5a) ----
import { etaReissueInvoice, etaUndoReissue, installReissueRpcs } from "../../scripts/sql/2026-11-15-eta-step2.fake"
import { correctPermit, startReissue } from "../eta/reissue"
import { openCorrection } from "../eta/correction"
import { createSoInvoice } from "../invoicing"
import { creditInvoicedReturn } from "../return-credit"
import { arSummary as arSummary7 } from "../reports/views"
import * as reissueRoute7 from "../../app/api/eta/reissue/route"
import * as correctRoute7 from "../../app/api/delivery-permits/correct/route"
import * as dpRoute7 from "../../app/api/delivery-permits/route"
import * as soRoute7 from "../../app/api/sales-orders/route"

const realDoc = (extra: Row = {}): Row => ({ doc_id: 1, invoice_id: 10, document_type: "I", environment: "real", version: 1, status: "valid", eta_uuid: "U1", errors: null, ...extra })
const creditNote = (extra: Row = {}): Row => realDoc({ doc_id: 2, document_type: "C", eta_uuid: "C1", ...extra })

// SO 1: 5 x Pump at 100 (570 with VAT) on DP-1 (approved, stock taken from inventory 1), invoiced as INV-2026-0010 with
// 200 paid (payment 1, receivable schedule 1). Schedule 2 is a supplier (payable) schedule that happens to carry invoice id 10.
function reissueDb(o: { docs?: Row[]; paid?: boolean; wholeOrder?: boolean; stock?: number } = {}) {
  const paid = o.paid !== false
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    customers: [{ customer_id: 5, customer_name: "Acme Trading" }, { customer_id: 6, customer_name: "Beta Co" }],
    sales_orders: [{ so_id: 1, so_number: "SO-7", customer_id: 5, status: "delivered", total: 570, subtotal: 500, discount_amount: 0, payment_type: "cash" }],
    sales_order_items: [{ so_item_id: 1, so_id: 1, product_id: 100, outsourced_name: null, quantity: 5, unit_price: 100, total: 500, item_type: "stock" }],
    delivery_permits: [{ permit_id: 1, permit_no: "DP-7-1", sales_order_id: 1, customer_id: 5, status: "APPROVED", invoice_id: o.wholeOrder ? null : 10 }],
    delivery_permit_items: [{ item_id: 11, permit_id: 1, product_id: 100, item_name_snapshot: "Pump", quantity: 5, unit_price: 100, total: 500, warehouse_id: 1 }],
    inventory: [{ inventory_id: 1, product_id: 100, warehouse_id: 1, quantity: o.stock ?? 2, is_returned: false }],
    inventory_transactions: [], workflow_events: [],
    idempotency_log: [{ id: 1, operation_type: "dp_stock_deduct", idempotency_key: "dp_stock_deduct_1", status: "completed" }],
    accounts_receivable: [{
      invoice_id: 10, invoice_number: "INV-2026-0010", customer_id: 5, so_id: 1, source_delivery_permit_id: o.wholeOrder ? null : 1, amount: 570,
      collected_amount: paid ? 200 : 0, balance: paid ? 370 : 570, months_paid: paid ? 1 : 0, installment_months: 1, payment_terms: "cash",
      status: paid ? "partially_paid" : "pending", invoice_date: "2026-11-01", due_date: "2027-06-01", created_at: "2026-11-01T10:00:00Z",
      replaces_invoice_id: null, replaced_by_invoice_id: null,
    }],
    invoice_delivery_permits: o.wholeOrder ? [] : [{ invoice_id: 10, permit_id: 1 }],
    customer_payments: paid ? [{ payment_id: 1, invoice_id: 10, customer_id: 5, amount: 200, payment_method: "cash" }] : [],
    payment_schedules: [
      { schedule_id: 1, invoice_id: 10, so_id: 1, po_id: null, amount: 570, paid_amount: paid ? 200 : 0, status: paid ? "partial" : "pending", schedule_type: "receivable" },
      { schedule_id: 2, invoice_id: 10, so_id: null, po_id: 3, amount: 900, paid_amount: 0, status: "pending", schedule_type: "payable" },
    ],
    customer_credits: [], balance_entries: [], product_returns: [], return_items: [], dp_corrections: [], company_settings: [],
    eta_documents: o.docs ?? [realDoc(), creditNote()],
  })
  db.jitter = false
  installReissueRpcs(db)
  useDb(db)
  return db
}
const ar7 = (db: FakeDb, id: number) => db.tables.accounts_receivable.find((r) => r.invoice_id === id)!
// what the customer owes: open invoices (replaced ones left out) less open credits
async function owes(db: FakeDb) {
  const credits = db.tables.customer_credits.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.amount), 0)
  return Math.round(((await arSummary7(db as any)).total_outstanding - credits) * 100) / 100
}
const mirror = (db: FakeDb) => JSON.stringify(Object.fromEntries(Object.entries(db.tables).filter(([k]) => k !== "workflow_events")))

test("F31. correct and reissue starts only after the real document is reversed on the portal", async () => {
  const refused = async (docs: Row[], code: string, extra: Partial<SendDeps> = {}) => {
    const db = reissueDb({ docs })
    const r = await startReissue(db, 10, 7, { ...portalFake().deps, ...extra })
    assert.equal(r.ok, false, code)
    assert.equal((r as any).code, code)
    assert.match((r as any).messageAr, /[؀-ۿ]/)
    assert.equal(ar7(db, 10).status, "partially_paid", "nothing changed")
    return r
  }
  // valid on the portal without a credit note
  const v = await refused([realDoc()], "not_reversed")
  assert.match((v as any).message, /still valid on the tax portal/)
  await refused([], "not_reversed")
  await refused([realDoc(), creditNote({ environment: "test" })], "not_reversed", {})
  await refused([realDoc(), creditNote({ status: "pending_signature" })], "credit_note_pending")
  await refused([realDoc(), creditNote({ status: "invalid" })], "not_reversed")
  // a cancellation the portal has not confirmed (the customer can still decline it)
  const waiting = portalFake({ getDetails: () => ({ status: "Valid", cancelRequestDate: "2026-11-15T10:00:00Z" }) })
  await refused([realDoc({ status: "cancelled", errors: [{ code: "CancelRequested" }] })], "cancel_not_confirmed", waiting.deps)
  assert.deepEqual(waiting.calls.getDetails, ["U1"])

  // a valid credit note: replaced, permits stay linked until the new invoice exists
  const db = reissueDb()
  assert.deepEqual(await startReissue(db, 10, 7), { ok: true })
  assert.equal(ar7(db, 10).status, "replaced")
  assert.equal(ar7(db, 10).collected_amount, 200, "payments wait on it for the new invoice")
  assert.deepEqual(db.tables.invoice_delivery_permits, [{ invoice_id: 10, permit_id: 1 }])
  assert.deepEqual(await openCorrection(db, { soId: 1 }), { oldInvoiceId: 10 })
  assert.deepEqual(await openCorrection(db, { permitId: 1 }), { oldInvoiceId: 10 })
  assert.equal(db.tables.workflow_events[0].event_type, "ETA_CORRECTION_STARTED")
  assert.equal((await startReissue(db, 10, 7) as any).code, "already_replaced")
  // a cancellation the portal confirms now
  const c = reissueDb({ docs: [realDoc({ status: "cancelled", errors: [{ code: "CancelRequested" }] })] })
  assert.deepEqual(await startReissue(c, 10, null, portalFake({ getDetails: () => ({ status: "Cancelled" }) }).deps), { ok: true })
  assert.equal(ar7(c, 10).status, "replaced")
  // not a sales invoice (maintenance: no order, no permits)
  const m = reissueDb()
  Object.assign(ar7(m, 10), { so_id: null })
  m.tables.invoice_delivery_permits = []
  assert.equal((await startReissue(m, 10, null) as any).code, "not_sales_invoice")
  assert.equal((await startReissue(m, 99, null) as any).code, "not_found")

  // the route: /api/eta (accountant; CEO / admin pass), plain errors with a code
  reissueDb({ docs: [realDoc()] })
  const no = await callRoute(reissueRoute7.POST, "POST", { invoiceId: 10 })
  assert.equal(no.status, 409)
  assert.equal(no.body.code, "not_reversed")
  assert.ok(no.body.errorAr)
  const yesDb = reissueDb()
  const ok = await callRoute(reissueRoute7.POST, "POST", { invoiceId: 10 })
  assert.equal(ok.status, 200)
  assert.equal(ar7(yesDb, 10).status, "replaced")
  const r = ruleFor("/api/eta/reissue")!
  assert.ok(allows(r, "POST", ["accountant"]) && allows(r, "POST", ["ceo"]) && allows(r, "POST", ["admin"]))
  assert.ok(!allows(r, "POST", ["sales-rep"]) && !allows(r, "POST", ["warehouse-rep"]))
})

test("F32. reissue, same customer with a part payment: payments, schedules and collected move in one step; links both ways; balance unchanged", async () => {
  const db = reissueDb()
  const before = await owes(db)
  assert.equal(before, 370)
  assert.deepEqual(await startReissue(db, 10, 7), { ok: true })
  // the old invoice no longer counts: its permit is not invoiced any more
  const state = await loadSoInvoicingState(db, 1)
  assert.deepEqual(state!.invoices, [])

  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.replacesInvoiceId, 10)
  assert.equal(db.calls["rpc:eta_reissue_invoice"], 1)
  const newId = res.body.invoices[0].invoice_id
  const fresh = ar7(db, newId)
  const old = ar7(db, 10)
  assert.equal(fresh.amount, 570)
  assert.equal(fresh.collected_amount, 200)
  assert.equal(fresh.status, "partially_paid")
  assert.equal(fresh.months_paid, 1)
  assert.equal(fresh.replaces_invoice_id, 10)
  assert.equal(old.replaced_by_invoice_id, newId)
  assert.equal(old.status, "replaced")
  assert.equal(old.collected_amount, 0)
  assert.deepEqual(db.tables.customer_payments.map((p) => p.invoice_id), [newId])
  assert.deepEqual(db.tables.payment_schedules.map((s) => s.invoice_id), [newId, 10], "the payable schedule is not touched")
  assert.deepEqual(db.tables.invoice_delivery_permits, [{ invoice_id: newId, permit_id: 1 }])
  assert.equal(db.tables.delivery_permits[0].invoice_id, newId)
  assert.equal(await owes(db), before, "customer balance unchanged")
  assert.equal(await openCorrection(db, { soId: 1 }), null, "the correction is closed")
  // the permit is invoiced again: no second invoice
  assert.equal((await createDpInvoices(db, [1])).status, 400)

  // the stand-in mirrors the SQL undo: everything back as it was before the reissue
  const u = reissueDb()
  await startReissue(u, 10, 7)
  const snap = mirror(u)
  const made = await createDpInvoices(u, [1])
  etaUndoReissue(u, { p_new: made.body.invoices[0].invoice_id, p_moved_permit_ids: [1] })
  assert.equal(mirror(u), snap)
  assert.throws(() => etaUndoReissue(u, { p_new: 10, p_moved_permit_ids: [] }), (e: any) => e.hint === "REISSUE_UNDO_REFUSED")
  // a refusal inside the function leaves every table as it was (one transaction)
  assert.throws(() => etaReissueInvoice(u, { p_old: 10, p_new_row: { invoice_number: "INV-X", amount: 1, customer_id: 5 }, p_permit_ids: [1] }), (e: any) => e.hint === "REISSUE_OVERPAID")
  assert.equal(mirror(u), snap)
  assert.throws(() => etaReissueInvoice(u, { p_old: 10, p_new_row: { invoice_number: "INV-2026-0010", amount: 570, customer_id: 5 }, p_permit_ids: [1] }), (e: any) => e.code === "23505")
  assert.equal(mirror(u), snap, "a taken number changes nothing")

  // more paid than the new amount: refused without a confirm (nothing changed); confirmed, the excess is customer credit
  const o = reissueDb()
  await startReissue(o, 10, 7)
  o.tables.delivery_permit_items[0].quantity = 1
  o.tables.delivery_permit_items[0].total = 100
  const untouched = mirror(o)
  const over = await createDpInvoices(o, [1])
  assert.equal(over.status, 409)
  assert.equal(over.body.code, "REISSUE_OVERPAID")
  assert.equal(over.body.excess, 86)
  assert.equal(mirror(o), untouched)
  const confirmed = await createDpInvoices(o, [1], null, { confirmOverpaid: true })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
  const paidInvoice = ar7(o, confirmed.body.invoices[0].invoice_id)
  assert.equal(paidInvoice.amount, 114)
  assert.equal(paidInvoice.collected_amount, 114)
  assert.equal(paidInvoice.status, "paid")
  const credit = o.tables.customer_credits[0]
  assert.equal(credit.amount, 86)
  assert.equal(credit.customer_id, 5)
  assert.equal(credit.credit_type, "overpayment")
  assert.equal(credit.status, "active")

  // a whole-order invoice is reissued as a whole-order invoice
  const w = reissueDb({ wholeOrder: true })
  await startReissue(w, 10, 7)
  const whole = await createSoInvoice(w, 1)
  assert.equal(whole.status, 200, JSON.stringify(whole.body))
  assert.equal(whole.body.replacesInvoiceId, 10)
  assert.equal(ar7(w, whole.body.invoice_id).collected_amount, 200)
  assert.equal(ar7(w, 10).replaced_by_invoice_id, whole.body.invoice_id)
  assert.deepEqual(w.tables.customer_payments.map((p) => p.invoice_id), [whole.body.invoice_id])
})

test("F33. reissue to a different customer: refused while the old invoice has payments (nothing changed); allowed without", async () => {
  const db = reissueDb()
  await startReissue(db, 10, 7)
  db.tables.sales_orders[0].customer_id = 6 // corrected on the sales order
  const snap = mirror(db)
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 409)
  assert.equal(res.body.code, "PAYMENTS_OTHER_CUSTOMER")
  assert.equal(res.body.error, "This invoice has payments from Acme Trading. Move or refund them first")
  assert.match(res.body.errorAr, /Acme Trading/)
  assert.equal(mirror(db), snap, "nothing changed")
  assert.deepEqual(await openCorrection(db, { permitId: 1 }), { oldInvoiceId: 10 }, "still open")

  const free = reissueDb({ paid: false })
  await startReissue(free, 10, 7)
  free.tables.sales_orders[0].customer_id = 6
  const ok = await createDpInvoices(free, [1])
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(ar7(free, ok.body.invoices[0].invoice_id).customer_id, 6)
  assert.equal(ar7(free, ok.body.invoices[0].invoice_id).status, "pending")
})

test("F34. correct delivery permit: stock moves by the difference; shortage, below-returned and outside a correction refused with no change", async () => {
  const db = reissueDb()
  // outside an open correction: refused, and the approved permit stays locked as before
  const closed = await correctPermit(db, 1, [{ permitItemId: 11, quantity: 3 }], 7)
  assert.equal((closed as any).code, "NOT_OPEN_CORRECTION")
  await startReissue(db, 10, 7)
  const reject = await callRoute(dpRoute7.PUT, "PUT", { permitId: "1", action: "REJECT", rejectionReason: "x" })
  assert.equal(reject.body.code, "DP_ALREADY_APPROVED", "approved permits stay locked everywhere else")

  // 5 -> 3: 2 back to stock
  const down = await correctPermit(db, 1, [{ permitItemId: 11, quantity: 3 }], 7)
  assert.equal(down.ok, true, JSON.stringify(down))
  assert.equal(db.tables.inventory[0].quantity, 4)
  assert.equal(db.tables.delivery_permit_items[0].quantity, 3)
  assert.equal(db.tables.delivery_permit_items[0].total, 300)
  const rec = db.tables.dp_corrections[0]
  assert.equal(rec.permit_id, 1)
  assert.equal(rec.invoice_id, 10)
  assert.equal(rec.created_by, 7)
  assert.deepEqual(rec.lines.map((l: any) => [l.before, l.after]), [[5, 3]])
  assert.deepEqual(rec.stock_moves.map((m: any) => [m.direction, m.quantity, m.before, m.after]), [["back", 2, 2, 4]])
  assert.match(db.tables.inventory_transactions[0].notes, /Correction for invoice INV-2026-0010/)
  // 3 -> 4: 1 out of stock
  assert.equal((await correctPermit(db, 1, [{ permitItemId: 11, quantity: 4 }], 7)).ok, true)
  assert.equal(db.tables.inventory[0].quantity, 3)
  // shortage: refused, nothing changed
  db.tables.inventory[0].quantity = 0
  let snap = mirror(db)
  const short = await correctPermit(db, 1, [{ permitItemId: 11, quantity: 6 }], 7)
  assert.equal((short as any).code, "INSUFFICIENT_STOCK")
  assert.equal(mirror(db), snap)
  db.tables.inventory[0].quantity = 3
  // a failure after the stock moved is undone
  db.failOn["dp_corrections:insert"] = "boom"
  snap = mirror(db)
  const failed = await correctPermit(db, 1, [{ permitItemId: 11, quantity: 2 }], 7)
  assert.equal(failed.ok, false)
  delete db.failOn["dp_corrections:insert"]
  assert.equal(mirror(db).replace(/"last_updated":"[^"]*",?/g, ""), snap.replace(/"last_updated":"[^"]*",?/g, ""))
  assert.equal(db.tables.delivery_permit_items[0].quantity, 4)

  // the route: accountant / CEO / admin only; refusals in plain words with a code
  const viaRoute = await callRoute(correctRoute7.POST, "POST", { permitId: 1, lines: [{ permitItemId: 11, quantity: 4 }] })
  assert.equal(viaRoute.body.code, "no_change")
  assert.ok(viaRoute.body.errorAr)
  const rule = ruleFor("/api/delivery-permits/correct")!
  assert.ok(allows(rule, "POST", ["accountant"]) && allows(rule, "POST", ["ceo"]) && allows(rule, "POST", ["admin"]))
  for (const role of ["sales-rep", "warehouse-rep", "shipment"] as const) assert.ok(!allows(rule, "POST", [role as any]), role)
  assert.ok(allows(ruleFor("/api/delivery-permits")!, "PUT", ["warehouse-rep"]), "the permits rule itself is unchanged")

  // the new invoice bills the corrected quantity; after it exists the permit is locked again
  const made = await createDpInvoices(db, [1])
  assert.equal(made.status, 200, JSON.stringify(made.body))
  assert.equal(made.body.invoices[0].amount, 456)
  assert.equal((await correctPermit(db, 1, [{ permitItemId: 11, quantity: 3 }], 7) as any).code, "NOT_OPEN_CORRECTION")

  // never below what was already returned
  const r = reissueDb()
  await startReissue(r, 10, 7)
  r.tables.product_returns.push({ return_id: 1, permit_id: "1", so_id: 1, status: "received", created_at: "2026-10-01T10:00:00Z" })
  r.tables.return_items.push({ return_item_id: 1, return_id: 1, product_id: 100, product_name: "Pump", returned_quantity: 2 })
  const below = await correctPermit(r, 1, [{ permitItemId: 11, quantity: 1 }], 7)
  assert.equal((below as any).code, "BELOW_RETURNED")
  assert.equal(r.tables.delivery_permit_items[0].quantity, 5)
  assert.equal(r.tables.inventory[0].quantity, 2)
  assert.equal((await correctPermit(r, 1, [{ permitItemId: 11, quantity: 2 }], 7)).ok, true)
  assert.equal(r.tables.inventory[0].quantity, 5)
})

test("F35. a return during an open correction creates no customer credit; after the new invoice, returns credit as today", async () => {
  const db = reissueDb()
  await startReissue(db, 10, 7)
  db.tables.product_returns.push({ return_id: 1, permit_id: "1", so_id: 1, so_number: "SO-7", status: "received", created_at: "2026-10-01T10:00:00Z" })
  db.tables.return_items.push({ return_item_id: 1, return_id: 1, product_id: 100, product_name: "Pump", returned_quantity: 1 })
  assert.equal(await creditInvoicedReturn(db, { return_id: 1, so_id: 1, permit_id: "1" }), null)
  assert.equal(db.tables.customer_credits.length, 0)
  // the new invoice simply bills less
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.invoices[0].amount, 456)
  // a later return: credited as today
  db.tables.product_returns.push({ return_id: 2, permit_id: "1", so_id: 1, so_number: "SO-7", status: "received", created_at: db.stamp() })
  db.tables.return_items.push({ return_item_id: 2, return_id: 2, product_id: 100, product_name: "Pump", returned_quantity: 1 })
  assert.deepEqual(await creditInvoicedReturn(db, { return_id: 2, so_id: 1, permit_id: "1" }), { amount: 114 })
  assert.equal(db.tables.customer_credits.length, 1)
})

test("F36. sales-order edit: allowed with an open correction, refused as today without one", async () => {
  const line = (extra: Row = {}) => ({ id: "1", productId: "100", productName: "Pump", quantity: 5, unitPrice: 100, total: 500, ...extra })
  // without a correction: the permitted line and the customer are locked
  const db = reissueDb()
  let r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [line({ unitPrice: 90, total: 450 })] })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /is on a delivery permit/)
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6 })
  assert.equal(r.status, 409)
  assert.equal(db.tables.sales_orders[0].customer_id, 5)
  assert.equal(db.tables.sales_order_items[0].unit_price, 100)

  // with an open correction: price and customer can be corrected; the permits follow the customer
  await startReissue(db, 10, 7)
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6, items: [line({ unitPrice: 90, total: 450 })] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.tables.sales_order_items[0].unit_price, 90)
  assert.equal(db.tables.sales_orders[0].customer_id, 6)
  assert.equal(db.tables.delivery_permits[0].customer_id, 6)
  // still never below what the customer keeps, and a kept line can't be removed
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [line({ quantity: 4, total: 400 })] })
  assert.equal(r.status, 409)
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [] })
  assert.equal(r.status, 409)
})

// ---- F37-F39: reissue keeps order, permits and prints consistent (rulings P11-P13) ----
import { dpInvoiceEtaLines } from "../invoicing"
import * as arPdf7 from "../../app/api/invoices/ar/[id]/pdf/route"
import * as arPdf7b from "../../app/api/invoices/ar/[id]/[invoiceId]/pdf/route"

test("F37. a price or name corrected on the order during an open correction reaches the permit lines and the new invoice; not otherwise", async () => {
  const line = (extra: Row = {}) => ({ id: "1", productId: "100", productName: "Pump", quantity: 5, unitPrice: 100, total: 500, ...extra })
  // no open correction: a name sent with the order leaves the permit lines as they are
  const plain = reissueDb()
  let r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [line({ productName: "Pump Mk2" })] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([plain.tables.delivery_permit_items[0].item_name_snapshot, plain.tables.delivery_permit_items[0].unit_price, plain.tables.delivery_permit_items[0].total], ["Pump", 100, 500])

  // open correction: price 100 -> 90 and the name follow onto DP-7-1
  const db = reissueDb()
  await startReissue(db, 10, 7)
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [line({ productName: "Pump Mk2", unitPrice: 90, total: 450 })] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const permitLine = db.tables.delivery_permit_items[0]
  assert.deepEqual([permitLine.item_name_snapshot, permitLine.unit_price, permitLine.total, permitLine.quantity], ["Pump Mk2", 90, 450, 5])
  const made = await createDpInvoices(db, [1])
  assert.equal(made.status, 200, JSON.stringify(made.body))
  assert.equal(made.body.invoices[0].amount, 513, "5 x 90 + 14 %")
  const billed = dpInvoiceEtaLines((await loadSoInvoicingState(db, 1))!, [1])
  assert.deepEqual(billed.map((l) => [l.name, l.quantity, l.unitPrice]), [["Pump Mk2", 5, 90]])

  // the same item twice on the order at two prices: the permit lines can't tell them apart -> refused, nothing written
  const two = reissueDb()
  await startReissue(two, 10, 7)
  two.tables.sales_order_items.push({ so_item_id: 2, so_id: 1, product_id: 100, outsourced_name: null, quantity: 1, unit_price: 100, total: 100, item_type: "stock" })
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [line({ unitPrice: 90, total: 450 }), line({ id: "2", quantity: 1, unitPrice: 95, total: 95 })] })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /more than once with different prices/)
  assert.equal(two.tables.sales_order_items[0].unit_price, 100)
  assert.equal(two.tables.delivery_permit_items[0].unit_price, 100)
})

const SENT_BODY = JSON.stringify({
  internalID: "INV-2026-0010",
  invoiceLines: [{ description: "Pump as sent", quantity: 5, unitValue: { currencySold: "EGP", amountEGP: 100 }, salesTotal: 500, netTotal: 500, total: 570 }],
  netAmount: 500, taxTotals: [{ taxType: "T1", amount: 70 }], totalAmount: 570,
})

test("F38. a replaced invoice prints from its sent e-invoice with 'Replaced by'; without a snapshot, the header and the note only", async () => {
  const pdf = async (id: number) => (await arPdf7.GET(rq("GET", `/api/invoices/ar/${id}/pdf`), { params: Promise.resolve({ id: String(id) }) })).text()
  const pdf2 = async (id: number) => (await arPdf7b.GET(new Request("http://test.local/x"), { params: Promise.resolve({ invoiceId: String(id) }) })).text()
  const db = reissueDb({ docs: [realDoc({ document: SENT_BODY }), creditNote()] })
  await startReissue(db, 10, 7)
  // open correction: printed from the snapshot, no new number yet
  let html = await pdf(10)
  assert.match(html, /Pump as sent/)
  assert.match(html, /the corrected invoice has not been created yet/)
  const made = await createDpInvoices(db, [1])
  const newNumber = made.body.invoices[0].invoice_number
  html = await pdf(10)
  assert.ok(html.includes(`Replaced by ${newNumber}`), "Replaced by (EN)")
  assert.ok(html.includes(`استُبدلت بالفاتورة ${newNumber}`), "Replaced by (AR)")
  assert.match(html, /Pump as sent/)
  assert.ok(!html.includes("DP-7-1"), "the moved permit is not listed")
  assert.ok(html.includes("570"), "the sent total")
  const html2 = await pdf2(10)
  assert.ok(html2.includes(`Replaced by ${newNumber}`))
  assert.match(html2, /Pump as sent/)
  // the new invoice prints normally (its permit, no note)
  const fresh = await pdf(made.body.invoices[0].invoice_id)
  assert.ok(!fresh.includes("Replaced by") && !fresh.includes("Pump as sent"))
  assert.ok(!(await pdf2(made.body.invoices[0].invoice_id)).includes("Replaced"))

  // no snapshot: header and note, no lines
  const bare = reissueDb()
  await startReissue(bare, 10, 7)
  const done = await createDpInvoices(bare, [1])
  html = await pdf(10)
  assert.ok(html.includes(`Replaced by ${done.body.invoices[0].invoice_number}`))
  assert.ok(!html.includes(">Pump<"), "no lines")
  assert.ok(!(await pdf2(10)).includes(">Pump<"))
})

test("F39. everything of a corrected invoice returned: nothing left to invoice, payments stay on the replaced invoice", async () => {
  const returnAll = (db: FakeDb) => {
    db.tables.product_returns.push({ return_id: 1, permit_id: "1", so_id: 1, status: "received", created_at: "2026-10-01T10:00:00Z" })
    db.tables.return_items.push({ return_item_id: 1, return_id: 1, product_id: 100, product_name: "Pump", returned_quantity: 5 })
  }
  const db = reissueDb()
  await startReissue(db, 10, 7)
  returnAll(db)
  const snap = mirror(db)
  const r = await createDpInvoices(db, [1])
  assert.equal(r.status, 409)
  assert.equal(r.body.code, "REISSUE_NOTHING_LEFT")
  assert.match(r.body.error, /Nothing is left to invoice: every item of INV-2026-0010 was returned\. Its payments stay on the replaced invoice INV-2026-0010; refund them or keep them as the customer's credit/)
  assert.match(r.body.errorAr, /[؀-ۿ]/)
  assert.equal(mirror(db), snap)
  assert.equal(db.tables.customer_payments[0].invoice_id, 10)
  // whole-order invoice: the same message
  const w = reissueDb({ wholeOrder: true })
  await startReissue(w, 10, 7)
  returnAll(w)
  const s = await createSoInvoice(w, 1)
  assert.equal(s.status, 409)
  assert.equal(s.body.code, "REISSUE_NOTHING_LEFT")
  // without a correction the old message stays
  const n = reissueDb({ paid: false })
  n.tables.accounts_receivable = []
  n.tables.invoice_delivery_permits = []
  returnAll(n)
  const plain = await createDpInvoices(n, [1])
  assert.equal(plain.status, 409)
  assert.match(plain.body.error, /^Nothing to invoice/)
})

// ---- F40-F42: no double-counted return credits; order edits scoped to the correction (rulings P14-P16) ----
const returned7 = (db: FakeDb, returnId: number, qty: number, at: string) => {
  db.tables.product_returns.push({ return_id: returnId, permit_id: "1", so_id: 1, so_number: "SO-7", status: "received", created_at: at })
  db.tables.return_items.push({ return_item_id: returnId, return_id: returnId, product_id: 100, product_name: "Pump", returned_quantity: qty })
}

test("F40. a return credited before the correction is settled by the reissue (owes 142, not -86); a used return credit refuses it", async () => {
  const db = reissueDb()
  db.clock = Date.parse("2026-11-16T10:00:00Z")
  returned7(db, 1, 2, "2026-11-05T10:00:00Z")
  assert.deepEqual(await creditInvoicedReturn(db, { return_id: 1, so_id: 1, permit_id: "1" }), { amount: 228 })
  assert.equal(await owes(db), 142)
  await startReissue(db, 10, 7)
  const snap = mirror(db)
  const made = await createDpInvoices(db, [1])
  assert.equal(made.status, 200, JSON.stringify(made.body))
  const newId = made.body.invoices[0].invoice_id
  assert.equal(made.body.invoices[0].amount, 342, "3 kept units")
  assert.equal(await owes(db), 142, "the return is counted once")
  const credit = db.tables.customer_credits[0]
  assert.deepEqual([credit.status, credit.used_in_invoice_id, credit.amount], ["used", newId, 228])
  assert.match(credit.notes, /Settled by corrected invoice/)
  // the stand-in's undo gives the credit back
  etaUndoReissue(db, { p_new: newId, p_moved_permit_ids: [1] })
  assert.deepEqual([db.tables.customer_credits[0].status, db.tables.customer_credits[0].used_in_invoice_id, db.tables.customer_credits[0].notes], ["active", null, null])
  assert.equal(JSON.stringify(db.tables.accounts_receivable), JSON.stringify(JSON.parse(snap).accounts_receivable))

  // the return credit was already applied (in part) to an invoice: refused, nothing changed
  const used = reissueDb()
  used.clock = Date.parse("2026-11-16T10:00:00Z")
  returned7(used, 1, 2, "2026-11-05T10:00:00Z")
  await creditInvoicedReturn(used, { return_id: 1, so_id: 1, permit_id: "1" })
  Object.assign(used.tables.customer_credits[0], { status: "used", amount: 100, used_in_invoice_id: 10 })
  used.tables.customer_credits.push({ ...used.tables.customer_credits[0], credit_id: 99, status: "active", amount: 128, used_in_invoice_id: null })
  await startReissue(used, 10, 7)
  const before = mirror(used)
  const refused = await createDpInvoices(used, [1])
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, "REISSUE_RETURN_CREDIT_USED")
  assert.equal(refused.body.error, "A return credit from this invoice was already used. Un-apply it first.")
  assert.match(refused.body.errorAr, /[؀-ۿ]/)
  assert.equal(mirror(used), before)
})

// SO 1 split: DP-1 (Pump) on the corrected INV-2026-0010, DP-2 (Belt) on the live INV-2026-0011
function splitDb() {
  const db = reissueDb()
  db.tables.sales_order_items.push({ so_item_id: 2, so_id: 1, product_id: 101, outsourced_name: null, quantity: 1, unit_price: 50, total: 50, item_type: "stock" })
  db.tables.delivery_permits.push({ permit_id: 2, permit_no: "DP-7-2", sales_order_id: 1, customer_id: 5, status: "APPROVED", invoice_id: 11 })
  db.tables.delivery_permit_items.push({ item_id: 12, permit_id: 2, product_id: 101, item_name_snapshot: "Belt", quantity: 1, unit_price: 50, total: 50, warehouse_id: 1 })
  db.tables.accounts_receivable.push({ ...db.tables.accounts_receivable[0], invoice_id: 11, invoice_number: "INV-2026-0011", amount: 57, collected_amount: 0, balance: 57, months_paid: 0, status: "pending", source_delivery_permit_id: 2 })
  db.tables.invoice_delivery_permits.push({ invoice_id: 11, permit_id: 2 })
  return db
}

test("F41. order edits during a correction: only the correction's lines; no customer change while another invoice counts; the permits' customer moves all or nothing", async () => {
  const pump = (extra: Row = {}) => ({ id: "1", productId: "100", productName: "Pump", quantity: 5, unitPrice: 100, total: 500, ...extra })
  const belt = (extra: Row = {}) => ({ id: "2", productId: "101", productName: "Belt", quantity: 1, unitPrice: 50, total: 50, ...extra })
  const db = splitDb()
  await startReissue(db, 10, 7)
  // the Belt is billed by the live INV-2026-0011: locked
  let r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [pump(), belt({ unitPrice: 40, total: 40 })] })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /"Belt" is on a delivery permit/)
  assert.equal(db.tables.delivery_permit_items[1].unit_price, 50)
  // the customer can't move while INV-2026-0011 still counts
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6 })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /INV-2026-0011/)
  assert.deepEqual(db.tables.delivery_permits.map((p) => p.customer_id), [5, 5])
  assert.equal(db.tables.sales_orders[0].customer_id, 5)
  // the Pump sits only on the correction's DP-1: it can be corrected
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", items: [pump({ unitPrice: 90, total: 450 }), belt()] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(db.tables.delivery_permit_items.map((i) => i.unit_price), [90, 50])

  // the permits can't follow the new customer: refused, nothing changed
  const m = reissueDb()
  await startReissue(m, 10, 7)
  m.failOn["delivery_permits:update"] = "boom"
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6 })
  assert.equal(r.status, 500)
  assert.equal(r.body.code, "PERMIT_CUSTOMER_NOT_MOVED")
  assert.equal(m.tables.sales_orders[0].customer_id, 5)
  assert.equal(m.tables.delivery_permits[0].customer_id, 5)
  // the order itself fails after the permits moved: they move back
  const o = reissueDb()
  await startReissue(o, 10, 7)
  o.failOn["sales_orders:update"] = "boom"
  r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6 })
  assert.equal(r.status, 500)
  assert.equal(o.tables.sales_orders[0].customer_id, 5)
  assert.equal(o.tables.delivery_permits[0].customer_id, 5)
})

test("F42. whole-order and permit invoices are reissued the same way; a correction that can't be undone says so", async () => {
  // a delivery-permit invoice is not reissued as a whole-order invoice
  const dp = reissueDb()
  await startReissue(dp, 10, 7)
  const so = await createSoInvoice(dp, 1)
  assert.equal(so.status, 409)
  assert.equal(so.body.code, "REISSUE_USE_PERMITS")
  assert.equal(ar7(dp, 10).replaced_by_invoice_id, null)
  // a whole-order invoice reissued from permits takes every permit of the order
  const w = reissueDb({ wholeOrder: true })
  Object.assign(w.tables.sales_order_items[0], { quantity: 6, total: 600 })
  Object.assign(w.tables.sales_orders[0], { total: 684, subtotal: 600 })
  w.tables.delivery_permits.push({ permit_id: 2, permit_no: "DP-7-2", sales_order_id: 1, customer_id: 5, status: "APPROVED", invoice_id: null })
  w.tables.delivery_permit_items.push({ item_id: 12, permit_id: 2, product_id: 100, item_name_snapshot: "Pump", quantity: 1, unit_price: 100, total: 100, warehouse_id: 1 })
  await startReissue(w, 10, 7)
  const part = await createDpInvoices(w, [1])
  assert.equal(part.status, 409)
  assert.equal(part.body.code, "REISSUE_MISSING_PERMITS")
  assert.match(part.body.error, /DP-7-2/)
  assert.throws(() => etaReissueInvoice(w, { p_old: 10, p_new_row: { invoice_number: "INV-Y", amount: 570, customer_id: 5 }, p_permit_ids: [1] }), (e: any) => e.hint === "REISSUE_MISSING_PERMITS")
  const all = await createDpInvoices(w, [1, 2])
  assert.equal(all.status, 200, JSON.stringify(all.body))
  assert.equal(all.body.replacesInvoiceId, 10)

  // correctPermit: the permit line can't be put back after a failure -> partial failure, never "nothing was changed"
  const c = reissueDb()
  await startReissue(c, 10, 7)
  c.failOn["dp_corrections:insert"] = "boom"
  c.failOn["delivery_permit_items:update"] = "boom"
  c.failAfter["delivery_permit_items:update"] = 1
  const res = await correctPermit(c, 1, [{ permitItemId: 11, quantity: 3 }], 7)
  assert.equal(res.ok, false)
  assert.equal((res as any).code, "partial_failure")
  assert.ok(!/Nothing was changed/.test((res as any).message), (res as any).message)
  assert.match((res as any).message, /permit quantities/)
})

test("F43. an invoice can be corrected more than once: settled return credits don't block it or count as payments", async () => {
  const reverse = (db: FakeDb, id: number) => {
    db.tables.eta_documents.push(realDoc({ doc_id: 100 + id, invoice_id: id, eta_uuid: `U${id}` }), creditNote({ doc_id: 200 + id, invoice_id: id, eta_uuid: `C${id}` }))
  }
  // paid: 570, 200 paid, 2 returned (228 credit) -> B bills 342 -> corrected again -> C bills 342; owes 142 throughout
  const db = reissueDb()
  db.clock = Date.parse("2026-11-16T10:00:00Z")
  returned7(db, 1, 2, "2026-11-05T10:00:00Z")
  await creditInvoicedReturn(db, { return_id: 1, so_id: 1, permit_id: "1" })
  await startReissue(db, 10, 7)
  const b = (await createDpInvoices(db, [1])).body.invoices[0].invoice_id
  assert.equal(db.tables.customer_credits[0].reference_type, "product_return_settled")
  reverse(db, b)
  assert.deepEqual(await startReissue(db, b, 7), { ok: true })
  const second = await createDpInvoices(db, [1])
  assert.equal(second.status, 200, JSON.stringify(second.body))
  const c = second.body.invoices[0].invoice_id
  assert.equal(ar7(db, c).amount, 342)
  assert.equal(ar7(db, c).collected_amount, 200)
  assert.equal(ar7(db, b).replaced_by_invoice_id, c)
  assert.equal(await owes(db), 142)
  assert.equal(db.tables.customer_credits[0].used_in_invoice_id, b, "settled by B; it does not move with the payments")
  // a later return is credited as today (the settled credit no longer counts as "already credited")
  returned7(db, 2, 1, db.stamp())
  assert.deepEqual(await creditInvoicedReturn(db, { return_id: 2, so_id: 1, permit_id: "1" }), { amount: 114 })
  assert.equal(await owes(db), 28)

  // nobody paid: the second correction may change the customer
  const free = reissueDb({ paid: false })
  free.clock = Date.parse("2026-11-16T10:00:00Z")
  returned7(free, 1, 2, "2026-11-05T10:00:00Z")
  await creditInvoicedReturn(free, { return_id: 1, so_id: 1, permit_id: "1" })
  await startReissue(free, 10, 7)
  const fb = (await createDpInvoices(free, [1])).body.invoices[0].invoice_id
  reverse(free, fb)
  await startReissue(free, fb, 7)
  const r = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const fc = await createDpInvoices(free, [1])
  assert.equal(fc.status, 200, JSON.stringify(fc.body))
  assert.equal(ar7(free, fc.body.invoices[0].invoice_id).customer_id, 6)

  // the order can't be saved and a permit can't be moved back: the answer says the edit was only partly undone
  const p = reissueDb()
  await startReissue(p, 10, 7)
  p.failOn["sales_orders:update"] = "boom"
  p.failOn["delivery_permits:update"] = "boom"
  p.failAfter["delivery_permits:update"] = 1
  const partly = await callRoute(soRoute7.PUT, "PUT", { so_id: 1, notes: "edit", customerId: 6 })
  assert.equal(partly.status, 500)
  assert.equal(partly.body.code, "PARTIALLY_UNDONE")
  assert.equal(partly.body.partialFailure, true)
  assert.match(partly.body.error, /only partly undone/)
})
