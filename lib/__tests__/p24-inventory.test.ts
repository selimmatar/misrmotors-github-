// Phone layout and accessibility checks for the "inventory" area (scanners in a11y-scan.ts). Live once Task 6 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = "Task 6"
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("inventory")
for (const c of CHECKS) test(`inventory: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))
