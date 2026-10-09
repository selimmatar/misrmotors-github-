// Phone layout and accessibility checks for the "purchasing" area (scanners in a11y-scan.ts). Live once Task 5 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = "Task 5"
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("purchasing")
for (const c of CHECKS) test(`purchasing: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))
