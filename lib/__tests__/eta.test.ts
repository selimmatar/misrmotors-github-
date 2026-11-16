// E-invoice (Egyptian Tax Authority) step 1.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeName, coreName, similarity, DEFAULT_BRANDS } from "../eta/normalize"
import { matchCode, prepareRowsToPost, chunk, PREPARE_BATCH, type EtaCode, type MemoryRow } from "../eta/codes"
import { etaLines, etaTolerance, isAfterGoLive, type EtaLineIn } from "../eta/totals"
import { FakeDb, type Row } from "./fake-db"
import { cannedDb, nreq } from "./hardening-fixtures"
import { useDb } from "./route-harness"
import * as etaSettingsRoute from "../../app/api/eta/settings/route"
import * as genericSettingsRoute from "../../app/api/settings/route"
import * as etaCodesRoute from "../../app/api/eta/codes/route"
import * as etaMemoryRoute from "../../app/api/eta/memory/route"
import * as etaPrepareRoute from "../../app/api/eta/memory/prepare/route"
import { GOVERNORATES, cleanTaxNumber, cleanNationalId } from "../eta/egypt"
import * as customersRoute from "../../app/api/customers/route"
import * as suppliersRoute from "../../app/api/suppliers/route"
import * as productsRoute from "../../app/api/products/route"
import { loadMatchContext as loadEtaCtx } from "../eta/store"
import { buildEtaPreview } from "../eta/preview"
import * as etaPreviewRoute from "../../app/api/eta/preview/route"
import { ruleFor, allows } from "../auth/permissions"
import { ROLE_MODULES } from "../../components/layout/nav-config"
import { MODULE_GROUP } from "../nav-groups"
import { canSetGoLive, goLiveDate as goLiveOf } from "../eta/go-live"
import * as arPdf from "../../app/api/invoices/ar/[id]/pdf/route"
import { moneyCell } from "../print-html"
import {
  computeInvoiceAmount, computeWholeOrderAmount, createDpInvoices, createSoInvoice, dpInvoicePrintTotals, evaluateDpInvoice,
  etaCheckTolerance, etaGoLiveWarning, invoicedTotalForOrder, loadEtaGoLiveAt, loadSoInvoicingState, netInvoiceValue, orderTotalAfterReturns, round2,
  soDiscountBase,
} from "../invoicing"
import { syncSalesOrderNetTotal } from "../so-edit"

test("E1. the step-1 migration only adds", () => {
  const sql = readFileSync(join(process.env.REPO_ROOT || process.cwd(), "scripts/sql/2026-11-15-eta-step1.sql"), "utf8")
  const statements = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
  assert.ok(statements.length > 0)
  for (const s of statements) {
    assert.ok(!/^(drop|update|delete|truncate)\b/.test(s), `destructive statement: ${s.slice(0, 60)}`)
    assert.ok(!/^alter table\b.*\b(drop|rename)\b/.test(s), `alter drop/rename: ${s.slice(0, 60)}`)
  }
  const lower = sql.toLowerCase()
  const columns = [
    "eta_receiver_type", "tax_registration_number", "national_id", "address_governorate", "address_region",
    "address_street", "address_building_number", "eta_code_id", "eta_unit_type",
  ]
  for (const c of columns) assert.ok(new RegExp(`add column if not exists ${c}\\b`).test(lower), `missing add column ${c}`)
  // tax_registration_number is added to both customers and suppliers (10 columns in total)
  assert.equal((lower.match(/add column if not exists tax_registration_number\b/g) || []).length, 2)
  for (const t of ["eta_item_codes", "eta_code_memory", "eta_documents"]) {
    assert.ok(lower.includes(`create table if not exists public.${t}`), `missing table ${t}`)
    assert.ok(new RegExp(`alter table public\\.${t} enable row level security`).test(lower), `missing RLS ${t}`)
  }
})

test("E2. normalise", () => {
  assert.equal(normalizeName("ترولى عده  Stanley"), normalizeName("ترولي عدة stanley"))
  assert.equal(normalizeName("لقمة ١٧"), "لقمه 17")
  assert.equal(normalizeName("لقمة ۱۷"), "لقمه 17")
  assert.equal(normalizeName("مــفـتَاح"), "مفتاح")
  assert.equal(normalizeName("3/8 - Bosch!"), "3/8 bosch")
})

test("E3. core name", () => {
  assert.equal(coreName(normalizeName("ترولي عدة Stanley 7 درج"), DEFAULT_BRANDS), "ترولي عده")
  assert.equal(coreName(normalizeName("طقم لقم 3/8"), DEFAULT_BRANDS), "طقم لقم")
  assert.equal(coreName(normalizeName("Stanley"), DEFAULT_BRANDS), "")
  assert.equal(coreName(normalizeName("King Tony مفك"), DEFAULT_BRANDS), "مفك")
  assert.equal(coreName(normalizeName("مفك صليبة كبير دق"), DEFAULT_BRANDS), "مفك صليبه دق")
  assert.equal(similarity("abc", "abc"), 1)
  assert.equal(similarity("a", "b"), 0)
})

test("E4. match order", () => {
  const HAND = 1, GARAGE = 2, POWER = 3
  const codes: EtaCode[] = [
    { codeId: HAND, itemCode: "H", name: "Hand tools", keywords: ["لقمة", "مفك", "بنسة"], defaultUnit: "EA", active: true },
    { codeId: GARAGE, itemCode: "G", name: "Garage", keywords: ["ترولي", "باتيناج"], defaultUnit: "EA", active: true },
    { codeId: POWER, itemCode: "P", name: "Power", keywords: ["دريل"], defaultUnit: "EA", active: true },
  ]
  const row = (name: string, codeId: number, unitType = "EA"): MemoryRow => {
    const n = normalizeName(name)
    return { normalizedName: n, coreName: coreName(n, DEFAULT_BRANDS), codeId, unitType }
  }
  const memory = [row("ترولي عدة", GARAGE, "SET")]
  const ctx = { codes, memory, brands: DEFAULT_BRANDS }
  const m = (name: string, extra = {}, c = ctx) => matchCode({ name, ...extra }, c)

  assert.deepEqual(m("ترولى عده Stanley"), { codeId: GARAGE, unit: "SET", state: "green", by: "core" })
  assert.deepEqual(m("ترولي عدة"), { codeId: GARAGE, unit: "SET", state: "green", by: "memory" })
  const close = m("تروللي عدة")
  assert.deepEqual([close.codeId, close.state, close.by], [GARAGE, "green", "close"])
  const kw = m("لقمة 19 تصادمية")
  assert.deepEqual([kw.codeId, kw.state, kw.by], [HAND, "orange", "keyword"])
  assert.deepEqual(m("شيء جديد"), { codeId: null, unit: "EA", state: "red", by: "none" })
  const prod = m("x", { productCodeId: HAND })
  assert.deepEqual([prod.codeId, prod.state, prod.by], [HAND, "green", "product"])
  assert.equal(m("x", { productCodeId: HAND, productUnit: "BOX" }).unit, "BOX")
  const inactive = { ...ctx, codes: codes.map((c) => (c.codeId === HAND ? { ...c, active: false } : c)) }
  assert.equal(m("x", { productCodeId: HAND }, inactive).state, "red")
  assert.equal(m("لقمة 19", {}, inactive).state, "red")
  // empty core never matched by core
  const empty = m("Stanley", {}, { ...ctx, memory: [...memory, row("Stanley", POWER)].filter((r) => r.normalizedName !== "stanley") })
  assert.deepEqual([empty.codeId, empty.state, empty.by], [null, "red", "none"])
  // core conflict
  const conflict = { ...ctx, memory: [row("طقم لقم", HAND), row("طقم لقم 3/8", POWER)] }
  const c = m("طقم لقم كبير", {}, conflict)
  assert.deepEqual([c.codeId, c.state, c.by], [POWER, "orange", "core"])
  const c2 = m("طقم لقم 1/2", {}, conflict) // core "طقم لقم", two codes
  assert.deepEqual([c2.codeId, c2.state, c2.by], [POWER, "orange", "core"])
})

// ---------------------------------------------------------------------------------------------------------
// Task 3: per-line totals (spec §6) and the go-live switch
// ---------------------------------------------------------------------------------------------------------
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const L = (name: string, quantity: number, unitPrice: number): EtaLineIn => ({ name, quantity, unitPrice })

// Al Kasrawy, entered 2026-11-15 from the paper invoices (discount 0, 14 % VAT on every line).
const AGOUZA: EtaLineIn[] = [
  L("كشاف", 4, 1800), L("يد عزم كبيرة", 4, 4380), L("لقمة 16 بوجيهات", 4, 420), L("لقمة 17 سودة تصادمية", 10, 360),
  L("لقمة 19 تصادمية سودة", 4, 420), L("طقم لقم 3/8", 1, 3840), L("لافية", 1, 1020), L("كفر رفرف", 2, 1800),
  L("مفتاح 14 بناحية", 1, 252), L("مفك صليبة كبير دق", 2, 540), L("كوباية فلتر زيت", 8, 600), L("وصلة كردان", 2, 1140),
  L("دريل", 3, 10800), L("مفك عادة دق", 4, 540), L("مفك صليبة بطيخة", 1, 210), L("مفك عادة بطيخة", 1, 210),
  L("يد سيستم 3/8", 2, 780), L("لقمة 10 طويلة تصادمية", 2, 252), L("طقم مفكات", 1, 780), L("بنسة كوليهات", 4, 1020),
  L("كاميرا جيروسكوب", 1, 5520), L("كابلات توصيلة بطارية", 1, 900), L("مشبك بطارية وسط", 1, 180), L("لقمة تروكس 3/8", 2, 200),
]
const ABU_RAWASH: EtaLineIn[] = [
  L("تزكة عدة", 2, 23760), L("عربيه مصفه تجميع مياه تبريد", 2, 14200), L("باتيناج هيدروليكي لتحريك السيارات مقاس 12 بوصة", 4, 10200),
  L("ثيرموميتر حرارة", 2, 1560), L("بيتته غسيل (مسدس غسيل)", 2, 900),
]

test("E5. etaLines", () => {
  assert.equal(AGOUZA.length, 24)
  const ag = etaLines(AGOUZA, 0)
  assert.deepEqual([ag.totals.net, ag.totals.vat, ag.totals.total], [97456, 13643.84, 111099.84])
  assert.equal(ag.lines.length, 24)
  const ar = etaLines(ABU_RAWASH, 0)
  assert.deepEqual([ar.totals.net, ar.totals.vat, ar.totals.total], [121640, 17029.6, 138669.6])

  // 10 % discount: VAT per line (rounded) differs from VAT on the total
  const lines = [L("a", 3, 33.35), L("b", 1, 17.45), L("c", 7, 12.15)]
  const out = etaLines(lines, 0.1)
  const perLineVat = r2(out.lines.reduce((s, l) => s + r2(l.netTotal * 0.14), 0))
  const totalLevelVat = r2(out.lines.reduce((s, l) => s + l.netTotal, 0) * 0.14)
  assert.equal(out.totals.vat, perLineVat)
  assert.equal(out.totals.vat, 25.53)
  assert.ok(Math.abs(out.totals.vat - totalLevelVat) >= 0.01 - 1e-9, `${out.totals.vat} vs ${totalLevelVat}`)
  // each line: sales, discount, net, VAT, total rounded to 2 decimals; totals = sums of the rounded line values
  assert.deepEqual(out.lines[0], { name: "a", quantity: 3, unitPrice: 33.35, salesTotal: 100.05, discount: 10.01, netTotal: 90.04, vat: 12.61, total: 102.65 })
  assert.equal(out.totals.sales, r2(out.lines.reduce((s, l) => s + l.salesTotal, 0)))
  assert.equal(out.totals.discount, r2(out.lines.reduce((s, l) => s + l.discount, 0)))
  assert.equal(out.totals.total, r2(out.lines.reduce((s, l) => s + l.total, 0)))
  assert.equal(out.totals.total, r2(out.totals.net + out.totals.vat))
  // lines with quantity <= 0 are dropped; a 0-priced line stays as a 0 line
  const dropped = etaLines([L("x", 0, 10), L("y", -1, 10), L("z", 2, 0), L("w", 1, 10)], 0)
  assert.deepEqual(dropped.lines.map((l) => l.name), ["z", "w"])
  assert.equal(dropped.totals.total, 11.4)

  // the switch and the tolerance
  assert.equal(isAfterGoLive("2026-12-01T10:00:00Z", ""), false)
  assert.equal(isAfterGoLive("2026-12-01T10:00:00Z", null), false)
  assert.equal(isAfterGoLive("2026-12-01T10:00:00Z", undefined), false)
  assert.equal(isAfterGoLive("2026-12-01T10:00:00Z", "not a date"), false)
  assert.equal(isAfterGoLive("2026-12-01T10:00:00Z", "2026-12-01T00:00:00Z"), true)
  assert.equal(isAfterGoLive("2026-12-01T00:00:00Z", "2026-12-01T00:00:00Z"), true)
  assert.equal(isAfterGoLive("2026-11-30T23:59:59Z", "2026-12-01T00:00:00Z"), false)
  assert.equal(isAfterGoLive("2026-12-01 10:00:00+00", "2026-12-01T00:00:00Z"), true) // Postgres timestamp text
  assert.equal(isAfterGoLive(null, "2026-12-01T00:00:00Z"), false)
  assert.equal(etaTolerance(0), 0.05)
  assert.equal(etaTolerance(5), 0.05)
  assert.equal(etaTolerance(30), 0.3)
})

// A sales order with `lines` ([qty, unitPrice]); one APPROVED permit per `permitQty` entry, delivering that quantity
// of every line ("all" = the line's ordered quantity).
function etaDb(lines: [number, number][], permitQty: (number | "all")[], opts: { goLive?: string | null; discount?: number; extraSettings?: Row[] } = {}) {
  const gross = lines.reduce((s, [q, p]) => s + q * p, 0)
  const discount = opts.discount || 0
  const settings: Row[] = [...(opts.extraSettings || [])]
  if (opts.goLive !== undefined) settings.push({ setting_key: "eta_go_live_at", setting_value: opts.goLive })
  return new FakeDb({
    sales_orders: [{ so_id: 1, so_number: "SO-E-1", customer_id: 5, total: r2((gross - discount) * 1.14), subtotal: gross, discount_amount: discount, payment_type: "cash" }],
    customers: [{ customer_id: 5, customer_name: "C" }],
    sales_order_items: lines.map(([q, p], i) => ({ so_id: 1, product_id: 100 + i, outsourced_name: null, quantity: q, unit_price: p, total: r2(q * p) })),
    delivery_permits: permitQty.map((_, k) => ({ permit_id: k + 1, permit_no: `DP-E-${k + 1}`, sales_order_id: 1, status: "APPROVED" })),
    delivery_permit_items: permitQty.flatMap((q, k) =>
      lines.map(([lq, p], i) => {
        const qty = q === "all" ? lq : q
        return { permit_id: k + 1, product_id: 100 + i, item_name_snapshot: `item ${i}`, quantity: qty, unit_price: p, total: r2(qty * p) }
      }),
    ),
    invoice_delivery_permits: [],
    accounts_receivable: [],
    ...(settings.length || opts.extraSettings ? { company_settings: settings } : {}),
  })
}
const UP_LINES: [number, number][] = [[1, 10.05], [1, 10.12], [1, 10.19]] // VAT per line rounds up: 3 x 1.41 vs 4.22 on the total

test("E6. go-live off changes nothing", async () => {
  const today = computeInvoiceAmount(30.36, 30.36, 0)
  assert.equal(today, 34.61) // total-level VAT
  for (const goLive of [undefined, null, "", "not a date", "2099-01-01T00:00:00Z"]) {
    const db = etaDb(UP_LINES, [1], { goLive, extraSettings: [{ setting_key: "company_name", setting_value: "x" }] })
    const state = await loadSoInvoicingState(db, 1)
    assert.ok(state)
    const verdict = evaluateDpInvoice(state!, [1])
    assert.ok(verdict.ok)
    // exactly today's formula (not rounded, as before)
    assert.equal((verdict as any).newValue, netInvoiceValue(30.36, 30.36, 0), `goLive=${goLive}`)
    const whole = computeWholeOrderAmount(state!)
    assert.ok(whole.ok && whole.amount === 34.61, `goLive=${goLive}`)
    const res = await createDpInvoices(db, [1])
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(db.tables.accounts_receivable[0].amount, today, `goLive=${goLive}`)
  }
  // no company_settings table at all / the settings query fails -> not live (today's rule)
  const bare = etaDb(UP_LINES, [1])
  delete bare.tables.company_settings
  const s1 = await loadSoInvoicingState(bare, 1)
  assert.ok(!s1!.etaGoLiveAt)
  // a missing table by its codes (Postgres 42P01 / PostgREST PGRST205) -> not live
  for (const code of ["42P01", "PGRST205"]) {
    const missing = settingsFailing(etaDb(UP_LINES, [1]), code)
    assert.equal(await loadEtaGoLiveAt(missing), null, code)
    const st = await loadSoInvoicingState(missing, 1)
    assert.ok(st && !st.etaGoLiveAt && !st.etaGoLiveError, code)
  }
  // the go-live value is read when set
  const live = await loadSoInvoicingState(etaDb(UP_LINES, [1], { goLive: "2026-01-01T00:00:00Z" }), 1)
  assert.equal(live!.etaGoLiveAt, "2026-01-01T00:00:00Z")
})

const GO_LIVE = "2026-01-01T00:00:00Z" // before the FakeDb clock (2026-10) and before today

// A db whose company_settings read fails with `code` (everything else is the FakeDb).
function settingsFailing(db: FakeDb, code: string): any {
  return {
    tables: db.tables,
    from: (table: string) =>
      table === "company_settings"
        ? { select: () => ({ eq: async () => ({ data: null, error: { code, message: `settings ${code}` } }) }) }
        : db.from(table),
  }
}

test("E8. go-live fixes: an unreadable setting refuses, the rule stays scoped, the tolerance counts invoice lines", async () => {
  // 1. go-live set + any other read error: invoice creation is refused, nothing is created
  const dpFail = etaDb(UP_LINES, [1], { goLive: GO_LIVE })
  dpFail.failOn["company_settings:select"] = "connection reset"
  await assert.rejects(loadEtaGoLiveAt(dpFail), /connection reset/)
  const st = await loadSoInvoicingState(dpFail, 1)
  assert.ok(st && st.etaGoLiveError, "recorded on the state; the overview / edits keep loading")
  const r1 = await createDpInvoices(dpFail, [1])
  assert.notEqual(r1.status, 200)
  assert.equal(r1.status, 503, JSON.stringify(r1.body))
  assert.equal(dpFail.tables.accounts_receivable.length, 0)
  assert.equal(dpFail.tables.invoice_delivery_permits.length, 0)
  const soFail = settingsFailing(etaDb(UP_LINES, [], { goLive: GO_LIVE }), "XX000")
  const rSo = await createSoInvoice(soFail, 1)
  assert.equal(rSo.status, 503, JSON.stringify(rSo.body))
  assert.equal(soFail.tables.accounts_receivable.length, 0)
  // a set but unparsable value: not live (today's rule), warned once
  const warnings: string[] = []
  const realWarn = console.warn
  console.warn = (...a: any[]) => void warnings.push(a.join(" "))
  etaGoLiveWarning.shown = false
  try {
    for (let i = 0; i < 2; i++) assert.equal((await loadSoInvoicingState(etaDb(UP_LINES, [1], { goLive: "15/12/2026" }), 1))!.etaGoLiveError, undefined)
  } finally {
    console.warn = realWarn
  }
  assert.equal(warnings.filter((w) => w.includes("eta_go_live_at")).length, 1)

  // 2. after go-live, net_total (order edits) and return credits stay on today's rule; with no returns net = total
  const so = etaDb(UP_LINES, [1], { goLive: GO_LIVE })
  assert.equal(await syncSalesOrderNetTotal(so, 1), 34.61)
  assert.equal(so.tables.sales_orders[0].net_total, so.tables.sales_orders[0].total)
  const sst = await loadSoInvoicingState(so, 1)
  assert.equal(orderTotalAfterReturns(sst!, []), 34.61)
  const whole = computeWholeOrderAmount(sst!)
  assert.ok(whole.ok && whole.amount === 34.61, "default rule = today's")
  const wholeEta = computeWholeOrderAmount(sst!, { eta: true })
  assert.ok(wholeEta.ok && wholeEta.amount === 34.62, "explicit per-line rule")

  // 3. 10 % discount, 10 lines of 3 x 1.23, each delivered 1 + 1 + 1 on three permits: 30 e-invoice lines, each
  // 0.01 above the order's per-line total -> 0.30 in all, more than 0.01 x 10 order lines; accepted in full
  const lines: [number, number][] = Array.from({ length: 10 }, () => [3, 1.23] as [number, number])
  const partial = etaDb(lines, [1, 1, 1], { goLive: GO_LIVE, discount: 3.69 })
  for (const permit of [1, 2, 3]) {
    const r = await createDpInvoices(partial, [permit])
    assert.equal(r.status, 200, `permit ${permit}: ${JSON.stringify(r.body)}`)
  }
  const pst = await loadSoInvoicingState(partial, 1)
  const billed = r2(partial.tables.accounts_receivable.reduce((s: number, r: Row) => s + r.amount, 0))
  const orderEta = computeWholeOrderAmount(pst!, { eta: true })
  assert.ok(orderEta.ok)
  assert.equal(r2(billed - (orderEta as any).amount), 0.3)
  assert.ok(billed - (orderEta as any).amount > etaTolerance(10))
  // a genuine over-billing beyond the tolerance is still refused (one permit line priced 1.23 -> 1.73)
  const over = etaDb(lines, [1, 1, 1], { goLive: GO_LIVE, discount: 3.69 })
  const item = over.tables.delivery_permit_items.find((r: Row) => r.permit_id === 3)!
  item.unit_price = 1.73
  item.total = 1.73
  assert.equal((await createDpInvoices(over, [1])).status, 200)
  assert.equal((await createDpInvoices(over, [2])).status, 200)
  const refused = await createDpInvoices(over, [3])
  assert.equal(refused.status, 409, JSON.stringify(refused.body))
  assert.equal(etaCheckTolerance(10, 30), 0.33)
})

test("E7. go-live on: per-line amounts, the wider tolerance, the print", async () => {
  // DP invoice created after go-live: amount = etaLines total (VAT per line), not today's total-level figure
  const db = etaDb(UP_LINES, [1], { goLive: GO_LIVE })
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const expected = etaLines(UP_LINES.map(([q, p], i) => L(`item ${i}`, q, p)), 0).totals.total
  assert.equal(expected, 34.62)
  assert.equal(db.tables.accounts_receivable[0].amount, expected)
  assert.notEqual(expected, computeInvoiceAmount(30.36, 30.36, 0))

  // the order discount rate applies to every line (discount_amount / pre-discount line total)
  const disc = etaDb([[3, 33.35], [1, 17.45], [7, 12.15]], ["all"], { goLive: GO_LIVE, discount: 20.255 })
  const dstate = await loadSoInvoicingState(disc, 1)
  const dv = evaluateDpInvoice(dstate!, [1])
  assert.ok(dv.ok)
  const rate = 20.255 / soDiscountBase(dstate!.soItems, dstate!.so.subtotal)
  assert.equal((dv as any).newValue, etaLines([L("a", 3, 33.35), L("b", 1, 17.45), L("c", 7, 12.15)], rate).totals.total)

  // whole-order invoice after go-live: the order lines, VAT per line
  const so = etaDb(UP_LINES, [], { goLive: GO_LIVE })
  const sres = await createSoInvoice(so, 1)
  assert.equal(sres.status, 200, JSON.stringify(sres.body))
  assert.equal(so.tables.accounts_receivable[0].amount, 34.62)

  // 30 lines of 2, each delivered 1 + 1 on two permits: the two invoices together are 0.25 above the order's
  // per-line total (one rounding per permit line) - more than 0.05, within max(0.05, 0.01 x 30)
  const prices = [10.05, 10.12, 10.19, 10.26, 10.33, 10.4, 10.47, 10.54, 10.61, 10.68, 10.75, 13.41, 13.48, 13.55, 13.62, 13.69, 13.76, 13.83, 13.9, 13.97, 14.04, 14.11, 14.18, 14.25, 16.91]
  const thirty: [number, number][] = [...prices.map((p): [number, number] => [2, p]), [2, 100], [2, 200], [2, 300], [2, 400], [2, 500]]
  assert.equal(thirty.length, 30)
  const big = etaDb(thirty, [1, 1], { goLive: GO_LIVE })
  const first = await createDpInvoices(big, [1])
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const second = await createDpInvoices(big, [2])
  assert.equal(second.status, 200, JSON.stringify(second.body))
  const invoiced = r2(big.tables.accounts_receivable.reduce((s: number, r: Row) => s + r.amount, 0))
  const orderTotal = etaLines(thirty.map(([q, p], i) => L(`item ${i}`, q, p)), 0).totals.total
  assert.ok(invoiced - orderTotal > 0.05 + 1e-9, `excess ${r2(invoiced - orderTotal)}`)
  assert.ok(invoiced - orderTotal <= etaTolerance(30), `excess ${r2(invoiced - orderTotal)}`)
  // the same excess is refused under the old tolerance (go-live not reached -> today's rule and 0.05):
  // inflate one line of a pre-go-live order by the same 0.25 and it is refused
  const pre = etaDb([[2, 100]], [1, 1])
  pre.tables.delivery_permit_items[1].total = 100.22 // 0.25 incl. VAT above the order
  pre.tables.delivery_permit_items[1].unit_price = 100.22
  assert.equal((await createDpInvoices(pre, [1])).status, 200)
  assert.equal((await createDpInvoices(pre, [2])).status, 409)

  // a prior invoice keeps the rule it was created under: a post-go-live invoice that also covers another
  // order's permit counts its per-line value for this order; a pre-go-live one today's value
  const mixed = etaDb(UP_LINES, [1, 0], { goLive: GO_LIVE })
  mixed.tables.delivery_permit_items = mixed.tables.delivery_permit_items.filter((r: Row) => r.permit_id === 1)
  mixed.tables.delivery_permits.push({ permit_id: 99, permit_no: "DP-OTHER", sales_order_id: 2, status: "APPROVED" })
  mixed.tables.accounts_receivable.push({ invoice_id: 1, invoice_number: "INV-X", so_id: 2, amount: 999, created_at: "2026-06-01T00:00:00Z" })
  mixed.tables.invoice_delivery_permits.push({ invoice_id: 1, permit_id: 1 }, { invoice_id: 1, permit_id: 99 })
  const mstate = await loadSoInvoicingState(mixed, 1)
  assert.equal(invoicedTotalForOrder(mstate!), 34.62)
  mstate!.invoices[0].created_at = "2025-06-01T00:00:00Z"
  assert.equal(invoicedTotalForOrder(mstate!), round2(netInvoiceValue(30.36, 30.36, 0)))
})

function arCanned(createdAt: string, amount: number, goLive: string | null) {
  return cannedDb({
    accounts_receivable: [
      {
        invoice_id: 1, invoice_number: "INV-E-1", invoice_date: "2026-12-02", created_at: createdAt, amount, so_id: 1,
        customers: { customer_name: "C", address: "A", city: "B" },
        sales_orders: {
          so_id: 1, so_number: "SO-E-1", subtotal: 30.36, discount_amount: 0,
          sales_order_items: UP_LINES.map(([q, p], i) => ({ product_id: 100 + i, quantity: q, unit_price: p, total: r2(q * p), item_type: "stock", outsourced_name: null, products: { product_name: `item ${i}` } })),
        },
      },
    ],
    invoice_delivery_permits: [
      {
        permit_id: 1,
        delivery_permits: {
          permit_id: 1, permit_no: "DP-E-1", status: "APPROVED",
          delivery_permit_items: UP_LINES.map(([q, p], i) => ({ product_id: 100 + i, quantity: q, unit_price: p, total: r2(q * p), item_name_snapshot: `item ${i}` })),
        },
      },
    ],
    ...(goLive ? { company_settings: [{ setting_key: "eta_go_live_at", setting_value: goLive }] } : {}),
  })
}
async function printAr() {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("", { status: 404 })) as any // the route tries to inline a logo
  try {
    return await (await arPdf.GET(nreq("http://test.local/x"), { params: Promise.resolve({ id: "1" }) })).text()
  } finally {
    globalThis.fetch = realFetch
  }
}

test("E7. AR print: an invoice created after go-live prints the per-line totals; an earlier one prints as today", async () => {
  const eta = etaLines(UP_LINES.map(([q, p], i) => L(`item ${i}`, q, p)), 0).totals
  useDb(arCanned("2026-12-02T09:00:00Z", 34.62, "2026-12-01T00:00:00Z"))
  const after = await printAr()
  assert.ok(after.includes(`المجموع الفرعي</td>\n        ${moneyCell(eta.net)}`), "subtotal")
  assert.ok(after.includes(`(14%)</td>\n        ${moneyCell(eta.vat)}`), "vat")
  assert.ok(after.includes(`إجمالي الفاتورة</td>\n        ${moneyCell(eta.total)}`), "total")
  assert.equal(eta.vat, 4.26)

  // created before go-live (and go-live unset): exactly today's print
  const today = dpInvoicePrintTotals(30.36, 30.36, 0, 34.61)
  for (const [createdAt, goLive] of [["2026-11-30T09:00:00Z", "2026-12-01T00:00:00Z"], ["2026-12-02T09:00:00Z", null]] as const) {
    useDb(arCanned(createdAt, 34.61, goLive))
    const before = await printAr()
    assert.ok(before.includes(`(14%)</td>\n        ${moneyCell(today.vatAmount)}`), `vat ${createdAt}`)
    assert.ok(before.includes(`إجمالي الفاتورة</td>\n        ${moneyCell(today.totalWithVat)}`), `total ${createdAt}`)
    assert.equal(today.vatAmount, 4.25)
  }
})

// ---------------------------------------------------------------------------------------------------------
// Task 4: settings, codes and memory APIs
// ---------------------------------------------------------------------------------------------------------
function ereq(method: string, body?: unknown, roles = "accountant", url = "http://test.local/api/eta/x"): any {
  const headers: Record<string, string> = { "content-type": "application/json", "x-mm-roles": roles, "x-mm-user-id": "7" }
  const r = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return Object.assign(r, { nextUrl: new URL(url) })
}
async function out(res: Response) {
  return { status: res.status, body: await res.json().catch(() => null) }
}
const setting = (db: FakeDb, key: string) => db.tables.company_settings?.find((r) => r.setting_key === key)?.setting_value

test("E9. settings", async () => {
  const db = new FakeDb({ users: [{ user_id: 7 }], company_settings: [] })
  useDb(db)
  const put = (body: unknown, roles = "accountant") => etaSettingsRoute.PUT(ereq("PUT", body, roles)).then(out)
  assert.equal((await put({ eta_rin: "١٠٠ ٢٣٤-٥٦٧" })).status, 200)
  assert.equal(setting(db, "eta_rin"), "100234567")
  assert.equal((await put({ eta_rin: "12345" })).status, 400)
  assert.equal(setting(db, "eta_rin"), "100234567")
  assert.equal((await put({ eta_activity_code: "٤٦٦٩" })).status, 200)
  assert.equal(setting(db, "eta_activity_code"), "4669")
  assert.equal((await put({ eta_activity_code: "46" })).status, 400)
  assert.equal((await put({ eta_registered_name: "  Misr Motors ", bogus: "x" })).status, 200)
  assert.equal(setting(db, "eta_registered_name"), "Misr Motors")
  assert.equal(setting(db, "bogus"), undefined, "unknown keys ignored")
  // go-live: accountant 403, ceo / admin 200 (dates far ahead: a go-live must be after today, see E27)
  assert.equal((await put({ eta_go_live_at: "2030-12-01" }, "accountant")).status, 403)
  assert.equal(setting(db, "eta_go_live_at"), undefined)
  assert.equal((await put({ eta_go_live_at: "2030-12-01" }, "ceo")).status, 200)
  assert.equal(setting(db, "eta_go_live_at"), "2030-12-01T00:00:00+02:00", "winter date, +02:00")
  assert.equal((await put({ eta_go_live_at: "2030-07-01" }, "sales-rep,admin")).status, 200)
  assert.equal(setting(db, "eta_go_live_at"), "2030-07-01T00:00:00+03:00", "summer time, +03:00")
  assert.equal((await put({ eta_go_live_at: "01/12/2026" }, "ceo")).status, 400)
  assert.equal((await put({ eta_go_live_at: "2026-02-30" }, "ceo")).status, 400)
  assert.equal((await put({ eta_go_live_at: "2026-12-01T00:00:00Z" }, "ceo")).status, 400)
  assert.equal(setting(db, "eta_go_live_at"), "2030-07-01T00:00:00+03:00")
  // an unchanged value saved by the accountant is not a change
  assert.equal((await put({ eta_go_live_at: "2030-07-01", eta_branch_id: "0" })).status, 200)
  const got = await etaSettingsRoute.GET(ereq("GET")).then(out)
  assert.equal(got.body.eta_go_live_at, "2030-07-01T00:00:00+03:00")
  assert.equal(got.body.eta_rin, "100234567")
  assert.equal((await put({ eta_go_live_at: "" }, "ceo")).status, 200)
  assert.equal(setting(db, "eta_go_live_at"), "")
})

test("E10. codes", async () => {
  const db = new FakeDb({ users: [{ user_id: 7 }] })
  useDb(db)
  const a = await etaCodesRoute.POST(ereq("POST", { item_code: "EG-1-HAND", code_type: "EGS", name: "Hand tools", keywords: ["لقمة", " مفك ", "لقمه"], default_unit: "EA" })).then(out)
  assert.equal(a.status, 200)
  assert.deepEqual(db.tables.eta_item_codes[0].keywords, ["لقمه", "مفك"], "keywords normalised")
  const b = await etaCodesRoute.POST(ereq("POST", { item_code: "EG-1-GARAGE", code_type: "GS1", name: "Garage" })).then(out)
  assert.equal(b.status, 200)
  assert.equal((await etaCodesRoute.POST(ereq("POST", { item_code: "EG-1-HAND", code_type: "EGS", name: "dup" })).then(out)).status, 409)
  assert.equal((await etaCodesRoute.POST(ereq("POST", { item_code: "", name: "x" })).then(out)).status, 400)
  assert.equal(db.tables.eta_item_codes.length, 2)
  const list = await etaCodesRoute.GET(ereq("GET")).then(out)
  assert.equal(list.body.length, 2)
  const put = await etaCodesRoute.PUT(ereq("PUT", { code_id: b.body.code_id, name: "Garage 2", active: false })).then(out)
  assert.equal(put.status, 200)
  assert.equal(db.tables.eta_item_codes[1].name, "Garage 2")
  assert.equal(db.tables.eta_item_codes[1].active, false)
  assert.equal((await etaCodesRoute.PUT(ereq("PUT", { code_id: b.body.code_id, item_code: "EG-1-HAND" })).then(out)).status, 409)
})

test("E11. memory upsert", async () => {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    eta_item_codes: [
      { code_id: 1, item_code: "A", keywords: [], default_unit: "EA", active: true },
      { code_id: 2, item_code: "B", keywords: [], default_unit: "EA", active: true },
      { code_id: 3, item_code: "C", keywords: [], default_unit: "EA", active: false },
    ],
  })
  useDb(db)
  const post = (body: unknown) => etaMemoryRoute.POST(ereq("POST", body)).then(out)
  assert.equal((await post({ name: "ترولي عدة", codeId: 1, unitType: "SET" })).status, 200)
  assert.equal((await post({ name: "ترولى عده", codeId: 1, unitType: "SET" })).status, 200)
  assert.equal((await post({ name: "ترولي عدة", codeId: 2, unitType: "EA" })).status, 200)
  const full = db.tables.eta_code_memory.filter((r) => r.normalized_name === "ترولي عده")
  assert.equal(full.length, 1)
  assert.equal(full[0].code_id, 2)
  assert.equal(full[0].unit_type, "EA")
  assert.equal(full[0].sample_name, "ترولي عدة", "first spelling kept")
  assert.equal(full[0].confirmed_by, 7)
  assert.equal(full[0].source, "confirmed")
  // full name equals its core: still a single row
  assert.equal(db.tables.eta_code_memory.length, 1)
  // a brand-bearing name also stores its core
  assert.equal((await post({ name: "ترولي عدة Stanley", codeId: 1, unitType: "SET" })).status, 200)
  assert.deepEqual(db.tables.eta_code_memory.map((r) => r.normalized_name).sort(), ["ترولي عده", "ترولي عده stanley"].sort())
  assert.equal(db.tables.eta_code_memory.length, 2)
  // the core row is the exact name confirmed earlier: learning the core never overwrites it
  assert.equal(db.tables.eta_code_memory.find((r) => r.normalized_name === "ترولي عده")!.code_id, 2)
  // unknown and inactive codes refused
  assert.equal((await post({ name: "x", codeId: 99, unitType: "EA" })).status, 400)
  assert.equal((await post({ name: "x", codeId: 3, unitType: "EA" })).status, 400)
  assert.equal(db.tables.eta_code_memory.length, 2)
  const list = await etaMemoryRoute.GET(ereq("GET", undefined, "accountant", "http://test.local/api/eta/memory?q=stanley")).then(out)
  assert.equal(list.body.length, 1)
  const id = db.tables.eta_code_memory[0].memory_id
  assert.equal((await etaMemoryRoute.DELETE(ereq("DELETE", undefined, "accountant", `http://test.local/api/eta/memory?id=${id}`)).then(out)).status, 200)
  assert.equal(db.tables.eta_code_memory.length, 1)
})

test("E12. prepare", async () => {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    eta_item_codes: [
      { code_id: 1, item_code: "H", keywords: ["لقمة", "دريل"], default_unit: "EA", active: true },
      { code_id: 2, item_code: "G", keywords: ["ترولي"], default_unit: "EA", active: true },
    ],
    products: [{ product_id: 5, product_name: "دريل", eta_code_id: null, eta_unit_type: null }],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: null, outsourced_name: "ترولي عدة" },
      { so_item_id: 2, so_id: 1, product_id: null, outsourced_name: "ترولى عده" },
      { so_item_id: 3, so_id: 2, product_id: null, outsourced_name: "ترولى عده" },
      { so_item_id: 4, so_id: 2, product_id: null, outsourced_name: "لقمة 17" },
      { so_item_id: 5, so_id: 3, product_id: 5, outsourced_name: null },
      { so_item_id: 6, so_id: 3, product_id: null, outsourced_name: "  " },
    ],
  })
  useDb(db)
  const res = await etaPrepareRoute.GET(ereq("GET")).then(out)
  assert.equal(res.status, 200)
  const items = res.body.items as any[]
  assert.equal(items.length, 3)
  const trolley = items.find((i) => i.normalizedName === "ترولي عده")
  assert.equal(trolley.count, 3)
  assert.equal(trolley.name, "ترولى عده", "most frequent spelling")
  assert.deepEqual([trolley.codeId, trolley.state, trolley.by], [2, "orange", "keyword"])
  assert.equal(items.find((i) => i.name === "لقمة 17").codeId, 1)
  assert.equal(items.find((i) => i.name === "دريل").count, 1)

  const saved = await etaPrepareRoute.POST(ereq("POST", { items: [
    { name: "ترولى عده", codeId: 2, unitType: "SET" },
    { name: "لقمة 17", codeId: 1, unitType: "EA" },
    { name: "دريل", codeId: null, unitType: "EA" },
  ] })).then(out)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.saved, 2)
  assert.ok(db.tables.eta_code_memory.length >= 2)
  assert.ok(db.tables.eta_code_memory.every((r) => r.source === "imported"))
  assert.ok(!db.tables.eta_code_memory.some((r) => r.normalized_name === "دريل"))
  // names already in memory are skipped on the next call
  const again = await etaPrepareRoute.GET(ereq("GET")).then(out)
  assert.deepEqual(again.body.items.map((i: any) => i.name), ["دريل"])
})

test("E13. permissions", () => {
  for (const path of ["/api/eta/memory", "/api/eta/settings", "/api/eta/codes", "/api/eta/memory/prepare"]) {
    const rule = ruleFor(path)!
    assert.ok(rule, path)
    assert.equal(allows(rule, "GET", ["accountant"]), true)
    assert.equal(allows(rule, "POST", ["accountant"]), true)
    assert.equal(allows(rule, "GET", ["sales-rep"]), false)
    assert.equal(allows(rule, "POST", ["sales-rep"]), false)
    assert.equal(allows(rule, "POST", ["ceo"]), true)
  }
})

test("E14. memory and codes are read in pages (more than 1000 rows)", async () => {
  const memory: Row[] = []
  for (let i = 1; i <= 1100; i++) {
    memory.push({ memory_id: i, normalized_name: `قطعه ${i}`, core_name: `قطعه ${i}`, code_id: 1, unit_type: "EA", confirmed_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() })
  }
  // the newest confirmation: same name as an old row's neighbour, but a different code
  memory.push({ memory_id: 1101, normalized_name: "ترولي عده", core_name: "ترولي عده", code_id: 2, unit_type: "SET", confirmed_at: "2027-01-01T00:00:00.000Z" })
  const codes: Row[] = [{ code_id: 1, item_code: "A", keywords: [], default_unit: "EA", active: true }, { code_id: 2, item_code: "B", keywords: [], default_unit: "EA", active: true }]
  for (let i = 3; i <= 1050; i++) codes.push({ code_id: i, item_code: `C${i}`, keywords: [], default_unit: "EA", active: true })
  const db = new FakeDb({
    eta_item_codes: codes,
    eta_code_memory: memory,
    products: [],
    sales_order_items: [
      { so_item_id: 1, so_id: 1, product_id: null, outsourced_name: "ترولي عدة" },
      { so_item_id: 2, so_id: 1, product_id: null, outsourced_name: "لقمة 17" },
    ],
  })
  db.jitter = false
  useDb(db)
  const ctx = await loadEtaCtx(db)
  assert.equal(ctx.memory.length, 1101)
  assert.equal(ctx.codes.length, 1050)
  assert.equal(ctx.memory[ctx.memory.length - 1].normalizedName, "ترولي عده", "the newest row is read")
  assert.equal(matchCode({ name: "ترولي عدة" }, ctx).codeId, 2)
  const res = await etaPrepareRoute.GET(ereq("GET")).then(out)
  assert.deepEqual(res.body.items.map((i: any) => i.name), ["لقمة 17"], "a name remembered past the first page is skipped")
})

test("E15. memory paging is stable across rows with the same confirmed_at", async () => {
  // 1100 rows share one confirmed_at (a bulk import); memory_ids run opposite to insertion order, so only the
  // secondary order on memory_id decides which row is last (the most recent) and keeps every page boundary exact.
  const same = "2026-06-01T00:00:00.000Z"
  const memory: Row[] = []
  for (let i = 1100; i >= 1; i--) {
    memory.push({ memory_id: i, normalized_name: `صنف ${i}`, core_name: `صنف ${i}`, code_id: i === 1100 ? 2 : 1, unit_type: "EA", confirmed_at: same })
  }
  const db = new FakeDb({
    eta_item_codes: [{ code_id: 1, item_code: "A", keywords: [], default_unit: "EA", active: true }, { code_id: 2, item_code: "B", keywords: [], default_unit: "EA", active: true }],
    eta_code_memory: memory,
  })
  db.jitter = false
  const ctx = await loadEtaCtx(db)
  assert.equal(ctx.memory.length, 1100)
  assert.equal(new Set(ctx.memory.map((m) => m.normalizedName)).size, 1100, "no row dropped or duplicated")
  assert.equal(ctx.memory[ctx.memory.length - 1].normalizedName, "صنف 1100", "ties resolve by memory_id")
  assert.equal(ctx.memory[999].normalizedName, "صنف 1000", "page boundary is exact")
  db.failOn["eta_item_codes:select"] = "boom"
  await assert.rejects(() => loadEtaCtx(db), /Could not read eta_item_codes: boom/)
})

// Task 5: tax fields on customers, suppliers and products
// ---------------------------------------------------------------------------------------------------------
test("E16. cleanTaxNumber / cleanNationalId / governorates", () => {
  assert.equal(cleanTaxNumber("١٠٠-٢٣٤-٥٦٧"), "100234567")
  assert.equal(cleanTaxNumber("12345"), null)
  assert.equal(cleanNationalId("2 9 0 0 1 0 1 1 2 3 4 5 6 7"), "29001011234567")
  assert.equal(cleanNationalId("123"), null)
  assert.equal(GOVERNORATES.length, 27)
  assert.ok(GOVERNORATES.every((g) => g.ar && g.en))
})

test("E17. customer PUT saves and returns the 7 fields; a bad number is saved with a warning; omitted fields untouched", async () => {
  const db = new FakeDb({ customers: [{ customer_id: 1, customer_name: "Acme", eta_receiver_type: "B", created_at: "2026-01-01" }] })
  useDb(db)
  const put = (body: unknown) => customersRoute.PUT(ereq("PUT", body)).then(out)
  const r1 = await put({
    id: "1", receiverType: "P", taxRegistrationNumber: "١٠٠-٢٣٤-٥٦٧", nationalId: "2 9 0 0 1 0 1 1 2 3 4 5 6 7",
    governorate: "Cairo", region: "Nasr City", street: "Abbas St", buildingNumber: "12",
  })
  assert.equal(r1.status, 200)
  assert.equal(r1.body.taxWarnings, undefined)
  assert.deepEqual(
    [r1.body.receiverType, r1.body.taxRegistrationNumber, r1.body.nationalId, r1.body.governorate, r1.body.region, r1.body.street, r1.body.buildingNumber],
    ["P", "100234567", "29001011234567", "Cairo", "Nasr City", "Abbas St", "12"],
  )
  const r2 = await put({ id: "1", taxRegistrationNumber: "12345" })
  assert.equal(r2.status, 200, "never refused")
  assert.equal(r2.body.taxRegistrationNumber, "12345", "saved as typed")
  assert.deepEqual(r2.body.taxWarnings, ["tax_registration_number: must be 9 digits"])
  const row = db.tables.customers[0]
  assert.equal(row.tax_registration_number, "12345")
  assert.equal(row.national_id, "29001011234567", "omitted field untouched")
  assert.equal(row.address_governorate, "Cairo")
  assert.equal(row.eta_receiver_type, "P")
  const g = await customersRoute.GET().then(out)
  assert.equal(g.body[0].governorate, "Cairo")
  const r3 = await put({ id: "1", nationalId: "99" })
  assert.deepEqual(r3.body.taxWarnings, ["national_id: must be 14 digits"])
})

test("E18. supplier PUT saves taxRegistrationNumber", async () => {
  const db = new FakeDb({ suppliers: [{ supplier_id: 1, supplier_name: "S", created_at: "2026-01-01" }] })
  useDb(db)
  const r = await suppliersRoute.PUT(ereq("PUT", { id: "1", taxRegistrationNumber: "١٢٣-٤٥٦-٧٨٩" })).then(out)
  assert.equal(r.body.taxRegistrationNumber, "123456789")
  assert.equal(db.tables.suppliers[0].tax_registration_number, "123456789")
  const bad = await suppliersRoute.PUT(ereq("PUT", { id: "1", taxRegistrationNumber: "abc" })).then(out)
  assert.equal(bad.status, 200)
  assert.equal(db.tables.suppliers[0].tax_registration_number, "abc")
  assert.deepEqual(bad.body.taxWarnings, ["tax_registration_number: must be 9 digits"])
  const other = await suppliersRoute.PUT(ereq("PUT", { id: "1", city: "Giza" })).then(out)
  assert.equal(other.body.taxRegistrationNumber, "abc", "omitted field untouched")
})

test("E19. product PUT saves etaCodeId / etaUnitType", async () => {
  const db = new FakeDb({ products: [{ product_id: 1, product_name: "P", sku: "S", unit_price: 5, created_at: "2026-01-01" }] })
  useDb(db)
  const r = await productsRoute.PUT(ereq("PUT", { id: "1", etaCodeId: 42, etaUnitType: "KGM" })).then(out)
  assert.equal(r.body.etaCodeId, 42)
  assert.equal(r.body.etaUnitType, "KGM")
  assert.equal(db.tables.products[0].eta_code_id, 42)
  const keep = await productsRoute.PUT(ereq("PUT", { id: "1", unitPrice: 7 })).then(out)
  assert.equal(keep.body.etaCodeId, 42, "omitted fields untouched")
  const none = await productsRoute.PUT(ereq("PUT", { id: "1", etaCodeId: null })).then(out)
  assert.equal(none.body.etaCodeId, null)
})

// ---------------------------------------------------------------------------------------------------------
// Task 6: invoice preview
// ---------------------------------------------------------------------------------------------------------
const COMPANY_OK: Row[] = [
  { setting_key: "eta_rin", setting_value: "100234567" },
  { setting_key: "eta_activity_code", setting_value: "4669" },
  { setting_key: "eta_branch_governorate", setting_value: "Cairo" },
  { setting_key: "eta_branch_region", setting_value: "Nasr City" },
  { setting_key: "eta_branch_street", setting_value: "Abbas St" },
  { setting_key: "eta_branch_building_number", setting_value: "12" },
]
interface PvLine { name: string; productId: number | null; qty: number; price: number }
// One sales order (so_id 1, customer 5), one APPROVED permit delivering every line in full.
function previewDb(lines: PvLine[], opts: { discount?: number; goLive?: string | null; customer?: Row; settings?: Row[]; products?: Row[]; codes?: Row[]; memory?: Row[] } = {}) {
  const gross = lines.reduce((s, l) => s + l.qty * l.price, 0)
  const discount = opts.discount || 0
  const settings: Row[] = [...(opts.settings ?? COMPANY_OK)]
  if (opts.goLive !== undefined) settings.push({ setting_key: "eta_go_live_at", setting_value: opts.goLive })
  return new FakeDb({
    users: [{ user_id: 7 }],
    sales_orders: [{ so_id: 1, so_number: "SO-P-1", customer_id: 5, total: r2((gross - discount) * 1.14), subtotal: gross, discount_amount: discount, payment_type: "cash" }],
    customers: [{ customer_id: 5, customer_name: "Acme", ...(opts.customer || {}) }],
    sales_order_items: lines.map((l) => ({ so_id: 1, product_id: l.productId, outsourced_name: l.productId ? null : l.name, quantity: l.qty, unit_price: l.price, total: r2(l.qty * l.price) })),
    delivery_permits: [{ permit_id: 1, permit_no: "DP-P-1", sales_order_id: 1, status: "APPROVED" }],
    delivery_permit_items: lines.map((l) => ({ permit_id: 1, product_id: l.productId, item_name_snapshot: l.name, quantity: l.qty, unit_price: l.price, total: r2(l.qty * l.price) })),
    invoice_delivery_permits: [],
    accounts_receivable: [],
    product_returns: [],
    return_items: [],
    products: opts.products || lines.filter((l) => l.productId).map((l) => ({ product_id: l.productId, product_name: l.name, eta_code_id: null, eta_unit_type: null })),
    eta_item_codes: opts.codes || [],
    eta_code_memory: opts.memory || [],
    eta_documents: [],
    company_settings: settings,
  })
}
function addReturn(db: FakeDb, id: number, createdAt: string, items: [number | null, string, number][]) {
  db.tables.product_returns.push({ return_id: id, permit_id: "1", status: "pending_warehouse", created_at: createdAt })
  items.forEach(([productId, name, qty], k) => db.tables.return_items.push({ return_item_id: id * 100 + k, return_id: id, product_id: productId, product_name: name, returned_quantity: qty }))
}
const preq = (method: string, query = "", body?: unknown) => ereq(method, body, "accountant", `http://test.local/api/eta/preview${query}`)

test("E20. preview lines: the invoice's billed lines (net of returns known at invoice time), the order discount, totals from etaLines", async () => {
  const lines: PvLine[] = [
    { name: "item 0", productId: 100, qty: 2, price: 100 },
    { name: "item 1", productId: 101, qty: 3, price: 50 },
    { name: "item 2", productId: 102, qty: 1, price: 20 },
  ]
  // 10 % discount: 37 of 370
  const db = previewDb(lines, { discount: 37, goLive: GO_LIVE })
  addReturn(db, 1, "2026-06-01T00:00:00Z", [[101, "item 1", 1], [102, "item 2", 1]]) // before invoicing
  const res = await createDpInvoices(db, [1])
  assert.equal(res.status, 200, JSON.stringify(res.body))
  addReturn(db, 2, "2027-01-01T00:00:00Z", [[100, "item 0", 1]]) // after invoicing: never changes the invoice
  const invoiceId = db.tables.accounts_receivable[0].invoice_id
  const p = await buildEtaPreview(db, invoiceId)
  assert.ok(p)
  const expected = etaLines([L("item 0", 2, 100), L("item 1", 2, 50)], 0.1)
  assert.deepEqual(p!.lines.map((l) => [l.name, l.quantity, l.unitPrice, l.discount, l.netTotal, l.vat, l.total]), expected.lines.map((l) => [l.name, l.quantity, l.unitPrice, l.discount, l.netTotal, l.vat, l.total]))
  assert.deepEqual(p!.totals, expected.totals)
  assert.equal(p!.totals.total, 307.8)
  assert.deepEqual(p!.lines.map((l) => l.discountRate), [0.1, 0.1])
  assert.equal(p!.totals.total, db.tables.accounts_receivable[0].amount, "the same total the invoice stored")
  assert.equal(p!.invoiceNumber, db.tables.accounts_receivable[0].invoice_number)
  assert.equal(p!.handledManually, false)
  assert.equal(p!.storedAmount, 307.8)
  assert.ok(!p!.missing.includes("amount_mismatch"), "matches the stored amount")

  // the warehouse rejects the return the invoice was priced net of: the preview now bills more than the invoice
  db.tables.product_returns.find((r) => r.return_id === 1)!.status = "rejected"
  const drifted = await buildEtaPreview(db, invoiceId)
  assert.ok(drifted!.totals.total > 307.8)
  assert.equal(drifted!.storedAmount, 307.8)
  assert.ok(drifted!.missing.includes("amount_mismatch"))
  // a pre-go-live (handled manually) invoice is never flagged
  db.tables.accounts_receivable[0].created_at = "2025-06-01T00:00:00Z"
  const old = await buildEtaPreview(db, invoiceId)
  assert.equal(old!.handledManually, true)
  assert.ok(!old!.missing.includes("amount_mismatch"))

  // whole-order invoice: the order lines less returns known at invoice time; a stock line's name is its product name
  const so = previewDb(lines, { discount: 37, goLive: GO_LIVE })
  addReturn(so, 1, "2026-06-01T00:00:00Z", [[101, "item 1", 1], [102, "item 2", 1]])
  const sres = await createSoInvoice(so, 1)
  assert.equal(sres.status, 200, JSON.stringify(sres.body))
  addReturn(so, 2, "2027-01-01T00:00:00Z", [[100, "item 0", 1]])
  const sp = await buildEtaPreview(so, so.tables.accounts_receivable[0].invoice_id)
  assert.deepEqual(sp!.lines.map((l) => [l.name, l.quantity]), [["item 0", 2], ["item 1", 2]])
  assert.deepEqual(sp!.totals, expected.totals)
  assert.equal(sp!.totals.total, so.tables.accounts_receivable[0].amount)
  assert.ok(!sp!.missing.includes("amount_mismatch"))

  assert.equal(await buildEtaPreview(db, 999), null, "unknown invoice")
})

test("E21. preview: code state per line and the missing-data checklist", async () => {
  const codes: Row[] = [
    { code_id: 1, item_code: "EG-HAND", name: "Hand tools", keywords: ["لقمه"], default_unit: "EA", active: true },
    { code_id: 2, item_code: "EG-GARAGE", code_type: "GS1", name: "Garage", keywords: [], default_unit: "SET", active: true },
  ]
  const memory: Row[] = [{ memory_id: 1, normalized_name: normalizeName("ترولي عدة"), core_name: normalizeName("ترولي عدة"), code_id: 2, unit_type: "SET", confirmed_at: "2026-01-01T00:00:00Z" }]
  const lines: PvLine[] = [
    { name: "مفتاح عزم", productId: 100, qty: 1, price: 10 }, // product card code, unit "" = not set
    { name: "ترولي عدة", productId: null, qty: 1, price: 10 }, // remembered
    { name: "لقمة 17", productId: null, qty: 1, price: 10 }, // keyword
    { name: "شيء غريب", productId: null, qty: 1, price: 10 }, // unknown
  ]
  const products = [{ product_id: 100, product_name: "مفتاح عزم", eta_code_id: 2, eta_unit_type: "" }]
  const db = previewDb(lines, { goLive: GO_LIVE, codes, memory, products, customer: { eta_receiver_type: "B", tax_registration_number: null } })
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  const id = db.tables.accounts_receivable[0].invoice_id
  const p = await buildEtaPreview(db, id)
  assert.deepEqual(p!.lines.map((l) => [l.state, l.codeId, l.itemCode, l.unit]), [
    ["green", 2, "EG-GARAGE", "SET"],
    ["green", 2, "EG-GARAGE", "SET"],
    ["orange", 1, "EG-HAND", "EA"],
    ["red", null, null, "EA"],
  ])
  assert.deepEqual(p!.customer, {
    name: "Acme", receiverType: "B", taxRegistrationNumber: null, nationalId: null,
    address: { governorate: "", regionCity: "", street: "", buildingNumber: "" },
  })
  assert.deepEqual(p!.lines.map((l) => [l.itemType, l.discountRate]), [["GS1", 0], ["GS1", 0], ["EGS", 0], ["EGS", 0]])
  assert.deepEqual([...p!.missing].sort(), ["customer_address", "customer_tax_number", "line_codes"])

  // the unknown name is confirmed: no line is red any more (orange is a suggestion, not missing)
  db.tables.eta_code_memory.push({ memory_id: 2, normalized_name: normalizeName("شيء غريب"), core_name: normalizeName("شيء غريب"), code_id: 1, unit_type: "EA", confirmed_at: "2026-02-01T00:00:00Z" })
  // a company with a tax number and full address
  Object.assign(db.tables.customers[0], { tax_registration_number: "100234567", address_governorate: "Giza", address_region: "Dokki", address_street: "Tahrir", address_building_number: "4" })
  const p2 = await buildEtaPreview(db, id)
  assert.deepEqual(p2!.missing, [])
  assert.deepEqual(p2!.customer.address, { governorate: "Giza", regionCity: "Dokki", street: "Tahrir", buildingNumber: "4" })
  assert.equal(p2!.lines[3].state, "green")
  // a tax number that is not 9 digits; an empty receiver type counts as a company
  Object.assign(db.tables.customers[0], { eta_receiver_type: null, tax_registration_number: "12345", address_street: "" })
  assert.deepEqual([...(await buildEtaPreview(db, id))!.missing].sort(), ["customer_address", "customer_tax_number"])
  // a person: the national ID (14 digits) is what counts, no address needed
  Object.assign(db.tables.customers[0], { eta_receiver_type: "P", tax_registration_number: null, national_id: "29001011234567" })
  const person = (await buildEtaPreview(db, id))!
  assert.deepEqual(person.missing, [])
  assert.equal(person.customer.nationalId, "29001011234567")
  db.tables.customers[0].national_id = "123"
  assert.deepEqual((await buildEtaPreview(db, id))!.missing, ["customer_tax_number"])
  db.tables.customers[0].national_id = "29001011234567"

  // company settings
  db.tables.company_settings = [{ setting_key: "eta_go_live_at", setting_value: GO_LIVE }, { setting_key: "eta_rin", setting_value: "12345" }, { setting_key: "eta_activity_code", setting_value: "46" }, ...COMPANY_OK.slice(2, 5)]
  assert.deepEqual([...(await buildEtaPreview(db, id))!.missing].sort(), ["company_activity", "company_address", "company_rin"])
})

test("E22. handled manually: go-live, invoice date, and the 'already on the portal' mark", async () => {
  const lines: PvLine[] = [{ name: "item 0", productId: 100, qty: 1, price: 10 }]
  // go-live empty -> every invoice is handled manually
  for (const goLive of ["", null, "not a date"]) {
    const off = previewDb(lines, { goLive })
    assert.equal((await createDpInvoices(off, [1])).status, 200)
    assert.equal((await buildEtaPreview(off, off.tables.accounts_receivable[0].invoice_id))!.handledManually, true, `goLive=${goLive}`)
  }
  const db = previewDb(lines, { goLive: GO_LIVE })
  assert.equal((await createDpInvoices(db, [1])).status, 200)
  const id = db.tables.accounts_receivable[0].invoice_id
  useDb(db)
  const get = () => etaPreviewRoute.GET(preq("GET", `?invoiceId=${id}`)).then(out)
  const g = await get()
  assert.equal(g.status, 200)
  assert.equal(g.body.handledManually, false)
  assert.equal(g.body.manualEtaUuid, null)
  assert.equal((await etaPreviewRoute.GET(preq("GET", "?invoiceId=abc")).then(out)).status, 400)
  assert.equal((await etaPreviewRoute.GET(preq("GET", "")).then(out)).status, 400)
  assert.equal((await etaPreviewRoute.GET(preq("GET", "?invoiceId=999")).then(out)).status, 404)

  // mark "already on the portal"
  const post = await etaPreviewRoute.POST(preq("POST", "", { invoiceId: id, etaUuid: "ABC" })).then(out)
  assert.equal(post.status, 200, JSON.stringify(post.body))
  assert.equal(db.tables.eta_documents.length, 1)
  assert.deepEqual(
    (({ invoice_id, document_type, status, eta_uuid, created_by }) => ({ invoice_id, document_type, status, eta_uuid, created_by }))(db.tables.eta_documents[0] as any),
    { invoice_id: id, document_type: "I", status: "manual", eta_uuid: "ABC", created_by: 7 },
  )
  const marked = await get()
  assert.equal(marked.body.handledManually, true)
  assert.equal(marked.body.manualEtaUuid, "ABC")
  // marking again without an ID keeps the one given; still a single row
  assert.equal((await etaPreviewRoute.POST(preq("POST", "", { invoiceId: id })).then(out)).status, 200)
  assert.equal(db.tables.eta_documents.length, 1)
  assert.equal((await get()).body.manualEtaUuid, "ABC")
  assert.equal((await etaPreviewRoute.POST(preq("POST", "", { invoiceId: 999 })).then(out)).status, 404)
  assert.equal((await etaPreviewRoute.POST(preq("POST", "", { invoiceId: "x" })).then(out)).status, 400)

  // DELETE clears the mark
  assert.equal((await etaPreviewRoute.DELETE(preq("DELETE", `?invoiceId=${id}`)).then(out)).status, 200)
  assert.equal(db.tables.eta_documents.length, 0)
  assert.equal((await get()).body.handledManually, false)
  assert.equal((await etaPreviewRoute.DELETE(preq("DELETE", `?invoiceId=${id}`)).then(out)).status, 404)

  // a document already sent (any other status) is never overwritten or removed
  db.tables.eta_documents.push({ doc_id: 50, invoice_id: id, document_type: "I", status: "submitted", eta_uuid: "SENT" })
  assert.equal((await etaPreviewRoute.POST(preq("POST", "", { invoiceId: id, etaUuid: "ABC" })).then(out)).status, 409)
  assert.equal((await etaPreviewRoute.DELETE(preq("DELETE", `?invoiceId=${id}`)).then(out)).status, 404)
  assert.deepEqual(db.tables.eta_documents.map((r) => [r.status, r.eta_uuid]), [["submitted", "SENT"]])
  assert.equal((await get()).body.handledManually, false)

  // an invoice created before go-live is handled manually
  db.tables.accounts_receivable[0].created_at = "2025-12-31T23:59:59Z"
  assert.equal((await get()).body.handledManually, true)

  // the route is under the e-invoice permission rule
  const rule = ruleFor("/api/eta/preview")!
  assert.equal(allows(rule, "POST", ["accountant"]), true)
  assert.equal(allows(rule, "GET", ["sales-rep"]), false)
})

// ---- Task 7: screens ----
const src = (f: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), f), "utf8")
const SETTINGS_SCREEN = "components/modules/e-invoice-settings-module.tsx"
const PREVIEW_DIALOG = "components/accounting/eta-preview-dialog.tsx"

test("E23. screens wired", () => {
  for (const role of ["accountant", "ceo", "admin"] as const) {
    assert.ok(ROLE_MODULES[role].some((i) => i.id === "e-invoice-settings" && i.label === "module.e-invoice-settings"), role)
  }
  for (const role of ["sales-rep", "warehouse-rep", "po-rep", "shipment"] as const) {
    assert.ok(!ROLE_MODULES[role].some((i) => i.id === "e-invoice-settings"), role)
  }
  assert.equal(MODULE_GROUP["e-invoice-settings"], "finance")
  const dash = src("components/dashboard/dashboard.tsx")
  assert.match(dash, /case "e-invoice-settings":\s*return <EInvoiceSettingsModule roles=\{roles\} \/>/)
  // the admin branch renders it too (admins otherwise only get their own screens)
  assert.match(dash, /activeModule === "e-invoice-settings"\) \{\s*return <EInvoiceSettingsModule roles=\{roles\} \/>/)

  const ar = src("components/modules/accounts-receivable-module.tsx")
  assert.match(ar, /<EtaPreviewDialog/)
  assert.match(ar, /ETA_ROLES\.includes\(userRole/)

  // go-live: only the CEO or an admin
  assert.equal(canSetGoLive(["ceo"]), true)
  assert.equal(canSetGoLive(["admin"]), true)
  assert.equal(canSetGoLive(["accountant", "sales-rep"]), false)
  assert.equal(canSetGoLive([]), false)
  const settings = src(SETTINGS_SCREEN)
  assert.match(settings, /const mayGoLive = canSetGoLive\(roles\)/)
  assert.match(settings, /id="eta-go-live"[\s\S]{0,200}disabled=\{!mayGoLive/)
  for (const api of ['"/api/eta/settings"', '"/api/eta/codes"', '"/api/eta/memory/prepare"', "`/api/eta/memory"]) assert.ok(settings.includes(api), api)
})

test("E24. preview dialog: readable errors, handled-manually totals, amount mismatch, empty unit, line confirm", () => {
  const dlg = src(PREVIEW_DIALOG)
  // a failed load shows a translated message (never the raw object)
  assert.match(dlg, /setError\(/)
  assert.match(dlg, /t\("eta\.preview-error"\)/)
  // handled manually: the note, the stored ETA ID and totals labelled "for reference"
  assert.match(dlg, /preview\.handledManually \? t\("eta\.totals-reference"\)/)
  assert.match(dlg, /preview\.manualEtaUuid/)
  // the amount mismatch has its own plain message with both amounts
  assert.match(dlg, /amount_mismatch[\s\S]{0,200}eta\.missing-amount_mismatch/)
  assert.match(dlg, /storedAmount/)
  // an empty unit is no unit
  assert.match(dlg, /const hasUnit = \(u: string \| null \| undefined\) => !!u && u\.trim\(\) !== ""/)
  // confirming a line remembers it and reloads the preview
  assert.match(dlg, /fetch\("\/api\/eta\/memory", \{\s*method: "POST"[\s\S]{0,400}await onSaved\(\)/)
  assert.match(dlg, /onSaved=\{load\}/)
  // already on the portal: mark and undo
  assert.match(dlg, /method: "POST"[\s\S]{0,200}etaUuid/)
  assert.match(dlg, /method: "DELETE"/)

  // product code picker keeps the product's own code even when that code was switched off
  const product = src("components/modules/product-module.tsx")
  assert.match(product, /c\.active !== false \|\| c\.code_id === product\.etaCodeId/)
})

test("E25. every e-invoice screen text is in English and Arabic", () => {
  const i18n = src("lib/i18n-context.tsx")
  const arAt = i18n.indexOf("\n  ar: {")
  const en = i18n.slice(0, arAt)
  const arb = i18n.slice(arAt)
  const keys = new Set<string>(["module.e-invoice-settings"])
  for (const f of [SETTINGS_SCREEN, PREVIEW_DIALOG, "components/modules/accounts-receivable-module.tsx"]) {
    for (const m of src(f).matchAll(/"(eta\.[\w.-]+)"/g)) keys.add(m[1])
    for (const m of src(f).matchAll(/`(eta\.[\w-]+-)\$\{/g)) keys.add(m[1] + "*")
  }
  const dyn: Record<string, string[]> = {
    "eta.state-": ["green", "orange", "red"],
    "eta.missing-": ["company_rin", "company_activity", "company_address", "customer_tax_number", "customer_address", "line_codes", "amount_mismatch"],
    "eta.unit-": ["EA", "SET", "KGM", "MTR", "LTR", "BOX"],
    "eta.env-": ["test", "real"],
    "eta.refuse-": ["amount_mismatch", "already_live", "final", "not_found", "no_issue_date", "build_failed", "handled_manually", "other"],
    "eta.doc-": ["pending_signature", "submitted", "valid", "invalid", "cancelled", "rejected"],
  }
  const all: string[] = []
  for (const k of keys) {
    if (!k.endsWith("*")) all.push(k)
    else {
      const base = k.slice(0, -1)
      assert.ok(dyn[base], `dynamic key ${base} listed in the test`)
      for (const v of dyn[base]) all.push(base + v)
    }
  }
  assert.ok(all.length > 40, String(all.length))
  for (const k of all) {
    const at = (block: string) => block.match(new RegExp(`^\\s+"${k.replace(/[.]/g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"))?.[1]
    assert.ok(at(en), `EN ${k}`)
    assert.ok(/[؀-ۿ]/.test(at(arb) || ""), `AR ${k}`)
  }
})

test("E26. prepare list: a changed code takes that code's default unit, an unchanged one keeps its matched unit", () => {
  const codes = [
    { code_id: 1, default_unit: "EA" },
    { code_id: 2, default_unit: "SET" },
    { code_id: 3, default_unit: null },
  ]
  const rows = [
    { name: "kept", codeId: 1, unit: "BOX", pick: "1", skip: false },
    { name: "changed", codeId: 1, unit: "BOX", pick: "2", skip: false },
    { name: "picked for a red row", codeId: null, unit: "EA", pick: "2", skip: false },
    { name: "code without a default", codeId: null, unit: "EA", pick: "3", skip: false },
    { name: "skipped", codeId: 1, unit: "EA", pick: "1", skip: true },
    { name: "no code", codeId: null, unit: "EA", pick: "none", skip: false },
  ]
  assert.deepEqual(prepareRowsToPost(rows, codes), [
    { name: "kept", codeId: 1, unitType: "BOX" },
    { name: "changed", codeId: 2, unitType: "SET" },
    { name: "picked for a red row", codeId: 2, unitType: "SET" },
    { name: "code without a default", codeId: 3, unitType: "" },
  ])
  assert.match(src(SETTINGS_SCREEN), /prepareRowsToPost\(prepare \|\| \[\], codes\)/)
})

// ---------------------------------------------------------------------------------------------------------
// Final review fixes
// ---------------------------------------------------------------------------------------------------------
const cairoDay = (offsetDays = 0) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const [y, m, d] = today.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10)
}

test("E27. go-live: only a future Cairo date; a go-live that has started cannot be changed or cleared", async () => {
  const db = new FakeDb({ users: [{ user_id: 7 }], company_settings: [] })
  useDb(db)
  const put = (body: unknown, roles = "ceo") => etaSettingsRoute.PUT(ereq("PUT", body, roles)).then(out)
  // today and earlier are refused, tomorrow is fine
  for (const day of [cairoDay(0), cairoDay(-1), "2020-01-01"]) {
    const r = await put({ eta_go_live_at: day })
    assert.equal(r.status, 400, day)
    assert.match(r.body.error, /after today/i, day)
    assert.equal(setting(db, "eta_go_live_at"), undefined, day)
  }
  assert.equal((await put({ eta_go_live_at: cairoDay(1) })).status, 200)
  assert.equal(goLiveOf(setting(db, "eta_go_live_at")), cairoDay(1))
  // a future go-live can still be moved or cleared
  assert.equal((await put({ eta_go_live_at: cairoDay(30) })).status, 200)
  assert.equal(goLiveOf(setting(db, "eta_go_live_at")), cairoDay(30))
  assert.equal((await put({ eta_go_live_at: "" })).status, 200)
  assert.equal(setting(db, "eta_go_live_at"), "")
  // a go-live that has passed is locked
  db.tables.company_settings.find((r) => r.setting_key === "eta_go_live_at")!.setting_value = "2026-01-01T00:00:00+02:00"
  for (const value of [cairoDay(10), ""]) {
    const r = await put({ eta_go_live_at: value })
    assert.equal(r.status, 409, `locked: ${value}`)
    assert.match(r.body.error, /started/i)
  }
  assert.equal(setting(db, "eta_go_live_at"), "2026-01-01T00:00:00+02:00")
  // saving the same date with other fields still works
  assert.equal((await put({ eta_go_live_at: "2026-01-01", eta_branch_id: "1" }, "accountant")).status, 200)
  assert.equal(setting(db, "eta_branch_id"), "1")
  assert.equal(setting(db, "eta_go_live_at"), "2026-01-01T00:00:00+02:00")

  // the generic settings route cannot write the go-live key
  const generic = (body: unknown) => genericSettingsRoute.PUT(ereq("PUT", body, "ceo", "http://test.local/api/settings")).then(out)
  const g = await generic({ key: "eta_go_live_at", value: "2020-01-01" })
  assert.equal(g.status, 400)
  assert.equal(setting(db, "eta_go_live_at"), "2026-01-01T00:00:00+02:00")
  assert.equal((await generic({ key: " ETA_GO_LIVE_AT ", value: "2020-01-01" })).status, 400)
  assert.equal((await generic({ key: "company_name", value: "MM" })).status, 200)

  // the screen: the date input starts tomorrow; once started it is read-only with a note
  const screen = src(SETTINGS_SCREEN)
  assert.match(screen, /min=\{goLiveMin\}/)
  assert.match(screen, /goLiveStarted\(settings\.eta_go_live_at\)/)
  assert.match(screen, /readOnly=\{started\}/)
  assert.match(screen, /"eta\.go-live-started"/)
  const i18n = src("lib/i18n-context.tsx")
  const arAt = i18n.indexOf("\n  ar: {")
  const enKey = i18n.slice(0, arAt).match(/"eta\.go-live-started": "([^"]*)",\n\s+"so\.print-plain"/)
  const arKey = i18n.slice(arAt).match(/"eta\.go-live-started": "([^"]*)",\n\s+"so\.print-plain"/)
  assert.ok(enKey && enKey[1].includes("{date}"), "EN key before so.print-plain")
  assert.ok(arKey && arKey[1].includes("{date}") && /[؀-ۿ]/.test(arKey[1]), "AR key before so.print-plain")
})

test("E28. memory: learning a core name never overwrites an existing row under that name", async () => {
  const db = new FakeDb({
    users: [{ user_id: 7 }],
    eta_item_codes: [
      { code_id: 1, item_code: "A", keywords: [], default_unit: "EA", active: true },
      { code_id: 2, item_code: "B", keywords: [], default_unit: "EA", active: true },
    ],
  })
  useDb(db)
  const post = (body: unknown) => etaMemoryRoute.POST(ereq("POST", body)).then(out)
  const row = (n: string) => db.tables.eta_code_memory.find((r) => r.normalized_name === n)
  assert.equal((await post({ name: "ترولي عدة", codeId: 2, unitType: "EA" })).status, 200)
  assert.equal((await post({ name: "ترولي عدة Stanley", codeId: 1, unitType: "SET" })).status, 200)
  assert.equal(row("ترولي عده")!.code_id, 2, "the exact name the accountant confirmed keeps code 2")
  assert.equal(row("ترولي عده")!.unit_type, "EA")
  assert.equal(row("ترولي عده stanley")!.code_id, 1)
  assert.equal(row("ترولي عده stanley")!.core_name, "ترولي عده")
  // so the core-conflict rule still fires for a new brand variant
  const ctx = await loadEtaCtx(db as any)
  const m = matchCode({ name: "ترولي عدة Bosch" }, ctx)
  assert.equal(m.state, "orange")
  // a core row is still created when none exists, and an exact confirmation of that name still wins
  assert.equal((await post({ name: "مفك Bosch", codeId: 1, unitType: "EA" })).status, 200)
  assert.equal(row("مفك")!.code_id, 1)
  assert.equal((await post({ name: "مفك", codeId: 2, unitType: "EA" })).status, 200)
  assert.equal(row("مفك")!.code_id, 2)
  assert.equal((await post({ name: "مفك Stanley", codeId: 1, unitType: "EA" })).status, 200)
  assert.equal(row("مفك")!.code_id, 2)
})

test("E29. product card picker sends only the id and the changed e-invoice field; a partial PUT keeps the rest", async () => {
  const db = new FakeDb({ products: [{ product_id: 1, product_name: "P", sku: "S", unit_price: 9.5, moq: 3, desired_excess: 2, unit: "pcs", eta_code_id: null, eta_unit_type: null, created_at: "2026-01-01" }] })
  useDb(db)
  const r = await productsRoute.PUT(ereq("PUT", { id: "1", etaCodeId: 4 })).then(out)
  assert.equal(r.status, 200)
  const p = db.tables.products[0]
  assert.deepEqual([p.product_name, p.sku, p.unit_price, p.moq, p.desired_excess, p.unit, p.eta_code_id], ["P", "S", 9.5, 3, 2, "pcs", 4])
  assert.equal((await productsRoute.PUT(ereq("PUT", { id: "1", etaUnitType: "SET" })).then(out)).status, 200)
  assert.deepEqual([p.unit_price, p.eta_code_id, p.eta_unit_type], [9.5, 4, "SET"])
  const product = src("components/modules/product-module.tsx")
  assert.doesNotMatch(product, /updateProduct\(\{\s*\.\.\.product/)
  assert.match(product, /updateProduct\(\{ id: product\.id, \.\.\.patch \}\)/)
})

test("E30. prepare: the server takes at most 50 items; the screen sends them in chunks of 50", async () => {
  const db = new FakeDb({ users: [{ user_id: 7 }], eta_item_codes: [{ code_id: 1, item_code: "H", keywords: [], default_unit: "EA", active: true }], company_settings: [] })
  useDb(db)
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `قطعة ${i}`, codeId: 1, unitType: "EA" }))
  const tooMany = await etaPrepareRoute.POST(ereq("POST", { items: many(51) })).then(out)
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.body.error, /50/)
  assert.equal((db.tables.eta_code_memory || []).length, 0, "nothing saved")
  const ok = await etaPrepareRoute.POST(ereq("POST", { items: many(50) })).then(out)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.saved, 50)

  assert.equal(PREPARE_BATCH, 50)
  const items = Array.from({ length: 120 }, (_, i) => i)
  const parts = chunk(items, PREPARE_BATCH)
  assert.deepEqual(parts.map((p) => p.length), [50, 50, 20])
  assert.deepEqual(parts.flat(), items)
  assert.deepEqual(chunk([], 50), [])
  assert.deepEqual(chunk([1, 2], 50), [[1, 2]])

  const screen = src(SETTINGS_SCREEN)
  assert.match(screen, /chunk\(toConfirm, PREPARE_BATCH\)/)
  assert.match(screen, /"eta\.prepare-progress"/)
})

test("E31. a brand-only or size-only name against real memory rows (Review Focus 1)", () => {
  const codes: EtaCode[] = [
    { codeId: 1, itemCode: "H", name: "Hand", keywords: ["3/8"], defaultUnit: "EA", active: true },
    { codeId: 2, itemCode: "P", name: "Power", keywords: [], defaultUnit: "EA", active: true },
  ]
  const n = normalizeName("Bosch")
  const memory: MemoryRow[] = [{ normalizedName: n, coreName: coreName(n, DEFAULT_BRANDS), codeId: 2, unitType: "EA" }]
  assert.equal(memory[0].coreName, "")
  const ctx = { codes, memory, brands: DEFAULT_BRANDS }
  assert.deepEqual(matchCode({ name: "Stanley" }, ctx), { codeId: null, unit: "EA", state: "red", by: "none" })
  assert.deepEqual(matchCode({ name: "Bosch" }, ctx), { codeId: 2, unit: "EA", state: "green", by: "memory" })
  assert.deepEqual(matchCode({ name: "3/8" }, ctx), { codeId: 1, unit: "EA", state: "orange", by: "keyword" })
})
