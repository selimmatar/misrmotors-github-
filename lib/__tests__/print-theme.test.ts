// Shared print theme (PR 5, "Plain modern"): PRINT_CSS and the three markup helpers. The helpers never escape (callers pass
// trusted, already-escaped HTML) and never add text; the stylesheet is black, white and greys only.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { PRINT_CSS, printHeader, docTitle, infoBox } from "../print/print-theme"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const strip = (h: string) => h.replace(/<[^>]*>/g, "").replace(/\s+/g, "")
const ARABIC = /[؀-ۿ]/

test("PT1 PRINT_CSS loads IBM Plex Sans Arabic first, with the Noto Naskh fallback", () => {
  assert.ok(
    PRINT_CSS.trimStart().startsWith(
      "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap');",
    ),
  )
  assert.ok(PRINT_CSS.includes("font-family: 'IBM Plex Sans Arabic', 'Noto Naskh Arabic', Arial, Tahoma, sans-serif"))
})

test("PT2 page and pagination rules", () => {
  assert.ok(PRINT_CSS.includes("@page { size: A4; margin: 15mm; }"))
  assert.ok(PRINT_CSS.includes("thead { display: table-header-group; }"))
  assert.match(PRINT_CSS, /tr \{[^}]*break-inside: avoid; page-break-inside: avoid/)
  assert.match(PRINT_CSS, /@media print \{[^}]*\.no-print \{ display: none !important; \}/)
  assert.match(PRINT_CSS, /\.pm-title \.doc-title \{[^}]*font-size: 34px/)
  assert.match(PRINT_CSS, /\.pm-num, \.pm-table \.currency-col \{[^}]*text-align: end;[^}]*font-variant-numeric: tabular-nums/)
})

test("PT3 nothing but black, white and greys", () => {
  const hexes = PRINT_CSS.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi) || []
  assert.ok(hexes.length > 0)
  for (const h of hexes) {
    const v = h.slice(1)
    const [r, g, b] = v.length === 3 ? [v[0], v[1], v[2]] : [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)]
    assert.ok(r.toLowerCase() === g.toLowerCase() && g.toLowerCase() === b.toLowerCase(), `${h} is not a grey`)
  }
  assert.doesNotMatch(PRINT_CSS, /\b(rgb|rgba|hsl)\(|\b(red|blue|green|navy|orange|yellow|purple)\b/i)
  const allowed = new Set(["#fff", "#ffffff", "white", "none", "none !important", "transparent"])
  for (const m of PRINT_CSS.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
    assert.ok(allowed.has(m[1].trim().toLowerCase()), `background value "${m[1].trim()}" is not allowed`)
  }
})

test("PT4 no decoration, no generated text, logical properties only", () => {
  // `order` is matched as a property name: "border:" must not count, so the character before it may not be a word character or "-"
  assert.doesNotMatch(
    PRINT_CSS,
    /text-transform|(^|[^-])content\s*:|border-radius|box-shadow|gradient|nth-child|(^|[^-\w])order\s*:|-reverse|float\s*:/,
  )
  assert.doesNotMatch(
    PRINT_CSS,
    /(margin|padding|border)-(left|right)|text-align:\s*(left|right)|(^|[\s;{])(left|right)\s*:/,
  )
  assert.doesNotMatch(PRINT_CSS, ARABIC)
})

test("PT5 the totals block is overridden, not reproduced", () => {
  assert.match(PRINT_CSS, /body \.totals-block[^{]*\{[^}]*border: 0 !important/)
  assert.match(PRINT_CSS, /body \.totals-block \*[^{]*\{[^}]*color: #000 !important/)
  assert.ok(!PRINT_CSS.includes('class="totals-block"'))
})

test("PT6 printHeader keeps the input order and adds no text", () => {
  const h = printHeader({
    logoHtml: '<img src="x">',
    company: { nameAr: "A1", nameEn: "B2", detailsHtml: "<div>C3</div>" },
    taxInfo: "D4",
  })
  assert.ok(h.startsWith('<header class="pm-header">'))
  const order = ['<img src="x">', 'pm-name-ar">A1<', 'pm-name-en">B2<', "<div>C3</div>", 'pm-tax">D4<'].map((s) => h.indexOf(s))
  assert.ok(order.every((i) => i >= 0), "every input appears")
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], "inputs keep their order")
  assert.equal(strip(h), "A1B2C3D4")
  const bare = printHeader({ logoHtml: "", company: { nameAr: "A1", detailsHtml: "<div>C3</div>" } })
  assert.ok(!bare.includes("pm-tax") && !bare.includes("pm-name-en"))
  const pre = printHeader({ logoHtml: "", company: { nameAr: "&lt;x&gt;", detailsHtml: "" } })
  assert.ok(pre.includes("&lt;x&gt;") && !pre.includes("&amp;lt;"), "already-escaped input is not escaped again")
})

test("PT7 docTitle keeps the pinned doc-title markup", () => {
  const t = docTitle({ titleAr: "T" })
  assert.ok(t.includes('<div class="doc-title">T</div>'))
  assert.ok(!t.includes("pm-title-no") && !t.includes("pm-title-note"))
  const full = docTitle({ titleAr: "T", noteHtml: "N", numberLabel: "L:", number: "9" })
  assert.equal(strip(full), "TNL:9")
  const idx = ['doc-title">T<', "pm-title-note", 'pm-title-no"', "L:", ">9<"].map((s) => full.indexOf(s))
  assert.ok(idx.every((i) => i >= 0))
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], "title, note, label, number in that order")
})

test("PT8 infoBox skips empty rows and keeps label-before-value order", () => {
  const b = infoBox("Head", [["L1", "V1"], null, false, undefined, ["L2", "V2", true]])
  assert.equal(strip(b), "HeadL1V1L2V2")
  // `class="pm-fields"` is the container, so the field divs are counted by what follows the class name
  assert.equal((b.match(/class="pm-field(?=[" ])/g) || []).length, 2)
  assert.equal((b.match(/pm-field-wide/g) || []).length, 1)
  assert.ok(!infoBox("", [["L", "V"]]).includes("pm-info-title"))
})

test("PT9 the module stands alone", () => {
  const src = fs.readFileSync(path.join(REPO, "lib/print/print-theme.ts"), "utf8")
  assert.doesNotMatch(src, /^import /m)
  assert.doesNotMatch(src, ARABIC)
})

test("PT10 numbers and money in table cells never break mid-figure", () => {
  // overflow-wrap: anywhere keeps long text from overflowing, but it would also split "1,524,944.28" across lines
  assert.match(PRINT_CSS, /\.pm-table td\.pm-num, \.pm-table td\.currency-col \{[^}]*white-space: nowrap;[^}]*overflow-wrap: normal;/)
})

test("PT11 long words wrap only when they cannot fit, never mid-word by default", () => {
  // overflow-wrap: anywhere also shrinks a column's minimum width, so the table split "Outsourced" into "Outso/urced"
  assert.match(PRINT_CSS, /\.pm-table td \{[^}]*overflow-wrap: break-word;/)
  assert.doesNotMatch(PRINT_CSS, /\.pm-table td \{[^}]*overflow-wrap: anywhere/)
})

test("PT12 split pound/piastre totals columns line up with the item table's money columns", () => {
  // The totals box is 60% wide; 20% of it is the 12% each money column takes in the item table
  assert.match(PRINT_CSS, /body \.totals-block td\.currency-col \{[^}]*width: 20%;/)
})

test("PT13 sales order money sub-headings sit over their figures", () => {
  const src = fs.readFileSync(path.join(REPO, "lib/so-print-html.ts"), "utf8")
  const subs = src.match(/<th class="subheader[^"]*"/g) || []
  assert.equal(subs.length, 4)
  for (const s of subs) assert.match(s, /pm-num/)
  assert.match(src, /<th rowspan="2" class="pm-center"[^>]*>م<\/th>/)
  assert.match(src, /<th rowspan="2" class="pm-center"[^>]*>الكمية<\/th>/)
  assert.equal((src.match(/<th colspan="2" class="pm-center">/g) || []).length, 2)
})

test("PT14 work order fields sit in the shared field grid, not one long column", () => {
  const src = fs.readFileSync(path.join(REPO, "app/api/maintenance/work-orders/[id]/pdf/route.ts"), "utf8")
  assert.equal((src.match(/<div class="pm-fields">/g) || []).length, 3)
})

test("PT15 missing-items unit cost stays on one line", () => {
  const src = fs.readFileSync(path.join(REPO, "lib/missing-items-html.ts"), "utf8")
  assert.match(src, /<td class="mi-cost">/)
  assert.match(src, /\.mi-cost \{[^}]*white-space: nowrap;/)
})
