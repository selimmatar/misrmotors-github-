// Phone layout and accessibility checks for the "frame" area (scanners in a11y-scan.ts). Live once Task 1 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("frame")
for (const c of CHECKS) test(`frame: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

const read = (p: string) => readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), p), "utf8")

test("phone tap-target floor on primitives; laptop sizes unchanged", () => {
  const b = read("components/ui/button.tsx")
  for (const k of ["h-9 px-4 py-2", "h-8 rounded-md", "h-10 rounded-md", "icon: 'size-9", "'icon-sm': 'size-8", "'icon-lg': 'size-10"]) assert.ok(b.includes(k), k)
  assert.ok((b.match(/max-md:min-h-11 max-md:min-w-11/g) || []).length >= 6)
  for (const f of ["input", "select"]) assert.match(read(`components/ui/${f}.tsx`), /max-md:min-h-11/, f)
  const tabs = read("components/ui/tabs.tsx")
  assert.match(tabs, /h-auto min-h-9 flex-wrap/); assert.match(tabs, /min-h-7 max-md:min-h-11/); assert.doesNotMatch(tabs, /h-\[calc\(100%-1px\)\]/)
  for (const f of ["checkbox", "radio-group", "switch"]) assert.match(read(`components/ui/${f}.tsx`), /max-md:after:absolute/, f)
})
test("close buttons: logical side, 44px on phones, translated name", () => {
  for (const f of ["dialog", "sheet"]) { const s = read(`components/ui/${f}.tsx`)
    assert.doesNotMatch(s, /\bright-4\b|sm:text-left/, f); assert.match(s, /top-4 end-4/, f); assert.match(s, /max-md:size-11/, f); assert.match(s, /t\("action\.close"\)/, f) }
  assert.match(read("components/ui/dialog.tsx"), /max-md:pe-8/)
})
test("frame names are translated and distinct from the Menu tab", () => {
  const m = read("components/layout/mobile-tabs.tsx")
  assert.match(m, /aria-label=\{t\("a11y\.bottom-nav"\)\}/); assert.doesNotMatch(m, /aria-label=\{t\("nav\.menu"\)\}/)
  assert.match(m, /<SheetDescription className="sr-only">\{t\("a11y\.group-sheet"\)\}<\/SheetDescription>/); assert.match(m, /pe-14/)
  assert.match(read("components/layout/header.tsx"), /aria-label=\{t\("a11y\.open-menu"\)\}/)
  assert.match(read("components/layout/sidebar.tsx"), /aria-label=\{t\("a11y\.close-menu"\)\}/)
  assert.match(read("components/layout/language-toggle.tsx"), /aria-label=\{t\("a11y\.language"\)\}/)
})
test("safe areas, zoom and phone frame targets", () => {
  const l = read("app/layout.tsx"); assert.match(l, /viewportFit: "cover"/); assert.doesNotMatch(l, /maximumScale/)
  const h = read("components/layout/header.tsx"); assert.match(h, /box-content h-14 pt-\[env\(safe-area-inset-top\)\]/); assert.match(h, /max-md:min-h-11 max-md:min-w-11/)
  assert.match(read("components/layout/mobile-tabs.tsx"), /safe-area-inset-left/); assert.match(read("app/globals.css"), /env\(safe-area-inset-left\)/)
  const s = read("components/layout/sidebar.tsx"); assert.match(s, /h-9 max-md:min-h-11/); assert.doesNotMatch(s, /bg-red-500/)
})
