// Phone layout and accessibility checks for the "customers" area (scanners in a11y-scan.ts). Live once Task 3 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = "Task 3"
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("customers")
for (const c of CHECKS) test(`customers: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))
