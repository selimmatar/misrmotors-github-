// Static scanners for the phone-layout and accessibility checks. Relative imports only (the test runner compiles to CJS).
import ts from "typescript"
import fs from "node:fs"
import path from "node:path"

export { RTL_BAD } from "./module-guard"

export type Area = "frame" | "sales" | "customers" | "finance" | "purchasing" | "inventory" | "overview"
export type Check = "iconOnly" | "toggles" | "keys" | "contrast" | "tabLists" | "ariaLiteral" | "negOffsets"

export const AREAS: Area[] = ["frame", "sales", "customers", "finance", "purchasing", "inventory", "overview"]
export const CHECKS: Check[] = ["iconOnly", "toggles", "keys", "contrast", "tabLists", "ariaLiteral", "negOffsets"]

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")

const mods = (names: string[], suffix = "-module.tsx") => names.map((n) => `components/modules/${n}${suffix}`)

// Entries ending in "/" are directory prefixes; the rest are files.
export const OWNED: Record<Area, string[]> = {
  frame: [
    "components/layout/", "components/erp/", "components/auth/", "components/dashboard/",
    ...["button", "input", "select", "tabs", "checkbox", "radio-group", "switch", "dialog", "sheet"].map((n) => `components/ui/${n}.tsx`),
    "app/layout.tsx", "app/page.tsx",
  ],
  sales: [
    ...mods(["sales-order", "sales-quotation", "sales-quotations-hub", "approve-sales-quotations"]),
    ...["sales-order", "sales-quotation", "sales", "payment", "discount", "so-type"].map((d) => `components/${d}/`),
    "components/order-summary-card.tsx", "components/product-search-combobox.tsx",
  ],
  customers: [
    ...mods(["approve-sales-orders", "delivery-permits", "customer", "lost-sales"]),
    "components/delivery-permit/",
  ],
  finance: [
    ...mods(["accounts-receivable", "accounts-payable", "payment-schedule", "balance", "maintenance-invoices", "accountant"]),
    "components/accounting/", "components/maintenance/",
  ],
  purchasing: [
    ...mods(["supplier", "product", "po-request", "purchase-order", "pricing-review", "reorder-suggestions"]),
    "components/modules/inventory-costing-settings.tsx",
    "components/supplier/",
  ],
  inventory: [
    ...mods(["inventory", "inventory-audit", "goods-receipt", "goods-receipt-tracking", "warehouse-transfers", "warehouse-delivery", "shipping", "courier-management", "operations-management", "maintenance"]),
    "components/shipping/",
  ],
  overview: [
    ...mods(["financial-dashboard", "analytics-dashboard", "ceo-chat-assistant"], ".tsx"),
    ...mods(["ai-assistant", "user-management", "hr-management", "metrics-validation", "system-health"]),
    "app/admin/", "app/auth/",
  ],
}

export const UNSCANNED: string[] = [
  "components/ui/",
  "components/report-generator.tsx",
  "components/quotation/quotation-preview-dialog.tsx",
  "components/updated-dfd-diagram.tsx",
  "app/api/",
]

export const matches = (entries: string[], file: string): boolean =>
  entries.some((e) => (e.endsWith("/") ? file.startsWith(e) : file === e))

export function allTsx(): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    const abs = path.join(REPO, rel)
    if (!fs.existsSync(abs)) return
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${ent.name}`
      if (ent.isDirectory()) { if (ent.name !== "node_modules" && ent.name !== ".next") walk(r) }
      else if (ent.name.endsWith(".tsx")) out.push(r)
    }
  }
  walk("components"); walk("app")
  return out.sort()
}

export const ownedFiles = (area: Area): string[] => allTsx().filter((f) => matches(OWNED[area], f))

// ---------------------------------------------------------------- AST helpers

const parse = (src: string) => ts.createSourceFile("x.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length

type JsxEl = ts.JsxElement | ts.JsxSelfClosingElement
const isEl = (n: ts.Node): n is JsxEl => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)
const openOf = (n: JsxEl) => (ts.isJsxElement(n) ? n.openingElement : n)
const tagOf = (n: JsxEl) => openOf(n).tagName.getText()
const attrNames = (n: JsxEl) => openOf(n).attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText())
const strip = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? strip(e.expression) : e)

function walk(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node)
  ts.forEachChild(node, (c) => walk(c, fn))
}

const unique = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b)

function exprIsText(e: ts.Expression): boolean {
  e = strip(e)
  if (e.kind === ts.SyntaxKind.NullKeyword) return false
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) return false
  if (ts.isJsxFragment(e)) return false
  if (ts.isConditionalExpression(e)) return exprIsText(e.whenTrue) || exprIsText(e.whenFalse)
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) return exprIsText(e.right)
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) return exprIsText(e.left) || exprIsText(e.right)
  }
  return true
}

function childrenHaveText(children: readonly ts.JsxChild[]): boolean {
  for (const c of children) {
    if (ts.isJsxText(c)) { if (c.text.trim() !== "") return true }
    else if (ts.isJsxExpression(c)) { if (c.expression && exprIsText(c.expression)) return true }
    else if (ts.isJsxElement(c)) { if (childrenHaveText(c.children)) return true }
    else if (ts.isJsxFragment(c)) { if (childrenHaveText(c.children)) return true }
  }
  return false
}

const ICON_TAGS = new Set(["Button", "button", "DialogClose", "SheetClose", "PopoverTrigger", "DropdownMenuTrigger", "Toggle", "ToggleGroupItem"])

export function iconOnlyButtons(src: string): number[] {
  const sf = parse(src), out: number[] = []
  walk(sf, (n) => {
    if (!isEl(n) || !ICON_TAGS.has(tagOf(n))) return
    const names = attrNames(n)
    if (names.includes("asChild") || names.includes("aria-label") || names.includes("aria-labelledby")) return
    if (ts.isJsxElement(n) && childrenHaveText(n.children)) return
    out.push(lineOf(sf, n))
  })
  return unique(out)
}

export function unnamedToggles(src: string): number[] {
  const sf = parse(src), out: number[] = []
  walk(sf, (n) => {
    if (!isEl(n) || !["Checkbox", "Switch", "RadioGroupItem"].includes(tagOf(n))) return
    const names = attrNames(n)
    if (names.some((a) => a === "aria-label" || a === "aria-labelledby" || a === "id")) return
    out.push(lineOf(sf, n))
  })
  return unique(out)
}

function firstReturn(node: ts.Node): ts.ReturnStatement | undefined {
  let found: ts.ReturnStatement | undefined
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isReturnStatement(n)) { found = n; return }
    if (ts.isFunctionLike(n) && n !== node) return
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

export function unkeyedMapReturns(src: string): number[] {
  const sf = parse(src), out: number[] = []
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "map") return
    const cb = n.arguments[0]
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) return
    let ret: ts.Expression | undefined
    if (ts.isArrowFunction(cb) && !ts.isBlock(cb.body)) ret = cb.body
    else ret = firstReturn(cb.body)?.expression
    if (!ret) return
    ret = strip(ret)
    if (ts.isJsxFragment(ret)) out.push(lineOf(sf, ret))
    else if (isEl(ret) && !attrNames(ret).includes("key")) out.push(lineOf(sf, ret))
  })
  return unique(out)
}

// ---------------------------------------------------------------- text scanners

const HUES_WARM = "red|rose|pink|orange|amber|yellow|lime|green|emerald|teal|cyan|sky"
const HUES_COOL = "blue|indigo|violet|purple|fuchsia"
const HUES_BG_COOL = "blue|indigo|violet|purple"
const GREYS = "gray|slate|zinc|neutral|stone"
const PRE = "((?:[\\w\\[\\]&>*=.-]+:)*)"
const TEXT_BAD = new RegExp(`(?<![\\w:-])${PRE}text-(?:(?:${HUES_WARM})-(?:400|500|600)|(?:${HUES_COOL})-(?:400|500)|(?:${GREYS})-(?:300|400))(?![\\w-])`, "g")
const BG_BAD = new RegExp(`(?<![\\w:-])${PRE}bg-(?:(?:${HUES_WARM})-(?:400|500|600)|(?:${HUES_BG_COOL})-(?:400|500))(?![\\w-])`, "g")
const WHITE = /(?<![\w-])text-white(?![\w-])/
const STRINGS = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g

export function contrastBad(src: string): number[] {
  const out: number[] = []
  const lines = src.split("\n")
  lines.forEach((line, i) => {
    for (const m of line.matchAll(TEXT_BAD)) if (!m[1].split(":").includes("dark")) { out.push(i + 1); break }
  })
  const spans = [...src.matchAll(STRINGS)].map((m) => ({ s: m.index!, e: m.index! + m[0].length, text: m[0] }))
  for (const m of src.matchAll(BG_BAD)) {
    if (m[1].split(":").includes("dark")) continue
    const at = m.index!
    const span = spans.find((s) => s.s <= at && at < s.e)
    const ctx = span ? span.text : (src.split("\n")[lineAt(src, at) - 1] ?? "")
    if (WHITE.test(ctx)) out.push(lineAt(src, at))
  }
  return unique(out)
}

export function unwrappedTabLists(src: string): number[] {
  const out: number[] = []
  for (const m of src.matchAll(/<TabsList\b((?:=>|[^>])*)>/g)) {
    const attrs = m[1]
    const cls = attrs.match(/className\s*=\s*(?:"[^"]*"|\{[\s\S]*?\}(?=\s|$|\/)|'[^']*')/)?.[0] ?? attrs
    if (!cls.includes("flex-wrap") || cls.includes("grid-cols-") || attrs.includes("gridTemplateColumns")) out.push(lineAt(src, m.index!))
  }
  return unique(out)
}

export function ariaLiteral(src: string): number[] {
  const out: number[] = []
  for (const m of src.matchAll(/aria-label=(?:"([^"]*)"|\{\s*(?:"([^"]*)"|'([^']*)')\s*\})/g)) {
    const v = m[1] ?? m[2] ?? m[3] ?? ""
    if (/\p{L}/u.test(v)) out.push(lineAt(src, m.index!))
  }
  return unique(out)
}

export function negOffsets(src: string): number[] {
  const out: number[] = []
  src.split("\n").forEach((line, i) => { if (/(?<![\w-])-(?:left|right)-[\d[]/.test(line)) out.push(i + 1) })
  return out
}

// ---------------------------------------------------------------- per-area findings

const SCANNERS: Record<Check, (src: string) => number[]> = {
  iconOnly: iconOnlyButtons, toggles: unnamedToggles, keys: unkeyedMapReturns, contrast: contrastBad,
  tabLists: unwrappedTabLists, ariaLiteral, negOffsets,
}

export function areaFindings(area: Area): Record<Check, string[]> {
  const res = {} as Record<Check, string[]>
  for (const c of CHECKS) res[c] = []
  for (const f of ownedFiles(area)) {
    const src = fs.readFileSync(path.join(REPO, f), "utf8")
    for (const c of CHECKS) for (const n of SCANNERS[c](src)) res[c].push(`${f}:${n}`)
  }
  return res
}

// Drops up to allow[file] findings per file.
export function allowed(findings: string[], allow: Record<string, number>): string[] {
  const left = { ...allow }
  return findings.filter((x) => {
    const file = x.slice(0, x.lastIndexOf(":"))
    if ((left[file] ?? 0) > 0) { left[file]--; return false }
    return true
  })
}
