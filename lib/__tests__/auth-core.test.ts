// Security and logins (plan 2026-10-28): roles, the rule list, the decision, and the guard that every route has a rule.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { ROLE_PRIORITY, isRole } from "../auth/roles"
import { RULES, PUBLIC_PATHS, ruleFor, allows } from "../auth/permissions"
import { authMode, decide, identityFromAuthUser, identityHeaders, isIdle, loginAddress, type Identity } from "../auth/decide"

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

const person = (roles: Identity["roles"], active = true): Identity => ({ userId: 7, name: "Mona Ali", roles, active })

test("authMode: off unless test or on", () => {
  assert.equal(authMode({}), "off")
  assert.equal(authMode({ AUTH_MODE: "ON" }), "on")
  assert.equal(authMode({ AUTH_MODE: " test " }), "test")
  assert.equal(authMode({ AUTH_MODE: "maybe" }), "off")
})

test("decide: off allows everything; on refuses; test only records", () => {
  const base = { path: "/api/supplier-payments", method: "POST", idle: false }
  assert.deepEqual(decide({ ...base, mode: "off", identity: null }), { kind: "allow" })
  const noOne = decide({ ...base, mode: "on", identity: null })
  assert.equal(noOne.kind, "refuse")
  assert.equal(noOne.kind === "refuse" && noOne.status, 401)
  assert.equal(noOne.kind === "refuse" && noOne.body.code, "AUTH_REQUIRED")
  assert.equal(decide({ ...base, mode: "on", identity: person(["accountant"], false) }).kind, "refuse")
  const idle = decide({ ...base, mode: "on", identity: person(["accountant"]), idle: true })
  assert.equal(idle.kind === "refuse" && idle.status, 401)
  const wrong = decide({ ...base, mode: "on", identity: person(["sales-rep"]) })
  assert.equal(wrong.kind === "refuse" && wrong.status, 403)
  assert.equal(wrong.kind === "refuse" && wrong.body.code, "FORBIDDEN")
  assert.match(wrong.kind === "refuse" ? wrong.body.error : "", /cannot/)
  assert.deepEqual(decide({ ...base, mode: "on", identity: person(["accountant"]) }), { kind: "allow" })
  const noRule = decide({ mode: "on", path: "/api/nothing-here", method: "GET", identity: person(["ceo"]), idle: false })
  assert.equal(noRule.kind === "refuse" && noRule.status, 403)
  assert.deepEqual(decide({ mode: "on", path: "/api/auth/login", method: "POST", identity: null, idle: false }), { kind: "allow" })
  const t = decide({ ...base, mode: "test", identity: person(["sales-rep"]) })
  assert.equal(t.kind, "would-refuse")
  assert.equal(t.kind === "would-refuse" && t.status, 403)
  // only /api is checked
  assert.deepEqual(decide({ mode: "on", path: "/", method: "GET", identity: null, idle: false }), { kind: "allow" })
})

test("identityFromAuthUser: reads app_metadata only, turned-off accounts are inactive", () => {
  assert.equal(identityFromAuthUser(null), null)
  assert.equal(identityFromAuthUser({ app_metadata: {} }), null)
  assert.equal(identityFromAuthUser({ app_metadata: { app_user_id: 3 }, user_metadata: { roles: ["admin"] } } as any)?.roles.length, 0)
  const ok = identityFromAuthUser({ app_metadata: { app_user_id: 3, roles: ["accountant", "nope"], name: "Mona", active: true } })
  assert.deepEqual(ok, { userId: 3, name: "Mona", roles: ["accountant"], active: true })
  assert.equal(identityFromAuthUser({ app_metadata: { app_user_id: 3, roles: ["admin"], active: false } })?.active, false)
  const future = new Date(Date.now() + 86400000).toISOString()
  assert.equal(identityFromAuthUser({ app_metadata: { app_user_id: 3, roles: ["admin"] }, banned_until: future })?.active, false)
})

test("identityHeaders: forged x-mm headers are always removed", () => {
  const forged = new Headers({ "x-mm-roles": "admin", "x-mm-user-id": "1", "x-mm-name": "x", accept: "a" })
  const none = identityHeaders(forged, null)
  assert.equal(none.get("x-mm-roles"), null)
  assert.equal(none.get("x-mm-user-id"), null)
  assert.equal(none.get("x-mm-name"), null)
  assert.equal(none.get("accept"), "a")
  const real = identityHeaders(forged, person(["sales-rep", "accountant"]))
  assert.equal(real.get("x-mm-user-id"), "7")
  assert.equal(real.get("x-mm-roles"), "sales-rep,accountant")
  assert.equal(decodeURIComponent(real.get("x-mm-name") || ""), "Mona Ali")
})

test("loginAddress and isIdle", () => {
  assert.equal(loginAddress(" Ahmed "), "ahmed@staff.misrmotors.app")
  assert.equal(loginAddress("A@B.com"), "a@b.com")
  const now = Date.now()
  assert.equal(isIdle(undefined, now), false)
  assert.equal(isIdle(String(now - 11 * 3600000), now), false)
  assert.equal(isIdle(String(now - 13 * 3600000), now), true)
  assert.equal(isIdle("garbage", now), false)
})

// ---- Task 5: new-account rules and "who is acting" ----
import { validateNewUser } from "../auth/users-admin"
import { actorUserId } from "../auth/actor"

test("validateNewUser: each rule", () => {
  const good = { fullName: " Mona ", loginMethod: "email", email: "Mona@Example.com", roles: ["accountant"], tempPassword: "temp-1234" }
  const ok = validateNewUser(good)
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.value.fullName, "Mona")
    assert.equal(ok.value.email, "mona@example.com")
    assert.deepEqual(ok.value.roles, ["accountant"])
    assert.equal(ok.value.employeeId, null)
  }
  const bad = (over: Record<string, unknown>) => {
    const r = validateNewUser({ ...good, ...over })
    assert.equal(r.ok, false, JSON.stringify(over))
    return r.ok ? "" : r.error
  }
  bad({ fullName: "  " })
  bad({ roles: [] })
  bad({ roles: ["boss"] })
  bad({ email: "not-an-email" })
  bad({ email: "x@staff.misrmotors.app" })
  bad({ loginMethod: "username", username: "a b" })
  bad({ loginMethod: "username", username: "ab" })
  assert.equal(bad({ loginMethod: "phone" }), "Phone login is coming soon")
  bad({ loginMethod: "fax" })
  bad({ tempPassword: "short" })
  bad({ employeeId: "abc" })
  const u = validateNewUser({ ...good, loginMethod: "username", username: "Ahmed.K", email: undefined, roles: ["warehouse-rep", "warehouse-rep"], employeeId: "4" })
  assert.equal(u.ok, true)
  if (u.ok) {
    assert.equal(u.value.username, "ahmed.k")
    assert.deepEqual(u.value.roles, ["warehouse-rep"])
    assert.equal(u.value.employeeId, 4)
  }
  assert.equal(validateNewUser(null).ok, false)
})

test("actorUserId: login header first, then the old body value, else null", () => {
  const req = (h?: string) => new Request("http://t/api", { headers: h === undefined ? {} : { "x-mm-user-id": h } })
  assert.equal(actorUserId(req("7"), "admin-123"), 7)
  assert.equal(actorUserId(req(), "12"), 12)
  assert.equal(actorUserId(req(), "admin-123"), null)
  assert.equal(actorUserId(req("abc"), 5), 5)
  assert.equal(actorUserId(req("0")), null)
})
