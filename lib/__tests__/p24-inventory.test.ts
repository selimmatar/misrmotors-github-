// Phone layout and accessibility checks for the "inventory" area (scanners in a11y-scan.ts). Live once Task 6 lands.
import test from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert/strict"
import { areaFindings, allowed, CHECKS, type Check } from "./a11y-scan"
import { matchesStockFilter, STOCK_FILTERS } from "../inventory-stock-filter"

const TODO: string | false = false
const ALLOW: Partial<Record<Check, Record<string, number>>> = {}
const F = areaFindings("inventory")
for (const c of CHECKS) test(`inventory: ${c}`, { todo: TODO }, () => assert.deepEqual(allowed(F[c], ALLOW[c] ?? {}), [], c))

const read = (p: string) => readFileSync(join(process.env.REPO_ROOT ?? process.cwd(), p), "utf8")

// Owner, 2026-11-17: on-hand stock filter All / In stock (> 0) / Out of stock (<= 0)
test("stock filter: in stock is quantity > 0, out of stock is <= 0, all keeps everything", () => {
  const qtys = [5, 0, -2, "3", null]
  assert.deepEqual(qtys.filter((q) => matchesStockFilter(q, "in-stock")), [5, "3"])
  assert.deepEqual(qtys.filter((q) => matchesStockFilter(q, "out-of-stock")), [0, -2, null])
  assert.deepEqual(qtys.filter((q) => matchesStockFilter(q, "all")), qtys)
  assert.deepEqual(STOCK_FILTERS, ["all", "in-stock", "out-of-stock"])
})

test("stock filter: on the inventory screen, default All, applied after the all-warehouses aggregation, both languages", () => {
  const s = read("components/modules/inventory-module.tsx")
  assert.match(s, /useState<StockFilter>\("all"\)/)
  const memo = s.slice(s.indexOf("const filteredInventory = useMemo"), s.indexOf("const returnedItems = useMemo"))
  assert.ok(memo.indexOf("aggregatedMap") < memo.indexOf("matchesStockFilter(item.quantity, stockFilter)"), "filters the summed quantity")
  assert.match(memo, /\[inventory, categoryFilter, warehouseFilter, stockFilter, products, searchQuery\]/)
  for (const v of ["all", "in-stock", "out-of-stock"]) assert.match(s, new RegExp(`<SelectItem value="${v}">\\{t\\("inventory\\.stock-`))
  const i18n = read("lib/i18n-context.tsx")
  for (const k of ["inventory.stock-filter", "inventory.stock-all", "inventory.stock-in", "inventory.stock-out"]) {
    assert.equal(i18n.split(`"${k}":`).length - 1, 2, `${k} in English and Arabic`)
  }
})
test("shipping tabs wrap at phone widths", () => {
  const s = read("components/modules/shipping-module.tsx")
  assert.doesNotMatch(s, /<TabsList className="grid w-full grid-cols-5">/); assert.match(s, /<TabsList className="[^"]*flex-wrap/)
})
