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
