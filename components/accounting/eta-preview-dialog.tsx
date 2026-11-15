"use client"

// E-invoice preview of one customer invoice (spec §9): the lines as they would be sent, each line's item code with a
// green / orange / red state and a confirm / change control (writes the code memory), the portal totals, what is
// still missing, and the "already on the portal" mark. Nothing is sent from here (step 1).
import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Money } from "@/components/erp/money"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatMoney } from "@/lib/format"
import { ETA_UNITS } from "@/lib/eta/egypt"
import type { CodeState } from "@/lib/eta/codes"
import type { EtaPreview, EtaPreviewLine } from "@/lib/eta/preview"

export interface EtaCodeRow {
  code_id: number
  item_code: string
  code_type?: string | null
  name?: string | null
  keywords?: string[] | null
  default_unit?: string | null
  active?: boolean | null
}

/** The server's error text when it sent one as text; otherwise the fallback (never "[object Object]"). */
export async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return body && typeof body.error === "string" && body.error.trim() ? body.error : fallback
}

/** "" or spaces is no unit. */
export const hasUnit = (u: string | null | undefined) => !!u && u.trim() !== ""

export const STATE_TONE: Record<CodeState, string> = {
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  orange: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
}

export function StatePill({ state }: { state: CodeState }) {
  const { t } = useI18n()
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATE_TONE[state]}`}>
      {t(`eta.state-${state}`)}
    </span>
  )
}

const NONE = "none"

function LineRow({ line, codes, onSaved }: { line: EtaPreviewLine; codes: EtaCodeRow[]; onSaved: () => Promise<void> }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [codeId, setCodeId] = useState(line.codeId != null ? String(line.codeId) : NONE)
  const [unit, setUnit] = useState(hasUnit(line.unit) ? line.unit : NONE)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setCodeId(line.codeId != null ? String(line.codeId) : NONE)
    setUnit(hasUnit(line.unit) ? line.unit : NONE)
  }, [line.codeId, line.unit])

  // active codes, plus the line's own code so the picker never shows blank
  const options = codes.filter((c) => c.active !== false || c.code_id === line.codeId)
  const units: string[] = [...ETA_UNITS]
  if (hasUnit(line.unit) && !units.includes(line.unit)) units.push(line.unit)

  const confirm = async () => {
    if (codeId === NONE) return
    setSaving(true)
    try {
      const res = await fetch("/api/eta/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: line.name, codeId: Number(codeId), unitType: unit === NONE ? "" : unit }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.confirmed") })
      await onSaved()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium break-words min-w-0">{line.name}</p>
        <StatePill state={line.state} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.quantity")}</p>
          <bdi className="tabular-nums">{line.quantity}</bdi>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.unit-price")}</p>
          <Money value={line.unitPrice} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.line-total")}</p>
          <Money value={line.total} className="font-semibold" />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{t("eta.item-code")}</p>
          <Select value={codeId} onValueChange={setCodeId}>
            <SelectTrigger aria-label={`${t("eta.item-code")} ${line.name}`}>
              <SelectValue placeholder={t("eta.choose-code")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("eta.choose-code")}</SelectItem>
              {options.map((c) => (
                <SelectItem key={c.code_id} value={String(c.code_id)}>
                  {c.item_code}
                  {c.name ? ` - ${c.name}` : ""}
                  {c.active === false ? ` (${t("eta.code-inactive")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-40 space-y-1">
          <p className="text-xs text-muted-foreground">{t("eta.unit")}</p>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger aria-label={`${t("eta.unit")} ${line.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("eta.no-unit")}</SelectItem>
              {units.map((u) => (
                <SelectItem key={u} value={u}>
                  {(ETA_UNITS as readonly string[]).includes(u) ? `${u} - ${t(`eta.unit-${u}`)}` : u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={confirm} disabled={saving || codeId === NONE}>
          {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
          {t("eta.confirm")}
        </Button>
      </div>
    </li>
  )
}

export function EtaPreviewDialog({ invoiceId, invoiceNumber, onClose }: { invoiceId: string; invoiceNumber: string; onClose: () => void }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [preview, setPreview] = useState<EtaPreview | null>(null)
  const [codes, setCodes] = useState<EtaCodeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [etaUuid, setEtaUuid] = useState("")
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/eta/preview?invoiceId=${encodeURIComponent(invoiceId)}`)
      if (!res.ok) {
        setError(await readError(res, ""))
        setPreview(null)
        return
      }
      setPreview((await res.json()) as EtaPreview)
    } catch {
      setError("")
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    setLoading(true)
    load()
    fetch("/api/eta/codes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setCodes(Array.isArray(rows) ? rows : []))
      .catch(() => setCodes([]))
  }, [load])

  const markOnPortal = async () => {
    setMarking(true)
    try {
      const res = await fetch("/api/eta/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoiceId), etaUuid: etaUuid.trim() }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      setEtaUuid("")
      await load()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  const undoMark = async () => {
    setMarking(true)
    try {
      const res = await fetch(`/api/eta/preview?invoiceId=${encodeURIComponent(invoiceId)}`, { method: "DELETE" })
      if (res.status === 404) {
        toast({ title: t("eta.portal-undo-none") })
        return
      }
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      await load()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  const missingText = (m: EtaPreview["missing"][number]) =>
    m === "amount_mismatch" && preview
      ? fill(t("eta.missing-amount_mismatch"), { stored: formatMoney(preview.storedAmount, language), total: formatMoney(preview.totals.total, language) })
      : t(`eta.missing-${m}`)

  const totals = preview
    ? [
        { key: "eta.total-sales", value: preview.totals.sales },
        { key: "eta.total-discount", value: preview.totals.discount },
        { key: "eta.total-net", value: preview.totals.net },
        { key: "eta.total-vat", value: preview.totals.vat },
        { key: "eta.total-total", value: preview.totals.total },
      ]
    : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fill(t("eta.preview-title"), { number: invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("eta.preview-help")}</DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("eta.loading")}
          </p>
        )}

        {!loading && error !== null && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <p className="text-sm font-medium">{t("eta.preview-error")}</p>
            {error && <p className="text-xs text-muted-foreground break-words">{error}</p>}
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); load() }}>
              <RefreshCw className="w-4 h-4 me-2" />
              {t("eta.retry")}
            </Button>
          </div>
        )}

        {!loading && preview && (
          <div className="space-y-5">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("eta.customer")}: </span>
              <span className="font-medium">{preview.customer.name || "-"}</span>
              {preview.customer.taxRegistrationNumber && (
                <span className="text-muted-foreground">
                  {" "}
                  · {t("eta.tax-number")}: <bdi>{preview.customer.taxRegistrationNumber}</bdi>
                </span>
              )}
            </div>

            {preview.handledManually && (
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <p className="font-semibold">{t("eta.manual-title")}</p>
                <p className="text-sm text-muted-foreground">{t("eta.manual-note")}</p>
                {preview.manualEtaUuid && (
                  <p className="text-sm">
                    {t("eta.manual-id")}{" "}
                    <bdi className="font-mono break-all">{preview.manualEtaUuid}</bdi>
                  </p>
                )}
              </div>
            )}

            <section className="space-y-2">
              <h3 className="font-semibold">{t("eta.lines")}</h3>
              {preview.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("eta.no-lines")}</p>
              ) : (
                <ul className="space-y-2">
                  {preview.lines.map((line, i) => (
                    <LineRow key={`${i}-${line.name}`} line={line} codes={codes} onSaved={load} />
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">{preview.handledManually ? t("eta.totals-reference") : t("eta.totals")}</h3>
              <dl className={`grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm ${preview.handledManually ? "opacity-70" : ""}`}>
                {totals.map((row) => (
                  <div key={row.key} className="rounded-lg border p-2">
                    <dt className="text-xs text-muted-foreground">{t(row.key)}</dt>
                    <dd className={row.key === "eta.total-total" ? "font-bold" : ""}>
                      <Money value={row.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">{t("eta.missing-title")}</h3>
              {preview.missing.length === 0 ? (
                <p className="text-sm text-emerald-800 dark:text-emerald-300">{t("eta.missing-none")}</p>
              ) : (
                <ul className="list-disc ps-5 space-y-1 text-sm">
                  {preview.missing.map((m) => (
                    <li key={m}>{missingText(m)}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border p-3 space-y-2">
              <h3 className="font-semibold">{t("eta.portal-section")}</h3>
              <p className="text-sm text-muted-foreground">{t("eta.portal-help")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="eta-portal-id">{t("eta.portal-id")}</Label>
                  <Input id="eta-portal-id" value={etaUuid} maxLength={100} onChange={(e) => setEtaUuid(e.target.value)} dir="ltr" />
                </div>
                <Button onClick={markOnPortal} disabled={marking}>
                  {t("eta.portal-mark")}
                </Button>
                {preview.handledManually && (
                  <Button variant="outline" onClick={undoMark} disabled={marking}>
                    {t("eta.portal-undo")}
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
