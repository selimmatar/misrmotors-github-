"use client"

// "Change invoice number": the accountant types a new internal number for an invoice that is not on the portal yet.
// The server checks every rule (not on the portal, number free, valid shape) and shows its reason here.
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { readApiError } from "@/components/accounting/eta-preview-dialog"

export function RenameInvoiceDialog({
  invoiceId, invoiceNumber, onClose, onChanged,
}: {
  invoiceId: string
  invoiceNumber: string
  onClose: () => void
  onChanged: () => void
}) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [value, setValue] = useState(invoiceNumber)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const next = value.trim()
  const canSave = !busy && next !== "" && next !== invoiceNumber

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/eta/rename-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoiceId), invoiceNumber: next }),
      })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      toast({ title: t("ar.rename-done") })
      onChanged()
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
          <DialogTitle>{fill(t("ar.rename-title"), { number: invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("ar.rename-help")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Label htmlFor="rename-invoice-number">{t("ar.rename-new")}</Label>
          <Input
            id="rename-invoice-number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={50}
            autoFocus
            dir="ltr"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "rename-invoice-error" : undefined}
          />
          {error && (
            <p id="rename-invoice-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("eta.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t("ar.rename-save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
