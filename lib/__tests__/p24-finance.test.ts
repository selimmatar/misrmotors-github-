// Phone layout and accessibility checks for the "finance" area (scanners in a11y-scan.ts). Live once Task 4 lands.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const read = (f: string) => fs.readFileSync(path.join(process.env.REPO_ROOT ?? process.cwd(), f), "utf8")
const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("finance")
for (const c of CHECKS) test(`finance: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

test("accountant tab badges sit on the end side", () => {
  const s = read("components/modules/accountant-module.tsx")
  assert.doesNotMatch(s, /-right-1/); assert.match(s, /-top-1 -end-1/)
})
