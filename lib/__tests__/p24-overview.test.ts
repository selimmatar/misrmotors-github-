// Phone layout and accessibility checks for the "overview" area (scanners in a11y-scan.ts). Live once Task 7 lands.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("overview")
for (const c of CHECKS) test(`overview: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")

test("analytics tab strip wraps instead of a fixed grid", () => {
  const s = read("components/modules/analytics-dashboard.tsx")
  assert.doesNotMatch(s, /gridTemplateColumns: `repeat\(\$\{visibleTabs\.length\}/)
})
