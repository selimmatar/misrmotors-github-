// Owner report 2026-11-25: the customers search and the inventory Sold search did not work.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { matchesSearch } from "../search-match"

const REPO = process.env.REPO_ROOT || process.cwd()

test("SF1. matching: any field, any case, Arabic digits, missing fields skipped, empty query matches all", () => {
  const acme = ["Acme Trading", null, undefined, "01001234567", ""]
  assert.equal(matchesSearch("", acme), true)
  assert.equal(matchesSearch("  acme ", acme), true)
  assert.equal(matchesSearch("ACME", acme), true)
  assert.equal(matchesSearch("٠١٠٠١٢", acme), true, "phone typed on an Arabic keyboard")
  assert.equal(matchesSearch("xyz", acme), false, "no crash on missing fields")
  assert.equal(matchesSearch("شركة", ["شركة النور"]), true)
  assert.equal(matchesSearch("so-9", ["SO-9"]), true)
})

test("SF2. the customers list uses the safe search; the inventory search narrows Pending and Sold too", () => {
  const customers = readFileSync(join(REPO, "components/modules/customer-module.tsx"), "utf8")
  assert.match(customers, /customers\.filter\(\(customer: any\) =>\s*matchesSearch\(searchQuery, \[customer\.name, customer\.email, customer\.phone/)
  assert.ok(!customers.includes("customer.email.toLowerCase()"))
  const inv = readFileSync(join(REPO, "components/modules/inventory-module.tsx"), "utf8")
  assert.match(inv, /return items\.filter\(searchHit\)\n\s*\}, \[[^\]]*searchQuery\]\)/, "Pending")
  assert.match(inv, /return items\.filter\(searchHit\)\.sort\([^\n]*\n\s*\}, \[[^\]]*searchQuery\]\)/, "Sold")
})
