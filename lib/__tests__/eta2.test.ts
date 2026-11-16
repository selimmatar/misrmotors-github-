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
  const rest = noComments.replace(/do\s+\$\$([\s\S]*?)\$\$\s*;/gi, (_m, body: string) => { blocks.push(flat(body)); return ";" })
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
  assert.ok(!/eta_link_reissue/.test(lower), "eta_link_reissue belongs to a later task")

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
function portalFake(opts: { submit?: (docs: string[], n: number) => any; getSubmission?: (uuid: string, n: number) => any; getDetails?: (uuid: string) => any; searchSent?: (p: { internalId: string; from: string; to: string }) => any } = {}) {
  const calls = { submit: [] as string[][], getSubmission: [] as string[], getDetails: [] as string[], searchSent: [] as { internalId: string; from: string; to: string }[] }
  const portal: EtaPortal = {
    async submit(docs) { calls.submit.push(docs); return opts.submit ? opts.submit(docs, calls.submit.length) : { submissionUUID: "SUB1", acceptedDocuments: docs.map((d, i) => ({ uuid: `UUID${i}`, longId: `LONG${i}`, internalId: JSON.parse(d).internalID })), rejectedDocuments: [] } },
    async getSubmission(uuid) { calls.getSubmission.push(uuid); return opts.getSubmission ? opts.getSubmission(uuid, calls.getSubmission.length) : { overallStatus: "InProgress", documentSummary: [] } },
    async getDetails(uuid) { calls.getDetails.push(uuid); return opts.getDetails ? opts.getDetails(uuid) : {} },
    async cancel() { throw new Error("no") }, async searchReceived() { throw new Error("no") },
    async searchSent(p) { calls.searchSent.push(p); return opts.searchSent ? opts.searchSent(p) : { result: [] } },
    async printout() { throw new Error("no") }, async documentType() { throw new Error("no") },
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
