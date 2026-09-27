"use client"

import { useI18n } from "@/lib/i18n-context"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type DiscountType = "none" | "percentage" | "fixed"

interface DiscountFieldsProps {
  discountType: DiscountType
  discountValue: number
  subtotal: number
  onDiscountTypeChange: (type: DiscountType) => void
  onDiscountValueChange: (value: number) => void
}

export function DiscountFields({
  discountType,
  discountValue,
  subtotal,
  onDiscountTypeChange,
  onDiscountValueChange,
}: DiscountFieldsProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <h4 className="font-medium">{t("pricing.discount")}</h4>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("discount-type")}</Label>
          <Select value={discountType} onValueChange={(v) => onDiscountTypeChange(v as DiscountType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("discount-none")}</SelectItem>
              <SelectItem value="percentage">{t("discount-percentage")}</SelectItem>
              <SelectItem value="fixed">{t("discount-fixed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {discountType !== "none" && (
          <div className="space-y-2">
            <Label>{discountType === "percentage" ? t("discount-percent-value") : t("discount-fixed-value")}</Label>
            <div className="relative">
              <Input
                type="number"
                min="0"
                max={discountType === "percentage" ? 100 : subtotal}
                step={discountType === "percentage" ? 1 : 0.01}
                value={discountValue || ""}
                onChange={(e) => onDiscountValueChange(Number(e.target.value))}
                className={discountType === "percentage" ? "pr-8" : ""}
              />
              {discountType === "percentage" && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper function to calculate discount
export function calculateDiscount(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
): { discountAmount: number; netTotal: number } {
  if (discountType === "none" || !discountValue) {
    return { discountAmount: 0, netTotal: subtotal }
  }

  const discountAmount =
    discountType === "percentage" ? (subtotal * discountValue) / 100 : Math.min(discountValue, subtotal)

  return {
    discountAmount,
    netTotal: subtotal - discountAmount,
  }
}
