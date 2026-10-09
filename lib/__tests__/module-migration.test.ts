// Migration guard (PR 1b): the Sales + Finance screens change presentation only. A snapshot of each module's
// protected surface (API calls, handlers, ids, fetch/toISOString counts) must hold, and migrated modules must use the
// shared blocks. Regenerate the snapshot only with a ledgered ruling: UPDATE_GUARD=1.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { MODULES, BANNED, RTL_BAD, protectedSurface, type Surface } from "./module-guard"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const FIXTURE = path.join(REPO, "lib/__tests__/fixtures/ui-1b/protected.json")

// Each module task appends its paths.
const MIGRATED: string[] = [
  "components/modules/sales-order-module.tsx",
  "components/modules/sales-quotations-hub-module.tsx",
  "components/modules/sales-quotation-module.tsx",
  "components/modules/approve-sales-quotations-module.tsx",
  "components/modules/accounts-receivable-module.tsx",
  "components/modules/accounts-payable-module.tsx",
]
// Allowed leftover BANNED matches per file; each entry needs a ledgered ruling.
const ALLOW: Record<string, Partial<Record<keyof typeof BANNED, number>>> = {}
// Files that render inside another screen and carry no page header of their own.
const NO_HEADER = new Set(["components/accounting/maintenance-invoice-tab.tsx"])

test("protected surface matches the snapshot", () => {
  const now: Record<string, Surface> = {}
  for (const f of MODULES) now[f] = protectedSurface(read(f))
  if (process.env.UPDATE_GUARD === "1") {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
    fs.writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n")
    return
  }
  const snap: Record<string, Surface> = JSON.parse(fs.readFileSync(FIXTURE, "utf8"))
  const problems: string[] = []
  for (const f of MODULES) {
    if (!snap[f]) { problems.push(`${f}: no snapshot entry`); continue }
    for (const k of ["api", "handlers", "ids", "fetch", "iso"] as const)
      if (JSON.stringify(now[f][k]) !== JSON.stringify(snap[f][k]))
        problems.push(`${f}: ${k} changed\n    was ${JSON.stringify(snap[f][k])}\n    now ${JSON.stringify(now[f][k])}`)
    for (const k of ["t", "onClick"] as const)
      if (now[f][k] < snap[f][k]) problems.push(`${f}: ${k} dropped from ${snap[f][k]} to ${now[f][k]}`)
  }
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("migrated modules use the shared blocks", () => {
  const problems: string[] = []
  for (const f of MIGRATED) {
    const src = read(f)
    if (!NO_HEADER.has(f) && !src.includes("<PageHeader")) problems.push(`${f}: no <PageHeader`)
    for (const [name, re] of Object.entries(BANNED)) {
      const n = (src.match(re) ?? []).length
      const allowed = ALLOW[f]?.[name] ?? 0
      if (n > allowed) problems.push(`${f}: ${name} appears ${n} time(s), ${allowed} allowed`)
    }
    for (const [i, line] of src.split("\n").entries()) if (RTL_BAD.test(line)) problems.push(`${f}:${i + 1}: physical class`)
  }
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("sales order shows approval steps in its details dialog and can be embedded", () => {
  const s = read("components/modules/sales-order-module.tsx")
  assert.match(s, /<ApprovalSteps status=\{selectedOrder\.status\}/); assert.match(s, /embedded\?: boolean/)
})

test("hub owns the page header and embeds its three tabs", () => {
  const hub = read("components/modules/sales-quotations-hub-module.tsx")
  for (const m of ["SalesOrderModule", "SalesQuotationModule", "ApproveSalesQuotationsModule"]) assert.match(hub, new RegExp(`<${m}[^>]*\\bembedded\\b`), m)
  assert.match(hub, /title=\{t\("module\.sales-orders"\)\}/)
  for (const f of ["sales-quotation", "approve-sales-quotations"]) assert.match(read(`components/modules/${f}-module.tsx`), /embedded\?: boolean/, f)
})

test("AR keeps its whole-row click on the phone card", () => {
  const s = read("components/modules/accounts-receivable-module.tsx")
  assert.match(s, /<ListCard[\s\S]{0,400}?onClick=/); assert.match(s, /renderRowActions\(/)
})

test("AP: three clickable tiles, total balance is not", () => {
  const s = read("components/modules/accounts-payable-module.tsx")
  const tiles = s.split("<KpiTile").slice(1).map((c) => c.split("</KpiGrid>")[0])
  assert.equal(tiles.length, 4); assert.equal(tiles.filter((c) => /\bonClick=/.test(c)).length, 3)
  assert.doesNotMatch(tiles[3], /\bonClick=/)
  assert.match(s, /title=\{t\("ap\.title"\)\}/)
})
