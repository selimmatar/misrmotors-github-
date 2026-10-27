// Reports step 1: due dates, late amounts, statements and the cash forecast. Cases mirror real invoice shapes.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  addMonths, daysBetween, ageBucket, arDueSchedule, apDueSchedule, summarizeDue, unpaidBetween, todayYmd,
} from "../due-schedule"
import { lateRows, buildStatement, cashForecast, toSheetRows } from "../reports/finance"

const ROOT = process.env.REPO_ROOT || join(__dirname, "../../../..")
const src = (file: string) => readFileSync(join(ROOT, file), "utf8")

// ---------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------
test("dates: months, days between, ageing columns", () => {
  assert.equal(addMonths("2026-07-26", 1), "2026-08-26")
  assert.equal(addMonths("2026-01-31", 1), "2026-03-03")
  assert.equal(daysBetween("2026-10-24", "2026-10-27"), 3)
  assert.equal(daysBetween("2026-10-27", "2026-10-27"), 0)
  assert.equal(ageBucket(0), null)
  assert.equal(ageBucket(1), "1-30")
  assert.equal(ageBucket(30), "1-30")
  assert.equal(ageBucket(31), "31-60")
  assert.equal(ageBucket(90), "61-90")
  assert.equal(ageBucket(91), "90+")
  assert.equal(todayYmd(new Date(2026, 9, 5, 23, 30)), "2026-10-05")
})

// ---------------------------------------------------------------------------------------------------------
// Customer invoices
// ---------------------------------------------------------------------------------------------------------
test("a cash customer invoice is one amount on its due date, whatever installment leftovers the order has", () => {
  const so = { total: 298873.8, paymentType: "cash", installments: 6, paymentDetails: { downPaymentAmount: 149436.9, remainingInstallmentMonths: 6, monthlyAmount: 24906.15 } }
  const inv = { amount: 298873.8, collectedAmount: 0, status: "pending", date: "2026-07-26", dueDate: "2026-08-25" }
  const s = arDueSchedule(inv, so)
  assert.deepEqual(s, [{ dueDate: "2026-08-25", amount: 298873.8, paid: 0, isDownPayment: false }])
  const sum = summarizeDue(s, "2026-10-27")
  assert.equal(sum.overdue, 298873.8)
  assert.equal(sum.daysLate, 63)
  assert.equal(sum.buckets["61-90"], 298873.8)
})

test("late starts the day after the due date (no grace)", () => {
  const inv = { amount: 1000, collectedAmount: 0, status: "pending", date: "2026-09-27", dueDate: "2026-10-27" }
  const s = arDueSchedule(inv, { paymentType: "bank_transfer", total: 1000 })
  assert.equal(summarizeDue(s, "2026-10-27").overdue, 0)
  assert.equal(summarizeDue(s, "2026-10-27").dueSoon, 1000)
  assert.equal(summarizeDue(s, "2026-10-28").overdue, 1000)
  assert.equal(summarizeDue(s, "2026-10-28").daysLate, 1)
})

test("a part-paid invoice is late only for what is still owed", () => {
  const s = arDueSchedule({ amount: 6042, collectedAmount: 1000, status: "partially_paid", dueDate: "2026-10-01" }, { paymentType: "bank_transfer", total: 6042 })
  assert.equal(summarizeDue(s, "2026-10-27").overdue, 5042)
})

test("an invoice marked paid owes nothing", () => {
  const s = arDueSchedule({ amount: 500, collectedAmount: 0, status: "paid", dueDate: "2026-01-01" }, { paymentType: "cash", total: 500 })
  assert.equal(summarizeDue(s, "2026-10-27").balance, 0)
})

test("cheque invoices fall due on the cheque date when one is set", () => {
  const s = arDueSchedule({ amount: 100, collectedAmount: 0, dueDate: "2026-11-01" }, { paymentType: "cheque", total: 100, paymentDetails: { chequeDueDate: "2026-12-15" } })
  assert.equal(s[0].dueDate, "2026-12-15")
})

test("installments: equal monthly amounts, payments fill the earliest first", () => {
  const s = arDueSchedule({ amount: 600, collectedAmount: 250, dueDate: "2026-07-01" }, { paymentType: "installments", installments: 3, total: 600 })
  assert.deepEqual(s.map((e) => [e.dueDate, e.amount, e.paid]), [["2026-07-01", 200, 200], ["2026-08-01", 200, 50], ["2026-09-01", 200, 0]])
  const sum = summarizeDue(s, "2026-08-15")
  assert.equal(sum.overdue, 150)
  assert.equal(sum.oldestLateDate, "2026-08-01")
  assert.equal(sum.nextDueDate, "2026-09-01")
})

test("hybrid: down payment then installments; an invoice for part of the order gets its share", () => {
  const so = { total: 1000, paymentType: "hybrid", downPaymentDueDate: "2026-07-01", paymentDetails: { downPaymentAmount: 400, remainingAmount: 600, remainingInstallmentMonths: 2, monthlyAmount: 300 } }
  const whole = arDueSchedule({ amount: 1000, collectedAmount: 0 }, so)
  assert.deepEqual(whole.map((e) => [e.dueDate, e.amount, e.isDownPayment]), [["2026-07-01", 400, true], ["2026-08-01", 300, false], ["2026-09-01", 300, false]])
  const half = arDueSchedule({ amount: 500, collectedAmount: 0 }, so)
  assert.deepEqual(half.map((e) => e.amount), [200, 150, 150])
})

test("manual schedules use the saved dates", () => {
  const so = { total: 900, paymentType: "installments", scheduleMode: "MANUAL", scheduleEntries: [{ dueDate: "2026-07-10", amount: 300 }, { dueDate: "2026-09-10", amount: 600 }] }
  const s = arDueSchedule({ amount: 900, collectedAmount: 300 }, so)
  assert.deepEqual(s.map((e) => [e.dueDate, e.paid]), [["2026-07-10", 300], ["2026-09-10", 0]])
})

test("maintenance invoices are one amount on their own due date", () => {
  const s = arDueSchedule({ invoiceNumber: "INV-MNT-0001", amount: 50, collectedAmount: 0, dueDate: "2026-10-01", paymentTerms: "cash" }, null)
  assert.deepEqual(s.map((e) => e.dueDate), ["2026-10-01"])
})

// ---------------------------------------------------------------------------------------------------------
// Supplier invoices
// ---------------------------------------------------------------------------------------------------------
test("a cash supplier invoice is one amount on its due date", () => {
  const s = apDueSchedule({ amount: 399000, paidAmount: 44000, status: "partially_paid", dueDate: "2026-10-18", paymentType: "cash", installmentMonths: 1 }, { paymentType: "cash" })
  assert.deepEqual(s, [{ dueDate: "2026-10-18", amount: 399000, paid: 44000, isDownPayment: false }])
  assert.equal(summarizeDue(s, "2026-10-27").overdue, 355000)
})

test("a supplier invoice marked paid owes nothing even with no payment recorded", () => {
  const s = apDueSchedule({ amount: 63200, paidAmount: 0, status: "paid", dueDate: "2026-07-26", paymentType: "cash" }, null)
  assert.equal(summarizeDue(s, "2026-10-27").balance, 0)
})

test("a hybrid supplier invoice: down payment then monthly amounts", () => {
  const s = apDueSchedule({ amount: 1000, paidAmount: 0, paymentType: "hybrid", downPaymentAmount: 200, downPaymentDueDate: "2026-07-01", remainingAmount: 800, remainingInstallmentMonths: 2, monthlyAmount: 400, paymentStartDate: "2026-08-01" }, null)
  assert.deepEqual(s.map((e) => [e.dueDate, e.amount]), [["2026-07-01", 200], ["2026-08-01", 400], ["2026-09-01", 400]])
})

test("unpaidBetween lists what falls due in a window", () => {
  const s = arDueSchedule({ amount: 600, collectedAmount: 200, dueDate: "2026-07-01" }, { paymentType: "installments", installments: 3, total: 600 })
  assert.deepEqual(unpaidBetween(s, "2026-08-01", "2026-08-31"), [{ dueDate: "2026-08-01", amount: 200 }])
})

// ---------------------------------------------------------------------------------------------------------
// Report rows
// ---------------------------------------------------------------------------------------------------------
const customers = [{ id: "1", name: "Nile Co" }, { id: "2", name: "Delta Co" }]
const arInvoices = [
  { id: "10", invoiceNumber: "INV-1", customerId: "1", soId: "100", amount: 1000, collectedAmount: 0, status: "pending", date: "2026-07-01", dueDate: "2026-07-31" },
  { id: "11", invoiceNumber: "INV-2", customerId: "2", soId: "101", amount: 500, collectedAmount: 0, status: "pending", date: "2026-10-01", dueDate: "2026-10-30" },
  { id: "12", invoiceNumber: "INV-3", customerId: "1", soId: "100", amount: 300, collectedAmount: 300, status: "paid", date: "2026-08-01", dueDate: "2026-08-31" },
]
const salesOrders = [{ id: "100", soNumber: "SO-1", paymentType: "cash", total: 1300 }, { id: "101", soNumber: "SO-2", paymentType: "cash", total: 500 }]

test("late report: one row per late invoice with ageing columns, and coming-due rows", () => {
  const r = lateRows({ side: "ar", invoices: arInvoices, orders: salesOrders, parties: customers, today: "2026-10-27" })
  assert.equal(r.late.length, 1)
  assert.equal(r.late[0].invoiceNumber, "INV-1")
  assert.equal(r.late[0].partyName, "Nile Co")
  assert.equal(r.late[0].orderNumber, "SO-1")
  assert.equal(r.late[0].daysLate, 88)
  assert.equal(r.late[0].buckets["61-90"], 1000)
  assert.equal(r.totals.overdue, 1000)
  assert.equal(r.dueSoon.length, 1)
  assert.equal(r.dueSoon[0].invoiceNumber, "INV-2")
  assert.equal(r.dueSoon[0].nextDueDate, "2026-10-30")
  const one = lateRows({ side: "ar", invoices: arInvoices, orders: salesOrders, parties: customers, today: "2026-10-27", partyId: "2" })
  assert.equal(one.late.length, 0)
})

test("statement: opening balance, invoices and payments in date order with a running balance", () => {
  const st = buildStatement({
    invoices: [
      { id: "10", number: "INV-1", date: "2026-07-01", amount: 1000 },
      { id: "12", number: "INV-3", date: "2026-08-01", amount: 300 },
      { id: "13", number: "INV-4", date: "2026-09-15", amount: 200 },
    ],
    payments: [
      { date: "2026-07-20", amount: 400, invoiceId: "10", method: "cash", reference: "R1" },
      { date: "2026-09-20", amount: 300, invoiceId: "12", method: "cheque", reference: "" },
    ],
    from: "2026-08-01",
    to: "2026-09-30",
    invoiceNumberById: { "10": "INV-1", "12": "INV-3" },
  })
  assert.equal(st.opening, 600)
  assert.deepEqual(st.lines.map((l) => [l.date, l.kind, l.debit, l.credit, l.balance]), [
    ["2026-08-01", "invoice", 300, 0, 900],
    ["2026-09-15", "invoice", 200, 0, 1100],
    ["2026-09-20", "payment", 0, 300, 800],
  ])
  assert.equal(st.closing, 800)
  assert.equal(st.totalDebit, 500)
  assert.equal(st.totalCredit, 300)
})

test("cash forecast: money in and out by week, late amounts in their own first row", () => {
  const f = cashForecast({
    receivable: [{ dueDate: "2026-10-20", amount: 100 }, { dueDate: "2026-10-28", amount: 200 }, { dueDate: "2026-11-05", amount: 50 }],
    payable: [{ dueDate: "2026-10-29", amount: 80 }],
    today: "2026-10-27",
    weeks: 2,
  })
  assert.deepEqual(f.map((w) => [w.from, w.to, w.moneyIn, w.moneyOut, w.net]), [
    ["", "2026-10-26", 100, 0, 100],
    ["2026-10-27", "2026-11-02", 200, 80, 120],
    ["2026-11-03", "2026-11-09", 50, 0, 50],
  ])
})

test("Excel sheet rows keep Arabic text and numbers as numbers", () => {
  const rows = toSheetRows(["العميل", "المبلغ"], [["شركة النيل", 1500.5]])
  assert.deepEqual(rows, [["العميل", "المبلغ"], ["شركة النيل", 1500.5]])
})

// ---------------------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------------------
test("the Reports page is in the accountant's and the CEO's menu, in the finance group", () => {
  const nav = src("components/layout/nav-config.ts")
  const groups = src("lib/nav-groups.ts")
  const dash = src("components/dashboard/dashboard.tsx")
  assert.match(nav, /accountant:[\s\S]*?\{ id: "finance-reports"[\s\S]*?\n  \],/)
  assert.match(nav, /ceo:[\s\S]*?\{ id: "finance-reports"[\s\S]*?\n  \],/)
  assert.match(groups, /"finance-reports": "finance"/)
  assert.match(dash, /case "finance-reports":/)
})

test("the AR and AP Overdue tiles use the shared due-date calculation", () => {
  assert.match(src("components/modules/accounts-receivable-module.tsx"), /arDueSchedule\(/)
  assert.match(src("components/modules/accounts-payable-module.tsx"), /apDueSchedule\(/)
})

test("shared lists are re-read when a screen is opened and when coming back to the tab", () => {
  const ctx = src("lib/app-context.tsx")
  assert.match(ctx, /revalidateOnFocus: true/)
  assert.match(ctx, /focusThrottleInterval: 30000/)
  assert.match(ctx, /refreshLists/)
  assert.match(src("components/dashboard/dashboard.tsx"), /refreshLists\(\)/)
})
