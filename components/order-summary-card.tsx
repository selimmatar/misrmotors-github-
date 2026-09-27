"use client"

import { useI18n } from "@/lib/i18n-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Receipt, Banknote, Landmark, CreditCard, FileText, Layers } from "lucide-react"
import type { DiscountType } from "@/components/discount"
import type { PaymentType, PaymentDetails } from "@/lib/types"

interface OrderSummaryCardProps {
  // Pricing
  subtotal: number
  discountType: DiscountType
  discountValue: number
  discountAmount?: number
  netTotal?: number
  vatEnabled?: boolean
  vatRate?: number
  // Payment
  paymentType: PaymentType
  paymentDetails?: PaymentDetails
  currency?: string
}

export function OrderSummaryCard({
  subtotal,
  discountType,
  discountValue,
  discountAmount,
  netTotal,
  vatEnabled = true,
  vatRate = 0.14,
  paymentType,
  paymentDetails,
  currency = "EGP",
}: OrderSummaryCardProps) {
  const { t, formatCurrency, formatNumber, formatDate } = useI18n()

  const calculatedDiscountAmount =
    discountAmount ??
    (discountType === "percentage" ? (subtotal * discountValue) / 100 : discountType === "fixed" ? discountValue : 0)

  const subtotalAfterDiscount = subtotal - calculatedDiscountAmount
  const vatAmount = vatEnabled ? subtotalAfterDiscount * vatRate : 0
  const calculatedNetTotal = netTotal ?? (subtotalAfterDiscount + vatAmount)

  const getPaymentIcon = () => {
    switch (paymentType) {
      case "cash":
        return <Banknote className="w-4 h-4" />
      case "bank_transfer":
        return <Landmark className="w-4 h-4" />
      case "installments":
        return <CreditCard className="w-4 h-4" />
      case "cheque":
        return <FileText className="w-4 h-4" />
      case "hybrid":
        return <Layers className="w-4 h-4" />
      default:
        return <Banknote className="w-4 h-4" />
    }
  }

  const getPaymentBadgeColor = () => {
    switch (paymentType) {
      case "cash":
        return "bg-green-100 text-green-800"
      case "bank_transfer":
        return "bg-teal-100 text-teal-800"
      case "installments":
        return "bg-blue-100 text-blue-800"
      case "cheque":
        return "bg-amber-100 text-amber-800"
      case "hybrid":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />
          {t("order-summary")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Pricing breakdown */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("pricing.subtotal")}</span>
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
            <div className="flex justify-between text-sm text-red-600">
              <span>{t("discount-amount")}</span>
              <span>- {formatCurrency(calculatedDiscountAmount)}</span>
            </div>
          </>
        )}

        {vatEnabled && vatAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">VAT ({formatNumber(vatRate * 100)}%)</span>
            <span>+ {formatCurrency(vatAmount)}</span>
          </div>
        )}

        <div className="flex justify-between font-semibold border-t pt-3">
          <span>{t("pricing.net-total")}</span>
          <span className="text-lg">{formatCurrency(calculatedNetTotal, currency)}</span>
        </div>

        {/* Payment breakdown - total is already shown above as Net Total, so it isn't repeated here */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            {getPaymentIcon()}
            {t("payment.type")}
          </span>
          <Badge className={getPaymentBadgeColor()}>{t(`payment.${paymentType}`)}</Badge>
        </div>

        {paymentType === "cash" && (
          <div className="p-2 bg-green-50 rounded text-sm text-green-700">{t("payment.cash-full-payment")}</div>
        )}

        {paymentType === "bank_transfer" && (
          <div className="p-2 bg-teal-50 rounded text-sm text-teal-700">{t("payment.bank-transfer-full-payment")}</div>
        )}

        {paymentType === "installments" && paymentDetails && (
          <div className="space-y-2 p-2 bg-blue-50 rounded">
            <div className="flex justify-between text-sm">
              <span>{t("payment.installment-months")}</span>
              <span className="font-medium">
                {paymentDetails.installmentMonths} {t("months")}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t("payment.monthly-amount")}</span>
              <span className="font-medium text-blue-600">
                {formatCurrency(paymentDetails.monthlyAmount, currency)}
              </span>
            </div>
          </div>
        )}

        {paymentType === "cheque" && paymentDetails && (
          <div className="space-y-2 p-2 bg-amber-50 rounded">
            <div className="flex justify-between text-sm">
              <span>{t("payment.cheque-number")}</span>
              <span className="font-medium">{paymentDetails.chequeNumber || "-"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t("payment.bank-name")}</span>
              <span className="font-medium">{paymentDetails.chequeBankName || "-"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t("payment.cheque-due-date")}</span>
              <span className="font-medium">
                {paymentDetails.chequeDueDate ? formatDate(paymentDetails.chequeDueDate) : "-"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t("payment.cheque-amount")}</span>
              <span className="font-medium text-amber-600">
                {formatCurrency(paymentDetails.chequeAmount || calculatedNetTotal, currency)}
              </span>
            </div>
            {paymentDetails.chequeNotes && (
              <div className="text-xs text-muted-foreground border-t pt-2 mt-2">{paymentDetails.chequeNotes}</div>
            )}
          </div>
        )}

        {paymentType === "hybrid" && paymentDetails && (
          <div className="space-y-3">
            <div className="p-2 bg-green-50 rounded space-y-2">
              <p className="text-xs font-medium text-green-800">{t("payment.down-payment")}</p>
              <div className="flex justify-between text-sm">
                <span>{t("payment.method")}</span>
                <Badge variant="outline" className="text-xs">
                  {t(`payment.${paymentDetails.downPaymentType || "cash"}`)}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t("amount")}</span>
                <span className="font-medium text-green-600">
                  {formatCurrency(paymentDetails.downPaymentAmount, currency)}({paymentDetails.downPaymentPercent}%)
                </span>
              </div>
              {paymentDetails.downPaymentType === "cheque" && (
                <>
                  <div className="flex justify-between text-sm">
                    <span>{t("payment.cheque-number")}</span>
                    <span>{paymentDetails.downPaymentChequeNumber || "-"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>{t("payment.bank-name")}</span>
                    <span>{paymentDetails.downPaymentChequeBank || "-"}</span>
                  </div>
                </>
              )}
            </div>

            <div className="p-2 bg-blue-50 rounded space-y-2">
              <p className="text-xs font-medium text-blue-800">{t("payment.remaining-installments")}</p>
              <div className="flex justify-between text-sm">
                <span>{t("payment.remaining-amount")}</span>
                <span className="font-medium text-orange-600">
                  {formatCurrency(paymentDetails.remainingAmount, currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t("payment.installment-months")}</span>
                <span>
                  {paymentDetails.remainingInstallmentMonths} {t("months")}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t("payment.monthly-amount")}</span>
                <span className="font-medium text-blue-600">
                  {formatCurrency(paymentDetails.monthlyAmount, currency)}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
