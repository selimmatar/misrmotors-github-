"use client"

// The 360 "Order overview" of a sales order (owner request, 2026-11-12; the simple design with step dots that the
// owner picked): one money bar, what is left to finish, then three tabs — items, DPs & POs, timeline & notes.
// Profit is shown to the CEO and admins only.
import { useCallback, useEffect, useState } from "react"
import { Check, Clock, Loader2, Printer, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Money } from "@/components/erp/money"
import { NotesButton } from "@/components/notes/notes-button"
import { useI18n } from "@/lib/i18n-context"
import { openDocument, type DocumentScreen } from "@/lib/open-document"
import { fill } from "@/lib/i18n-format"
import type { SoOverview, SoProfit, OverviewLine, OverviewTodo, OverviewEvent } from "@/lib/so-overview"
import type { UserRole } from "@/lib/types"

const PROFIT_ROLES: UserRole[] = ["ceo", "admin"]
const DP_STATUSES = ["DRAFT", "PENDING", "CREATED", "READY_FOR_PICKUP", "READY_FOR_SHIPMENT", "OUT_FOR_DELIVERY", "SUBMITTED_SIGNED", "DELIVERED", "APPROVED"]
const FULFILMENT = ["DELIVERED", "PARTIALLY_DELIVERED", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "READY_FOR_SHIPMENT"]
const EVENTS = ["PO_CLOSED", "PO_REOPENED", "PO_ITEM_EXCHANGED", "PO_ITEM_SENT_BACK"]
/** keys that have a translation; anything else shows its raw value made readable */
const LABELLED = new Set([...DP_STATUSES.map((s) => `ov.dp-status.${s}`), ...FULFILMENT.map((s) => `ov.fulfilment.${s}`), ...EVENTS.map((s) => `ov.event.${s}`)])

const tone = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  bad: "bg-red-500/15 text-red-700 dark:text-red-300",
  info: "bg-primary/10 text-primary",
  grey: "bg-muted text-muted-foreground",
}
function Pill({ kind, children }: { kind: keyof typeof tone; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone[kind]}`}>{children}</span>
}

const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")
const when = (value: string | null, language: string, withTime = true) => {
  if (!value) return ""
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) || value.length <= 10 ? value : `${value}Z`)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(language === "ar" ? "ar-EG" : "en-GB", withTime ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" })
}

const LINE_TONE: Record<OverviewLine["state"], keyof typeof tone> = {
  delivered: "good",
  partial: "warn",
  ready: "info",
  waiting_supplier: "info",
  no_po: "bad",
  to_deliver: "grey",
}

/** Ordered → On PO / Stock → Received → Delivered, as four dots. */
function Steps({ line }: { line: OverviewLine }) {
  const { t } = useI18n()
  const full = (n: number | null) => (line.source === "stock" ? "done" : n !== null && n >= line.ordered - 1e-6 ? "done" : n && n > 0 ? "part" : "none")
  const steps = [
    { label: t("ov.step-ordered"), state: "done" },
    { label: line.source === "stock" ? t("ov.step-stock") : t("ov.step-po"), state: full(line.onPo) },
    { label: t("ov.step-received"), state: full(line.received) },
    { label: t("ov.step-delivered"), state: line.delivered >= line.ordered - 1e-6 ? "done" : line.delivered > 0 ? "part" : "none" },
  ]
  return (
    <div className="grid grid-cols-4 mt-2 min-w-[220px]" aria-hidden="true">
      {steps.map((s, i) => (
        <div key={i} className="relative grid justify-items-center gap-1 text-[10px] text-muted-foreground">
          {i > 0 && <span className={`absolute top-[7px] end-1/2 w-full h-0.5 ${s.state !== "none" ? "bg-primary" : "bg-border"}`} />}
          <span
            className={`relative z-[1] grid place-items-center w-4 h-4 rounded-full border-2 ${
              s.state === "done"
                ? "bg-primary border-primary text-primary-foreground ring-4 ring-primary/15"
                : s.state === "part"
                  ? "border-primary bg-[linear-gradient(90deg,var(--primary)_50%,var(--card)_50%)]"
                  : "border-border bg-card"
            }`}
          >
            {s.state === "done" && <Check className="w-2.5 h-2.5" strokeWidth={4} />}
          </span>
          <span className={s.state !== "none" ? "text-foreground" : ""}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

export function OrderOverviewDialog({
  soId,
  userRole,
  onClose,
  onNewDp,
  onOpenOrder,
  onPrint,
}: {
  soId: number
  userRole: UserRole
  onClose: () => void
  onNewDp?: () => void
  onOpenOrder?: () => void
  onPrint?: () => void
}) {
  const { t, language } = useI18n()
  const [data, setData] = useState<SoOverview | null>(null)
  const [profit, setProfit] = useState<SoProfit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seesProfit = PROFIT_ROLES.includes(userRole)
  /** a label, or the raw value made readable when there is no translation for it */
  const label = (key: string, raw: string) => (LABELLED.has(key) ? t(key) : raw.replace(/_/g, " ").toLowerCase())

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/sales-orders/overview?soId=${soId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || t("message.error"))
        setData(body)
      })
      .catch((e) => setError(e.message || t("message.error")))
      .finally(() => setLoading(false))
    if (seesProfit) {
      fetch(`/api/sales-orders/overview/profit?soId=${soId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => setProfit(body))
        .catch(() => setProfit(null))
    }
  }, [soId, seesProfit, t])
  useEffect(() => {
    load()
  }, [load])

  const openDoc = (screen: DocumentScreen, number: string) => {
    onClose()
    openDocument(screen, number)
  }
  const go = (module: string) => {
    onClose()
    window.dispatchEvent(new CustomEvent("navigate-to-module", { detail: module }))
  }

  const todoText = (item: OverviewTodo) => {
    switch (item.kind) {
      case "no_po":
        return fill(t("ov.todo-no-po"), { qty: qty(item.quantity), item: item.name })
      case "waiting_supplier":
        return fill(t("ov.todo-waiting"), { qty: qty(item.quantity), item: item.name, po: item.po }) + (item.expected ? ` · ${t("ov.expected")} ${when(item.expected, language, false)}` : "")
      case "ready":
        return fill(t("ov.todo-ready"), { qty: qty(item.quantity), item: item.name })
      case "to_deliver":
        return fill(t("ov.todo-to-deliver"), { qty: qty(item.quantity), item: item.name })
      case "draft_dp":
        return fill(t("ov.todo-draft-dp"), { dp: item.dp })
      case "not_invoiced":
        return fill(t("ov.todo-not-invoiced"), { dp: item.dp })
      case "unpaid":
        return t("ov.todo-unpaid")
    }
  }
  const todoAction = (item: OverviewTodo) => {
    if (item.kind === "no_po") return <Button size="sm" variant="outline" onClick={() => go("purchase-orders")}>{t("ov.create-po")}</Button>
    if ((item.kind === "ready" || item.kind === "to_deliver") && onNewDp)
      return <Button size="sm" variant="outline" onClick={() => { onClose(); onNewDp() }}>{t("so.create-dp")}</Button>
    if (item.kind === "draft_dp") return <Button size="sm" variant="outline" onClick={() => go("delivery-permits")}>{t("ov.open-dps")}</Button>
    if (item.kind === "not_invoiced") return <Button size="sm" variant="outline" onClick={() => go("accounts-receivable")}>{t("ov.invoice")}</Button>
    if (item.kind === "unpaid") return <Button size="sm" variant="outline" onClick={() => go("accounts-receivable")}>{t("ov.record-payment")}</Button>
    return null
  }
  const todoIcon = (item: OverviewTodo) =>
    item.kind === "no_po" ? tone.bad : item.kind === "not_invoiced" || item.kind === "unpaid" ? tone.warn : tone.info
  const todoAmount = (item: OverviewTodo) => (item.kind === "not_invoiced" ? item.value : item.kind === "unpaid" ? item.amount : null)

  const eventText = (e: OverviewEvent) => {
    switch (e.kind) {
      case "so_created":
        return fill(t("ov.ev-so-created"), { so: e.subject })
      case "dp_created":
        return fill(t("ov.ev-dp-created"), { dp: e.subject })
      case "dp_signed":
        return fill(t("ov.ev-dp-signed"), { dp: e.subject })
      case "returned":
        return fill(t("ov.ev-returned"), { qty: qty(e.quantity || 0), item: e.subject, dp: e.detail || "" })
      case "po_created":
        return fill(t("ov.ev-po-created"), { po: e.subject })
      case "invoiced":
        return fill(t("ov.ev-invoiced"), { invoice: e.subject })
      case "paid":
        return t("ov.ev-paid")
      case "po_event":
      case "so_event": {
        return `${label(`ov.event.${e.subject}`, e.subject)}${e.detail ? ` · ${e.detail}` : ""}`
      }
      default:
        return e.subject
    }
  }
  const eventDot = (e: OverviewEvent) =>
    e.kind === "note" ? "bg-amber-500" : e.kind === "returned" ? "bg-red-500" : e.kind === "paid" || e.kind === "dp_signed" || e.kind === "invoiced" ? "bg-emerald-500" : "bg-primary"

  const lineStatus = (l: OverviewLine) => {
    if (l.state === "partial" || l.state === "to_deliver") return fill(t("ov.state-left"), { qty: qty(l.ordered - l.delivered) })
    return t(`ov.state-${l.state}`)
  }

  const m = data?.money
  const pct = (v: number) => (m && m.total > 0 ? `${Math.min(100, (v / m.total) * 100)}%` : "0%")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{t("ov.title")}</DialogTitle>
        </DialogHeader>
        {loading && !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("notes.loading")}
          </p>
        ) : error || !data || !m ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-destructive">{error || t("message.error")}</p>
            <Button size="sm" variant="outline" onClick={load}>{t("ov.retry")}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* header + money */}
            <section className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">{t("ov.title")}</p>
                  <h2 className="text-xl font-extrabold">
                    {data.so.number} · {data.so.customer}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {when(data.so.createdAt, language, false)}
                    {data.so.fulfilment ? (
                      <>
                        {" · "}
                        <Pill kind={data.so.fulfilment === "DELIVERED" ? "good" : "warn"}>{label(`ov.fulfilment.${data.so.fulfilment}`, data.so.fulfilment)}</Pill>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <NotesButton type="so" id={data.so.id} title={data.so.number} count={data.timeline.filter((e) => e.kind === "note").length} onChanged={load} labelled />
                  {onPrint && (
                    <Button size="sm" variant="outline" onClick={onPrint}>
                      <Printer className="w-4 h-4 me-1" /> {t("so.print-so")}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={load} aria-label={t("ov.refresh")} title={t("ov.refresh")}>
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                  {onOpenOrder && (
                    <Button size="sm" onClick={() => { onClose(); onOpenOrder() }}>{t("ov.open-order")}</Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex h-3 rounded-full overflow-hidden bg-muted" role="img" aria-label={t("ov.money-bar")}>
                  <span className="bg-emerald-500" style={{ width: pct(m.paid) }} />
                  <span className="bg-amber-500" style={{ width: pct(m.invoicedUnpaid) }} />
                  <span className="bg-primary" style={{ width: pct(m.deliveredNotInvoiced) }} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 tabular-nums">
                  {[
                    ["bg-emerald-500", t("ov.paid"), m.paid],
                    ["bg-amber-500", t("ov.invoiced-unpaid"), m.invoicedUnpaid],
                    ["bg-primary", t("ov.delivered-not-invoiced"), m.deliveredNotInvoiced],
                    ["bg-muted-foreground/30", t("ov.not-delivered"), m.notDelivered],
                  ].map(([dot, label, value]) => (
                    <div key={label as string} className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={`w-2 h-2 rounded-sm ${dot}`} /> {label}
                      </p>
                      <p className="font-bold"><Money value={value as number} /></p>
                    </div>
                  ))}
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{seesProfit ? t("ov.total-profit") : t("ov.total")}</p>
                    <p className="font-bold">
                      <Money value={m.total} />
                      {seesProfit && profit && (
                        <span className={profit.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}> · {profit.margin}%</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* what's left */}
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <h3 className="font-bold">{t("ov.left-title")}</h3>
              {data.todo.length === 0 ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                  <Check className="w-4 h-4" /> {t("ov.left-none")}
                </p>
              ) : (
                <ul className="divide-y">
                  {data.todo.map((item, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="flex items-center gap-2 text-sm min-w-0">
                        <span className={`grid place-items-center w-5 h-5 rounded-full text-[10px] font-extrabold shrink-0 ${todoIcon(item)}`}>{i + 1}</span>
                        <span>
                          {todoText(item)}
                          {todoAmount(item) !== null && (
                            <>
                              {" "}
                              (<Money value={todoAmount(item)} />)
                            </>
                          )}
                        </span>
                      </span>
                      {todoAction(item)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* tabs */}
            <Tabs defaultValue="items" className="rounded-xl border bg-card p-4">
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="items">{t("ov.tab-items")} <span className="ms-1 text-xs text-muted-foreground">{data.lines.length}</span></TabsTrigger>
                <TabsTrigger value="docs">{t("ov.tab-docs")} <span className="ms-1 text-xs text-muted-foreground">{data.permits.length + data.pos.length}</span></TabsTrigger>
                <TabsTrigger value="time">
                  <Clock className="w-3.5 h-3.5 me-1" /> {t("ov.tab-timeline")} <span className="ms-1 text-xs text-muted-foreground">{data.timeline.length}</span>
                </TabsTrigger>
                {seesProfit && <TabsTrigger value="profit">{t("ov.tab-profit")}</TabsTrigger>}
              </TabsList>

              <TabsContent value="items" className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-start font-semibold p-2">{t("ov.item")}</th>
                      <th className="text-center font-semibold p-2">{t("ov.step-ordered")}</th>
                      <th className="text-center font-semibold p-2">{t("ov.step-received")}</th>
                      <th className="text-center font-semibold p-2">{t("ov.step-delivered")}</th>
                      <th className="text-start font-semibold p-2">{t("ov.status")}</th>
                      <th className="text-start font-semibold p-2">{t("ov.documents")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.id} className="border-b last:border-0 align-top">
                        <td className="p-2">
                          <span className="font-medium">{l.name}</span>
                          <Steps line={l} />
                        </td>
                        <td className="p-2 text-center">{qty(l.ordered)}</td>
                        <td className="p-2 text-center">{l.received === null ? t("ov.step-stock") : qty(l.received)}</td>
                        <td className="p-2 text-center">
                          {qty(l.delivered)}
                          {l.returned > 0 && <div className="text-xs text-destructive">{fill(t("ov.returned-n"), { qty: qty(l.returned) })}</div>}
                        </td>
                        <td className="p-2"><Pill kind={LINE_TONE[l.state]}>{lineStatus(l)}</Pill></td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {l.poNumbers.length + l.dpNumbers.length === 0
                            ? "—"
                            : [
                                ...l.poNumbers.map((n) => ["purchase-orders", n] as const),
                                ...l.dpNumbers.map((n) => ["delivery-permits", n] as const),
                              ].map(([screen, n]) => (
                                <button key={n} type="button" onClick={() => openDoc(screen, n)} className="me-2 text-primary underline underline-offset-2 whitespace-nowrap">
                                  {n}
                                </button>
                              ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="docs" className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 min-w-0">
                  <h4 className="font-bold">{t("ov.dps")}</h4>
                  {data.permits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("ov.none-yet")}</p>
                  ) : (
                    data.permits.map((p) => (
                      <button type="button" key={p.id} onClick={() => openDoc("delivery-permits", p.number)} title={fill(t("ov.open-doc"), { doc: p.number })} className="w-full text-start flex flex-wrap items-center justify-between gap-2 border-t pt-2 first:border-0 first:pt-0 text-sm rounded-md hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary px-1 -mx-1">
                        <span>
                          <span className="font-medium text-primary underline underline-offset-2">{p.number}</span>{" "}
                          <span className="text-muted-foreground">· {when(p.date, language, false)} · <Money value={p.value} /></span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <Pill kind={["SUBMITTED_SIGNED", "DELIVERED", "APPROVED"].includes(p.status) ? "good" : "grey"}>{label(`ov.dp-status.${p.status}`, p.status)}</Pill>
                          {p.returned > 0 && <Pill kind="bad">{fill(t("ov.returned-n"), { qty: qty(p.returned) })}</Pill>}
                          {["SUBMITTED_SIGNED", "DELIVERED", "APPROVED"].includes(p.status) && (
                            <Pill kind={p.invoiced ? "good" : "warn"}>{p.invoiced ? t("ov.invoiced") : t("ov.not-invoiced")}</Pill>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="space-y-2 min-w-0">
                  <h4 className="font-bold">{t("ov.pos")}</h4>
                  {data.pos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("ov.none-yet")}</p>
                  ) : (
                    data.pos.map((po) => (
                      <button type="button" key={po.id} onClick={() => openDoc("purchase-orders", po.number)} title={fill(t("ov.open-doc"), { doc: po.number })} className="w-full text-start flex flex-wrap items-center justify-between gap-2 border-t pt-2 first:border-0 first:pt-0 text-sm rounded-md hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary px-1 -mx-1">
                        <span className="min-w-0">
                          <span className="font-medium"><span className="text-primary underline underline-offset-2">{po.number}</span> · {po.supplier}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t("ov.for-this-order")} <Money value={po.forThisOrder} /> · {t("ov.po-total")} <Money value={po.total} /> · {t("ov.paid")} <Money value={po.paid} />
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <Pill kind={po.closed ? "good" : "warn"}>{po.closed ? t("ov.closed") : t("ov.open")}</Pill>
                          {po.exchanges > 0 && <Pill kind="info">{fill(t("ov.exchanges-n"), { n: po.exchanges })}</Pill>}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="time">
                <ul className="tabular-nums">
                  {data.timeline.map((e, i) => (
                    <li key={i} className="grid grid-cols-[88px_16px_minmax(0,1fr)] gap-2.5">
                      <span className="text-xs text-muted-foreground pt-0.5">{when(e.at, language)}</span>
                      <span className="relative">
                        <span className={`absolute start-[3px] top-1.5 w-2.5 h-2.5 rounded-full ${eventDot(e)}`} />
                        {i < data.timeline.length - 1 && <span className="absolute start-[7px] top-5 bottom-0 w-0.5 bg-border" />}
                      </span>
                      <span className="pb-4 text-sm">
                        {e.kind === "note" ? (
                          <span className="inline-block rounded-md bg-amber-500/15 px-2 py-0.5 whitespace-pre-wrap">{e.subject}</span>
                        ) : (
                          <>
                            {eventText(e)}
                            {e.amount !== undefined && (
                              <>
                                {" "}
                                <Money value={e.amount} />
                              </>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              {seesProfit && (
                <TabsContent value="profit">
                  {!profit ? (
                    <p className="text-sm text-muted-foreground">{t("notes.loading")}</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3 tabular-nums">
                        <div><p className="text-xs text-muted-foreground">{t("ov.selling")}</p><p className="text-lg font-extrabold"><Money value={profit.selling} /></p></div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("ov.cost")}</p>
                          <p className="text-lg font-extrabold"><Money value={profit.cost} /></p>
                          <p className="text-xs text-muted-foreground">{t("ov.cost-pos")} <Money value={profit.poCost} /> · {t("ov.cost-stock")} <Money value={profit.stockCost} /></p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("ov.profit")}</p>
                          <p className={`text-lg font-extrabold ${profit.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}><Money value={profit.profit} /></p>
                          <p className="text-xs text-muted-foreground">{fill(t("ov.margin"), { pct: profit.margin })}</p>
                        </div>
                      </div>
                      {profit.noCost.length > 0 && (
                        <p className="text-xs rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 px-3 py-2">
                          {t("ov.no-cost")} {profit.noCost.join(", ")}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{t("ov.profit-help")}</p>
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
