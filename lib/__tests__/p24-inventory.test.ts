// Phone layout and accessibility checks for the "inventory" area (scanners in a11y-scan.ts). Live once Task 6 lands.
import test from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("inventory")
for (const c of CHECKS) test(`inventory: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

const read = (p: string) => readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), p), "utf8")
test("shipping tabs wrap at phone widths", () => {
  const s = read("components/modules/shipping-module.tsx")
  assert.doesNotMatch(s, /<TabsList className="grid w-full grid-cols-5">/); assert.match(s, /<TabsList className="[^"]*flex-wrap/)
})
