// Phone layout and accessibility checks for the "frame" area (scanners in a11y-scan.ts). Live once Task 1 lands.
import test from "node:test"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = "Task 1"
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("frame")
for (const c of CHECKS) test(`frame: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))
