"use client"

// Inside "Portal comparison": the lines of a matched supplier bill (or a linked group) next to the lines of the
// supplier's e-invoice(s) on the tax portal. Each line is matched, has differences (quantity / price / total
// highlighted), is only in the ERP or only on the portal. The accountant can confirm a pair, take it apart, or pair two
// lines by hand; pairs are remembered for the supplier (lib/eta/ap-line-compare.ts). Accounts Payable is never changed.
import { useCallback, useEffect, useState } from "react"
import { Check, Link2, Loader2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Money } from "@/components/erp/money"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

type LineStatus = "matched" | "differs" | "only_erp" | "only_portal"
interface OurLine {
  key: string
  apInvoiceId: number
  name: string
  quantity: number
  unitPrice: number
  total: number
}
interface PortalLine {
  key: string
  receivedId: number
  description: string
  itemCode: string | null
  internalCode: string | null
  unitType: string | null
  quantity: number
  unitPrice: number
  total: number
}
interface Row {
  status: LineStatus
  our: OurLine | null
  portal: PortalLine | null
  diffs: { quantity: boolean; unitPrice: boolean; total: boolean } | null
  remembered: boolean
}
interface Body {
  memoryReady: boolean
  bills: { invoiceId: number; invoiceNumber: string; source: "bill" | "po" | "none"; lines: number }[]
  docs: { receivedId: number; internalId: string | null; skipped: "credit_note" | "withdrawn" | null; unread: boolean; lines: number }[]
  rows: Row[]
  summary: { matched: number; differs: number; only_erp: number; only_portal: number; ourTotal: number; portalTotal: number }
}

const STATUSES: LineStatus[] = ["matched", "differs", "only_erp", "only_portal"]
const TONE: Record<LineStatus, string> = {
  matched: "bg-tone-done-bg text-tone-done",
  differs: "bg-tone-waiting-bg text-tone-waiting",
  only_erp: "bg-tone-danger-bg text-tone-danger",
  only_portal: "bg-tone-danger-bg text-tone-danger",
}
const qty = (n: number) => String(Math.round(n * 1000) / 1000)

function LinePill({ status }: { status: LineStatus }) {
  const { t } = useI18n()
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", TONE[status])}>{t(`eta.apl-line-${status}`)}</span>
}

/** quantity x unit price = total, a differing part highlighted */
function Figures({ line, diffs }: { line: { quantity: number; unitPrice: number; total: number }; diffs: Row["diffs"] }) {
  const { language } = useI18n()
  const mark = (on: boolean | undefined) => (on ? "rounded bg-tone-waiting-bg px-1 font-semibold text-tone-waiting" : "")
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground tabular-nums">
      <bdi className={mark(diffs?.quantity)}>{qty(line.quantity)}</bdi>
      <span aria-hidden="true">×</span>
      <bdi className={mark(diffs?.unitPrice)}>{formatMoney(line.unitPrice, language)}</bdi>
      <span aria-hidden="true">=</span>
      <Money value={line.total} className={cn("text-foreground", mark(diffs?.total))} />
    </p>
  )
}

export function ApLineCompare({ apInvoiceIds, receivedIds }: { apInvoiceIds: number[]; receivedIds: number[] }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [data, setData] = useState<Body | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const query = `apInvoiceIds=${apInvoiceIds.join(",")}&receivedIds=${receivedIds.join(",")}`

  const errorOf = async (res: Response) => {
    const body = await res.json().catch(() => null)
    if (body && language === "ar" && typeof body.errorAr === "string") return body.errorAr
    return body && typeof body.error === "string" ? body.error : t("message.error")
  }
  const failed = (e: unknown) => toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/eta/ap-portal/lines?${query}`)
      if (!res.ok) throw new Error(await errorOf(res))
      setData(await res.json())
    } catch (e) {
      failed(e)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, language])

  useEffect(() => {
    load()
  }, [load])

  const save = async (action: "pair" | "unpair", our: OurLine, portal: PortalLine, done: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/eta/ap-portal/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, apInvoiceId: our.apInvoiceId, ourKey: our.key, portalKey: portal.key }),
      })
      if (!res.ok) throw new Error(await errorOf(res))
      toast({ title: done })
      setPicking(null)
      await load()
    } catch (e) {
      failed(e)
    } finally {
      setBusy(false)
    }
  }

  if (!data)
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {loading ? t("eta.apl-lines-loading") : t("eta.apl-lines-none")}
      </p>
    )

  const onlyErp = data.rows.filter((r) => r.status === "only_erp" && r.our).map((r) => r.our!)
  const onlyPortal = data.rows.filter((r) => r.status === "only_portal" && r.portal).map((r) => r.portal!)
  const docNo = (receivedId: number) => data.docs.find((d) => d.receivedId === receivedId)?.internalId || `#${receivedId}`

  /** the plain-words line under a row */
  const explain = (r: Row): string => {
    if (r.status === "matched") return t("eta.apl-line-explain-matched")
    if (r.status === "only_erp") return t("eta.apl-line-explain-only_erp")
    if (r.status === "only_portal") return t("eta.apl-line-explain-only_portal")
    const parts: string[] = []
    if (r.diffs?.quantity) parts.push(fill(t("eta.apl-line-diff-qty"), { erp: qty(r.our!.quantity), portal: qty(r.portal!.quantity) }))
    if (r.diffs?.unitPrice) parts.push(fill(t("eta.apl-line-diff-price"), { erp: formatMoney(r.our!.unitPrice, language), portal: formatMoney(r.portal!.unitPrice, language) }))
    if (r.diffs?.total) parts.push(fill(t("eta.apl-line-diff-total"), { erp: formatMoney(r.our!.total, language), portal: formatMoney(r.portal!.total, language) }))
    return parts.join(" ")
  }

  const ourCell = (o: OurLine | null, diffs: Row["diffs"]) =>
    o ? (
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium break-words">{o.name}</p>
        <Figures line={o} diffs={diffs} />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{t("eta.apl-line-missing")}</p>
    )
  const portalCell = (p: PortalLine | null, diffs: Row["diffs"]) =>
    p ? (
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium break-words">{p.description || "-"}</p>
        <p className="text-xs text-muted-foreground break-words">
          {p.internalCode || p.itemCode ? <bdi dir="ltr">{p.internalCode || p.itemCode}</bdi> : null}
          {receivedIds.length > 1 ? ` · ${docNo(p.receivedId)}` : ""}
        </p>
        <Figures line={p} diffs={diffs} />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{t("eta.apl-line-missing")}</p>
    )

  /** the other side's unpaired lines, to pair by hand */
  const picker = (r: Row) => {
    const key = r.our?.key || r.portal?.key || ""
    const choices = r.our ? onlyPortal.map((p) => ({ key: p.key, label: p.description || "-", total: p.total, pair: () => save("pair", r.our!, p, t("eta.apl-line-paired")) })) : onlyErp.map((o) => ({ key: o.key, label: o.name, total: o.total, pair: () => save("pair", o, r.portal!, t("eta.apl-line-paired")) }))
    if (picking !== key)
      return (
        <Button type="button" size="sm" variant="outline" disabled={busy || choices.length === 0} onClick={() => setPicking(key)}>
          <Link2 className="h-4 w-4 me-1.5" aria-hidden="true" />
          {t(r.our ? "eta.apl-line-pair-portal" : "eta.apl-line-pair-erp")}
        </Button>
      )
    return (
      <div className="w-full space-y-1 rounded-md border bg-card p-2">
        <ul className="max-h-56 divide-y overflow-y-auto">
          {choices.map((c) => (
            <li key={c.key}>
              <button type="button" disabled={busy} onClick={c.pair} className="flex w-full items-center justify-between gap-3 p-2 text-start text-sm hover:bg-muted disabled:opacity-50">
                <span className="min-w-0 break-words">{c.label}</span>
                <Money value={c.total} className="font-semibold" />
              </button>
            </li>
          ))}
        </ul>
        <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(null)}>
          {t("eta.cancel")}
        </Button>
      </div>
    )
  }

  const actions = (r: Row) => {
    if (r.our && r.portal)
      return (
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          {r.remembered ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t("eta.apl-line-remembered")}
            </span>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => save("pair", r.our!, r.portal!, t("eta.apl-line-confirmed"))}>
              <Check className="h-4 w-4 me-1.5" aria-hidden="true" />
              {t("eta.apl-line-confirm")}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => save("unpair", r.our!, r.portal!, t("eta.apl-line-unpaired"))}>
            <Unlink className="h-4 w-4 me-1.5" aria-hidden="true" />
            {t("eta.apl-line-unpair")}
          </Button>
        </div>
      )
    return picker(r)
  }

  return (
    <div className="space-y-3 border-t bg-muted/30 p-3" aria-busy={loading || busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-sm">
              <LinePill status={s} />
              <span className="font-semibold tabular-nums">{data.summary[s]}</span>
            </span>
          ))}
          {(loading || busy) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t("eta.loading")} />}
        </div>
        <p className="flex flex-wrap gap-x-3 text-sm">
          <span>
            {t("eta.apl-lines-erp-total")} <Money value={data.summary.ourTotal} className="font-semibold" />
          </span>
          <span>
            {t("eta.apl-lines-portal-total")} <Money value={data.summary.portalTotal} className="font-semibold" />
          </span>
        </p>
      </div>

      <ul className="space-y-1 text-xs text-muted-foreground">
        {data.bills.filter((b) => b.source !== "bill").map((b) => (
          <li key={`b${b.invoiceId}`}>{fill(t(b.source === "po" ? "eta.apl-lines-whole-po" : "eta.apl-lines-no-bill-lines"), { number: b.invoiceNumber || `#${b.invoiceId}` })}</li>
        ))}
        {data.docs.filter((d) => d.unread || d.skipped).map((d) => (
          <li key={`d${d.receivedId}`}>
            {fill(t(d.skipped === "credit_note" ? "eta.apl-lines-credit-note" : d.skipped === "withdrawn" ? "eta.apl-lines-withdrawn" : "eta.apl-lines-unread"), { number: d.internalId || `#${d.receivedId}` })}
          </li>
        ))}
        {!data.memoryReady && <li>{t("eta.apl-lines-no-memory")}</li>}
      </ul>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("eta.apl-lines-none")}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="hidden border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,13rem)] md:gap-3">
            <span>{t("eta.apl-status")}</span>
            <span>{t("eta.apl-lines-col-erp")}</span>
            <span>{t("eta.apl-lines-col-portal")}</span>
            <span className="text-end">{t("eta.apl-lines-col-action")}</span>
          </div>
          <ul className="divide-y">
            {data.rows.map((r) => (
              <li key={`${r.our?.key || "-"}|${r.portal?.key || "-"}`} className="grid gap-2 p-3 md:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,13rem)] md:items-start md:gap-3">
                <div>
                  <LinePill status={r.status} />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground md:hidden">{t("eta.apl-lines-col-erp")}</span>
                  {ourCell(r.our, r.diffs)}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground md:hidden">{t("eta.apl-lines-col-portal")}</span>
                  {portalCell(r.portal, r.diffs)}
                </div>
                <div>{actions(r)}</div>
                <p className={cn("text-xs md:col-span-4", r.status === "matched" ? "text-muted-foreground" : "text-foreground")}>{explain(r)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
