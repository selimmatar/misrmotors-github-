// Every a11y.* label used in components and app code is defined once in EN and once in AR (Arabic letters in the AR value).
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { allTsx } from "./a11y-scan"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const I18N = read("lib/i18n-context.tsx")
const AR_AT = I18N.indexOf("\n  ar: {")
const EN = I18N.slice(0, AR_AT)
const AR = I18N.slice(AR_AT)

const used = (): Map<string, string[]> => {
  const m = new Map<string, string[]>()
  for (const f of allTsx().filter((x) => !x.startsWith("app/api/"))) {
    for (const k of read(f).matchAll(/\bt\(\s*["']((?:a11y)\.[^"']+)["']/g)) m.set(k[1], [...(m.get(k[1]) ?? []), f])
  }
  return m
}
const defs = (block: string, key: string) => [...block.matchAll(new RegExp(`^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*(.*?),?\\s*$`, "gm"))].map((m) => m[1])
const allDefined = (block: string) => [...block.matchAll(/^\s*"(a11y\.[^"]+)":/gm)].map((m) => m[1])

test("every a11y key used is defined in EN and AR", () => {
  const problems: string[] = []
  for (const [k, files] of used()) {
    if (defs(EN, k).length === 0) problems.push(`${k}: missing in EN (${files[0]})`)
    const ar = defs(AR, k)
    if (ar.length === 0) problems.push(`${k}: missing in AR (${files[0]})`)
    else if (!/[\u0600-\u06FF]/.test(ar[0])) problems.push(`${k}: AR value has no Arabic letters`)
  }
  assert.deepEqual(problems, [])
})

test("no dynamic a11y keys", () => {
  const bad = allTsx().filter((f) => !f.startsWith("app/api/") && /\bt\(\s*`a11y\./.test(read(f)))
  assert.deepEqual(bad, [])
})

test("each a11y key is defined once per language", () => {
  const dup: string[] = []
  for (const [lang, block] of [["EN", EN], ["AR", AR]] as const) {
    const keys = allDefined(block)
    for (const k of new Set(keys)) if (keys.filter((x) => x === k).length > 1) dup.push(`${lang}: ${k}`)
  }
  assert.deepEqual(dup, [])
})
