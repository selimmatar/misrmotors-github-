// Shared display formatting (dates, money, enum labels, initials) used by the PR 1a building blocks.
import test from "node:test"
import assert from "node:assert/strict"
import { formatDate, formatMoney, formatEnum, initials } from "../format"
import { keyToReadable } from "../i18n-fallback"

test("dates: en and ar", () => {
  assert.equal(formatDate("2026-10-08", "en"), "08 Oct 2026")
  assert.equal(formatDate("2026-10-08", "ar"), "٠٨ أكتوبر ٢٠٢٦")
  assert.equal(formatDate(new Date(2026, 0, 5), "en"), "05 Jan 2026")
  assert.equal(formatDate("2026-10-08T10:00:00Z", "en"), "08 Oct 2026")
})

test("dates: empty and invalid give a dash", () => {
  for (const v of [null, undefined, "", "not a date"]) assert.equal(formatDate(v as any, "en"), "—")
})

test("date-only strings keep their calendar day in any time zone", () => {
  const tz = process.env.TZ
  process.env.TZ = "America/Los_Angeles"
  try {
    assert.equal(formatDate("2026-10-08", "en"), "08 Oct 2026")
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
})

test("money: two decimals, grouping, Western digits in both languages", () => {
  assert.equal(formatMoney(0, "en"), "0.00")
  assert.equal(formatMoney(-1500, "en"), "-1,500.00")
  assert.equal(formatMoney("1234.5", "en"), "1,234.50")
  assert.equal(formatMoney(1206000, "ar"), "1,206,000.00")
  for (const v of [null, undefined, "", "abc"]) assert.equal(formatMoney(v as any, "en"), "—")
})

test("enum: translation, sentence-case fallback, dash", () => {
  const t = (k: string) => ({ "enum.pending": "Waiting" } as Record<string, string>)[k] ?? keyToReadable(k)
  assert.equal(formatEnum("pending", t), "Waiting")
  assert.equal(formatEnum("bank_transfer", t), "Bank transfer")
  assert.equal(formatEnum("READY_FOR_SHIPMENT", t), "Ready for shipment")
  assert.equal(formatEnum(null, t), "—")
  assert.equal(formatEnum("", t), "—")
})

test("initials", () => {
  assert.equal(initials("Sales Representative"), "SR")
  assert.equal(initials("CEO / Owner"), "CO")
  assert.equal(initials("أحمد سالم"), "أس")
  assert.equal(initials(""), "?")
})
