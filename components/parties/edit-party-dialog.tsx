"use client"

// Edit the main details of a customer or a supplier.
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

export interface PartyDetails {
  name: string
  email: string
  phone: string
  country?: string
  city?: string
  address: string
  leadTimeDays?: number
}

interface EditPartyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "customer" | "supplier"
  initial: PartyDetails
  onSave: (details: PartyDetails) => Promise<void>
}

export function EditPartyDialog({ open, onOpenChange, kind, initial, onSave }: EditPartyDialogProps) {
  const { t } = useI18n()
  const [form, setForm] = useState<PartyDetails>(initial)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (key: keyof PartyDetails, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert(t("message.fill-required-fields"))
      return
    }
    setSaving(true)
    try {
      await onSave({ ...form, name: form.name.trim() })
      onOpenChange(false)
    } catch (error) {
      alert(fill(t("message.not-saved"), { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof PartyDetails, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`party-${key}`}>{label}</Label>
      <Input
        id={`party-${key}`}
        type={type}
        value={String(form[key] ?? "")}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(kind === "customer" ? "party.edit-customer" : "party.edit-supplier")}</DialogTitle>
          <DialogDescription>{initial.name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("name", `${t(kind === "customer" ? "customer.name" : "supplier.name")} *`)}
          {field("email", t("field.email"), "email")}
          {field("phone", t("field.phone"), "tel")}
          {field("country", t("customer.country"))}
          {field("city", t("customer.city"))}
          {kind === "supplier" && (
            <div className="space-y-1">
              <Label htmlFor="party-leadTimeDays">{t("supplier.lead-time-days")}</Label>
              <Input
                id="party-leadTimeDays"
                type="number"
                min="0"
                value={form.leadTimeDays ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: Number.parseInt(e.target.value) || 0 }))}
              />
            </div>
          )}
          <div className="sm:col-span-2">{field("address", t("customer.address"))}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {t("action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
