// Login screens (security build, Tasks 6–7): source-level checks, like the other module tests.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")

test("accounts screen: uses the server API, never the browser, for accounts", () => {
  const src = read("components/modules/user-management-module.tsx")
  assert.match(src, /fetch\("\/api\/users"\)/)
  assert.match(src, /method,\s*\n?\s*headers/)
  assert.match(src, /send\("POST"/)
  assert.match(src, /send\("PUT", \{ userId: [^}]*action: "update"/)
  assert.match(src, /action: "reset-password"/)
  assert.match(src, /active \? "reactivate" : "deactivate"/)
  assert.doesNotMatch(src, /localStorage/)
  assert.doesNotMatch(src, /password:\s*newUserPassword/)
})

test("accounts screen: phone login shown but disabled; every role offered; HR link optional", () => {
  const src = read("components/modules/user-management-module.tsx")
  assert.match(src, /<RadioGroupItem id="m-phone" value="phone" disabled \/>/)
  assert.match(src, /ROLES\.map\(\(r\) =>/)
  assert.match(src, /fetch\("\/api\/hr\/employees"\)/)
  assert.match(src, /t\("users\.hr-none"\)/)
})

test("accounts screen: no hard-coded English text between tags", () => {
  const src = read("components/modules/user-management-module.tsx")
  const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'!?-]{2,})\s*</g)].map((m) => m[1])
  assert.deepEqual(jsxText, [])
})

test("old /admin/users page only sends people to the app", () => {
  const src = read("app/admin/users/page.tsx")
  assert.match(src, /redirect\("\/"\)/)
  assert.doesNotMatch(src, /DELETE/)
})

// ---- Task 7: several roles on one screen ----
import { effectiveRoleFor, navItemsForRoles, primaryRole } from "../auth/role-nav"
import { responseAction } from "../auth/client-fetch"

test("navItemsForRoles: union of the roles' screens, each once, in role-priority order", () => {
  const ids = navItemsForRoles(["warehouse-rep", "accountant"]).map((i) => i.id)
  assert.equal(ids.filter((id) => id === "accounts-payable").length, 1)
  assert.equal(ids.filter((id) => id === "warehouse-transfers").length, 1)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.indexOf("accounts-payable") < ids.indexOf("warehouse-delivery"), "accountant items come first")
  assert.deepEqual(navItemsForRoles([]), [])
})

test("effectiveRoleFor: the highest-priority role that has the screen, else the main role", () => {
  assert.equal(effectiveRoleFor("delivery-permits", ["warehouse-rep", "accountant"]), "accountant")
  assert.equal(effectiveRoleFor("warehouse-delivery", ["warehouse-rep", "accountant"]), "warehouse-rep")
  assert.equal(effectiveRoleFor("no-such-screen", ["warehouse-rep", "accountant"]), "accountant")
  assert.equal(primaryRole(["shipment", "admin"]), "admin")
  assert.equal(primaryRole([]), null)
})

test("responseAction: 401 AUTH_REQUIRED logs out; 403 FORBIDDEN only tells; others pass", () => {
  assert.equal(responseAction(401, { code: "AUTH_REQUIRED" }), "logout")
  assert.equal(responseAction(403, { code: "FORBIDDEN" }), "forbidden")
  assert.equal(responseAction(401, { error: "Unauthorized" }), null)
  assert.equal(responseAction(403, { code: "ACCOUNT_OFF" }), null)
  assert.equal(responseAction(200, { code: "AUTH_REQUIRED" }), null)
  assert.equal(responseAction(401, null), null)
})

test("start screen: asks who is logged in, keeps the role picker only when logins are off", () => {
  const page = read("app/page.tsx")
  assert.match(page, /fetch\("\/api\/auth\/me"/)
  assert.match(page, /fetch\("\/api\/auth\/logout", \{ method: "POST" \}\)/)
  assert.match(page, /mustChangePassword/)
  assert.match(page, /installAuthFetch\(/)
  const login = read("components/auth/login-page.tsx")
  assert.match(login, /mode === "off"/)
  assert.match(login, /<AccountLogin/)
  const form = read("components/auth/account-login.tsx")
  assert.match(form, /fetch\("\/api\/auth\/login"/)
  assert.match(form, /fetch\("\/api\/auth\/forgot"/)
  assert.match(form, /type=\{show \? "text" : "password"\}/)
})

test("dashboard: menu from all roles; each screen opens with the role that owns it", () => {
  const d = read("components/dashboard/dashboard.tsx")
  assert.match(d, /navItemsForRoles\(roles\)/)
  assert.match(d, /effectiveRoleFor\(activeModule, roles\)/)
  assert.doesNotMatch(d, /ROLE_MODULES\[user\.role\]/)
})
