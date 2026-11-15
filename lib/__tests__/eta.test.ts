// E-invoice (Egyptian Tax Authority) step 1.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeName, coreName, similarity, DEFAULT_BRANDS } from "../eta/normalize"
import { matchCode, type EtaCode, type MemoryRow } from "../eta/codes"

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
