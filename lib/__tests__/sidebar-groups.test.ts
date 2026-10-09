// Sidebar groups and the phone tab model (spec §5): role item sets unchanged versus main, every id grouped,
// every label translated in both languages.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { GROUP_ORDER, MODULE_GROUP, groupItems, pageFor, buildMobileTabs } from "../nav-groups"
import { ROLE_MODULES, ROLE_DISPLAY_NAMES } from "../../components/layout/nav-config"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const I18N = fs.readFileSync(path.join(REPO, "lib/i18n-context.tsx"), "utf8")
const AR_AT = I18N.indexOf("\n  ar: {")
const EN = I18N.slice(0, AR_AT)
const AR = I18N.slice(AR_AT)

const MAIN_IDS: Record<string, string[]> = { // verbatim from origin/main components/layout/sidebar.tsx
  admin: ["user-management","hr-management","metrics-validation","system-health"],
  ceo: ["dashboard","analytics","ceo-chat","hr-management","suppliers","products","po-requests","purchase-orders","pricing-review","costing-settings","inventory","inventory-audit","goods-receipt-tracking","reorder-suggestions","lost-sales","accounts-payable","customers","sales-orders","delivery-permits","accounts-receivable","balance","metrics-validation","system-health"],
  accountant: ["dashboard","analytics","approve-sales-orders","sales-quotations","payment-schedule","purchase-orders","pricing-review","costing-settings","accounts-payable","accounts-receivable","maintenance-invoices","customers","suppliers","delivery-permits","balance"],
  "sales-rep": ["dashboard","analytics","customers","sales-orders","delivery-permits","inventory","lost-sales","accounts-receivable","operations-management"],
  "warehouse-rep": ["dashboard","inventory","inventory-audit","warehouse-transfers","warehouse-delivery","delivery-permits","goods-receipt","goods-receipt-tracking"],
  "po-rep": ["dashboard","analytics","suppliers","products","po-requests","purchase-orders","goods-receipt-tracking","inventory","reorder-suggestions","lost-sales"],
  shipment: ["shipment","courier-management","delivery-permits","operations-management"],
}

test("each role's item set is unchanged versus main", () => {
  assert.equal(AR_AT > 0, true)
  assert.deepEqual(Object.fromEntries(Object.entries(ROLE_MODULES).map(([r, l]) => [r, l.map((i) => i.id)])), MAIN_IDS)
})

test("every module id in every role list has a group", () => {
  for (const list of Object.values(ROLE_MODULES)) for (const i of list) assert.ok(i.id in MODULE_GROUP, i.id)
})

test("every label is an i18n key", () => {
  for (const list of Object.values(ROLE_MODULES)) for (const i of list) assert.match(i.label, /^module\./, i.id)
  assert.equal(ROLE_MODULES.accountant.find((i) => i.id === "maintenance-invoices")!.label, "module.maintenance-invoices")
})

test("groupItems: fixed order, role order inside, empty groups hidden", () => {
  const g = groupItems(ROLE_MODULES.accountant)
  assert.deepEqual(g.map((x) => x.group), ["overview", "sales", "purchasing", "finance"])
  assert.deepEqual(g[1].items.map((i) => i.id), ["approve-sales-orders", "sales-quotations", "customers", "delivery-permits"])
})

test("pageFor", () => {
  assert.deepEqual(pageFor("sales-orders", ROLE_MODULES.ceo), { labelKey: "module.sales-orders", group: "sales" })
  assert.deepEqual(pageFor("approve-sales-quotations", ROLE_MODULES.ceo), { labelKey: "module.approve-sales-quotations", group: "sales" })
  assert.deepEqual(pageFor("user-management", ROLE_MODULES.admin), { labelKey: "module.user-management", group: "admin" })
  assert.deepEqual(pageFor("shipment", ROLE_MODULES.shipment), { labelKey: "module.shipping", group: "operations" })
})

test("mobile tabs", () => {
  const shape = (r: keyof typeof ROLE_MODULES) => buildMobileTabs(ROLE_MODULES[r]).map((t) =>
    t.kind === "home" ? `home:${t.moduleId}` : t.kind === "group" ? `${t.group}:${t.items.length}` : "menu")
  assert.deepEqual(shape("ceo"), ["home:dashboard", "sales:4", "purchasing:6", "inventory:4", "menu"])
  assert.deepEqual(shape("admin"), ["home:user-management", "admin:4", "menu"])
  assert.deepEqual(shape("shipment"), ["home:shipment", "sales:1", "operations:3", "menu"])
  assert.deepEqual(buildMobileTabs([]).map((t) => t.kind), ["menu"])
})

test("frame keys exist in EN and AR", () => {
  const keys = [...GROUP_ORDER.map((g) => `group.${g}`), "nav.home", "nav.menu", "nav.account",
    ...new Set(Object.values(ROLE_MODULES).flat().map((i) => i.label)), ...Object.values(ROLE_DISPLAY_NAMES),
    "module.approve-sales-quotations", "module.ai-assistant", "module.upcoming-orders", "module.previous-orders", "module.accountant"]
  for (const k of keys) {
    assert.ok(EN.includes(`"${k}":`), `EN ${k}`)
    assert.ok(AR.includes(`"${k}":`), `AR ${k}`)
  }
})
