// Phone layout and accessibility checks for the "purchasing" area (scanners in a11y-scan.ts). Live once Task 5 lands.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("purchasing")
for (const c of CHECKS) test(`purchasing: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

const read = (f: string) => fs.readFileSync(path.join(process.env.REPO_ROOT || process.cwd(), f), "utf8")
test("reorder inputs and checkboxes are labelled; PO rows keyed", () => {
  const s = read("components/modules/reorder-suggestions-module.tsx")
  assert.match(s, /aria-label=\{`\$\{t\("reorder\.new-value"\)\} \$\{item\.productName\}`\}/)
  assert.match(s, /aria-label=\{t\("a11y\.select-all"\)\}/)
  assert.match(read("components/modules/purchase-order-module.tsx"), /<Fragment key=\{order\.id\}>/)
})
