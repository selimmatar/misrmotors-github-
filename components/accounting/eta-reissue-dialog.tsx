"use client"

// "Correct and reissue" (spec §6.5a): explains the steps, starts the correction (the invoice becomes Replaced and its
// order and delivery permits open for correction) and links to the order and the permits. The new invoice is then made
// the usual way, which moves the payments to it.
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { readApiError } from "@/components/accounting/eta-preview-dialog"

const go = (module: string) => window.dispatchEvent(new CustomEvent("navigate-to-module", { detail: module }))

export function EtaReissueDialog({
  invoiceId, invoiceNumber, started, onClose, onStarted,
}: {
  invoiceId: string
  invoiceNumber: string
  /** the correction is already open (the invoice is Replaced and has no new invoice yet) */
  started: boolean
  onClose: () => void
  onStarted: () => void
}) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(started)

  const start = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/eta/reissue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoiceId) }),
      })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      toast({ title: t("eta.reissue-started") })
      setOpen(true)
      onStarted()
    } catch (e) {
      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fill(t("eta.reissue-title"), { number: invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("eta.reissue-help")}</DialogDescription>
        </DialogHeader>
        <ol className="list-decimal ps-5 space-y-2 text-sm">
          <li>{t("eta.reissue-step-1")}</li>
          <li>{t("eta.reissue-step-2")}</li>
          <li>{t("eta.reissue-step-3")}</li>
          <li>{t("eta.reissue-step-4")}</li>
        </ol>
        {open ? (
          <div className="space-y-3">
            <p role="status" className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{t("eta.reissue-open")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { onClose(); go("sales-orders") }}>{t("eta.open-orders")}</Button>
              <Button variant="outline" onClick={() => { onClose(); go("delivery-permits") }}>{t("eta.open-permits")}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={start} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t("eta.reissue-start")}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>{t("eta.cancel")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
