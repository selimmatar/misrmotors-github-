// Migration guard (PR 1c): the remaining 25 module screens change presentation only. One fixture file per migration
// task (lib/__tests__/fixtures/ui-1c/t<N>.json) holds each module's protected-surface snapshot, a `migrated` flag and
// the task's own `must` assertions. Regenerate surfaces only with a ledgered ruling: UPDATE_GUARD_1C=1.
import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { MODULES, BANNED, RTL_BAD, protectedSurface, type Surface } from "./module-guard"
import { statusTone } from "../status-tone"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const FIXTURE_DIR = path.join(REPO, "lib/__tests__/fixtures/ui-1c")
// The text of `export function <name>` up to the next `export function`, or to the end of the file.
const fn = (src: string, name: string) => {
  const start = src.indexOf(`export function ${name}`)
  assert.ok(start >= 0, `export function ${name}`)
  const next = src.indexOf("export function", start + 1)
  return src.slice(start, next < 0 ? undefined : next)
}

type Entry = {
  surface?: Surface
  migrated: boolean
  noHeader?: boolean
  allow?: Record<string, number>
  must?: { re: string; min?: number; max?: number }[]
  printRegion?: { from: string; to: string; sha256?: string }
}
type Fixture = { task: string; modules: Record<string, Entry> }

const MODULES_1C: readonly string[] = [
  ...[
    "purchase-order", "supplier", "product", "po-request", "pricing-review", "inventory", "inventory-audit",
    "goods-receipt", "goods-receipt-tracking", "reorder-suggestions", "warehouse-transfers", "warehouse-delivery",
    "shipping", "courier-management", "operations-management", "maintenance", "user-management", "hr-management",
    "metrics-validation", "system-health", "ai-assistant",
  ].map((n) => `components/modules/${n}-module.tsx`),
  "components/modules/inventory-costing-settings.tsx",
  "components/modules/analytics-dashboard.tsx",
  "components/modules/ceo-chat-assistant.tsx",
  "components/modules/financial-dashboard.tsx",
]

// Extra bans for 1c (the 1b BANNED set misses how these files show money and dates).
const BANNED_1C: Record<string, RegExp> = {
  i18nFormat: /\{[^}]*\b(?:formatCurrency|formatDate)\b[^}]*\}\s*=\s*useI18n\(\)/g,
  toLocaleString: /\.toLocaleString\(/g,
  toFixed2: /\.toFixed\(2\)/g,
  localBadge: /\b(?:getStatusVariant|getStatusBadgeVariant|getPriorityBadge|getUrgencyBadge|getHealthColor|PriorityBadge|WOStatusBadge|DPStatusBadge)\b/g,
  h1: /<h1\b/g,
}

const fixtureFiles = (): string[] =>
  fs.existsSync(FIXTURE_DIR) ? fs.readdirSync(FIXTURE_DIR).filter((f) => /^t\d+\.json$/.test(f)).sort() : []
const loadFixtures = (): { file: string; fx: Fixture }[] =>
  fixtureFiles().map((file) => ({ file, fx: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as Fixture }))

// Line range [start, end) of the pinned region: from the first line containing `from` up to (not including) the
// first later line containing `to`.
function regionLines(lines: string[], r: { from: string; to: string }): [number, number] {
  const a = lines.findIndex((l) => l.includes(r.from))
  assert.ok(a >= 0, `print region start "${r.from}" not found`)
  const b = lines.findIndex((l, i) => i > a && l.includes(r.to))
  assert.ok(b >= 0, `print region end "${r.to}" not found`)
  return [a, b]
}
const regionHash = (src: string, r: { from: string; to: string }) => {
  const lines = src.split("\n"), [a, b] = regionLines(lines, r)
  return crypto.createHash("sha256").update(lines.slice(a, b).join("\n")).digest("hex")
}

test("1c fixtures cover each module exactly once", () => {
  const seen = new Map<string, string>()
  const problems: string[] = []
  for (const { file, fx } of loadFixtures())
    for (const m of Object.keys(fx.modules)) {
      if (seen.has(m)) problems.push(`${m}: in both ${seen.get(m)} and ${file}`)
      seen.set(m, file)
      if ((MODULES as readonly string[]).includes(m)) problems.push(`${m}: also a 1b module`)
    }
  for (const m of MODULES_1C) if (!seen.has(m)) problems.push(`${m}: no fixture entry`)
  for (const m of seen.keys()) if (!MODULES_1C.includes(m)) problems.push(`${m}: not a 1c module`)
  assert.deepEqual(problems, [], problems.join("\n"))
  assert.equal(seen.size, MODULES_1C.length)
})

test("1c protected surface matches the snapshot", () => {
  if (process.env.UPDATE_GUARD_1C === "1") {
    for (const { file, fx } of loadFixtures()) {
      for (const [m, e] of Object.entries(fx.modules)) {
        const src = read(m)
        e.surface = protectedSurface(src)
        if (e.printRegion) e.printRegion.sha256 = regionHash(src, e.printRegion)
      }
      fs.writeFileSync(path.join(FIXTURE_DIR, file), JSON.stringify(fx, null, 2) + "\n")
    }
    return
  }
  const problems: string[] = []
  for (const { fx } of loadFixtures())
    for (const [f, e] of Object.entries(fx.modules)) {
      if (!e.surface) { problems.push(`${f}: no snapshot entry (surface)`); continue }
      const now = protectedSurface(read(f))
      for (const k of ["api", "handlers", "ids", "fetch", "iso"] as const)
        if (JSON.stringify(now[k]) !== JSON.stringify(e.surface[k]))
          problems.push(`${f}: ${k} changed\n    was ${JSON.stringify(e.surface[k])}\n    now ${JSON.stringify(now[k])}`)
      for (const k of ["t", "onClick"] as const)
        if (now[k] < e.surface[k]) problems.push(`${f}: ${k} dropped from ${e.surface[k]} to ${now[k]}`)
    }
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("1c print regions unchanged", () => {
  const problems: string[] = []
  for (const { fx } of loadFixtures())
    for (const [f, e] of Object.entries(fx.modules)) {
      if (!e.printRegion) continue
      if (!e.printRegion.sha256) { problems.push(`${f}: print region has no sha256`); continue }
      const h = regionHash(read(f), e.printRegion)
      if (h !== e.printRegion.sha256) problems.push(`${f}: print region changed (restore it from C0)\n    was ${e.printRegion.sha256}\n    now ${h}`)
    }
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("1c migrated modules use the shared blocks", () => {
  const problems: string[] = []
  for (const { fx } of loadFixtures())
    for (const [f, e] of Object.entries(fx.modules)) {
      if (!e.migrated) continue
      const lines = read(f).split("\n")
      let kept = lines.map((text, i) => ({ text, n: i + 1 }))
      if (e.printRegion) {
        const [a, b] = regionLines(lines, e.printRegion)
        kept = kept.filter((_, i) => i < a || i >= b)
      }
      const src = kept.map((l) => l.text).join("\n")
      if (!e.noHeader && !src.includes("<PageHeader")) problems.push(`${f}: no <PageHeader`)
      for (const [name, re] of [...Object.entries(BANNED), ...Object.entries(BANNED_1C)]) {
        const n = (src.match(re) ?? []).length
        const allowed = e.allow?.[name] ?? 0
        if (n > allowed) problems.push(`${f}: ${name} appears ${n} time(s), ${allowed} allowed`)
      }
      for (const l of kept) if (RTL_BAD.test(l.text)) problems.push(`${f}:${l.n}: physical class`)
      for (const m of e.must ?? []) {
        const n = (src.match(new RegExp(m.re, "g")) ?? []).length
        const min = m.min ?? 1
        if (n < min || (m.max !== undefined && n > m.max)) problems.push(`${f}: must /${m.re}/ matched ${n} time(s), wanted ${min}..${m.max ?? "any"}`)
      }
    }
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("1c tones", () => {
  const TONES: Record<string, string> = {
    in_transit: "approved", in_progress: "approved", "in-progress": "approved", completed: "done", quoted: "approved",
    converted: "done", allocated: "approved", active: "done", on_leave: "waiting", suspended: "danger",
    terminated: "neutral", resigned: "neutral", in_stock: "done", low_stock: "waiting", out_of_stock: "danger",
    returned: "waiting", near_reorder: "waiting", healthy: "done", over: "waiting", short: "danger", match: "done",
    pass: "done", fail: "danger", warn: "waiting", valid: "done", mismatch: "danger", excellent: "done",
    good: "approved", fair: "waiting", poor: "danger", urgent: "danger", high: "danger", medium: "waiting",
    low: "neutral", busy: "waiting", available: "done", submitted: "waiting", cancelled: "danger",
  }
  const problems: string[] = []
  for (const [value, tone] of Object.entries(TONES))
    for (const v of [value, value.toUpperCase()])
      if (statusTone(v) !== tone) problems.push(`${v}: expected ${tone}, got ${statusTone(v)}`)
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("ListCard has a full-width note slot", () => {
  const src = read("components/erp/responsive-list.tsx"), s = fn(src, "ListCard")
  assert.ok(src.includes("note?: ReactNode"), "note?: ReactNode")
  assert.ok(s.includes('data-slot="list-card-note"'), "list-card-note slot")
  assert.ok(s.includes("{note != null &&"), "note rendered only when given")
})

// Ruling: PageHeader titles and subtitles use translation keys that exist (lib/i18n-context.tsx is not edited, so a
// missing key is replaced by the screen's `module.<id>` title, or the subtitle is dropped).
test("1c headers use translation keys that exist", () => {
  const i18n = read("lib/i18n-context.tsx")
  const iEn = i18n.indexOf("  en: {"), iAr = i18n.indexOf("  ar: {", iEn)
  assert.ok(iEn >= 0 && iAr > iEn, "en and ar dictionaries")
  const en = i18n.slice(iEn, iAr), ar = i18n.slice(iAr)
  const has = (block: string, key: string) =>
    new RegExp(`["']${key.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}["']\\s*:`).test(block)
  const problems: string[] = []
  for (const f of MODULES_1C) {
    for (const header of read(f).match(/<PageHeader[\s\S]*?\/>/g) ?? []) {
      for (const attr of ["title", "subtitle"]) {
        const key = header.match(new RegExp(`${attr}=\\{t\\("([^"]+)"\\)`))?.[1]
        if (!key) continue
        if (!has(en, key)) problems.push(`${f}: ${attr} key "${key}" is not in the English dictionary`)
        else if (key.startsWith("module.") && !has(ar, key)) problems.push(`${f}: ${attr} key "${key}" is not in the Arabic dictionary`)
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"))
})

test("1c header rulings", () => {
  const titleOf = (f: string) => read(`components/modules/${f}`).match(/<PageHeader[\s\S]*?title=\{t\("([^"]+)"\)/)?.[1]
  assert.equal(titleOf("supplier-module.tsx"), "module.suppliers")
  assert.equal(titleOf("pricing-review-module.tsx"), "module.pricing-review")
  assert.equal(titleOf("goods-receipt-module.tsx"), "module.goods-receipt")
  assert.equal(titleOf("reorder-suggestions-module.tsx"), "module.reorder-suggestions")
  assert.equal(titleOf("user-management-module.tsx"), "module.user-management")
  assert.equal(titleOf("analytics-dashboard.tsx"), "module.analytics")
  // Ruling 11: the HR status badge uses StatusBadge's default status.* label.
  assert.ok(!/label=\{getStatusLabel\(/.test(read("components/modules/hr-management-module.tsx")), "hr label")
})

test("warehouse delivery: a signed permit awaiting approval is labelled as signed, not Completed", () => {
  assert.match(read("components/modules/warehouse-delivery-module.tsx"), /case "SUBMITTED_SIGNED":\s*return t\("permit\.status\.submitted-signed"\)/)
})
