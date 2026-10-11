// Leftovers the phone + a11y browser sweep found after Tasks 1-8.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

test("kpi tile is compact on phones and unchanged from md up", () => {
  const s = read("components/erp/kpi-tile.tsx")
  assert.match(s, /min-h-\[72px\] md:min-h-\[104px\]/)
  assert.match(s, /p-3 md:p-4/)
})

test("checkbox and radio hit area reaches 44px on phones", () => {
  for (const f of ["components/ui/checkbox.tsx", "components/ui/radio-group.tsx"]) {
    const s = read(f)
    assert.match(s, /max-md:after:-inset-\[15px\]/, f)
    assert.doesNotMatch(s, /after:-inset-3\.5/, f)
  }
})

test("light accent passes 4.5:1 with white text; dark accent unchanged", () => {
  const s = read("app/globals.css")
  const [light, dark] = s.split(/^\.dark\s*\{/m)
  assert.match(light, /--accent: oklch\(0\.50 0\.2 220\);/)
  assert.match(dark, /--accent: oklch\(0\.65 0\.22 220\);/)
})

test("quotation totals box only takes its fixed width on laptops", () => {
  const s = read("components/modules/sales-quotation-module.tsx")
  assert.match(s, /space-y-2 w-full lg:w-auto lg:min-w-\[300px\]/)
})

test("clickable list card works from the keyboard", () => {
  const s = read("components/erp/responsive-list.tsx")
  assert.match(s, /role=\{onClick \? "button" : undefined\}/)
  assert.match(s, /tabIndex=\{onClick \? 0 : undefined\}/)
  assert.match(s, /e\.key === "Enter" \|\| e\.key === " "/)
  assert.match(s, /e\.target !== e\.currentTarget/)
})

test("warehouse delivery long action buttons wrap instead of pushing the page sideways", () => {
  const s = read("components/modules/warehouse-delivery-module.tsx")
  assert.match(s, /className="flex-1 min-w-0 h-auto whitespace-normal bg-blue-600 hover:bg-blue-700"\s*>\s*<Warehouse className="w-4 h-4 me-2 shrink-0" \/>\s*(Allocate Warehouses & Prepare|\{t\("wd\.allocate-prepare"\)\})/)
})
