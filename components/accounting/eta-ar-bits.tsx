"use client"

// Receivables list helpers for the e-invoice (spec §9): the state badge on each row, "Send all ready", and the
// "Replaced by / Replaces" links of a corrected invoice.
import { useCallback, useEffect, useState } from "react"
import { Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatMoney } from "@/lib/format"
import type { EtaBadgeKey } from "@/lib/eta/badge"
import { readApiError, reasonText } from "@/components/accounting/eta-preview-dialog"

const TONE: Record<EtaBadgeKey, string> = {
  not_sent: "bg-muted text-muted-foreground",
  waiting: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  sent: "bg-blue-500/15 text-blue-800 dark:text-blue-300",
  valid: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  invalid: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancel_requested: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  cancelled: "bg-muted text-muted-foreground",
  credit_waiting: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  credited: "bg-muted text-muted-foreground",
  credit_invalid: "bg-red-500/15 text-red-700 dark:text-red-300",
  manual: "bg-muted text-muted-foreground",
}

/** The e-invoice state of every invoice on the selected portal; reload() after anything changed. */
export function useEtaBadges(enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, EtaBadgeKey>>({})
  const [environment, setEnvironment] = useState<"test" | "real">("test")
  const reload = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch("/api/eta/statuses")
      if (!res.ok) return
      const body = await res.json()
      setStatuses(body.statuses || {})
      setEnvironment(body.environment === "real" ? "real" : "test")
    } catch {
      /* the badge is a convenience: the list works without it */
    }
  }, [enabled])
  useEffect(() => {
    reload()
  }, [reload])
  return { statuses, environment, reload }
}

export function EtaBadge({ state, environment }: { state: EtaBadgeKey | undefined; environment: "test" | "real" }) {
  const { t } = useI18n()
  const key: EtaBadgeKey = state || "not_sent"
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[key]}`}>
      {t(`eta.badge-${key}`)}
      {environment === "test" && key !== "not_sent" ? ` (${t("eta.test-tag")})` : ""}
    </span>
  )
}

/** "Send all ready": queues the given (not yet sent) invoices; the server refuses the ones that are not ready. */
export function EtaSendAll({ invoiceIds, onDone }: { invoiceIds: number[]; onDone: () => void }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/eta/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: invoiceIds.slice(0, 100) }),
      })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      const body = await res.json()
      const queued = Array.isArray(body.queued) ? body.queued.length : 0
      const refused = Array.isArray(body.refused) ? body.refused : []
      toast({
        title: fill(t("eta.send-all-done"), { queued, skipped: refused.length }),
        description: refused.length ? reasonText(refused[0].reasons?.[0] || "", t) : undefined,
      })
      onDone()
    } catch (e) {
      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" onClick={send} disabled={busy || invoiceIds.length === 0}>
      {busy ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Send className="w-4 h-4 me-2" />}
      {t("eta.send-all")} ({invoiceIds.length})
    </Button>
  )
}

interface LinkInvoice { id: string; invoiceNumber: string; collectedAmount?: number }

/** "Replaced by {number}" / "Replaces {number}" (each opens the other) and the payments waiting for the new invoice. */
export function ReplacementMarks({
  invoice, replacedBy, replaces, replaced, onOpen,
}: {
  invoice: LinkInvoice
  replacedBy: LinkInvoice | null
  replaces: LinkInvoice | null
  replaced: boolean
  onOpen: (invoice: LinkInvoice) => void
}) {
  const { t, language } = useI18n()
  const link = (other: LinkInvoice, label: string) => (
    <button
      type="button"
      className="text-xs font-medium text-primary underline underline-offset-2 text-start"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(other)
      }}
    >
      {fill(t(label), { number: other.invoiceNumber })}
    </button>
  )
  const waiting = replaced && !replacedBy && (invoice.collectedAmount || 0) > 0
  if (!replacedBy && !replaces && !replaced) return null
  return (
    <div className="flex flex-col items-start gap-1">
      {replaced && <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground">{t("eta.replaced")}</span>}
      {replacedBy && link(replacedBy, "eta.replaced-by")}
      {replaces && link(replaces, "eta.replaces")}
      {waiting && <span className="text-xs text-amber-800 dark:text-amber-300">{fill(t("eta.payments-waiting"), { amount: formatMoney(invoice.collectedAmount || 0, language) })}</span>}
    </div>
  )
}
