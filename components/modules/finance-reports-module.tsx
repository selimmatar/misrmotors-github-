"use client"

// Reports page (accountant and CEO): late payments, customer / supplier statements and upcoming cash in/out.
// Read-only. Every report is one table model shown on screen, downloaded to Excel and printed, so the three match.
import { useEffect, useMemo, useState } from "react"
import { Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { Money } from "@/components/erp/money"
import { ErpTable, NumHead, NumCell } from "@/components/erp/data-table"
import { useAppContext } from "@/lib/app-context"
import { useI18n } from "@/lib/i18n-context"
import { formatDate, formatMoney } from "@/lib/format"
import { escapeHtml } from "@/lib/html-escape"
import { AGE_BUCKETS, addDays, todayYmd, unpaidBetween, type AgeBucket } from "@/lib/due-schedule"
import { apPaid, arPaid } from "@/lib/due-schedule"
import { buildStatement, cashForecast, dueScheduleFor, lateRows, toSheetRows } from "@/lib/reports/finance"

type ReportId = "late-ar" | "late-ap" | "customer-statement" | "supplier-statement" | "cash-forecast"
type Kind = "text" | "date" | "money" | "number"
interface Column { label: string; kind: Kind }
type Cell = string | number
interface TableModel { columns: Column[]; rows: Cell[][]; totals?: Cell[] }

const ALL = "all"

export function FinanceReportsModule() {
  const { t, language } = useI18n()
  const { customerInvoices, supplierInvoices, salesOrders, purchaseOrders, customers, suppliers } = useAppContext()
  const [report, setReport] = useState<ReportId>("late-ar")
  const [asOf, setAsOf] = useState(todayYmd())
  const [partyId, setPartyId] = useState(ALL)
  const [from, setFrom] = useState(addDays(todayYmd(), -90))
  const [to, setTo] = useState(todayYmd())
  const [weeks, setWeeks] = useState("8")
  const [customerPayments, setCustomerPayments] = useState<any[] | null>(null)
  const [supplierPayments, setSupplierPayments] = useState<any[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  const isStatement = report === "customer-statement" || report === "supplier-statement"
  const side = report === "late-ap" || report === "supplier-statement" ? "ap" : "ar"
  const parties = (side === "ar" ? customers : suppliers).map((p: any) => ({ id: String(p.id), name: p.name || "" }))
  const partyName = parties.find((p) => p.id === partyId)?.name || ""

  // Payments are only needed for the statements; read them when one is opened.
  useEffect(() => {
    if (!isStatement) return
    const url = side === "ar" ? "/api/customer-payments" : "/api/supplier-payments"
    let cancelled = false
    setLoadError(false)
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return
        if (side === "ar") setCustomerPayments(Array.isArray(data) ? data : [])
        else setSupplierPayments(Array.isArray(data) ? data : [])
      })
      .catch(() => !cancelled && setLoadError(true))
    return () => {
      cancelled = true
    }
  }, [isStatement, side])

  const pickReport = (id: ReportId) => {
    setReport(id)
    setPartyId(ALL)
  }

  const methodLabel = (method: string) => {
    if (method === "cash") return t("payment.cash")
    if (method === "bank_transfer") return t("payment.bank_transfer")
    if (method === "cheque") return t("payment.cheque")
    if (method === "supplier_credit") return t("reports.method-supplier-credit")
    return t("reports.method-not-recorded")
  }
  const bucketLabel: Record<AgeBucket, string> = {
    "1-30": t("reports.bucket-1-30"),
    "31-60": t("reports.bucket-31-60"),
    "61-90": t("reports.bucket-61-90"),
    "90+": t("reports.bucket-90"),
  }

  const late = useMemo(
    () =>
      report === "late-ar" || report === "late-ap"
        ? lateRows({
            side,
            invoices: side === "ar" ? customerInvoices : supplierInvoices,
            orders: side === "ar" ? salesOrders : purchaseOrders,
            parties,
            today: asOf,
            partyId: partyId === ALL ? undefined : partyId,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, side, customerInvoices, supplierInvoices, salesOrders, purchaseOrders, customers, suppliers, asOf, partyId],
  )

  const statement = useMemo(() => {
    if (!isStatement || partyId === ALL) return null
    const payments = side === "ar" ? customerPayments : supplierPayments
    if (!payments) return null
    const invoices = (side === "ar" ? customerInvoices : supplierInvoices).filter(
      (i: any) => String(side === "ar" ? i.customerId : i.supplierId) === partyId,
    )
    const invoiceNumberById = Object.fromEntries(invoices.map((i: any) => [String(i.id), i.invoiceNumber || ""]))
    const mine = payments
      .filter((p: any) => String(side === "ar" ? p.customerId : p.supplier_id) === partyId)
      .map((p: any) =>
        side === "ar"
          ? { date: p.paymentDate, amount: Number(p.amount) || 0, invoiceId: String(p.invoiceId ?? ""), method: p.paymentMethod, reference: p.referenceNumber }
          : { date: p.payment_date, amount: Number(p.amount) || 0, invoiceId: String(p.invoice_id ?? ""), method: p.payment_method, reference: p.reference_number },
      )
    const st = buildStatement({
      invoices: invoices.map((i: any) => ({ id: String(i.id), number: i.invoiceNumber || "", date: i.invoiceDate || i.date, amount: Number(i.amount) || 0 })),
      payments: mine,
      from,
      to,
      invoiceNumberById,
    })
    // What the invoice records say is still owed (an invoice can be marked paid without a payment line).
    const owedOnRecords = invoices.reduce(
      (s: number, i: any) => s + (Number(i.amount) || 0) - (side === "ar" ? arPaid(i) : apPaid(i)),
      0,
    )
    const allTime = buildStatement({ invoices: invoices.map((i: any) => ({ id: String(i.id), number: "", date: i.invoiceDate || i.date, amount: Number(i.amount) || 0 })), payments: mine, from: "", to: "" })
    return { ...st, owedOnRecords: Math.round(owedOnRecords * 100) / 100, allTimeClosing: allTime.closing }
  }, [isStatement, partyId, side, customerPayments, supplierPayments, customerInvoices, supplierInvoices, from, to])

  const forecast = useMemo(() => {
    if (report !== "cash-forecast") return null
    const n = Number(weeks) || 8
    const end = addDays(asOf, n * 7 - 1)
    const collect = (sideOf: "ar" | "ap", invoices: any[], orders: any[]) =>
      invoices.flatMap((inv) => unpaidBetween(dueScheduleFor(sideOf, inv, orders), "0000-01-01", end))
    return cashForecast({
      receivable: collect("ar", customerInvoices, salesOrders),
      payable: collect("ap", supplierInvoices, purchaseOrders),
      today: asOf,
      weeks: n,
    })
  }, [report, weeks, asOf, customerInvoices, supplierInvoices, salesOrders, purchaseOrders])

  // ---- the table model for the chosen report ----
  const model: TableModel | null = useMemo(() => {
    if (late) {
      const columns: Column[] = [
        { label: side === "ar" ? t("reports.customer") : t("reports.supplier"), kind: "text" },
        { label: t("reports.invoice"), kind: "text" },
        { label: side === "ar" ? t("reports.sales-order") : t("reports.purchase-order"), kind: "text" },
        { label: t("reports.late-since"), kind: "date" },
        { label: t("reports.days-late"), kind: "number" },
        ...AGE_BUCKETS.map((b) => ({ label: bucketLabel[b], kind: "money" as Kind })),
        { label: t("reports.late-amount"), kind: "money" },
        { label: t("reports.still-owed"), kind: "money" },
      ]
      const rows = late.late.map((r) => [
        r.partyName, r.invoiceNumber, r.orderNumber, r.oldestLateDate, r.daysLate, ...AGE_BUCKETS.map((b) => r.buckets[b]), r.overdue, r.balance,
      ])
      const totals = [t("reports.total"), "", "", "", "", ...AGE_BUCKETS.map((b) => late.totals.buckets[b]), late.totals.overdue, late.late.reduce((s, r) => s + r.balance, 0)]
      return { columns, rows, totals }
    }
    if (statement) {
      return {
        columns: [
          { label: t("reports.date"), kind: "date" },
          { label: t("reports.entry"), kind: "text" },
          { label: t("reports.reference"), kind: "text" },
          { label: t("reports.method"), kind: "text" },
          { label: side === "ar" ? t("reports.charged") : t("reports.billed"), kind: "money" },
          { label: side === "ar" ? t("reports.received") : t("reports.paid"), kind: "money" },
          { label: t("reports.balance"), kind: "money" },
        ],
        rows: [
          ["", t("reports.opening-balance"), "", "", "", "", statement.opening],
          ...statement.lines.map((l) => [
            l.date,
            l.kind === "invoice" ? t("reports.entry-invoice") : t("reports.entry-payment"),
            l.kind === "invoice" ? l.reference : [l.invoiceNumber, l.reference].filter(Boolean).join(" · "),
            l.kind === "payment" ? methodLabel(l.method) : "",
            l.debit || "",
            l.credit || "",
            l.balance,
          ]),
        ],
        totals: [t("reports.closing-balance"), "", "", "", statement.totalDebit, statement.totalCredit, statement.closing],
      }
    }
    if (forecast) {
      return {
        columns: [
          { label: t("reports.week"), kind: "text" },
          { label: t("reports.money-in"), kind: "money" },
          { label: t("reports.money-out"), kind: "money" },
          { label: t("reports.net"), kind: "money" },
          { label: t("reports.running-net"), kind: "money" },
        ],
        rows: (() => {
          let running = 0
          return forecast.map((w) => {
            running += w.net
            const label = w.from
              ? `${formatDate(w.from, language)} – ${formatDate(w.to, language)}`
              : t("reports.already-late")
            return [label, w.moneyIn, w.moneyOut, w.net, Math.round(running * 100) / 100]
          })
        })(),
        totals: [
          t("reports.total"),
          forecast.reduce((s, w) => s + w.moneyIn, 0),
          forecast.reduce((s, w) => s + w.moneyOut, 0),
          forecast.reduce((s, w) => s + w.net, 0),
          "",
        ],
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [late, statement, forecast, language, side])

  const reportTitle = {
    "late-ar": t("reports.late-ar"),
    "late-ap": t("reports.late-ap"),
    "customer-statement": t("reports.customer-statement"),
    "supplier-statement": t("reports.supplier-statement"),
    "cash-forecast": t("reports.cash-forecast"),
  }[report]
  const subtitle = isStatement
    ? `${partyName} · ${formatDate(from, language)} – ${formatDate(to, language)}`
    : `${partyId !== ALL && partyName ? `${partyName} · ` : ""}${t("reports.as-of")} ${formatDate(asOf, language)}`

  const display = (value: Cell, kind: Kind) => {
    if (value === "" || value === null || value === undefined) return ""
    if (kind === "date") return formatDate(String(value), language)
    if (kind === "money") return formatMoney(value as number, language)
    return String(value)
  }

  const downloadExcel = async () => {
    if (!model) return
    const XLSX = await import("xlsx")
    const data = toSheetRows(
      model.columns.map((c) => c.label),
      [...model.rows, ...(model.totals ? [model.totals] : [])].map((r) => r.map((v, i) => (model.columns[i].kind === "date" && v ? String(v) : v))),
    )
    const sheet = XLSX.utils.aoa_to_sheet([[reportTitle], [subtitle], [], ...data])
    sheet["!cols"] = model.columns.map((c) => ({ wch: c.kind === "text" ? 28 : 16 }))
    const book = XLSX.utils.book_new()
    if (language === "ar") book.Workbook = { Views: [{ RTL: true }] }
    XLSX.utils.book_append_sheet(book, sheet, "Report")
    XLSX.writeFile(book, `${report}-${todayYmd()}.xlsx`)
  }

  const print = () => {
    if (!model) return
    const dir = language === "ar" ? "rtl" : "ltr"
    const head = model.columns.map((c) => `<th class="${c.kind}">${escapeHtml(c.label)}</th>`).join("")
    const row = (r: Cell[], cls = "") =>
      `<tr class="${cls}">${r.map((v, i) => `<td class="${model.columns[i].kind}">${escapeHtml(display(v, model.columns[i].kind))}</td>`).join("")}</tr>`
    const html = `<!doctype html><html dir="${dir}" lang="${language}"><head><meta charset="utf-8"><title>${escapeHtml(reportTitle)}</title>
<style>body{font-family:Arial,Tahoma,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:start}th{background:#f2f2f2}
td.money,td.number,th.money,th.number{text-align:end;white-space:nowrap}tr.total td{font-weight:bold;background:#fafafa}</style></head>
<body><h1>${escapeHtml(reportTitle)}</h1><p>${escapeHtml(subtitle)}</p><table><thead><tr>${head}</tr></thead><tbody>
${model.rows.map((r) => row(r)).join("")}${model.totals ? row(model.totals, "total") : ""}</tbody></table></body></html>`
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  const needsParty = isStatement && partyId === ALL
  const loading = isStatement && !needsParty && !statement && !loadError

  return (
    <div className="space-y-4">
      <PageHeader
        group={t("group.finance")}
        title={t("reports.title")}
        subtitle={t("reports.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadExcel} disabled={!model}>
              <Download className="h-4 w-4 me-2" />
              {t("reports.download-excel")}
            </Button>
            <Button variant="outline" onClick={print} disabled={!model}>
              <Printer className="h-4 w-4 me-2" />
              {t("reports.print")}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="report-pick">{t("reports.report")}</Label>
            <Select value={report} onValueChange={(v) => pickReport(v as ReportId)}>
              <SelectTrigger id="report-pick">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="late-ar">{t("reports.late-ar")}</SelectItem>
                <SelectItem value="late-ap">{t("reports.late-ap")}</SelectItem>
                <SelectItem value="customer-statement">{t("reports.customer-statement")}</SelectItem>
                <SelectItem value="supplier-statement">{t("reports.supplier-statement")}</SelectItem>
                <SelectItem value="cash-forecast">{t("reports.cash-forecast")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {report !== "cash-forecast" && (
            <div className="space-y-1">
              <Label htmlFor="report-party">{side === "ar" ? t("reports.customer") : t("reports.supplier")}</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger id="report-party">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{isStatement ? t("reports.choose") : t("reports.all")}</SelectItem>
                  {parties
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isStatement ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="report-from">{t("reports.from")}</Label>
                <Input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-to">{t("reports.to")}</Label>
                <Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="report-asof">{t("reports.as-of")}</Label>
              <Input id="report-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayYmd())} />
            </div>
          )}

          {report === "cash-forecast" && (
            <div className="space-y-1">
              <Label htmlFor="report-weeks">{t("reports.weeks-ahead")}</Label>
              <Select value={weeks} onValueChange={setWeeks}>
                <SelectTrigger id="report-weeks">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">{t("reports.one-month")}</SelectItem>
                  <SelectItem value="8">{t("reports.two-months")}</SelectItem>
                  <SelectItem value="13">{t("reports.three-months")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {late && (
        <KpiGrid>
          <KpiTile label={t("reports.late-amount")} value={<Money value={late.totals.overdue} />} sub={`${late.late.length} ${t("reports.invoices")}`} strong />
          {AGE_BUCKETS.map((b) => (
            <KpiTile key={b} label={bucketLabel[b]} value={<Money value={late.totals.buckets[b]} />} />
          ))}
          <KpiTile label={t("reports.due-next-7")} value={<Money value={late.totals.dueSoon} />} sub={`${late.dueSoon.length} ${t("reports.invoices")}`} />
        </KpiGrid>
      )}

      {statement && Math.abs(statement.owedOnRecords - statement.allTimeClosing) > 0.01 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-4 text-sm">
            {t("reports.records-differ")}{" "}
            <strong>
              {formatMoney(statement.owedOnRecords, language)} {t("reports.egp")}
            </strong>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-base font-semibold">{reportTitle}</h2>
          <p className="text-sm text-muted-foreground mb-4">{needsParty ? t("reports.pick-party") : subtitle}</p>
          {loadError && <p className="text-sm text-destructive">{t("reports.load-error")}</p>}
          {loading && <p className="text-sm text-muted-foreground">{t("reports.loading")}</p>}
          {model && model.rows.length === 0 && <p className="text-sm text-muted-foreground">{t("reports.nothing")}</p>}
          {model && model.rows.length > 0 && <ReportTable model={model} display={display} />}
        </CardContent>
      </Card>

      {late && late.dueSoon.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-base font-semibold mb-4">{t("reports.due-next-7")}</h2>
            <ReportTable
              display={display}
              model={{
                columns: [
                  { label: side === "ar" ? t("reports.customer") : t("reports.supplier"), kind: "text" },
                  { label: t("reports.invoice"), kind: "text" },
                  { label: t("reports.due-date"), kind: "date" },
                  { label: t("reports.amount-due"), kind: "money" },
                ],
                rows: late.dueSoon.map((r) => [r.partyName, r.invoiceNumber, r.nextDueDate, r.dueSoon]),
                totals: [t("reports.total"), "", "", late.totals.dueSoon],
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ReportTable({ model, display }: { model: TableModel; display: (v: Cell, k: Kind) => string }) {
  const numeric = (k: Kind) => k === "money" || k === "number"
  return (
    <div className="overflow-x-auto">
      <ErpTable>
        <TableHeader>
          <TableRow>
            {model.columns.map((c, i) => (numeric(c.kind) ? <NumHead key={i}>{c.label}</NumHead> : <TableHead key={i}>{c.label}</TableHead>))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((v, i) =>
                numeric(model.columns[i].kind) ? (
                  <NumCell key={i}>{display(v, model.columns[i].kind)}</NumCell>
                ) : (
                  <TableCell key={i}>{display(v, model.columns[i].kind)}</TableCell>
                ),
              )}
            </TableRow>
          ))}
          {model.totals && (
            <TableRow className="font-semibold bg-muted/40">
              {model.totals.map((v, i) =>
                numeric(model.columns[i].kind) ? (
                  <NumCell key={i}>{display(v, model.columns[i].kind)}</NumCell>
                ) : (
                  <TableCell key={i}>{display(v, model.columns[i].kind)}</TableCell>
                ),
              )}
            </TableRow>
          )}
        </TableBody>
      </ErpTable>
    </div>
  )
}
