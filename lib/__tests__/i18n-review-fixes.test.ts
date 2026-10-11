// Final-review fixes (I1, I2, I3): PO assistant examples stay English, data enum values are translated at render
// time, and on-screen "N/A" fallbacks go through t("label.na"). Source scanning only; nothing here changes data.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const I18N = read("lib/i18n-context.tsx")
const AR_AT = I18N.indexOf("\n  ar: {")
const AR_SRC = I18N.slice(AR_AT)
const arValue = (key: string): string => {
  const m = AR_SRC.match(new RegExp(`^\\s+"${key.replace(/[.]/g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"))
  assert.ok(m, `AR key ${key} exists`)
  return JSON.parse(`"${m![1]}"`).toLowerCase()
}

// (a) I1: app/api/ai/po-assistant/route.ts only matches these English keywords.
test("PO assistant example commands keep the English keywords the route matches", () => {
  const need: Record<string, string[]> = {
    "ai.ex-suppliers": ["show", "supplier"],
    "ai.ex-products": ["show", "product"],
    "ai.ex-order-pumps": ["order"],
    "ai.ex-installments": ["purchase", "installment", "6 month"],
    "ai.try-po": ["order", "show me available suppliers"],
  }
  for (const [key, words] of Object.entries(need)) {
    const v = arValue(key)
    for (const w of words) assert.ok(v.includes(w), `${key} (AR) contains "${w}": ${v}`)
  }
})

// (b) I2: render sites no longer print the raw value.
const SITES: Array<{ file: string; must: RegExp[]; mustNot: RegExp[] }> = [
  {
    file: "components/sales-order/maintenance-tab.tsx",
    must: [/statusLabel\(status, t\)\.toUpperCase\(\)/, /statusLabel\(workOrder\.priority, t\)\.toUpperCase\(\)/],
    mustNot: [/status\.replace\("_", " "\)\.toUpperCase\(\)/, /\{workOrder\.priority\.toUpperCase\(\)\}/],
  },
  {
    file: "components/modules/accountant-module.tsx",
    must: [/t\(`payment\.\$\{order\.paymentTerms/, /t\(`payment\.\$\{po\.paymentTerms/, /t\(`payment\.\$\{selectedSalesOrder\.paymentTerms/],
    mustNot: [/>\{order\.paymentTerms\}</, />\{po\.paymentTerms\}</, />\{selectedSalesOrder\.paymentTerms\}</],
  },
  {
    file: "components/modules/hr-management-module.tsx",
    must: [/HR_EMPLOYMENT_TYPE_KEYS/, /HR_EMPLOYMENT_STATUS_KEYS/, /HR_FREQUENCY_KEYS/],
    mustNot: [/\{employee\.employment_type\.replace/, /\{employee\.employment_status\.replace/, /frequency: activeCompensation\.payment_frequency \}/],
  },
  {
    file: "components/modules/shipping-module.tsx",
    must: [/returnReasonLabel\(item\.reason, t\)/],
    mustNot: [/<Badge variant="secondary">\{item\.reason\}<\/Badge>/],
  },
  {
    file: "components/modules/warehouse-delivery-module.tsx",
    must: [/returnReasonLabel\(item\.reason, t\)/],
    mustNot: [/<Badge variant="secondary">\{item\.reason\}<\/Badge>/],
  },
  {
    file: "app/admin/users/page.tsx",
    must: [/t\(`role\.\$\{user\.role\}`\)/],
    mustNot: [/\{user\.role\}<\/Badge>/],
  },
  {
    file: "components/accounting/maintenance-invoice-tab.tsx",
    must: [/mi\.net-\$\{/],
    mustNot: [/replace\(\/\\b\\w\/g, l => l\.toUpperCase\(\)\)/],
  },
  {
    file: "components/modules/financial-dashboard.tsx",
    must: [/statusLabel\(aiAnalysis\.financialHealth\.status, t\)\.toUpperCase\(\)/],
    mustNot: [/\$\{aiAnalysis\.financialHealth\.status\.toUpperCase\(\)\}/],
  },
  {
    file: "components/modules/accounts-payable-module.tsx",
    must: [/t\(`payment\.\$\{bankDetails\.paymentType/],
    mustNot: [/\{bankDetails\.paymentType\}<\/p>/],
  },
]
for (const s of SITES) {
  test(`I2 render sites translate values: ${s.file}`, () => {
    const src = read(s.file)
    for (const re of s.must) assert.match(src, re)
    for (const re of s.mustNot) assert.doesNotMatch(src, re)
  })
}

// (c) I3: no "N/A" string literal in display positions. Allowed: the profit-margin sentinel is a data value that is
// translated where it is rendered (the comparison in the financial-dashboard sub line).
const NA_FILES = [
  "components/modules/customer-module.tsx",
  "components/modules/hr-management-module.tsx",
  "components/modules/operations-management-module.tsx",
  "components/modules/shipping-module.tsx",
  "components/modules/accounts-receivable-module.tsx",
  "components/modules/financial-dashboard.tsx",
  "components/modules/approve-sales-quotations-module.tsx",
  "components/modules/warehouse-delivery-module.tsx",
  "components/modules/product-module.tsx",
  "components/modules/metrics-validation-module.tsx",
  "components/modules/accountant-module.tsx",
  "components/accounting/maintenance-invoice-tab.tsx",
  "components/sales/maintenance-approval-tab.tsx",
  "components/shipping/maintenance-tab.tsx",
]
const NA_ALLOWED = [/const profitMargin = /, /profitMargin === "N\/A"/]
test("no on-screen N/A literals remain", () => {
  for (const f of NA_FILES) {
    read(f).split("\n").forEach((line, i) => {
      if (!/["'`]N\/A["'`]/.test(line)) return
      assert.ok(NA_ALLOWED.some((re) => re.test(line)), `${f}:${i + 1} still has an N/A literal: ${line.trim()}`)
    })
  }
})
