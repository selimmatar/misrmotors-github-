"use client"

// "Cancel invoice" for a maintenance (MINV) invoice: asks why, then frees its number so the same booklet page can be
// uploaded again. The server checks every rule (no payments, not on the tax portal) and shows its reason here.
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { readApiError } from "@/components/accounting/eta-preview-dialog"

export function CancelMinvDialog({
  invoiceId, invoiceNumber, onClose, onCancelled,
}: {
  invoiceId: string
  invoiceNumber: string
  onClose: () => void
  onCancelled: () => void
}) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const canSave = !busy && reason.trim() !== ""

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/invoices/ar/${invoiceId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      toast({ title: fill(t("ar.cancel-done"), { number: invoiceNumber }) })
      onCancelled()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{fill(t("ar.cancel-title"), { number: invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("ar.cancel-help")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Label htmlFor="cancel-invoice-reason">{t("ar.cancel-reason")}</Label>
          <Textarea
            id="cancel-invoice-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={3}
            autoFocus
            className="text-base"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "cancel-invoice-error" : undefined}
          />
          {error && (
            <p id="cancel-invoice-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={busy}>
              {t("ar.cancel-keep")}
            </Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={!canSave}>
              {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t("ar.cancel-confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
