// Phone layout and accessibility checks for the "sales" area (scanners in a11y-scan.ts). Live once Task 2 lands.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"

const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("sales")
for (const c of CHECKS) test(`sales: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

const read = (f: string) => fs.readFileSync(path.join(process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", ".."), f), "utf8")
test("quotation items toolbar wraps", () => {
  const s = read("components/modules/sales-quotation-module.tsx"), i = s.indexOf("fileInputRef.current?.click()")
  const head = s.slice(s.lastIndexOf("<CardHeader", i), i)
  assert.ok((head.match(/flex-wrap/g) || []).length >= 2, "row and button group both wrap")
})
