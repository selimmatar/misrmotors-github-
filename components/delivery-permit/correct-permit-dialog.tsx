"use client"

// "Correct delivery permit" (spec §6.5a): shown on an approved permit whose invoice is open for correction. Each line's
// quantity can be changed (never below what was returned); stock moves by the difference.
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import type { DeliveryPermit } from "@/lib/types"

export function CorrectPermitDialog({ permit, onClose, onDone }: { permit: DeliveryPermit; onClose: () => void; onDone: () => void }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const items = (permit.items || []).filter((i) => i.id)
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id as string, String(i.quantity)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    setError("")
    const lines = items.map((i) => ({ permitItemId: Number(i.id), quantity: Number(quantities[i.id as string]) }))
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity < 0)) return setError(t("eta.permit-bad-quantity"))
    setBusy(true)
    try {
      const res = await fetch("/api/delivery-permits/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permitId: Number(permit.id), lines }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const message = language === "ar" && body?.errorAr ? body.errorAr : body?.error
        return setError(typeof message === "string" && message ? message : t("message.error"))
      }
      toast({ title: t("eta.permit-corrected") })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("message.error"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fill(t("eta.permit-title"), { number: permit.permitNo })}</DialogTitle>
          <DialogDescription>{fill(t("eta.permit-help"), { invoice: permit.openCorrection?.invoiceNumber || "" })}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border p-3 space-y-1">
              <Label htmlFor={`eta-permit-qty-${item.id}`} className="break-words">{item.itemNameSnapshot}</Label>
              <Input
                id={`eta-permit-qty-${item.id}`}
                type="number"
                inputMode="decimal"
                min={item.returnedQuantity || 0}
                step="any"
                dir="ltr"
                value={quantities[item.id as string] ?? ""}
                onChange={(e) => setQuantities((q) => ({ ...q, [item.id as string]: e.target.value }))}
              />
              {(item.returnedQuantity || 0) > 0 && (
                <p className="text-xs text-muted-foreground">{fill(t("eta.permit-returned"), { n: item.returnedQuantity || 0 })}</p>
              )}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} disabled={busy || items.length === 0}>
            {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t("eta.permit-save")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("eta.cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
