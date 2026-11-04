"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"

// A supplier invoice is created automatically when its purchase order is approved (APINV-<PO number>). This dialog
// replaces that number with the one on the supplier's own invoice (owner, 2026-11-04). The server refuses a number
// that is already used and keeps the old one (PUT /api/accounts-payable, lib/doc-number.ts).
export function ChangeInvoiceNumberDialog({
  invoice,
  onOpenChange,
  onSaved,
}: {
  invoice: { id: string | number; invoiceNumber: string } | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(invoice?.invoiceNumber || "")
    setError(null)
  }, [invoice])

  const save = async () => {
    if (!invoice || saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/accounts-payable", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoice.id, invoiceNumber: value }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || t("error"))
        return
      }
      await onSaved()
      onOpenChange(false)
    } catch {
      setError(t("error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={invoice !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("docNumber.change")}</DialogTitle>
          <DialogDescription dir="ltr">{invoice?.invoiceNumber}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="ap-new-invoice-number">{t("docNumber.new")}</Label>
          <Input
            id="ap-new-invoice-number"
            value={value}
            maxLength={50}
            dir="ltr"
            autoComplete="off"
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("button.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !value.trim() || value.trim() === invoice?.invoiceNumber}>
            {t("docNumber.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
