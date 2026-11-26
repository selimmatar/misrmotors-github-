"use client"

// Receivables list helpers for the e-invoice (spec §9): the state badge on each row, "Send all ready", and the
// "Replaced by / Replaces" links of a corrected invoice.
import { useCallback, useEffect, useState } from "react"
import { Loader2, Mail, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatMoney } from "@/lib/format"
import type { EtaBadgeKey } from "@/lib/eta/badge"
import { readApiError, reasonText } from "@/components/accounting/eta-preview-dialog"
import { usePortalPin } from "@/components/accounting/portal-pin"

const TONE: Record<EtaBadgeKey, string> = {
  not_sent: "bg-muted text-muted-foreground",
  waiting: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  sent: "bg-blue-500/15 text-blue-800 dark:text-blue-300",
  valid: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  invalid: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancel_requested: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  cancelled: "bg-muted text-muted-foreground",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  credit_waiting: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  credited: "bg-muted text-muted-foreground",
  credit_invalid: "bg-red-500/15 text-red-700 dark:text-red-300",
  manual: "bg-muted text-muted-foreground",
}

/** The e-invoice state of every invoice on the selected portal; reload() after anything changed. */
export function useEtaBadges(enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, EtaBadgeKey>>({})
  const [environment, setEnvironment] = useState<"test" | "real">("test")
  const [emailed, setEmailed] = useState<Set<string>>(new Set())
  const reload = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch("/api/eta/statuses")
      if (!res.ok) return
      const body = await res.json()
      setStatuses(body.statuses || {})
      setEmailed(new Set((Array.isArray(body.emailed) ? body.emailed : []).map(String)))
      setEnvironment(body.environment === "real" ? "real" : "test")
    } catch {
      /* the badge is a convenience: the list works without it */
    }
  }, [enabled])
  useEffect(() => {
    reload()
  }, [reload])
  return { statuses, environment, emailed, reload }
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

/** The refusal reason "Send all ready" shows: one that asks to press Send again comes first. */
export function sendAllReason(refused: { reasons?: string[] }[]): string {
  const all = refused.map((r) => r.reasons?.[0] || "")
  return all.find((r) => r === "portal_check_later") || all.find((r) => r === "portal_check_failed") || all[0] || ""
}

/** "Sent to customer": the e-invoice of this row was e-mailed to the customer. */
export function EmailedBadge() {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
      <Mail className="w-3 h-3" aria-hidden="true" />
      {t("eta.emailed-badge")}
    </span>
  )
}

/** "Send by e-mail" from the invoice's ⋯ menu: e-mails the valid e-invoice to the customer now (logged as manual). */
export function useSendInvoiceEmail(onDone: () => void) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  return useCallback(
    async (invoiceId: string | number) => {
      toast({ title: t("eta.email-sending") })
      try {
        const res = await fetch("/api/eta/invoice-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: Number(invoiceId) }) })
        if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
        toast({ title: t("eta.email-sent-now") })
      } catch (e) {
        toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
      } finally {
        onDone()
      }
    },
    [t, language, toast, onDone],
  )
}

/** "Send all ready": queues the given (not yet sent) invoices; the server refuses the ones that are not ready. */
export function EtaSendAll({ invoiceIds, onDone }: { invoiceIds: number[]; onDone: () => void }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const portalPin = usePortalPin()
  const send = async () => {
    const pin = await portalPin.ask()
    if (pin === null) return
    setBusy(true)
    try {
      const res = await fetch("/api/eta/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: invoiceIds.slice(0, 100), pin }),
      })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      const body = await res.json()
      const queued = Array.isArray(body.queued) ? body.queued.length : 0
      const refused = Array.isArray(body.refused) ? body.refused : []
      toast({
        title: fill(t("eta.send-all-done"), { queued, skipped: refused.length }),
        // "checking the portal, press Send again" first: it tells what to do next
        description: refused.length ? reasonText(sendAllReason(refused), t) : undefined,
      })
      onDone()
    } catch (e) {
      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="outline" onClick={send} disabled={busy || invoiceIds.length === 0}>
        {busy ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Send className="w-4 h-4 me-2" />}
        {t("eta.send-all")} ({invoiceIds.length})
      </Button>
      {portalPin.dialog}
    </>
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
