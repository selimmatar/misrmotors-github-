// Invoice codes (spec docs/superpowers/specs/2026-11-19-invoice-codes-and-maintenance-photos-design.md, part 1).
// Start moved to serial 001 (owner, 2026-11-20): INV26001, MINV26001.
import test from "node:test"
import assert from "node:assert/strict"
import {
  INVOICE_SERIAL_START,
  QUICK_SO_NOTE,
  QUICK_SO_TYPE,
  codedNumber,
  invoiceCodeForOrders,
  invoiceYear2,
  isMaintenanceNumber,
  isMinvNumber,
  nextCodedNumber,
} from "../invoice-codes"
import { tabOf } from "../ar-tabs"
import { isMaintenanceInvoice } from "../maintenance-quick-invoice"
import { FakeDb } from "./fake-db"
import { takeSharedNumber } from "../shared-invoice-numbers"
import { createStandaloneMinv } from "../invoicing"
import { allows, ruleFor } from "../auth/permissions"
import { renameInvoiceNumber } from "../eta/rename-invoice"
import { excludeReplaced } from "../ar-live"

test("C1. the first number of each code and year is 001, no dashes", () => {
  assert.equal(INVOICE_SERIAL_START, 1)
  assert.equal(nextCodedNumber("INV", "26", []), "INV26001")
  assert.equal(nextCodedNumber("MINV", "26", []), "MINV26001")
})

test("C1b. serials keep at least 3 digits and grow past 999", () => {
  assert.equal(codedNumber("INV", "26", 9), "INV26009")
  assert.equal(codedNumber("INV", "26", 999), "INV26999")
  assert.equal(nextCodedNumber("INV", "26", ["INV26999"]), "INV261000")
})

test("C2. each code has its own sequence; they never move each other", () => {
  const existing = ["INV26001", "INV26002", "MINV26001"]
  assert.equal(nextCodedNumber("INV", "26", existing), "INV26003")
  assert.equal(nextCodedNumber("MINV", "26", existing), "MINV26002")
})

test("C3. old numbers (INV-2026-..., 10503, INV-MNT-...) do not move the new counters", () => {
  const existing = ["INV-2026-0001", "INV-2026-10525", "10503", "10524", "INV-MNT-WO-12", "INV-SO-1-DP"]
  assert.equal(nextCodedNumber("INV", "26", existing), "INV26001")
  assert.equal(nextCodedNumber("MINV", "26", existing), "MINV26001")
})

test("C4. a new year starts again at 001; last year's numbers do not count", () => {
  assert.equal(nextCodedNumber("INV", "27", ["INV26990", "MINV26600"]), "INV27001")
  assert.equal(nextCodedNumber("MINV", "27", ["INV26990", "MINV26600"]), "MINV27001")
})

test("C5. a retry after a clash moves on to the next free number", () => {
  assert.equal(nextCodedNumber("INV", "26", ["INV26004"], 1), "INV26006")
})

test("C6. INV numbers never count as MINV (INV is a prefix of neither)", () => {
  assert.equal(nextCodedNumber("MINV", "26", ["INV26900"]), "MINV26001")
  assert.equal(nextCodedNumber("INV", "26", ["MINV26900"]), "INV26001")
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
  assert.equal(isMinvNumber("MINV26001"), true)
  assert.equal(isMinvNumber("INV26001"), false)
  assert.equal(isMaintenanceNumber("MINV26001"), true)
  assert.equal(isMaintenanceNumber("INV-MNT-WO-3"), true)
  assert.equal(isMaintenanceNumber("INV26001"), false)
  assert.equal(tabOf({ invoiceNumber: "MINV26001" }), "maintenance")
  assert.equal(tabOf({ invoiceNumber: "INV26001" }), "sales")
  assert.equal(isMaintenanceInvoice({ invoice_number: "MINV26001" }), true)
  assert.equal(isMaintenanceInvoice({ invoice_number: "INV26001" }), false)
})

// Part 3, carbon booklets
import { BOOKLET_PAGES, cleanMinvNumber, nextBookletRange, parseMinvNumber, skipReserved } from "../invoice-codes"
import { bookletStats, minvNumber } from "../maintenance-booklets"

test("office MINV numbers skip booklet blocks and ignore booklet numbers", () => {
  const block = { first: 34, last: 333 }
  assert.equal(nextCodedNumber("MINV", "26", ["MINV26032"], 0, [block]), "MINV26033")
  assert.equal(nextCodedNumber("MINV", "26", ["MINV26033"], 0, [block]), "MINV26334")
  // a booklet page already used does not push the office counter forward
  assert.equal(nextCodedNumber("MINV", "26", ["MINV26004", "MINV26100"], 0, [block]), "MINV26005")
  // the retry offset also skips the block
  assert.equal(nextCodedNumber("MINV", "26", ["MINV26032"], 2, [block]), "MINV26335")
  assert.equal(skipReserved(34, [block, { first: 334, last: 344 }]), 345)
})

test("a new booklet takes the next 300 after every number and every block", () => {
  assert.equal(BOOKLET_PAGES, 300)
  assert.deepEqual(nextBookletRange("26", [], []), { first: 1, last: 300 })
  assert.deepEqual(nextBookletRange("26", ["MINV26014"], []), { first: 15, last: 314 })
  assert.deepEqual(nextBookletRange("26", ["MINV26014"], [{ first: 34, last: 333 }]), { first: 334, last: 633 })
  assert.deepEqual(nextBookletRange("26", ["MINV275999", "INV269999"], []), { first: 1, last: 300 })
})

test("printed numbers are cleaned the way they are read or typed", () => {
  assert.equal(cleanMinvNumber("minv 26-001"), "MINV26001")
  assert.equal(cleanMinvNumber("٢٦٠٠١"), "MINV26001")
  assert.equal(cleanMinvNumber("MINV261"), "MINV26001")
  assert.equal(cleanMinvNumber("minv 26-5600"), "MINV265600")
  assert.equal(cleanMinvNumber("INV26001"), "")
  assert.equal(cleanMinvNumber(""), "")
  assert.deepEqual(parseMinvNumber("MINV26001"), { year2: "26", serial: 1 })
  assert.equal(parseMinvNumber("MINV2"), null)
  assert.equal(minvNumber("26", 1), "MINV26001")
})

test("booklet counts used, cancelled, blank and skipped pages", () => {
  const stats = bookletStats(
    { year2: "26", first_serial: 1, last_serial: 10 },
    new Set(["MINV26001", "MINV26004"]),
    new Set(["MINV26002"]),
  )
  assert.equal(stats.used, 2)
  assert.equal(stats.voided, 1)
  assert.equal(stats.blank, 7)
  assert.deepEqual(stats.skipped, ["MINV26003"])
})

// ---- v0 follow-up fixes (2026-11-22) ----------------------------------------------------------------------
test("shared numbers: a missing take_invoice_number function falls back to the INV/MINV numbering", async () => {
  const db = new FakeDb({ company_settings: [{ setting_key: "shared_invoice_start", setting_value: "1000" }], accounts_receivable: [] })
  db.jitter = false
  assert.equal(await takeSharedNumber(db, "sales", null, true), null) // FakeDb answers 42883 for an unknown rpc
  const made = await createStandaloneMinv(db, { customerId: 1, lines: [{ description: "x", quantity: 1, unitPrice: 100 }] })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  assert.match(made.body.invoice_number, /^MINV\d{2}001$/)
  // any other failure still stops the invoice
  db.rpcHandlers.take_invoice_number = () => {
    throw { code: "XX000", message: "locked" }
  }
  await assert.rejects(takeSharedNumber(db, "sales", null, true), /locked/)
})

test("permissions: only the accountant (and admin / CEO) reach the shared invoice number panel", () => {
  const r = ruleFor("/api/maintenance/shared-numbers")!
  assert.equal(r.prefix, "/api/maintenance/shared-numbers")
  for (const role of ["sales-rep", "warehouse-rep", "maintenance", "po-rep"] as const) {
    assert.equal(allows(r, "GET", [role]), false, role)
    assert.equal(allows(r, "POST", [role]), false, role)
  }
  assert.equal(allows(r, "POST", ["accountant"]), true)
  assert.equal(allows(r, "POST", ["ceo"]), true)
})

test("a cancelled MINV drops out of every live list and its number cannot be changed", async () => {
  const db = new FakeDb({
    accounts_receivable: [
      { invoice_id: 1, invoice_number: "X1-MINV26001", cancelled_number: "MINV26001", status: "cancelled", amount: 10 },
      { invoice_id: 2, invoice_number: "MINV26002", status: "pending", amount: 10 },
    ],
    eta_documents: [],
  })
  db.jitter = false
  const { data } = await excludeReplaced(db.from("accounts_receivable").select("invoice_id"))
  assert.deepEqual(data.map((r: any) => r.invoice_id), [2])
  const r = await renameInvoiceNumber(db, 1, "777", null)
  assert.equal(r.ok, false)
  assert.equal((r as any).code, "CANCELLED")
  assert.equal(db.tables.accounts_receivable[0].invoice_number, "X1-MINV26001")
})
