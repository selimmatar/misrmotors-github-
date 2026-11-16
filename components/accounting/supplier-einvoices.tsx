"use client"

// Accounts Payable -> "Supplier e-invoices" (spec §6.6, §9): the invoices suppliers issued to the company on the ETA
// portal, each compared with Accounts Payable (matched / amount differs / missing in the ERP / unknown supplier), the
// credit notes apart, and the AP invoices that are not on the portal. Read-only toward AP. "Check now" reads the
// portal month by month (each call continues from a cursor).
import { useCallback, useEffect, useState } from "react"
import { FileText, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Money } from "@/components/erp/money"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate } from "@/lib/format"

type MatchStatus = "matched" | "amount_differs" | "missing_in_erp" | "unknown_supplier"
interface Row {
  receivedId: number
  documentType: string
  issuerId: string | null
  issuerName: string | null
  supplierName: string | null
  internalId: string | null
  dateIssued: string | null
  net: number | null
  vat: number | null
  total: number | null
  portalStatus: string | null
  match: { status: MatchStatus; apInvoiceNumber?: string; difference?: number }
}
interface Missing { invoiceId: number; invoiceNumber: string; supplierName: string | null; amount: number; date: string | null }
interface ListBody { environment: string; documents: Row[]; creditNotes: Row[]; missingOnPortal: Missing[] }

const TONE: Record<MatchStatus, string> = {
  matched: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  amount_differs: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  missing_in_erp: "bg-red-500/15 text-red-700 dark:text-red-300",
  unknown_supplier: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
}
const FILTERS = ["all", "matched", "amount_differs", "missing_in_erp", "unknown_supplier"] as const
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function errorOf(res: Response, fallback: string, language: string): Promise<string> {
  const body = await res.json().catch(() => null)
  if (body && language === "ar" && typeof body.errorAr === "string") return body.errorAr
  return body && typeof body.error === "string" ? body.error : fallback
}

export function SupplierEInvoices() {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [months, setMonths] = useState("3")
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all")
  const [data, setData] = useState<ListBody | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<{ added: number; updated: number; unknown: number } | null>(null)

  const range = useCallback(() => {
    const today = Date.parse(iso(Date.now()))
    return { from: iso(today - Number(months) * 30 * DAY + DAY), to: iso(today) }
  }, [months])

  const failed = (e: unknown) =>
    toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = range()
      const res = await fetch(`/api/eta/received?from=${from}&to=${to}`)
      if (!res.ok) throw new Error(await errorOf(res, t("message.error"), language))
      setData(await res.json())
    } catch (e) {
      failed(e)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, language])

  useEffect(() => {
    load()
  }, [load])

  // "Check now": one call after another with the cursor until the whole period is read
  const checkNow = async () => {
    const { from, to } = range()
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

  const docs = (data?.documents || []).filter((d) => filter === "all" || d.match.status === filter)
  const pdfHref = (id: number) => `/api/eta/received/${id}/pdf`

  const DocRow = ({ d, credit }: { d: Row; credit?: boolean }) => (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{d.supplierName || d.issuerName || "-"}</p>
          <p className="text-xs text-muted-foreground break-words">
            {t("eta.sup-number")}: <bdi dir="ltr">{d.internalId || "-"}</bdi> · {d.dateIssued ? formatDate(d.dateIssued, language) : "-"}
            {d.portalStatus ? ` · ${t("eta.sup-portal-status")}: ${d.portalStatus}` : ""}
          </p>
        </div>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${credit ? TONE.matched : TONE[d.match.status]}`}>
          {credit ? t("eta.sup-credit-note") : t(`eta.sup-status-${d.match.status}`)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.sup-net")}</p>
          <Money value={d.net ?? 0} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.sup-vat")}</p>
          <Money value={d.vat ?? 0} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.sup-total")}</p>
          <Money value={d.total ?? 0} className="font-semibold" />
        </div>
      </div>
      {!credit && d.match.apInvoiceNumber && (
        <p className="text-sm">
          {t("eta.sup-ap-invoice")}: <bdi dir="ltr">{d.match.apInvoiceNumber}</bdi>
          {d.match.status === "amount_differs" && d.match.difference != null && (
            <>
              {" · "}
              {t("eta.sup-difference")}: <Money value={d.match.difference} />
            </>
          )}
        </p>
      )}
      {d.match.status === "unknown_supplier" && (
        <p className="text-sm text-muted-foreground">
          {fill(t("eta.sup-unknown-hint"), { tax: d.issuerId || "-" })}
        </p>
      )}
      <Button asChild size="sm" variant="outline">
        <a href={pdfHref(d.receivedId)} target="_blank" rel="noopener noreferrer" aria-label={`${t("eta.sup-pdf")} ${d.internalId || ""}`}>
          <FileText className="w-4 h-4 me-2" />
          {t("eta.sup-pdf")}
        </a>
      </Button>
    </li>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("eta.sup-section")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("eta.sup-help")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="eta-sup-months">{t("eta.sup-months")}</Label>
            <Select value={months} onValueChange={setMonths} disabled={checking !== null}>
              <SelectTrigger id="eta-sup-months" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1", "3", "6", "12"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={checkNow} disabled={checking !== null || loading}>
            {checking ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <RefreshCw className="w-4 h-4 me-2" />}
            {t("eta.sup-check-now")}
          </Button>
          <div className="space-y-1">
            <Label htmlFor="eta-sup-filter">{t("eta.sup-filter")}</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as (typeof FILTERS)[number])}>
              <SelectTrigger id="eta-sup-filter" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => (
                  <SelectItem key={f} value={f}>{f === "all" ? t("eta.sup-filter-all") : t(`eta.sup-status-${f}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
        {data?.environment === "test" && <p className="text-xs text-muted-foreground">{t("eta.sup-test-env")}</p>}

        {loading && !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("eta.loading")}
          </p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eta.sup-empty")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {docs.map((d) => (
              <DocRow key={d.receivedId} d={d} />
            ))}
          </ul>
        )}

        {data && data.creditNotes.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">{t("eta.sup-credit-notes")}</h3>
            <ul className="divide-y rounded-lg border">
              {data.creditNotes.map((d) => (
                <DocRow key={d.receivedId} d={d} credit />
              ))}
            </ul>
          </div>
        )}

        {data && (
          <div className="space-y-2">
            <h3 className="font-semibold">{t("eta.sup-missing-on-portal")}</h3>
            <p className="text-sm text-muted-foreground">{t("eta.sup-missing-on-portal-help")}</p>
            {data.missingOnPortal.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("eta.sup-missing-on-portal-none")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.missingOnPortal.map((m) => (
                  <li key={m.invoiceId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{m.supplierName || "-"}</p>
                      <p className="text-xs text-muted-foreground">
                        <bdi dir="ltr">{m.invoiceNumber}</bdi> · {m.date ? formatDate(m.date, language) : "-"}
                      </p>
                    </div>
                    <Money value={m.amount} className="font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
