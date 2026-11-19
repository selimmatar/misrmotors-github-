// Invoice codes (spec docs/superpowers/specs/2026-11-19-invoice-codes-and-maintenance-photos-design.md, part 1).
import test from "node:test"
import assert from "node:assert/strict"
import {
  INVOICE_SERIAL_START,
  QUICK_SO_NOTE,
  QUICK_SO_TYPE,
  invoiceCodeForOrders,
  invoiceYear2,
  isMaintenanceNumber,
  isMinvNumber,
  nextCodedNumber,
} from "../invoice-codes"
import { tabOf } from "../ar-tabs"
import { isMaintenanceInvoice } from "../maintenance-quick-invoice"

test("C1. the first number of each code and year is 5567, no dashes", () => {
  assert.equal(INVOICE_SERIAL_START, 5567)
  assert.equal(nextCodedNumber("INV", "26", []), "INV265567")
  assert.equal(nextCodedNumber("MINV", "26", []), "MINV265567")
})

test("C2. each code has its own sequence; they never move each other", () => {
  const existing = ["INV265567", "INV265568", "MINV265567"]
  assert.equal(nextCodedNumber("INV", "26", existing), "INV265569")
  assert.equal(nextCodedNumber("MINV", "26", existing), "MINV265568")
})

test("C3. old numbers (INV-2026-..., 10503, INV-MNT-...) do not move the new counters", () => {
  const existing = ["INV-2026-0001", "INV-2026-10525", "10503", "10524", "INV-MNT-WO-12", "INV-SO-1-DP"]
  assert.equal(nextCodedNumber("INV", "26", existing), "INV265567")
  assert.equal(nextCodedNumber("MINV", "26", existing), "MINV265567")
})

test("C4. a new year starts again at 5567; last year's numbers do not count", () => {
  assert.equal(nextCodedNumber("INV", "27", ["INV265990", "MINV265600"]), "INV275567")
  assert.equal(nextCodedNumber("MINV", "27", ["INV265990", "MINV265600"]), "MINV275567")
})

test("C5. a retry after a clash moves on to the next free number", () => {
  assert.equal(nextCodedNumber("INV", "26", ["INV265570"], 1), "INV265572")
})

test("C6. INV numbers never count as MINV (INV is a prefix of neither)", () => {
  assert.equal(nextCodedNumber("MINV", "26", ["INV265900"]), "MINV265567")
  assert.equal(nextCodedNumber("INV", "26", ["MINV265900"]), "INV265567")
})

test("C7. the two-digit year is the Cairo year", () => {
  assert.equal(invoiceYear2(new Date("2026-06-01T12:00:00Z")), "26")
  // 31 Dec 2026 23:30 UTC is already 1 Jan 2027 in Cairo
  assert.equal(invoiceYear2(new Date("2026-12-31T23:30:00Z")), "27")
})

test("C8. MINV only when every order is a quick maintenance order", () => {
  const quick = { so_type: QUICK_SO_TYPE, notes: QUICK_SO_NOTE }
  const partsSale = { so_type: QUICK_SO_TYPE, notes: "parts order" }
  const sale = { so_type: "STANDARD", notes: null }
  assert.equal(invoiceCodeForOrders([quick]), "MINV")
  assert.equal(invoiceCodeForOrders([quick, quick]), "MINV")
  assert.equal(invoiceCodeForOrders([sale]), "INV")
  assert.equal(invoiceCodeForOrders([partsSale]), "INV")
  assert.equal(invoiceCodeForOrders([quick, sale]), "INV")
  assert.equal(invoiceCodeForOrders([]), "INV")
  assert.equal(invoiceCodeForOrders([undefined]), "INV")
})

test("C9. MINV numbers land in the Maintenance tab; INV numbers stay in Sales", () => {
  assert.equal(isMinvNumber("MINV265567"), true)
  assert.equal(isMinvNumber("INV265567"), false)
  assert.equal(isMaintenanceNumber("MINV265567"), true)
  assert.equal(isMaintenanceNumber("INV-MNT-WO-3"), true)
  assert.equal(isMaintenanceNumber("INV265567"), false)
  assert.equal(tabOf({ invoiceNumber: "MINV265567" }), "maintenance")
  assert.equal(tabOf({ invoiceNumber: "INV265567" }), "sales")
  assert.equal(isMaintenanceInvoice({ invoice_number: "MINV265567" }), true)
  assert.equal(isMaintenanceInvoice({ invoice_number: "INV265567" }), false)
})
