// Rows for the money-owed reports on the Reports page: late payments, customer / supplier statements and the
// week-by-week cash forecast. Plain functions over the lists the screens already hold; read-only.
import { round2 } from "@/lib/invoicing"
import {
  AGE_BUCKETS, addDays, apDueSchedule, arDueSchedule, findPurchaseOrder, findSalesOrder, summarizeDue,
  type AgeBucket, type DueEntry,
} from "@/lib/due-schedule"

export type Side = "ar" | "ap"

export interface LateRow {
  invoiceId: string
  invoiceNumber: string
  partyId: string
  partyName: string
  orderNumber: string
  invoiceDate: string
  balance: number
  overdue: number
  daysLate: number
  oldestLateDate: string
  buckets: Record<AgeBucket, number>
  dueSoon: number
  nextDueDate: string
}

export interface LateReport {
  late: LateRow[]
  dueSoon: LateRow[]
  totals: { overdue: number; dueSoon: number; balance: number; buckets: Record<AgeBucket, number> }
}

/** The due schedule of any invoice on either side, paired with its order. */
export function dueScheduleFor(side: Side, inv: any, orders: any[]): DueEntry[] {
  return side === "ar"
    ? arDueSchedule(inv, findSalesOrder(orders, inv.soId) as any)
    : apDueSchedule(inv, findPurchaseOrder(orders, inv.poId) as any)
}

/** Late invoices (oldest first) and invoices falling due in the next `soonDays` days, for customers or suppliers. */
export function lateRows(opts: {
  side: Side
  invoices: any[]
  orders: any[]
  parties: { id: any; name?: string }[]
  today: string
  partyId?: string
  soonDays?: number
}): LateReport {
  const { side, invoices, orders, parties, today, partyId, soonDays = 7 } = opts
  const partyName = (id: string, fallback?: string) => parties.find((p) => String(p.id) === id)?.name || fallback || ""
  const rows: LateRow[] = []
  for (const inv of invoices) {
    const pid = String((side === "ar" ? inv.customerId : inv.supplierId) ?? "")
    if (partyId && pid !== partyId) continue
    const s = summarizeDue(dueScheduleFor(side, inv, orders), today, soonDays)
    if (s.balance <= 0) continue
    const order = side === "ar" ? findSalesOrder(orders, inv.soId) : findPurchaseOrder(orders, inv.poId)
    rows.push({
      invoiceId: String(inv.id ?? ""),
      invoiceNumber: inv.invoiceNumber || "",
      partyId: pid,
      partyName: partyName(pid, side === "ar" ? inv.customerName : inv.supplierName),
      orderNumber:
        (side === "ar" ? inv.soNumber || order?.soNumber || order?.so_number : inv.poNumber || order?.poNumber || order?.po_number) || "",
      invoiceDate: String(inv.invoiceDate || inv.date || "").slice(0, 10),
      balance: s.balance,
      overdue: s.overdue,
      daysLate: s.daysLate,
      oldestLateDate: s.oldestLateDate,
      buckets: s.buckets,
      dueSoon: s.dueSoon,
      nextDueDate: s.nextDueDate,
    })
  }
  const late = rows.filter((r) => r.overdue > 0).sort((a, b) => b.daysLate - a.daysLate || b.overdue - a.overdue)
  const dueSoon = rows.filter((r) => r.dueSoon > 0).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
  const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b, round2(late.reduce((s, r) => s + r.buckets[b], 0))])) as Record<AgeBucket, number>
  return {
    late,
    dueSoon,
    totals: {
      overdue: round2(late.reduce((s, r) => s + r.overdue, 0)),
      dueSoon: round2(dueSoon.reduce((s, r) => s + r.dueSoon, 0)),
      balance: round2(rows.reduce((s, r) => s + r.balance, 0)),
      buckets,
    },
  }
}

export interface StatementLine {
  date: string
  kind: "invoice" | "payment"
  reference: string
  /** Payment: the invoice it paid. */
  invoiceNumber: string
  method: string
  debit: number
  credit: number
  balance: number
}

export interface Statement {
  opening: number
  lines: StatementLine[]
  totalDebit: number
  totalCredit: number
  closing: number
}

/**
 * Account statement for one customer or supplier between `from` and `to` (inclusive, YYYY-MM-DD; empty = open).
 * Invoices add to what is owed, payments take it off; everything before `from` is the opening balance.
 * On the same day invoices come before payments.
 */
export function buildStatement(opts: {
  invoices: { id: string; number: string; date: string; amount: number }[]
  payments: { date: string; amount: number; invoiceId?: string; method?: string; reference?: string }[]
  from: string
  to: string
  invoiceNumberById?: Record<string, string>
}): Statement {
  const { from, to, invoiceNumberById = {} } = opts
  type Item = Omit<StatementLine, "balance">
  const items: Item[] = [
    ...opts.invoices.map((i) => ({
      date: String(i.date || "").slice(0, 10), kind: "invoice" as const, reference: i.number, invoiceNumber: i.number,
      method: "", debit: round2(Number(i.amount) || 0), credit: 0,
    })),
    ...opts.payments.map((p) => ({
      date: String(p.date || "").slice(0, 10), kind: "payment" as const, reference: p.reference || "",
      invoiceNumber: (p.invoiceId && invoiceNumberById[p.invoiceId]) || "", method: p.method || "",
      debit: 0, credit: round2(Number(p.amount) || 0),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "invoice" ? -1 : 1))

  let opening = 0
  const lines: StatementLine[] = []
  let balance = 0
  for (const it of items) {
    if (from && it.date < from) {
      opening = round2(opening + it.debit - it.credit)
      continue
    }
    if (to && it.date > to) continue
    if (lines.length === 0) balance = opening
    balance = round2(balance + it.debit - it.credit)
    lines.push({ ...it, balance })
  }
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0))
  return { opening, lines, totalDebit, totalCredit, closing: round2(opening + totalDebit - totalCredit) }
}

export interface ForecastWeek {
  /** "" on the first row: everything already late. */
  from: string
  to: string
  moneyIn: number
  moneyOut: number
  net: number
}

/**
 * Money expected in (from customers) and out (to suppliers) week by week from `today`, `weeks` weeks ahead.
 * The first row holds amounts already late (due before today).
 */
export function cashForecast(opts: {
  receivable: { dueDate: string; amount: number }[]
  payable: { dueDate: string; amount: number }[]
  today: string
  weeks: number
}): ForecastWeek[] {
  const { today, weeks } = opts
  const rows: ForecastWeek[] = [{ from: "", to: addDays(today, -1), moneyIn: 0, moneyOut: 0, net: 0 }]
  for (let w = 0; w < weeks; w++) {
    rows.push({ from: addDays(today, w * 7), to: addDays(today, w * 7 + 6), moneyIn: 0, moneyOut: 0, net: 0 })
  }
  const place = (dueDate: string, amount: number, key: "moneyIn" | "moneyOut") => {
    const row = dueDate < today ? rows[0] : rows.find((r, i) => i > 0 && dueDate >= r.from && dueDate <= r.to)
    if (row) row[key] = round2(row[key] + amount)
  }
  for (const e of opts.receivable) place(e.dueDate, e.amount, "moneyIn")
  for (const e of opts.payable) place(e.dueDate, e.amount, "moneyOut")
  for (const r of rows) r.net = round2(r.moneyIn - r.moneyOut)
  return rows
}

/** Header row plus data rows for an Excel sheet (text stays text, numbers stay numbers). */
export const toSheetRows = (headers: string[], rows: (string | number)[][]): (string | number)[][] => [headers, ...rows]
