"use client"

// "Orders to invoice" on Accounts Receivable (owner request, 2026-11-14; the calm design the owner picked): a quiet
// line "N orders are ready to invoice · M not ready yet" that opens the list. One row per sales order with approved
// DPs not invoiced: Ready (everything delivered, every DP approved) or Not ready yet with the reasons. "Invoice whole
// order" / "Invoice delivered part" hand the order's DPs to the normal invoice-from-DPs window; part of an order
// warns first.
import { useCallback, useEffect, useState } from "react"
import { Check, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Money } from "@/components/erp/money"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import type { NotReadyReason, OrderToInvoice } from "@/lib/ready-to-invoice"

/** Loads the orders to invoice; `reload` after an invoice is made. */
export function useOrdersToInvoice() {
  const [orders, setOrders] = useState<OrderToInvoice[] | null>(null)
  const reload = useCallback(() => {
    fetch("/api/accounts-receivable/ready-to-invoice")
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((body) => setOrders(body.orders || []))
      .catch(() => setOrders([]))
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { orders, reload }
}

const q = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")

export function OrdersToInvoice({
  orders,
  onInvoice,
  onOverview,
}: {
  orders: OrderToInvoice[] | null
  /** opens the normal invoice-from-DPs window with these permits ticked */
  onInvoice: (permitIds: number[]) => void
  onOverview?: (soId: number) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"ready" | "open" | "all">("ready")
  const [warnFor, setWarnFor] = useState<OrderToInvoice | null>(null)
  if (!orders || orders.length === 0) return null
  const ready = orders.filter((o) => o.ready)
  const notReady = orders.filter((o) => !o.ready)
  const shown = tab === "all" ? orders : tab === "ready" ? ready : notReady

  const reasonText = (r: NotReadyReason) =>
    r.kind === "not_delivered"
      ? fill(t("rti.not-delivered"), { qty: q(r.quantity), item: r.name })
      : r.kind === "waiting_approval"
        ? fill(t("rti.waiting-approval"), { dp: r.dp })
        : fill(t("rti.on-its-way"), { dp: r.dp })

  return (
    <section className="space-y-3" id="orders-to-invoice">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${ready.length ? "bg-emerald-500" : "bg-muted-foreground/40"}`} aria-hidden="true" />
        <span className="text-sm">
          <strong>{fill(t("rti.strip-ready"), { n: ready.length })}</strong>
          {notReady.length > 0 && <span className="text-muted-foreground"> · {fill(t("rti.strip-open"), { n: notReady.length })}</span>}
        </span>
        <Button variant="ghost" size="sm" className="ms-auto" aria-expanded={open} aria-controls="orders-to-invoice-list" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp className="w-4 h-4 me-1" /> : <ChevronDown className="w-4 h-4 me-1" />} {open ? t("rti.hide") : t("rti.show")}
        </Button>
      </div>

      {open && (
        <div id="orders-to-invoice-list" className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">{t("rti.title")}</h2>
              <p className="text-xs text-muted-foreground">{t("rti.help")}</p>
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={t("rti.title")}>
              {(["ready", "open", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={tab === f}
                  onClick={() => setTab(f)}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${tab === f ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t(`rti.tab-${f}`)} <span className="ms-1 text-xs text-muted-foreground tabular-nums">{f === "ready" ? ready.length : f === "open" ? notReady.length : orders.length}</span>
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rti.none")}</p>
          ) : (
            <ul className="space-y-2">
              {shown.map((o) => (
                <li key={o.soId} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold">{o.soNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.customer} · {t("rti.order-total")} <Money value={o.total} />
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${o.ready ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}>
                        {o.ready ? t("rti.ready") : t("rti.not-ready")}
                      </span>
                      {o.invoiced.map((d) => (
                        <span key={d} className="rounded border px-1.5 text-[11px] text-muted-foreground">{fill(t("rti.dp-invoiced"), { dp: d })}</span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    {o.ready ? (
                      <>
                        <p className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> {fill(t("rti.all-delivered"), { n: o.lineCount })}</p>
                        <p className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> {t("rti.all-approved")}</p>
                      </>
                    ) : (
                      o.reasons.slice(0, 4).map((r, i) => (
                        <p key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" /> {reasonText(r)}</p>
                      ))
                    )}
                    {!o.ready && o.reasons.length > 4 && <p className="text-xs text-muted-foreground">{fill(t("rti.more"), { n: o.reasons.length - 4 })}</p>}
                    <p className="text-xs text-muted-foreground">
                      {t("rti.to-invoice-now")} <strong className="text-foreground"><Money value={o.value} /></strong> · {o.toInvoice.map((p) => p.number).join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {o.ready ? (
                      <Button size="sm" onClick={() => onInvoice(o.toInvoice.map((p) => p.permitId))}>{t("rti.invoice-whole")}</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setWarnFor(o)}>{t("rti.invoice-part")}</Button>
                    )}
                    {onOverview && (
                      <Button size="sm" variant="ghost" onClick={() => onOverview(o.soId)}>{t("ov.button")}</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnFor && (
        <Dialog open onOpenChange={(v) => !v && setWarnFor(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{fill(t("rti.part-title"), { so: warnFor.soNumber })}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 rounded-md bg-amber-500/15 p-3 text-sm">
              <p className="font-semibold text-amber-800 dark:text-amber-300">{t("rti.part-warning")}</p>
              {warnFor.reasons.map((r, i) => (
                <p key={i}>• {reasonText(r)}</p>
              ))}
              <p className="text-xs text-muted-foreground">{t("rti.part-help")}</p>
            </div>
            <p className="text-sm">
              {t("rti.to-invoice-now")} <strong><Money value={warnFor.value} /></strong> · {warnFor.toInvoice.map((p) => p.number).join(", ")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWarnFor(null)}>{t("action.cancel")}</Button>
              <Button
                onClick={() => {
                  const ids = warnFor.toInvoice.map((p) => p.permitId)
                  setWarnFor(null)
                  onInvoice(ids)
                }}
              >
                {t("rti.invoice-anyway")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
