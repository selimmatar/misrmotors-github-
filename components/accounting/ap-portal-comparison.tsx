"use client"

// Accounts Payable -> "Portal comparison": the company's supplier invoices in the ERP, each with the supplier e-invoices
// on the tax portal that belong to it (many-to-many). Links are suggested automatically (lib/eta/ap-match.ts); a person
// can add a link or remove one (it is then never suggested again). The portal invoices are behind Show / Hide, each
// with its ERP invoices, a link picker and the portal PDF. "Check now" reads the portal (cursor by cursor).
// Accounts Payable itself is never changed here.
import { useCallback, useEffect, useMemo, useState } from "react"
import { FileText, Link2, Loader2, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { Money } from "@/components/erp/money"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate, formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

type GroupStatus = "matched" | "differs" | "no_portal" | "no_erp" | "unknown_supplier"
type Source = "auto" | "manual"
interface Group {
  key: string
  supplierId: number | null
  apInvoiceIds: number[]
  receivedIds: number[]
  erpTotal: number
  portalTotal: number
  difference: number
  status: GroupStatus
}
interface ApInvoice {
  invoiceId: number
  invoiceNumber: string
  poNumber: string | null
  supplierId: number | null
  supplierName: string | null
  date: string | null
  amount: number
  groupKey: string
  links: { receivedId: number; source: Source }[]
}
interface PortalDoc {
  receivedId: number
  documentType: string
  issuerId: string | null
  issuerName: string | null
  supplierId: number | null
  supplierName: string | null
  internalId: string | null
  dateIssued: string | null
  total: number | null
  signedTotal: number
  portalStatus: string | null
  standing: boolean
  groupKey: string
  links: { apInvoiceId: number; source: Source }[]
  linkable: boolean
}
interface Body {
  environment: string
  groups: Group[]
  apInvoices: ApInvoice[]
  portalDocs: PortalDoc[]
  totals: { erpTotal: number; portalTotal: number; difference: number; counts: Record<GroupStatus, number> }
  suppliers: { supplierId: number; supplierName: string }[]
}

const STATUSES: GroupStatus[] = ["matched", "differs", "no_portal", "no_erp", "unknown_supplier"]
const ERP_STATUSES = ["all", "matched", "differs", "no_portal"] as const
const PORTAL_FILTERS = ["all", "not_linked", "linked", "unknown"] as const
const TONE: Record<GroupStatus, string> = {
  matched: "bg-tone-done-bg text-tone-done",
  differs: "bg-tone-waiting-bg text-tone-waiting",
  no_portal: "bg-tone-danger-bg text-tone-danger",
  no_erp: "bg-tone-danger-bg text-tone-danger",
  unknown_supplier: "bg-tone-neutral-bg text-tone-neutral",
}
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const MAX_SHOWN = 50

async function errorOf(res: Response, fallback: string, language: string): Promise<string> {
  const body = await res.json().catch(() => null)
  if (body && language === "ar" && typeof body.errorAr === "string") return body.errorAr
  return body && typeof body.error === "string" ? body.error : fallback
}

function StatusPill({ status }: { status: GroupStatus }) {
  const { t } = useI18n()
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", TONE[status])}>
      {t(`eta.apl-status-${status}`)}
    </span>
  )
}

function SourceBadge({ source }: { source: Source }) {
  const { t } = useI18n()
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", source === "auto" ? "bg-muted text-muted-foreground" : "bg-tone-approved-bg text-tone-approved")}>
      {t(source === "auto" ? "eta.apl-auto" : "eta.apl-manual")}
    </span>
  )
}

/** a linked invoice: number, date, amount, auto / manual, and a remove button */
function LinkChip({ number, date, amount, source, onRemove, disabled }: { number: string; date: string | null; amount: number; source: Source; onRemove: () => void; disabled: boolean }) {
  const { t, language } = useI18n()
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background py-0.5 ps-2.5 pe-0.5 text-xs">
      <bdi dir="ltr" className="truncate font-medium">{number}</bdi>
      {date && <span className="whitespace-nowrap text-muted-foreground">{formatDate(date, language)}</span>}
      <Money value={amount} className="font-semibold" />
      <SourceBadge source={source} />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={fill(t("eta.apl-unlink"), { number })}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  )
}

interface PickItem {
  id: number
  label: string
  sub: string
  amount: number
}
/** A light searchable picker: only a button until opened, then a search box and at most 50 matches (never a Radix
 *  Select per row, see eta-code-picker.tsx). */
function LinkPicker({ items, buttonLabel, onPick, disabled }: { items: PickItem[]; buttonLabel: string; onPick: (id: number) => void; disabled: boolean }) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const shown = useMemo(() => {
    if (!open) return []
    const s = q.trim().toLowerCase()
    return items.filter((i) => !s || `${i.label} ${i.sub} ${i.amount} ${formatMoney(i.amount, language)}`.toLowerCase().includes(s)).slice(0, MAX_SHOWN)
  }, [open, q, items, language])
  const close = () => {
    setOpen(false)
    setQ("")
  }
  if (!open)
    return (
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4 me-1.5" aria-hidden="true" />
        {buttonLabel}
      </Button>
    )
  return (
    <div className="w-full space-y-2 rounded-md border bg-card p-2 sm:max-w-md">
      <div className="flex gap-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("eta.apl-search")} aria-label={buttonLabel} />
        <Button type="button" variant="ghost" onClick={close}>
          {t("eta.cancel")}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">{t("eta.apl-picker-empty")}</p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto">
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-2 text-start text-sm hover:bg-muted"
                onClick={() => {
                  onPick(i.id)
                  close()
                }}
              >
                <span className="min-w-0">
                  <bdi dir="ltr" className="block truncate font-medium">{i.label}</bdi>
                  <span className="block truncate text-xs text-muted-foreground">{i.sub}</span>
                </span>
                <Money value={i.amount} className="font-semibold" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ApPortalComparison() {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const today = Date.parse(iso(Date.now()))
  const [from, setFrom] = useState(iso(today - 90 * DAY))
  const [to, setTo] = useState(iso(today))
  const [supplier, setSupplier] = useState("all")
  const [status, setStatus] = useState<(typeof ERP_STATUSES)[number]>("all")
  const [showPortal, setShowPortal] = useState(false)
  const [portalFilter, setPortalFilter] = useState<(typeof PORTAL_FILTERS)[number]>("all")
  const [data, setData] = useState<Body | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<{ added: number; updated: number; unknown: number } | null>(null)

  const failed = (e: unknown) => toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to

  const load = useCallback(async () => {
    if (!validRange) return
    setLoading(true)
    try {
      const sup = supplier === "all" ? "" : `&supplierId=${supplier}`
      const res = await fetch(`/api/eta/ap-portal?from=${from}&to=${to}${sup}`)
      if (!res.ok) throw new Error(await errorOf(res, t("message.error"), language))
      setData(await res.json())
    } catch (e) {
      failed(e)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, supplier, validRange, language])

  useEffect(() => {
    load()
  }, [load])

  // "Check now": one call after another with the cursor until the whole period is read
  const checkNow = async () => {
    const sum = { added: 0, updated: 0, unknown: 0 }
    let cursor: unknown = null
    setSummary(null)
    setChecking({ done: 0, total: 1 })
    try {
      for (let part = 0; part < 200; part++) {
        const res: Response = await fetch("/api/eta/received/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, cursor }),
        })
        if (!res.ok) throw new Error(await errorOf(res, t("message.error"), language))
        const r: any = await res.json()
        sum.added += r.added || 0
        sum.updated += r.updated || 0
        sum.unknown += r.unknownSuppliers || 0
        cursor = r.cursor ?? null
        setChecking((c) => ({ done: Math.min((c?.done || 0) + (r.windows || 0), r.totalWindows || 1), total: r.totalWindows || 1 }))
        if (!cursor) break
      }
    } catch (e) {
      failed(e)
    } finally {
      setSummary(sum)
      setChecking(null)
      await load()
    }
  }

  const apById = useMemo(() => new Map((data?.apInvoices || []).map((a) => [a.invoiceId, a])), [data])
  const docById = useMemo(() => new Map((data?.portalDocs || []).map((d) => [d.receivedId, d])), [data])
  const docNumber = (d: PortalDoc) => d.internalId || `#${d.receivedId}`

  // a new manual link keeps the automatic links both sides showed (a manual link ends the suggestions for that side)
  const link = async (receivedId: number, apInvoiceId: number) => {
    const keep = [
      ...(apById.get(apInvoiceId)?.links || []).filter((l) => l.source === "auto").map((l) => ({ receivedId: l.receivedId, apInvoiceId })),
      ...(docById.get(receivedId)?.links || []).filter((l) => l.source === "auto").map((l) => ({ receivedId, apInvoiceId: l.apInvoiceId })),
    ]
    await change("POST", { receivedId, apInvoiceId, keep }, t("eta.apl-linked"))
  }
  const unlink = (receivedId: number, apInvoiceId: number) => change("DELETE", { receivedId, apInvoiceId }, t("eta.apl-unlinked"))
  const change = async (method: "POST" | "DELETE", body: unknown, done: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/eta/ap-portal/link", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await errorOf(res, t("message.error"), language))
      toast({ title: done })
      await load()
    } catch (e) {
      failed(e)
    } finally {
      setBusy(false)
    }
  }

  const portalItemsFor = (a: ApInvoice): PickItem[] =>
    (data?.portalDocs || [])
      .filter((d) => d.linkable && d.supplierId === a.supplierId && !a.links.some((l) => l.receivedId === d.receivedId))
      .sort((x, y) => Math.abs(x.signedTotal - a.amount) - Math.abs(y.signedTotal - a.amount))
      .map((d) => ({
        id: d.receivedId,
        label: docNumber(d),
        sub: [d.dateIssued ? formatDate(d.dateIssued, language) : "", d.documentType === "C" ? t("eta.sup-credit-note") : "", d.links.length ? t("eta.apl-already-linked") : ""].filter(Boolean).join(" · "),
        amount: d.signedTotal,
      }))
  const erpItemsFor = (d: PortalDoc): PickItem[] =>
    (data?.apInvoices || [])
      .filter((a) => a.supplierId === d.supplierId && !d.links.some((l) => l.apInvoiceId === a.invoiceId))
      .sort((x, y) => Math.abs(x.amount - d.signedTotal) - Math.abs(y.amount - d.signedTotal))
      .map((a) => ({
        id: a.invoiceId,
        label: a.invoiceNumber || a.poNumber || `#${a.invoiceId}`,
        sub: [a.poNumber ? `${t("eta.apl-po")} ${a.poNumber}` : "", a.date ? formatDate(a.date, language) : "", a.links.length ? t("eta.apl-already-linked") : ""].filter(Boolean).join(" · "),
        amount: a.amount,
      }))

  const erpGroups = (data?.groups || []).filter((g) => g.apInvoiceIds.length > 0 && (status === "all" || g.status === status))
  const portalDocs = (data?.portalDocs || []).filter((d) =>
    portalFilter === "all" ? true : portalFilter === "unknown" ? !d.linkable : portalFilter === "linked" ? d.links.length > 0 : d.linkable && d.links.length === 0,
  )
  const counts = data?.totals.counts

  const pickStatus = (s: GroupStatus) => {
    if (s === "no_erp" || s === "unknown_supplier") {
      setShowPortal(true)
      setPortalFilter(s === "no_erp" ? "not_linked" : "unknown")
    } else setStatus(s)
  }

  // a plain render function (not a component), so a re-render never remounts an open picker
  const apRow = (a: ApInvoice, single: Group | null) => (
    <div key={a.invoiceId} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1.4fr)_6.5rem_8rem_minmax(0,2.6fr)_8.5rem] sm:items-start sm:gap-3">
      <div className="min-w-0">
        <p className="font-medium break-words">
          <bdi dir="ltr">{a.invoiceNumber || "-"}</bdi>
        </p>
        <p className="text-xs text-muted-foreground break-words">
          {a.supplierName || "-"}
          {a.poNumber ? ` · ${t("eta.apl-po")} ${a.poNumber}` : ""}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm sm:block">
        <span className="text-xs text-muted-foreground sm:hidden">{t("eta.apl-col-date")}</span>
        <span className="whitespace-nowrap">{a.date ? formatDate(a.date, language) : "-"}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm sm:block sm:text-end">
        <span className="text-xs text-muted-foreground sm:hidden">{t("eta.apl-col-amount")}</span>
        <Money value={a.amount} className="font-semibold" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {a.links.length === 0 && <span className="text-xs text-muted-foreground">{t("eta.apl-no-links")}</span>}
        {a.links.map((l) => {
          const d = docById.get(l.receivedId)
          return d ? (
            <LinkChip key={l.receivedId} number={docNumber(d)} date={d.dateIssued} amount={d.signedTotal} source={l.source} disabled={busy} onRemove={() => unlink(l.receivedId, a.invoiceId)} />
          ) : null
        })}
        <LinkPicker items={portalItemsFor(a)} buttonLabel={t("eta.apl-link-portal")} disabled={busy} onPick={(id) => link(id, a.invoiceId)} />
      </div>
      <div className="sm:text-end">{single && <StatusPill status={single.status} />}</div>
    </div>
  )

  return (
    <section className="space-y-4" aria-labelledby="apl-title">
      <div className="space-y-1">
        <h2 id="apl-title" className="text-lg font-semibold">{t("eta.apl-title")}</h2>
        <p className="text-sm text-muted-foreground">{t("eta.apl-help")}</p>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="apl-from">{t("eta.apl-from")}</Label>
          <Input id="apl-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="apl-to">{t("eta.apl-to")}</Label>
          <Input id="apl-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="apl-supplier">{t("eta.apl-supplier")}</Label>
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger id="apl-supplier" className="w-56 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("eta.apl-all-suppliers")}</SelectItem>
              {(data?.suppliers || []).map((s) => (
                <SelectItem key={s.supplierId} value={String(s.supplierId)}>{s.supplierName || `#${s.supplierId}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="apl-status">{t("eta.apl-status")}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as (typeof ERP_STATUSES)[number])}>
            <SelectTrigger id="apl-status" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ERP_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s === "all" ? t("eta.apl-all") : t(`eta.apl-status-${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {loading && <Loader2 className="mb-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-label={t("eta.loading")} />}
      </div>
      {!validRange && <p className="text-sm text-tone-danger">{t("eta.apl-bad-range")}</p>}

      {/* summary */}
      {data && (
        <>
          <KpiGrid className="lg:grid-cols-3">
            <KpiTile label={t("eta.apl-erp-total")} value={<Money value={data.totals.erpTotal} />} sub={fill(t("eta.apl-n-erp"), { n: data.apInvoices.length })} />
            <KpiTile label={t("eta.apl-portal-total")} value={<Money value={data.totals.portalTotal} />} sub={fill(t("eta.apl-n-portal"), { n: data.portalDocs.length })} />
            <KpiTile label={t("eta.apl-difference")} value={<Money value={data.totals.difference} />} sub={t("eta.apl-difference-sub")} />
          </KpiGrid>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pickStatus(s)}
                className="inline-flex items-center gap-2 rounded-full border bg-card py-1 ps-1 pe-3 text-sm hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusPill status={s} />
                <span className="font-semibold tabular-nums">{counts?.[s] ?? 0}</span>
              </button>
            ))}
          </div>
          {data.environment === "test" && <p className="text-xs text-muted-foreground">{t("eta.sup-test-env")}</p>}
        </>
      )}

      {/* main table: the ERP supplier invoices */}
      <div className="rounded-xl border bg-card">
        <div className="hidden border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.4fr)_6.5rem_8rem_minmax(0,2.6fr)_8.5rem] sm:gap-3">
          <span>{t("eta.apl-col-invoice")}</span>
          <span>{t("eta.apl-col-date")}</span>
          <span className="text-end">{t("eta.apl-col-amount")}</span>
          <span>{t("eta.apl-col-portal")}</span>
          <span className="text-end">{t("eta.apl-status")}</span>
        </div>
        {loading && !data ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("eta.loading")}
          </p>
        ) : erpGroups.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("eta.apl-empty")}</p>
        ) : (
          <ul className="divide-y">
            {erpGroups.map((g) => {
              const several = g.apInvoiceIds.length > 1 || g.receivedIds.length > 1
              const rows = g.apInvoiceIds.map((id) => apById.get(id)).filter((a): a is ApInvoice => !!a)
              if (!several) return <li key={g.key}>{rows[0] && apRow(rows[0], g)}</li>
              return (
                <li key={g.key} className="border-s-4 border-s-primary/40">
                  <div className="divide-y divide-dashed">
                    {rows.map((a) => apRow(a, null))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{fill(t("eta.apl-group-of"), { erp: g.apInvoiceIds.length, portal: g.receivedIds.length })}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>
                        {t("eta.apl-erp")} <Money value={g.erpTotal} className="font-semibold" />
                      </span>
                      <span>
                        {t("eta.apl-portal")} <Money value={g.portalTotal} className="font-semibold" />
                      </span>
                      <span>
                        {t("eta.apl-diff")} <Money value={g.difference} className="font-semibold" />
                      </span>
                      <StatusPill status={g.status} />
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* the portal invoices, behind Show / Hide */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" aria-expanded={showPortal} aria-controls="apl-portal" onClick={() => setShowPortal((v) => !v)}>
            {showPortal ? t("eta.apl-hide-portal") : fill(t("eta.apl-show-portal"), { n: data?.portalDocs.length ?? 0 })}
          </Button>
          <Button type="button" onClick={checkNow} disabled={checking !== null || loading || !validRange}>
            {checking ? <Loader2 className="h-4 w-4 me-2 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4 me-2" aria-hidden="true" />}
            {t("eta.sup-check-now")}
          </Button>
        </div>
        {checking && (
          <p role="status" className="text-sm text-muted-foreground">
            {fill(t("eta.sup-checking"), { done: checking.done, total: checking.total })}
          </p>
        )}
        {summary && (
          <p className="text-sm" aria-live="polite">
            {fill(t("eta.sup-check-result"), { added: summary.added, updated: summary.updated, unknown: summary.unknown })}
          </p>
        )}

        {showPortal && (
          <div id="apl-portal" className="space-y-3 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="group" aria-label={t("eta.apl-portal-invoices")}>
              {PORTAL_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={portalFilter === f}
                  onClick={() => setPortalFilter(f)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    portalFilter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`eta.apl-portal-${f}`)}
                </button>
              ))}
            </div>
            {portalDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("eta.apl-portal-empty")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {portalDocs.map((d) => (
                  <li key={d.receivedId} className="space-y-2 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          <bdi dir="ltr">{docNumber(d)}</bdi>
                          <span className="ms-2 text-sm font-normal text-muted-foreground">{d.supplierName || d.issuerName || "-"}</span>
                        </p>
                        <p className="text-xs text-muted-foreground break-words">
                          {d.dateIssued ? formatDate(d.dateIssued, language) : "-"}
                          {d.documentType === "C" ? ` · ${t("eta.sup-credit-note")}` : ""}
                          {d.portalStatus ? ` · ${t("eta.sup-portal-status")}: ${d.portalStatus}` : ""}
                          {!d.standing ? ` · ${t("eta.apl-withdrawn")}` : ""}
                        </p>
                      </div>
                      <Money value={d.signedTotal} className="font-semibold" />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {d.links.map((l) => {
                        const a = apById.get(l.apInvoiceId)
                        return a ? (
                          <LinkChip key={l.apInvoiceId} number={a.invoiceNumber || `#${a.invoiceId}`} date={a.date} amount={a.amount} source={l.source} disabled={busy} onRemove={() => unlink(d.receivedId, l.apInvoiceId)} />
                        ) : null
                      })}
                      {d.linkable ? (
                        <LinkPicker items={erpItemsFor(d)} buttonLabel={t("eta.apl-link-erp")} disabled={busy} onPick={(id) => link(d.receivedId, id)} />
                      ) : (
                        <span className="text-sm text-muted-foreground">{fill(t("eta.sup-unknown-hint"), { tax: d.issuerId || "-" })}</span>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/api/eta/received/${d.receivedId}/pdf`} target="_blank" rel="noopener noreferrer" aria-label={`${t("eta.sup-pdf")} ${docNumber(d)}`}>
                          <FileText className="h-4 w-4 me-1.5" aria-hidden="true" />
                          {t("eta.sup-pdf")}
                        </a>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
