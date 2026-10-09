// Frame and building blocks (spec §3–§4): logical (RTL-safe) classes only, approval keys in EN and AR.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const I18N = read("lib/i18n-context.tsx")
const AR_AT = I18N.indexOf("\n  ar: {")
const EN = I18N.slice(0, AR_AT)
const AR = I18N.slice(AR_AT)

const ERP_DIR = path.join(REPO, "components/erp")
const FRAME_FILES: string[] = [
  ...(fs.existsSync(ERP_DIR) ? fs.readdirSync(ERP_DIR).filter((f) => f.endsWith(".tsx")).map((f) => `components/erp/${f}`) : []),
  "components/layout/sidebar.tsx",
  "components/layout/header.tsx",
  "components/layout/mobile-tabs.tsx",
  "components/auth/login-page.tsx",
]

const BAD = /(?<![\w-])(?:(?:ml|mr|pl|pr|left|right)-[\w[]|text-(?:left|right)\b|(?:border|rounded)-[lr]\b|flex-row\b)/
// catches border-r and border-r-2; ignores border-red-500, side="left", aria-* and ms-/me-/start-/end-
test("RTL: logical classes only", () => {
  for (const f of FRAME_FILES) for (const [n, line] of read(f).split("\n").entries())
    assert.doesNotMatch(line, BAD, `${f}:${n + 1}`)
})

test("approval and table keys exist in EN and AR", () => {
  assert.equal(AR_AT > 0, true)
  for (const k of ["approval.title", "approval.step", "approval.of", "approval.complete", "approval.not-started",
    "approval.accountant", "approval.warehouse", "approval.shipping", "approval.delivered", "field.actions"]) {
    assert.ok(EN.includes(`"${k}":`), `EN ${k}`); assert.ok(AR.includes(`"${k}":`), `AR ${k}`) }
})

test("components/erp exists", () => { assert.equal(FRAME_FILES.length >= 6, true) })

test("Welcome is gone from the top bar", () => {
  assert.ok(!read("components/layout/header.tsx").includes('t("welcome")'))
})

test("login keeps every role, name and handler", () => {
  const src = read("components/auth/login-page.tsx")
  const ROLES: Array<[string, string]> = [["admin", "Administrator"], ["ceo", "CEO / Owner"], ["accountant", "Accountant"],
    ["sales-rep", "Sales Representative"], ["po-rep", "Purchasing Agent"], ["warehouse-rep", "Warehouse Representative"],
    ["shipment", "Shipping & Operations"]]
  for (const [role, name] of ROLES) {
    assert.ok(src.includes(`role: "${role}" as const`), role)
    assert.ok(src.includes(`name: "${name}"`), name)
  }
  assert.ok(src.includes("onLogin(user)"))
  assert.ok(src.includes("Select your role to access the system"))
})

test("login cards are neutral: no gradient, no scale, no solid role colours", () => {
  const src = read("components/auth/login-page.tsx")
  assert.doesNotMatch(src, /bg-gradient|hover:scale-|text-white|bg-\w+-500/)
})
