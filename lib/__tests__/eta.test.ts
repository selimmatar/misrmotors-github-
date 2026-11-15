// E-invoice (Egyptian Tax Authority) step 1.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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
