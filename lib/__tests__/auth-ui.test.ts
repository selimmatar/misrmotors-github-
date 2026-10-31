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
