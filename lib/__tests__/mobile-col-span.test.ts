// Owner report 2026-11-27 (phone screenshot of "Add New Customer"): a box set to span 2 columns ("col-span-2") inside a
// form that has 1 column on a phone ("grid-cols-1 sm:grid-cols-2") makes the phone add a second, tiny column, so every
// label overlaps and the fields squeeze. A span inside a 1-column grid must only apply on wider screens (sm:/md:/lg:).
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.REPO_ROOT || process.cwd()

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === "node_modules" || name.startsWith(".")) continue
    if (statSync(p).isDirectory()) tsxFiles(p, out)
    else if (p.endsWith(".tsx")) out.push(p)
  }
  return out
}

/** unprefixed col-span-N (N >= 2) whose nearest grid above has 1 column on a phone */
export function phoneSpanProblems(source: string): number[] {
  const lines = source.split("\n")
  const bad: number[] = []
  lines.forEach((line, i) => {
    if (!/(^|["'\s`])col-span-([2-9]|1[0-2])(?=["'\s`])/.test(line)) return
    for (let j = i - 1; j >= 0 && j >= i - 120; j--) {
      const m = lines[j].match(/(^|["'\s`])grid-cols-(\d+)(?=["'\s`])/)
      if (m) {
        if (m[2] === "1") bad.push(i + 1)
        return
      }
    }
  })
  return bad
}

test("the scan catches the customer-form mistake and allows the fixed form", () => {
  assert.deepEqual(phoneSpanProblems(`<div className="grid grid-cols-1 sm:grid-cols-2">\n<div>a</div>\n<div className="col-span-2">`), [3])
  assert.deepEqual(phoneSpanProblems(`<div className="grid grid-cols-1 sm:grid-cols-2">\n<div className="sm:col-span-2">`), [])
  assert.deepEqual(phoneSpanProblems(`<div className="grid grid-cols-2 gap-4">\n<div className="col-span-2">`), [])
})

test("no screen squeezes into an extra column on a phone", () => {
  const problems: string[] = []
  for (const dir of ["components", "app"]) {
    for (const f of tsxFiles(join(ROOT, dir))) {
      for (const n of phoneSpanProblems(readFileSync(f, "utf8"))) problems.push(`${f.slice(ROOT.length + 1)}:${n}`)
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"))
})
