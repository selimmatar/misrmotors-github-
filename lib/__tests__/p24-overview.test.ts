// Phone layout and accessibility checks for the "overview" area (scanners in a11y-scan.ts). Live once Task 7 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = "Task 7"
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("overview")
for (const c of CHECKS) test(`overview: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))
