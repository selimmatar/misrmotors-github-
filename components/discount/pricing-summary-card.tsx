"use client"

import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Receipt } from "lucide-react"
import type { DiscountType } from "./discount-fields"

interface PricingSummaryCardProps {
  subtotal: number
  discountType: DiscountType
  discountValue: number
  discountAmount?: number
  netTotal?: number
  vatEnabled?: boolean
  vatRate?: number
}

export function PricingSummaryCard({
  subtotal,
  discountType,
  discountValue,
  discountAmount,
  netTotal,
  vatEnabled = true,
  vatRate = 0.14, // 14% VAT default for Egypt
}: PricingSummaryCardProps) {
  const { t, formatCurrency, formatNumber } = useI18n()

  const calculatedDiscountAmount =
    discountAmount ??
    (discountType === "percentage" ? (subtotal * discountValue) / 100 : discountType === "fixed" ? discountValue : 0)

  const subtotalAfterDiscount = subtotal - calculatedDiscountAmount
  const vatAmount = vatEnabled ? subtotalAfterDiscount * vatRate : 0
  const calculatedNetTotal = netTotal ?? (subtotalAfterDiscount + vatAmount)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />
          {t("pricing-summary")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("subtotal")}</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>

        {discountType !== "none" && calculatedDiscountAmount > 0 && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("discount-type")}</span>
              <span>
                {discountType === "percentage"
                  ? `${t("discount-percentage")} (${formatNumber(discountValue)}%)`
                  : t("discount-fixed")}
              </span>
            </div>
            <div className="flex justify-between text-sm text-red-700">
              <span>{t("discount-amount")}</span>
              <span>- {formatCurrency(calculatedDiscountAmount)}</span>
            </div>
          </>
        )}

        {vatEnabled && vatAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{fill(t("discount.vat-rate"), { rate: formatNumber(vatRate * 100) })}</span>
            <span>+ {formatCurrency(vatAmount)}</span>
          </div>
        )}

        <div className="flex justify-between font-semibold border-t pt-3">
          <span>{t("net-total")}</span>
          <span className="text-lg">{formatCurrency(calculatedNetTotal)}</span>
        </div>
      </CardContent>
    </Card>
  )
}
