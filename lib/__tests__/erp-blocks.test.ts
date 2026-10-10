// Building-block additions for PR 1b (spec §4): labelled status badge, Money, clickable tiles and list cards.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
// The text of `export function <name>` up to the next `export function`, or to the end of the file.
const fn = (src: string, name: string) => {
  const start = src.indexOf(`export function ${name}`)
  assert.ok(start >= 0, `export function ${name}`)
  const next = src.indexOf("export function", start + 1)
  return src.slice(start, next < 0 ? undefined : next)
}

test("StatusBadge takes an optional label and falls back to statusLabel", () => {
  const s = read("components/erp/status-badge.tsx")
  assert.match(s, /label\?: string/); assert.match(s, /label \?\? statusLabel\(status, t\)/); assert.doesNotMatch(s, /formatEnum\(/)
})

test("Money isolates the number and never adds a currency", () => {
  const s = read("components/erp/money.tsx")
  for (const k of ["<bdi", "formatMoney(", "tabular-nums", "whitespace-nowrap"]) assert.ok(s.includes(k), k)
  assert.doesNotMatch(s, /EGP/)
})

test("KpiTile becomes a button only when clickable", () => {
  const s = read("components/erp/kpi-tile.tsx"), body = fn(s, "KpiTile")
  for (const k of ["onClick?: () => void", 'type="button"', 'data-slot="kpi-tile"', "focus-visible:ring", "text-start"]) assert.ok(s.includes(k), k)
  assert.doesNotMatch(body, /<(div|p)\b/) // root via `const Root = onClick ? "button" : "div"`; inner parts are spans
})

test("ListCard row click keeps its actions separate", () => {
  const src = read("components/erp/responsive-list.tsx"), s = fn(src, "ListCard")
  assert.ok(src.includes("onClick?: () => void"), "ListCardProps.onClick")
  for (const k of ['data-slot="list-card"', "stopPropagation()", "cursor-pointer"]) assert.ok(s.includes(k), k)
})
