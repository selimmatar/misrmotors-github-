// E-invoice (Egyptian Tax Authority) step 1.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeName, coreName, similarity, DEFAULT_BRANDS } from "../eta/normalize"
import { matchCode, type EtaCode, type MemoryRow } from "../eta/codes"
import { etaLines, etaTolerance, isAfterGoLive, type EtaLineIn } from "../eta/totals"
import { FakeDb, type Row } from "./fake-db"
import { cannedDb, nreq } from "./hardening-fixtures"
import { useDb } from "./route-harness"
import * as arPdf from "../../app/api/invoices/ar/[id]/pdf/route"
import { moneyCell } from "../print-html"
import {
  computeInvoiceAmount, computeWholeOrderAmount, createDpInvoices, createSoInvoice, dpInvoicePrintTotals, evaluateDpInvoice,
  invoicedTotalForOrder, loadSoInvoicingState, netInvoiceValue, round2, soDiscountBase,
} from "../invoicing"

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
  const failing = etaDb(UP_LINES, [1], { goLive: "2026-01-01T00:00:00Z" })
  failing.failOn["company_settings:select"] = "relation does not exist"
  const s2 = await loadSoInvoicingState(failing, 1)
  assert.ok(s2, "a failing settings read never blocks invoicing")
  assert.ok(!s2!.etaGoLiveAt)
  const res = await createDpInvoices(failing, [1])
  assert.equal(res.status, 200)
  assert.equal(failing.tables.accounts_receivable[0].amount, today)
  // the go-live value is read when set
  const live = await loadSoInvoicingState(etaDb(UP_LINES, [1], { goLive: "2026-01-01T00:00:00Z" }), 1)
  assert.equal(live!.etaGoLiveAt, "2026-01-01T00:00:00Z")
})

const GO_LIVE = "2026-01-01T00:00:00Z" // before the FakeDb clock (2026-10) and before today

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
