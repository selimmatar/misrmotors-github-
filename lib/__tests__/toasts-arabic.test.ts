// Pop-up messages must actually show (Toaster mounted once in the root layout, RTL-safe, clear of the phone tab bar),
// plus the nine deferred Arabic/i18n minors. Source scanning only; nothing here changes data.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { allTsx } from "./a11y-scan"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const I18N = read("lib/i18n-context.tsx")
const AR_AT = I18N.indexOf("\n  ar: {")
const EN = I18N.slice(0, AR_AT)
const AR = I18N.slice(AR_AT)
const val = (block: string, key: string): string | undefined => {
  const m = block.match(new RegExp(`^\\s+"${key.replace(/[.]/g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"))
  return m ? JSON.parse(`"${m[1]}"`) : undefined
}
const hasArabic = (s?: string) => !!s && /[؀-ۿ]/.test(s)
const bothDefined = (key: string) => {
  assert.ok(val(EN, key) !== undefined, `EN ${key}`)
  assert.ok(hasArabic(val(AR, key)), `AR ${key}`)
}

// ---- Fix 1: toasts ----
test("root layout imports and renders the Toaster", () => {
  const src = read("app/layout.tsx")
  assert.match(src, /import\s*\{\s*Toaster\s*\}\s*from\s*["']@\/components\/ui\/toaster["']/)
  assert.match(src, /<Toaster\s*\/>/)
  const provider = src.indexOf("<I18nProvider>")
  assert.ok(provider >= 0 && src.indexOf("<Toaster", provider) > provider && src.indexOf("<Toaster") < src.indexOf("</I18nProvider>"),
    "Toaster is inside the providers")
})

test("every toast library used in the code has its Toaster mounted", () => {
  const layout = read("app/layout.tsx")
  const files = allTsx().filter((f) => !f.startsWith("components/ui/"))
  const usesShadcn = files.some((f) => /from\s*["']@\/hooks\/use-toast["']/.test(read(f)))
  const usesSonner = files.some((f) => /from\s*["']sonner["']/.test(read(f)))
  assert.ok(usesShadcn || usesSonner, "some toast library is used")
  if (usesShadcn) assert.match(layout, /components\/ui\/toaster["']/)
  if (usesSonner) assert.match(layout, /components\/ui\/sonner["']/)
})

test("toast viewport is RTL-safe and stays top on phones (clear of the bottom tab bar)", () => {
  const src = read("components/ui/toast.tsx")
  const vp = src.slice(src.indexOf("ToastViewport"), src.indexOf("ToastViewport.displayName"))
  assert.doesNotMatch(vp, /\b(?:sm:|md:)?(?:right|left)-\d/)
  assert.match(vp, /top-0/)
  assert.match(vp, /md:bottom-0/)
  assert.match(vp, /md:end-0/)
  assert.doesNotMatch(vp, /sm:bottom-0/)
})

// ---- Fix 2 ----
test("M1: Unique Products EN wording restored", () => {
  assert.equal(val(EN, "lost-sales.unique-products"), "Unique Products")
  assert.ok(hasArabic(val(AR, "lost-sales.unique-products")))
})

test("M2: work-order on hold has its own key", () => {
  bothDefined("status.on-hold")
  assert.equal(val(EN, "status.on-hold"), "On hold")
  assert.equal(val(AR, "status.on-hold"), "معلق")
  assert.match(read("components/shipping/maintenance-tab.tsx"), /on_hold:\s*\{\s*label:\s*"status\.on-hold"/)
})

test("M3: empty payment type shows a dash, not Unknown", () => {
  const src = read("components/modules/accounts-receivable-module.tsx")
  assert.doesNotMatch(src, /getSOPaymentType\(salesOrderId\) \|\| "Unknown"/)
  assert.match(src, /paymentType \? t\(`payment\.\$\{paymentType\}`\) : "—"/)
})

test("M4: CEO suggested questions send the question in the current language", () => {
  const src = read("components/modules/ceo-chat-assistant.tsx")
  assert.doesNotMatch(src, /What's our current financial position\?/)
  for (const k of ["financial-position", "cash-flow", "low-stock", "top-customers"]) {
    bothDefined(`ceo.q.${k}`)
    assert.match(src, new RegExp(`ceo\\.q\\.${k}`))
  }
  assert.match(val(EN, "ceo.q.financial-position")!, /financial position/i)
})

test("M5: login subtitle is translated", () => {
  const src = read("components/auth/login-page.tsx")
  assert.doesNotMatch(src, />Select your role to access the system</)
  assert.match(src, /t\("login\.select-role"\)/)
  assert.equal(val(EN, "login.select-role"), "Select your role to access the system")
  assert.equal(val(AR, "login.select-role"), "اختر دورك للدخول إلى النظام")
})

test("M6: errors are stored as keys and translated at render", () => {
  const lost = read("components/modules/lost-sales-module.tsx")
  assert.doesNotMatch(lost, /setError\(t\(/)
  assert.match(lost, /\{t\(error\)\}/)
  const ceo = read("components/modules/ceo-chat-assistant.tsx")
  assert.doesNotMatch(ceo, /setChatError\(t\(/)
  assert.match(ceo, /chatErrorText/)
})

test("M7: display-only Unknown fallbacks go through t()", () => {
  const ar = read("components/modules/accounts-receivable-module.tsx")
  assert.doesNotMatch(ar, /getCustomerName\(customerId\) \|\| "Unknown Customer"/)
  assert.match(ar, /t\("acct\.unknown-customer"\)/)
  const fin = read("components/modules/financial-dashboard.tsx")
  assert.doesNotMatch(fin, /displayCustomerName = [^\n]*"Unknown Customer"/)
})

test("M8: local assistant messages are not sent as history", () => {
  const src = read("components/modules/ai-assistant-module.tsx")
  assert.match(src, /local:\s*true/)
  assert.match(src, /messages:\s*\[\.\.\.messages,\s*userMessage\]\.filter\(\(m\) => !m\.local\)/)
})

test("M9: margin sentence is one fill() template", () => {
  bothDefined("analytics.margin-sentence")
  assert.match(val(EN, "analytics.margin-sentence")!, /\{status\}/)
  assert.match(val(AR, "analytics.margin-sentence")!, /\{status\}/)
  assert.match(val(AR, "analytics.margin-sentence")!, /\{advice\}/)
  const src = read("components/modules/analytics-dashboard.tsx")
  assert.match(src, /analytics\.margin-sentence/)
  assert.doesNotMatch(src, /analytics\.profit-margin-is/)
})
