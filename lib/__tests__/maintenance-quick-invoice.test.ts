// Maintenance quick invoice (spec docs/superpowers/specs/2026-11-17-maintenance-quick-invoice-design.md): the new
// "maintenance" login role reaches only its own route, the route makes order + approved permit + invoice in one call
// (undoing earlier steps on failure), and Accounts Receivable splits invoices into Sales and Maintenance tabs.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { FakeDb, type Row } from "./fake-db"
import { call, useDb } from "./route-harness"
import { ROLES, isRole } from "../auth/roles"
import { isPublicPath, allows, ruleFor } from "../auth/permissions"
import { decide } from "../auth/decide"
import { navItemsForRoles, primaryRole } from "../auth/role-nav"
import { validateNewUser } from "../auth/users-admin"
import { ROLE_MODULES, ROLE_DISPLAY_NAMES } from "../../components/layout/nav-config"
import { groupFor } from "../nav-groups"
import { isMaintenanceInvoice, quickTotals, validateQuickInvoice, MAX_LINES, QUICK_SO_NOTE, QUICK_SO_TYPE } from "../maintenance-quick-invoice"
import { invoicesForTab, tabOf } from "../ar-tabs"
import * as quickRoute from "../../app/api/maintenance/quick-invoice/route"
import * as arRoute from "../../app/api/accounts-receivable/route"

const ROOT = process.env.REPO_ROOT || process.cwd()
const YEAR = new Date().getFullYear()
const URL = "http://test.local/api/maintenance/quick-invoice"

// ------------------------------------------------------------------------------------------------ role access
function apiPaths(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...apiPaths(full))
    else if (entry.name === "route.ts") out.push("/" + path.relative(path.join(ROOT, "app"), dir).split(path.sep).join("/"))
  }
  return out
}

test("M1. the maintenance role exists, has one screen and a label", () => {
  assert.ok(ROLES.includes("maintenance"))
  assert.equal(isRole("maintenance"), true)
  assert.deepEqual(ROLE_MODULES.maintenance.map((i) => i.id), ["maintenance-quick-invoice"])
  assert.equal(ROLE_DISPLAY_NAMES.maintenance, "role.maintenance")
  assert.equal(groupFor("maintenance-quick-invoice"), "finance")
  assert.deepEqual(navItemsForRoles(["maintenance"]).map((i) => i.id), ["maintenance-quick-invoice"])
  assert.equal(primaryRole(["maintenance", "accountant"]), "accountant", "lowest priority")
  // the admin can create a maintenance login
  const made = validateNewUser({ fullName: "Fixer", loginMethod: "username", username: "fixer", roles: ["maintenance"], tempPassword: "12345678" })
  assert.ok(made.ok && made.value.roles[0] === "maintenance")
})

test("M2. the maintenance role reaches only the quick invoice route and its own session", () => {
  const paths = apiPaths(path.join(ROOT, "app/api"))
  assert.ok(paths.length > 100)
  const reachable: string[] = []
  for (const p of paths) {
    if (isPublicPath(p)) continue
    const rule = ruleFor(p)
    if (!rule) continue
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      if (allows(rule, method, ["maintenance"])) reachable.push(`${method} ${p}`)
    }
  }
  const outside = reachable.filter((r) => !/ \/api\/(maintenance\/quick-invoice|auth)(\/|$)/.test(r))
  assert.deepEqual(outside, [], "maintenance must not reach other routes")
  for (const m of ["GET", "POST"]) assert.ok(reachable.includes(`${m} /api/maintenance/quick-invoice`))
  // the old work-order maintenance routes stay closed to it
  assert.equal(allows(ruleFor("/api/maintenance/invoices")!, "POST", ["maintenance"]), false)
  assert.equal(allows(ruleFor("/api/maintenance/work-orders")!, "GET", ["maintenance"]), false)
  assert.equal(allows(ruleFor("/api/customers")!, "GET", ["maintenance"]), false, "signed-in does not open to it")
  assert.equal(allows(ruleFor("/api/accounts-receivable")!, "GET", ["maintenance"]), false)
  assert.equal(allows(ruleFor("/api/auth/change-password")!, "POST", ["maintenance"]), true)
  // decide(): refused in "on" mode
  const identity = { userId: 9, name: "M", roles: ["maintenance" as const], active: true }
  const d = decide({ mode: "on", path: "/api/products", method: "GET", identity, idle: false })
  assert.equal(d.kind, "refuse")
  assert.equal(decide({ mode: "on", path: "/api/maintenance/quick-invoice", method: "POST", identity, idle: false }).kind, "allow")
})

test("M3. who may use the quick invoice route: maintenance, accountant, CEO, admin", () => {
  const rule = ruleFor("/api/maintenance/quick-invoice")!
  assert.equal(rule.prefix, "/api/maintenance/quick-invoice")
  for (const roles of [["maintenance"], ["accountant"], ["ceo"], ["admin"]] as const) {
    assert.equal(allows(rule, "POST", [...roles]), true, roles.join())
    assert.equal(allows(rule, "GET", [...roles]), true, roles.join())
  }
  for (const r of ["sales-rep", "po-rep", "warehouse-rep", "shipment"] as const) assert.equal(allows(rule, "POST", [r]), false, r)
  // a person with another role as well keeps that role's access
  assert.equal(allows(ruleFor("/api/customers")!, "GET", ["maintenance", "sales-rep"]), true)
  assert.equal(allows(ruleFor("/api/customers")!, "GET", ["sales-rep"]), true, "other roles unchanged")
})

// ------------------------------------------------------------------------------------------------ create route
function quickDb(extra: Record<string, Row[]> = {}) {
  const db = new FakeDb({
    customers: [
      { customer_id: 6, customer_name: "Al Maamoun" },
      { customer_id: 7, customer_name: "Beta" },
    ],
    sales_orders: [],
    sales_order_items: [],
    delivery_permits: [],
    delivery_permit_items: [],
    invoice_delivery_permits: [],
    accounts_receivable: [],
    inventory: [],
    inventory_transactions: [],
    ...extra,
  })
  db.jitter = false
  let n = 110000
  db.rpcHandlers.generate_so_number = () => `SO-${YEAR}-${++n}`
  return db
}
const LINES_10503 = [
  { name: "Air lacquer", quantity: 2, unitPrice: 950 },
  { name: "Sensor maintenance", quantity: 1, unitPrice: 200 },
  { name: "Micro switch maintenance", quantity: 1, unitPrice: 200 },
  { name: "Air fittings", quantity: 1, unitPrice: 200 },
]
const post = (db: FakeDb, body: unknown) => {
  useDb(db)
  return call(quickRoute.POST, "POST", body, URL)
}
const counts = (db: FakeDb) =>
  ["sales_orders", "sales_order_items", "delivery_permits", "delivery_permit_items", "invoice_delivery_permits", "accounts_receivable"].map(
    (t) => `${t}=${(db.tables[t] || []).length}`,
  )
const EMPTY = counts(quickDb())

test("M4. happy path: order, approved permit and invoice, the same shape as invoice 10503", async () => {
  const db = quickDb()
  const res = await post(db, { customerId: 6, lines: LINES_10503 })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.amount, 2850, "2,500 before VAT + 14%")
  assert.equal(res.body.invoiceNumber, `INV-${YEAR}-0001`)
  assert.equal(res.body.customerName, "Al Maamoun")

  const so = db.tables.sales_orders[0]
  assert.equal(so.customer_id, 6)
  assert.equal(so.so_type, QUICK_SO_TYPE)
  assert.equal(so.notes, QUICK_SO_NOTE)
  assert.equal(so.status, "delivered")
  assert.equal(so.subtotal, 2500)
  assert.equal(so.total, 2850)
  assert.equal(so.payment_type, "cash")
  assert.equal(so.payment_terms, "prepaid", "the only allowed values are prepaid / installment")
  assert.equal(db.tables.sales_order_items.length, 4)
  for (const it of db.tables.sales_order_items) {
    assert.equal(it.item_type, "outsourced")
    assert.equal(it.product_id, null)
    assert.equal(it.item_category, "MAINTENANCE_PARTS")
  }
  const dp = db.tables.delivery_permits[0]
  assert.equal(dp.status, "APPROVED")
  assert.equal(dp.sales_order_id, so.so_id)
  assert.match(dp.permit_no, new RegExp(`^DP-${YEAR}-0001$`))
  assert.deepEqual(db.tables.delivery_permit_items.map((i) => [i.item_name_snapshot, i.quantity, i.unit_price, i.product_id]), [
    ["Air lacquer", 2, 950, null], ["Sensor maintenance", 1, 200, null], ["Micro switch maintenance", 1, 200, null], ["Air fittings", 1, 200, null],
  ])
  const inv = db.tables.accounts_receivable[0]
  assert.equal(inv.so_id, so.so_id)
  assert.equal(inv.source_delivery_permit_id, dp.permit_id)
  assert.equal(inv.is_maintenance, true)
  assert.equal(inv.status, "pending")
  assert.deepEqual(db.tables.invoice_delivery_permits, [{ invoice_id: inv.invoice_id, permit_id: dp.permit_id }])
  // no stock moved
  assert.equal(db.tables.inventory.length, 0)
  assert.equal(db.tables.inventory_transactions.length, 0)
})

test("M5. numbering: the normal invoice and permit numbers continue", async () => {
  const db = quickDb({
    accounts_receivable: [
      { invoice_id: 40, invoice_number: `INV-${YEAR}-0007`, so_id: null, amount: 10, status: "pending" },
      { invoice_id: 41, invoice_number: "INV-MNT-WO-3", so_id: null, amount: 10, status: "pending" },
      { invoice_id: 42, invoice_number: "10503", so_id: null, amount: 10, status: "pending" },
    ],
    delivery_permits: [{ permit_id: 3, permit_no: `DP-${YEAR}-0012`, sales_order_id: 99, status: "DRAFT" }],
  })
  const a = await post(db, { customerId: 7, lines: [{ name: "Service", quantity: 1, unitPrice: 100 }] })
  assert.equal(a.status, 200, JSON.stringify(a.body))
  assert.equal(a.body.invoiceNumber, `INV-${YEAR}-0008`)
  assert.equal(a.body.permitNo, `DP-${YEAR}-0013`)
  const b = await post(db, { customerId: 7, lines: [{ name: "Service", quantity: 1, unitPrice: 100 }] })
  assert.equal(b.body.invoiceNumber, `INV-${YEAR}-0009`)
  assert.notEqual(a.body.soNumber, b.body.soNumber)
})

test("M6. VAT math: 14% on prices before VAT; per line after the e-invoice go-live", async () => {
  const lines = [
    { name: "a", quantity: 1, unitPrice: 10.05 },
    { name: "b", quantity: 1, unitPrice: 10.12 },
    { name: "c", quantity: 1, unitPrice: 10.19 },
  ]
  assert.deepEqual(quickTotals(lines, false), { net: 30.36, vat: 4.25, total: 34.61 })
  assert.deepEqual(quickTotals(lines, true), { net: 30.36, vat: 4.26, total: 34.62 })
  assert.deepEqual(quickTotals(LINES_10503), { net: 2500, vat: 350, total: 2850 })
  assert.deepEqual(quickTotals([{ name: "x", quantity: 3, unitPrice: 33.33 }], false), { net: 99.99, vat: 14, total: 113.99 })

  const before = quickDb()
  const r1 = await post(before, { customerId: 6, lines })
  assert.equal(r1.status, 200, JSON.stringify(r1.body))
  assert.equal(r1.body.amount, 34.61)
  assert.equal(before.tables.sales_orders[0].total, 34.61)

  const live = quickDb({ company_settings: [{ setting_key: "eta_go_live_at", setting_value: "2026-01-01T00:00:00Z" }] })
  const r2 = await post(live, { customerId: 6, lines })
  assert.equal(r2.status, 200, JSON.stringify(r2.body))
  assert.equal(r2.body.amount, 34.62)
  assert.equal(live.tables.sales_orders[0].total, 34.62, "the order total fits the invoice exactly")
})

test("M7. validation: nothing is created for a bad request", async () => {
  const bad: [unknown, RegExp][] = [
    [null, /Missing/],
    [{ lines: LINES_10503 }, /customer/],
    [{ customerId: "x", lines: LINES_10503 }, /customer/],
    [{ customerId: 6, lines: [] }, /at least one line/],
    [{ customerId: 6 }, /at least one line/],
    [{ customerId: 6, lines: [{ name: "  ", quantity: 1, unitPrice: 5 }] }, /Line 1: enter/],
    [{ customerId: 6, lines: [{ name: "a", quantity: 0, unitPrice: 5 }] }, /quantity/],
    [{ customerId: 6, lines: [{ name: "a", quantity: 1, unitPrice: -5 }] }, /price/],
    [{ customerId: 6, lines: [{ name: "a", quantity: 1, unitPrice: 5 }, { name: "b", quantity: 1, unitPrice: "abc" }] }, /Line 2: the price/],
    [{ customerId: 6, lines: [{ name: "x".repeat(201), quantity: 1, unitPrice: 5 }] }, /at most 200/],
    [{ customerId: 6, lines: Array.from({ length: MAX_LINES + 1 }, () => ({ name: "a", quantity: 1, unitPrice: 1 })) }, /At most 50/],
  ]
  for (const [body, re] of bad) {
    const db = quickDb()
    const res = await post(db, body)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.match(res.body.error, re)
    assert.deepEqual(counts(db), EMPTY)
  }
  const unknown = quickDb()
  const res = await post(unknown, { customerId: 99, lines: LINES_10503 })
  assert.equal(res.status, 404)
  assert.deepEqual(counts(unknown), EMPTY)
  // names are tidied, prices rounded to piasters
  const ok = validateQuickInvoice({ customerId: "6", lines: [{ name: "  Oil   change ", quantity: "2", unitPrice: "10.555" }] })
  assert.deepEqual(ok, { ok: true, value: { customerId: 6, lines: [{ name: "Oil change", quantity: 2, unitPrice: 10.56 }] } })
})

test("M8. undo: a failure at any step leaves nothing behind", async () => {
  const steps = [
    "sales_orders:insert",
    "sales_order_items:insert",
    "delivery_permits:insert",
    "delivery_permit_items:insert",
    "accounts_receivable:insert",
    "invoice_delivery_permits:insert",
    "delivery_permits:update", // createDpInvoices marks the permit invoiced
  ]
  for (const step of steps) {
    const db = quickDb()
    db.failOn[step] = "boom"
    const res = await post(db, { customerId: 6, lines: LINES_10503 })
    assert.ok(res.status >= 400, `${step}: ${res.status}`)
    assert.ok(!res.body.partialFailure, step)
    assert.match(res.body.error, /Nothing was saved/, step)
    assert.deepEqual(counts(db), EMPTY, step)
  }
  // a failing undo is reported, never hidden
  const db = quickDb()
  db.failOn["accounts_receivable:insert"] = "boom"
  db.failOn["delivery_permits:delete"] = "locked"
  const res = await post(db, { customerId: 6, lines: LINES_10503 })
  assert.equal(res.status, 500)
  assert.equal(res.body.partialFailure, true)
  assert.match(res.body.error, /delivery permit/)
})

test("M9. without the is_maintenance column the invoice is still made and still counts as maintenance", async () => {
  const db = quickDb()
  db.failOn["accounts_receivable:update"] = 'column "is_maintenance" does not exist'
  const res = await post(db, { customerId: 6, lines: LINES_10503 })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const inv = db.tables.accounts_receivable[0]
  assert.equal(inv.is_maintenance, undefined)
  const so = db.tables.sales_orders[0]
  assert.equal(isMaintenanceInvoice({ is_maintenance: inv.is_maintenance, invoice_number: inv.invoice_number, so_type: so.so_type, so_notes: so.notes }), true)
})

test("M10. GET lists the customers (id and name only)", async () => {
  useDb(quickDb())
  const res = await call(quickRoute.GET as any, "GET", undefined, URL)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.customers, [{ id: 6, name: "Al Maamoun" }, { id: 7, name: "Beta" }])
})

// ------------------------------------------------------------------------------------------------ AR tabs
test("M11. which invoices are maintenance", () => {
  assert.equal(isMaintenanceInvoice({ is_maintenance: true, invoice_number: `INV-${YEAR}-0001` }), true)
  assert.equal(isMaintenanceInvoice({ is_maintenance: false, invoice_number: "INV-MNT-WO-2026-001" }), true, "work-order invoices")
  assert.equal(isMaintenanceInvoice({ invoice_number: `INV-${YEAR}-0002`, so_type: QUICK_SO_TYPE, so_notes: QUICK_SO_NOTE }), true, "before the SQL")
  assert.equal(isMaintenanceInvoice({ invoice_number: `INV-${YEAR}-0003`, so_type: QUICK_SO_TYPE, so_notes: "parts order" }), false, "a parts sale is sales")
  assert.equal(isMaintenanceInvoice({ is_maintenance: false, invoice_number: "10503", so_type: "EQUIPMENT", so_notes: "Entered from paper" }), false)
  assert.equal(isMaintenanceInvoice({}), false)
})

test("M12. the Sales and Maintenance tabs split the list", () => {
  const list = [
    { id: "1", invoiceNumber: `INV-${YEAR}-0001`, arTab: "sales" },
    { id: "2", invoiceNumber: `INV-${YEAR}-0002`, arTab: "maintenance" },
    { id: "3", invoiceNumber: "INV-MNT-WO-1" }, // older data without arTab
    { id: "4", invoiceNumber: "10503" },
  ]
  assert.deepEqual(invoicesForTab(list, "sales").map((i) => i.id), ["1", "4"])
  assert.deepEqual(invoicesForTab(list, "maintenance").map((i) => i.id), ["2", "3"])
  assert.equal(tabOf({}), "sales")
  // every invoice is in exactly one tab
  assert.equal(invoicesForTab(list, "sales").length + invoicesForTab(list, "maintenance").length, list.length)
})

test("M13. the receivables list tells each invoice's tab", async () => {
  const db = quickDb()
  const made = await post(db, { customerId: 6, lines: LINES_10503 })
  assert.equal(made.status, 200)
  db.tables.accounts_receivable.push(
    { invoice_id: 50, invoice_number: "INV-MNT-WO-9", customer_id: 6, amount: 114, collected_amount: 0, status: "pending", created_at: "2026-11-01" },
    { invoice_id: 51, invoice_number: `INV-${YEAR}-0050`, customer_id: 7, amount: 228, collected_amount: 0, status: "pending", is_maintenance: false, created_at: "2026-11-02" },
  )
  useDb(db)
  const list = await (arRoute.GET as any)()
  const rows = await list.json()
  const tabs = Object.fromEntries(rows.map((r: any) => [r.invoiceNumber, r.arTab]))
  assert.deepEqual(tabs, { [made.body.invoiceNumber]: "maintenance", "INV-MNT-WO-9": "maintenance", [`INV-${YEAR}-0050`]: "sales" })
  // the work-order flag the screen already used is unchanged
  assert.equal(rows.find((r: any) => r.invoiceNumber === "INV-MNT-WO-9").isMaintenance, true)
  assert.equal(rows.find((r: any) => r.invoiceNumber === made.body.invoiceNumber).isMaintenance, false)
})

test("M14. the screen and the AR tabs are wired", () => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8")
  const dash = read("components/dashboard/dashboard.tsx")
  assert.match(dash, /case "maintenance-quick-invoice":\s*return <MaintenanceQuickInvoiceModule \/>/)
  assert.match(dash, /mainRole === "maintenance"\) return "maintenance-quick-invoice"/)
  const screen = read("components/modules/maintenance-quick-invoice-module.tsx")
  assert.match(screen, /fetch\("\/api\/maintenance\/quick-invoice"/)
  assert.doesNotMatch(screen, /\/api\/(customers|accounts-receivable|eta)/, "the screen uses only its own route")
  const ar = read("components/modules/accounts-receivable-module.tsx")
  assert.match(ar, /<TabsTrigger value="sales">/)
  assert.match(ar, /<TabsTrigger value="maintenance">/)
  assert.match(ar, /filtered = invoicesForTab\(filtered, invoiceTab\)/)
  const sql = read("scripts/sql/2026-11-17-maintenance-role.sql")
  assert.match(sql, /^-- WRITTEN, NOT APPLIED/)
  assert.match(sql, /'maintenance'\]::text\[\]/)
  assert.match(sql, /add column if not exists is_maintenance/)
  assert.doesNotMatch(sql, /\bdrop table\b|\bdelete from\b|\btruncate\b/i)
})
