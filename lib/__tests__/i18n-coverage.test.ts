// Full Arabic (PR 3): exact dictionary facts. Every t() key the screens use exists in EN and AR, every enum and
// status value has a label, and the AR side is clean (Arabic, no U+FFFD, no duplicate keys).
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import * as enums from "../enums"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")
const I18N = read("lib/i18n-context.tsx")
const AR_AT = I18N.indexOf("\n  ar: {")
const EN_SRC = I18N.slice(I18N.indexOf("\n  en: {"), AR_AT)
const AR_SRC = I18N.slice(AR_AT, I18N.indexOf("\n  },\n}", AR_AT))

const ENTRY = /^\s+(?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*"((?:[^"\\]|\\.)*)"/gm
function entries(src: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const m of src.matchAll(ENTRY)) out.push([m[1] ?? m[2], JSON.parse(`"${m[3]}"`)])
  return out
}
const EN = new Map(entries(EN_SRC))
const AR = new Map(entries(AR_SRC))

// Values passed to formatEnum/statusLabel/StatusBadge that are not in STATUS_TONE or lib/enums (from extra-enum.txt).
const EXTRA_ENUM: string[] = []
// AR values that are legitimately Latin-only (brands, codes).
const LATIN_OK: string[] = []

function walk(dir: string, skip: string[]): string[] {
  const abs = path.join(REPO, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (skip.includes(rel)) continue
    if (e.isDirectory()) out.push(...walk(rel, skip))
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(rel)
  }
  return out
}

function missing(keys: Iterable<string>): string[] {
  const out: string[] = []
  for (const k of keys) {
    if (!EN.has(k)) out.push(`EN ${k}`)
    if (!AR.has(k)) out.push(`AR ${k}`)
  }
  return out
}

test("every static t() key in components and app exists in EN and AR", () => {
  const files = [...walk("components", ["components/ui"]), ...walk("app", ["app/api"])]
  assert.ok(files.length > 50, `scanned ${files.length} files`)
  const keys = new Set<string>()
  for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*"([^"]+)"\s*[),]/g)) keys.add(m[1])
  assert.deepEqual(missing(keys), [])
})

test("every enum value has enum.* in EN and AR", () => {
  const values = new Set<string>()
  for (const m of read("lib/status-tone.ts").matchAll(/^\s+"?([\w-]+)"?:\s*"(neutral|waiting|approved|ready|done|danger)"/gm))
    values.add(m[1].toLowerCase())
  for (const v of Object.values(enums)) {
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const s of Object.values(v as Record<string, unknown>)) if (typeof s === "string") values.add(s.toLowerCase())
  }
  for (const v of EXTRA_ENUM) values.add(v.toLowerCase())
  assert.ok(values.size > 20, `enum values: ${values.size}`)
  assert.deepEqual(missing([...values].map((v) => `enum.${v}`)), [])
})

test("status families exist", () => {
  const keys = [
    ...[...enums.AR_STATUS_VALUES, ...enums.AP_STATUS_VALUES, ...enums.SCHEDULE_STATUS_VALUES, ...enums.SO_STATUS_VALUES].map((v) => `status.${v}`),
    ...enums.PO_STATUS_VALUES.map((v) => `po.status.${v}`),
    ...Object.values(enums.PAYMENT_TERMS).map((v) => `payment.${v}`),
  ]
  assert.deepEqual(missing(new Set(keys)), [])
})

test("no garbled Arabic", () => {
  assert.equal(I18N.includes("�"), false)
})

test("every AR value contains Arabic", () => {
  const latin = [...AR].filter(([k, v]) => !/[؀-ۿ]/.test(v) && !LATIN_OK.includes(k)).map(([k, v]) => `${k}: ${v}`)
  assert.deepEqual(latin, [])
})

test("no duplicate keys per language", () => {
  for (const [name, src] of [["EN", EN_SRC], ["AR", AR_SRC]] as const) {
    const seen = new Set<string>()
    const dups: string[] = []
    for (const [k] of entries(src)) { if (seen.has(k)) dups.push(k); seen.add(k) }
    assert.deepEqual(dups, [], name)
  }
})
