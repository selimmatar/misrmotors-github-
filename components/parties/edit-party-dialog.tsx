"use client"

// Edit the main details of a customer or a supplier.
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { CustomerTaxIdentities } from "@/components/parties/customer-tax-identities"

export interface PartyDetails {
  name: string
  email: string
  /** customers: the address(es) our invoice e-mails go to (comma-separated allowed) */
  accountantEmail?: string
  /** customers: the purchasing contact our quotations and sales orders are e-mailed to */
  salespersonEmail?: string
  phone: string
  country?: string
  city?: string
  address: string
  leadTimeDays?: number
  // ETA e-invoice (customers: all; suppliers: taxRegistrationNumber only)
  receiverType?: "B" | "P" | "F"
  taxRegistrationNumber?: string
  nationalId?: string
  governorate?: string
  region?: string
  street?: string
  buildingNumber?: string
}

interface EditPartyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "customer" | "supplier"
  initial: PartyDetails
  /** customers: the card's id, for its list of companies on the portal (tax identities) */
  customerId?: string | number
  onSave: (details: PartyDetails) => Promise<string[] | void>
  /** customers: the card's address was filled from the portal (already saved); the screen keeps its copy in step */
  onCardAddress?: (details: PartyDetails) => void
}

export function EditPartyDialog({ open, onOpenChange, kind, initial, customerId, onSave, onCardAddress }: EditPartyDialogProps) {
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
      const warnings = await onSave({ ...form, name: form.name.trim() })
      onOpenChange(false)
      // a tax number that is not 9 / 14 digits is saved as typed; tell the user without blocking
      if (Array.isArray(warnings) && warnings.length > 0) {
        const fields = warnings.map((w) => {
          const key = w.split(":")[0]
          if (key === "accountant_email") return t("customer.accountant-email-not-saved")
          if (key === "salesperson_email") return t("customer.salesperson-email-not-saved")
          return key === "national_id" ? t("eta.national-id-warning") : t("eta.tax-number-warning")
        })
        alert(Array.from(new Set(fields)).join("\n"))
      }
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
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(kind === "customer" ? "party.edit-customer" : "party.edit-supplier")}</DialogTitle>
          <DialogDescription>{initial.name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("name", `${t(kind === "customer" ? "customer.name" : "supplier.name")} *`)}
          {field("email", t("field.email"), "email")}
          {kind === "customer" && (
            <div className="sm:col-span-2 space-y-1">
              {field("accountantEmail", t("customer.accountant-email"))}
              <p className="text-xs text-muted-foreground">{t("customer.accountant-email-hint")}</p>
            </div>
          )}
          {kind === "customer" && (
            <div className="sm:col-span-2 space-y-1">
              {field("salespersonEmail", t("customer.salesperson-email"))}
              <p className="text-xs text-muted-foreground">{t("customer.salesperson-email-hint")}</p>
            </div>
          )}
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
          <div className="sm:col-span-2 border-t pt-3">
            <p className="text-sm font-semibold">{t("eta.tax-section")}</p>
          </div>
          {/* customers: one line per company on the portal (the identities replace the card's single tax fields) */}
          {kind === "customer" ? (
            <div className="sm:col-span-2">
              <CustomerTaxIdentities
                customerId={customerId}
                card={form}
                onCardAddress={(a) => {
                  // the server filled only the card's empty fields; the form does the same so Save keeps them
                  const merged = { ...form }
                  for (const k of ["governorate", "region", "street", "buildingNumber"] as const) if (!String(merged[k] ?? "").trim() && a[k]) merged[k] = a[k]
                  setForm(merged)
                  onCardAddress?.(merged)
                }}
              />
            </div>
          ) : (
            field("taxRegistrationNumber", t("eta.tax-number"))
          )}
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
