"use client"

// "Send back to shipping" on an already REJECTED permit (owner rule, 2026-11-24; e.g. DP-2026-0005, rejected because the
// wrong photo was uploaded): the permit returns to shipping as "re-upload needed". The server refuses an invoiced permit
// and anyone but the accountant, the CEO or an admin (PUT /api/delivery-permits, SEND_BACK_TO_SHIPPING).
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { Loader2, Undo2 } from "lucide-react"

interface Props {
  onSendBack: (reason: string) => Promise<void> | void
  disabled?: boolean
  size?: "sm" | "default"
  initialReason?: string | null
}

export function SendBackToShippingButton({ onSendBack, disabled = false, size = "default", initialReason }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(initialReason || "")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!reason.trim()) {
      alert(t("permit.rejection-reason-required"))
      return
    }
    setBusy(true)
    try {
      await onSendBack(reason.trim())
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)} disabled={disabled || busy}>
        <Undo2 className="h-4 w-4 me-2" />
        {t("permit.send-back-short")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("permit.send-back-title")}</DialogTitle>
            <DialogDescription>{t("permit.send-back-description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>{t("permit.rejection-reason")} *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("permit.send-back-placeholder")} rows={3} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("action.cancel")}
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Undo2 className="h-4 w-4 me-2" />}
              {t("permit.send-back-short")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
