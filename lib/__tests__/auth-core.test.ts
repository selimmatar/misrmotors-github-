// Security and logins (plan 2026-10-28): roles, the rule list, the decision, and the guard that every route has a rule.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { ROLE_PRIORITY, isRole } from "../auth/roles"
import { RULES, PUBLIC_PATHS, ruleFor, allows } from "../auth/permissions"

const ROOT = process.env.REPO_ROOT || process.cwd()

test("roles: priority order and isRole", () => {
  assert.deepEqual(ROLE_PRIORITY, ["admin", "ceo", "accountant", "po-rep", "sales-rep", "warehouse-rep", "shipment"])
  assert.equal(isRole("sales-rep"), true)
  assert.equal(isRole("sales_rep"), false)
  assert.equal(isRole(undefined), false)
})

test("ruleFor: longest prefix on whole path segments", () => {
  assert.equal(ruleFor("/api/sales-quotations/approve")?.prefix, "/api/sales-quotations/approve")
  assert.equal(ruleFor("/api/sales-orders-x"), null)
  assert.equal(ruleFor("/api/accounts-payable/payments")?.prefix, "/api/accounts-payable")
  assert.equal(ruleFor("/api/nothing-here"), null)
  const prefixes = RULES.map((r) => r.prefix)
  assert.equal(new Set(prefixes).size, prefixes.length, "duplicate rule")
})

test("allows: reads vs changes, admin and CEO always, several roles add up", () => {
  const pay = ruleFor("/api/supplier-payments")!
  assert.equal(allows(pay, "POST", ["sales-rep"]), false)
  assert.equal(allows(pay, "POST", ["accountant"]), true)
  assert.equal(allows(pay, "POST", ["ceo"]), true)
  assert.equal(allows(pay, "POST", ["sales-rep", "accountant"]), true)
  assert.equal(allows(ruleFor("/api/hr/employees")!, "GET", ["accountant"]), false)
  assert.equal(allows(ruleFor("/api/users")!, "GET", ["ceo"]), true)
  assert.equal(allows(ruleFor("/api/users")!, "GET", ["accountant"]), false)
  assert.equal(allows(ruleFor("/api/products")!, "GET", ["shipment"]), true)
  assert.equal(allows(ruleFor("/api/products")!, "PUT", ["shipment"]), false)
  assert.equal(allows(ruleFor("/api/po-requests/read-prices")!, "POST", ["po-rep"]), true)
  assert.equal(allows(ruleFor("/api/po-requests/read-prices")!, "POST", ["sales-rep"]), false)
  assert.equal(allows(ruleFor("/api/quotations/read-items")!, "POST", ["sales-rep"]), true)
  assert.equal(allows(ruleFor("/api/pending-counts/details")!, "GET", ["shipment"]), true)
  assert.equal(allows(ruleFor("/api/ai/ceo-chat")!, "POST", ["accountant"]), false)
  assert.equal(allows(pay, "GET", []), false)
})

function apiPaths(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...apiPaths(full))
    else if (entry.name === "route.ts") out.push("/" + path.relative(path.join(ROOT, "app"), dir).split(path.sep).join("/"))
  }
  return out
}

test("guard: every /api route has a rule or is public", () => {
  const paths = apiPaths(path.join(ROOT, "app/api"))
  assert.ok(paths.length > 100, `found only ${paths.length} routes`)
  const uncovered = paths.filter((p) => !PUBLIC_PATHS.includes(p) && ruleFor(p) === null)
  assert.deepEqual(uncovered, [], `routes with no rule: ${uncovered.join(", ")}`)
})
