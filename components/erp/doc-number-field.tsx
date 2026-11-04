"use client"

import { useI18n } from "@/lib/i18n-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// "Number (optional)" on every create form (owner, 2026-11-04): left empty, the system gives the next automatic
// number; typed, the document is saved under exactly that number (the server refuses a number that is already used,
// see lib/doc-number.ts). Sent to the API as `manualNumber`.
export function DocNumberField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("docNumber.label")}</Label>
      <Input
        id={id}
        value={value}
        maxLength={50}
        disabled={disabled}
        autoComplete="off"
        dir="ltr"
        placeholder={t("docNumber.placeholder")}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t("docNumber.hint")}</p>
    </div>
  )
}

/** The value to send: `undefined` when empty, so the server picks the automatic number. */
export const manualNumberValue = (value: string) => (value.trim() ? value.trim() : undefined)
