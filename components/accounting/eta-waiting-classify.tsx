"use client"

// E-invoice settings -> "Classify waiting invoices": the lines of invoices made after go-live, not on the portal yet,
// whose item code is not sure (orange / red), one row per name with the suggested code already picked. "Confirm all
// shown" remembers each name as confirmed (POST /api/eta/memory in chunks), so the next invoices find it by itself.
import { useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EtaCodePicker, type PickerCode } from "@/components/accounting/eta-code-picker"
import { StatePill, readError } from "@/components/accounting/eta-preview-dialog"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { chunk, PREPARE_BATCH } from "@/lib/eta/codes"
import { mergeWaiting, type WaitingItem } from "@/lib/eta/waiting-list"

const PAGE = 100
const MAX_PARTS = 50

interface Row extends WaitingItem {
  pick: number | null
}

export function EtaWaitingClassify({ codes, onSaved }: { codes: PickerCode[]; onSaved?: () => void }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [noGoLive, setNoGoLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [read, setRead] = useState(0)
  const [shown, setShown] = useState(PAGE)
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)

  const failed = (e: unknown) =>
    toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })

  // a call stops after ~40 s and hands back a cursor; the parts are added up here
  const load = async () => {
    setLoading(true)
    setRead(0)
    try {
      let items: WaitingItem[] = []
      let cursor: number | null = null
      let total = 0
      for (let part = 0; part < MAX_PARTS; part++) {
        const res: Response = await fetch("/api/eta/predict/waiting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        })
        if (!res.ok) throw new Error(await readError(res, t("message.error")))
        const body: any = await res.json()
        setNoGoLive(!body.goLive)
        items = mergeWaiting(items, Array.isArray(body.items) ? body.items : [])
        total += Number(body.invoices) || 0
        setRead(total)
        cursor = body.cursor ?? null
        if (cursor == null) break
      }
      setRows(items.map((i) => ({ ...i, pick: i.suggestion?.codeId ?? null })))
      setShown(PAGE)
    } catch (e) {
      failed(e)
    } finally {
      setLoading(false)
    }
  }

  const visible = (rows || []).slice(0, shown)
  const toConfirm = visible.filter((r) => r.pick != null)

  const confirmAll = async () => {
    if (toConfirm.length === 0) return
    const total = toConfirm.length
    let done = 0
    let saved = 0
    let failedRows = 0
    let products = 0
    setSaving({ done, total })
    try {
      for (const part of chunk(toConfirm, PREPARE_BATCH)) {
        const res = await fetch("/api/eta/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: part.map((r) => ({ name: r.name, codeId: r.pick, unitType: "", productIds: r.productIds })) }),
        })
        if (!res.ok) throw new Error(await readError(res, t("message.error")))
        const out = await res.json()
        saved += out.saved ?? 0
        failedRows += Array.isArray(out.failed) ? out.failed.length : 0
        products += out.productsSet ?? 0
        done += part.length
        setSaving({ done, total })
      }
    } catch (e) {
      failed(e)
    } finally {
      toast({
        title: fill(t("eta.waiting-done"), { saved, failed: failedRows + (total - done), products }),
        variant: failedRows > 0 || done < total ? "destructive" : undefined,
      })
      setSaving(null)
      onSaved?.()
      await load()
    }
  }

  const setPick = (key: string, pick: number | null) => setRows((list) => (list || []).map((r) => (r.normalizedName === key ? { ...r, pick } : r)))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("eta.waiting-section")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("eta.waiting-help")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading || saving !== null}>
            {loading ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <RefreshCw className="w-4 h-4 me-2" />}
            {t("eta.waiting-start")}
          </Button>
          {rows && rows.length > 0 && (
            <Button onClick={confirmAll} disabled={loading || saving !== null || toConfirm.length === 0}>
              {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {fill(t("eta.waiting-confirm-all"), { n: toConfirm.length })}
            </Button>
          )}
        </div>
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            {fill(t("eta.waiting-progress"), { done: read })}
          </p>
        )}
        {saving && (
          <p role="status" className="text-sm text-muted-foreground">
            {fill(t("eta.prepare-progress"), { done: saving.done, total: saving.total })}
          </p>
        )}
        {rows && noGoLive && <p className="text-sm text-muted-foreground">{t("eta.waiting-no-go-live")}</p>}
        {rows && !noGoLive && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("eta.waiting-empty")}</p>}
        {rows && rows.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {visible.map((r) => (
              <li key={r.normalizedName} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{r.name}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{fill(t("eta.waiting-times"), { n: r.count })}</span>
                    <StatePill state={r.pick == null ? "red" : r.pick === r.suggestion?.codeId ? r.suggestion.state : "green"} />
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    {t("eta.waiting-invoices")}: <bdi dir="ltr">{r.invoices.slice(0, 10).join(", ")}{r.invoices.length > 10 ? " …" : ""}</bdi>
                  </p>
                </div>
                <div className="sm:w-72">
                  <EtaCodePicker
                    codes={codes}
                    value={r.pick}
                    onChange={(id) => setPick(r.normalizedName, id)}
                    ariaLabel={`${t("eta.item-code")} ${r.name}`}
                    noneLabel={t("eta.choose-code")}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length > shown && (
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
            {fill(t("eta.show-more"), { n: rows.length - shown })}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
