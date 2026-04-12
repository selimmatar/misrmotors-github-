"use client"

import { useI18n } from "@/lib/i18n-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { PaymentType } from "@/lib/types"

interface PaymentTypeSelectorProps {
  value: PaymentType
  onChange: (value: PaymentType) => void
  disabled?: boolean
}

export function PaymentTypeSelector({ value, onChange, disabled }: PaymentTypeSelectorProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-2">
      <Label>{t("payment.type")}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PaymentType)} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={t("payment.select-type")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cash">{t("payment.cash")}</SelectItem>
          <SelectItem value="installments">{t("payment.installments")}</SelectItem>
          <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
          <SelectItem value="hybrid">{t("payment.hybrid")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
