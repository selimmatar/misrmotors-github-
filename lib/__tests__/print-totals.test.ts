// Batch 3: print totals, HTML escaping and the totals block (pure functions).
import test from "node:test"
import assert from "node:assert/strict"
import { computeTotals, computeSoPrintTotals, round2 } from "../print-totals"
import { escapeHtml, formatMoney, moneyCell, moneyCells, renderSoTotalsBlock, renderTotalsBlock, splitMoney } from "../print-html"

test("T1. the spec example: 100,000 - 10% = 90,000; VAT 12,600; total 102,600", () => {
  const t = computeTotals({ subtotal: 100000, discountType: "percentage", discountValue: 10 })
  assert.deepEqual(t, { subtotal: 100000, discount: 10000, netSubtotal: 90000, vat: 12600, total: 102600 })
})

test("T2. no discount, zero discount, unknown discount type", () => {
  assert.deepEqual(computeTotals({ subtotal: 1000 }), { subtotal: 1000, discount: 0, netSubtotal: 1000, vat: 140, total: 1140 })
  assert.equal(computeTotals({ subtotal: 1000, discountType: "percentage", discountValue: 0 }).discount, 0)
  assert.equal(computeTotals({ subtotal: 1000, discountType: "none", discountValue: 50 }).discount, 0)
  assert.equal(computeTotals({ subtotal: 1000, discountType: "weird", discountValue: 50 }).discount, 0)
})

test("T3. fixed discount, capped at the subtotal; a discount can never make the total negative", () => {
  assert.equal(computeTotals({ subtotal: 1000, discountType: "fixed", discountValue: 250 }).total, round2(750 * 1.14))
  const over = computeTotals({ subtotal: 1000, discountType: "fixed", discountValue: 5000 })
  assert.equal(over.netSubtotal, 0)
  assert.equal(over.total, 0)
  assert.equal(computeTotals({ subtotal: 1000, discountType: "percentage", discountValue: 250 }).netSubtotal, 0)
})

test("T4. a stored discount amount wins over type/value", () => {
  const t = computeTotals({ subtotal: 929757.6, discountType: "percentage", discountValue: 2, discountAmount: 18595.152 })
  assert.equal(t.discount, 18595.15)
  assert.equal(t.netSubtotal, 911162.45)
  assert.equal(t.vat, 127562.74) // matches SO-2026-0004 / QT-2026-0005 as stored
  assert.equal(t.total, 1038725.19)
})

test("T5. rounding: half cents round up, no float noise, lines add up to the cent", () => {
  assert.equal(round2(1.005), 1.01)
  assert.equal(round2(2.675), 2.68)
  assert.equal(round2(0.1 + 0.2), 0.3)
  assert.equal(round2(-1.005), -1.01)
  assert.equal(round2(NaN), 0)
  assert.equal(round2(undefined), 0)
  for (const subtotal of [0.01, 0.07, 33.33, 99.99, 1234.565, 65999.2, 455568.78, 2121256.87]) {
    for (const pct of [0, 5, 7.5, 12.5, 33.33]) {
      const t = computeTotals({ subtotal, discountType: "percentage", discountValue: pct })
      assert.equal(round2(t.netSubtotal + t.vat), t.total, `${subtotal}/${pct}`)
      assert.equal(round2(t.subtotal - t.discount), t.netSubtotal, `${subtotal}/${pct}`)
      assert.ok(Number.isInteger(Math.round(t.total * 100)) && Math.abs(t.total * 100 - Math.round(t.total * 100)) < 1e-6)
    }
  }
})

test("T6. totals agree with every non-quotation sales order in the live data (stored total = (subtotal - discount) x 1.14)", () => {
  const live: [number, number, number][] = [
    [262170, 0, 298873.8], [21816, 0, 24870.24], [225770, 0, 257377.8], [65999.2, 0, 75239.09], [929757.6, 18595.15, 1038725.19],
    [455568.78, 0, 519348.41], [36720, 0, 41860.8], [350158.4, 0, 399180.58], [2121256.87, 0, 2418232.83], [17000, 0, 19380],
  ]
  for (const [subtotal, discountAmount, total] of live) assert.equal(computeTotals({ subtotal, discountAmount }).total, total, String(subtotal))
})

test("T7. SO totals: no return -> original = current net, adjustment 0", () => {
  const t = computeSoPrintTotals({ subtotal: 100000, storedTotal: 114000, storedNetTotal: 114000 })
  assert.equal(t.originalTotal, 114000)
  assert.equal(t.currentNetTotal, 114000)
  assert.equal(t.returnsAdjustment, 0)
  assert.equal(t.breakdownConsistent, true)
})

test("T8. SO totals after a return: Batch 2 net total (80,000 of 100,000 -> 91,200 incl. VAT)", () => {
  const t = computeSoPrintTotals({ subtotal: 100000, storedTotal: 114000, storedNetTotal: 91200 })
  assert.equal(t.originalTotal, 114000)
  assert.equal(t.currentNetTotal, 91200)
  assert.equal(t.returnsAdjustment, -22800)
  const html = renderSoTotalsBlock(t)
  assert.match(html, /الإجمالي الأصلي/)
  assert.match(html, /مرتجعات \/ تسويات/)
  assert.match(html, /صافي الإجمالي الحالي/)
})

test("T9. SO totals: a null net_total falls back to the stored total; an inconsistent breakdown is not printed", () => {
  const t = computeSoPrintTotals({ subtotal: 100, storedTotal: 999, storedNetTotal: null })
  assert.equal(t.currentNetTotal, 999)
  assert.equal(t.breakdownConsistent, false)
  const html = renderSoTotalsBlock(t)
  assert.doesNotMatch(html, /ضريبة القيمة المضافة/) // only the stored figure is shown
  assert.match(html, /999/)
})

test("T10. splitMoney / moneyCells are exact on cents", () => {
  assert.deepEqual(splitMoney(1234.5), { pounds: "1,234", piastres: "50", negative: false })
  assert.deepEqual(splitMoney(0.07), { pounds: "0", piastres: "07", negative: false })
  assert.deepEqual(splitMoney(19.99), { pounds: "19", piastres: "99", negative: false })
  assert.deepEqual(splitMoney(-22800), { pounds: "22,800", piastres: "00", negative: true })
  assert.match(moneyCells(-5.5), />-5</)
})

test("T11. escapeHtml neutralises markup in every dynamic value", () => {
  assert.equal(escapeHtml(`<img src=x onerror=alert(1)> & "q" 'a'`), "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;a&#39;")
  assert.equal(escapeHtml(null), "")
  assert.equal(escapeHtml(undefined), "")
  assert.equal(escapeHtml(12), "12")
})

test("T12. the totals block is a table AFTER the items, never a <tfoot>, and prints each figure once", () => {
  const html = renderTotalsBlock(computeTotals({ subtotal: 100000, discountType: "percentage", discountValue: 10 }), { total: "إجمالي العرض" })
  assert.doesNotMatch(html, /<tfoot/i)
  assert.match(html, /totals-block/)
  assert.equal((html.match(/إجمالي العرض/g) || []).length, 1)
  assert.match(html, /100,000/) // subtotal before discount
  assert.match(html, /-10,000/) // the discount
  assert.match(html, />90,000</) // net subtotal
  assert.match(html, />12,600</) // VAT
  assert.match(html, />102,600</) // total
})

test("T20. one money column: whole pounds print without .00, fractions keep two decimals, nothing is lost", () => {
  assert.equal(formatMoney(5750), "5,750")
  assert.equal(formatMoney(2943.333), "2,943.33")
  assert.equal(formatMoney(0.5), "0.50")
  assert.equal(formatMoney(-1000), "-1,000")
  assert.equal(formatMoney(1038725.19), "1,038,725.19")
  assert.equal(moneyCell(5750), '<td class="currency-col">5,750</td>')
})

test("T21. the totals block has one money cell per row (no piastre column)", () => {
  const html = renderTotalsBlock(computeTotals({ subtotal: 100000, discountType: "percentage", discountValue: 10 }))
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) || []) assert.equal((row.match(/<td/g) || []).length, 2)
  const so = renderSoTotalsBlock(computeSoPrintTotals({ subtotal: 100, discountType: null, discountValue: 0, storedTotal: 114, storedNetTotal: 100 } as any))
  for (const row of so.match(/<tr>[\s\S]*?<\/tr>/g) || []) assert.equal((row.match(/<td/g) || []).length, 2)
})
