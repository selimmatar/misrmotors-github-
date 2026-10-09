// Phone layout and accessibility checks for the "sales" area (scanners in a11y-scan.ts). Live once Task 2 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = "Task 2"
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("sales")
for (const c of CHECKS) test(`sales: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))
