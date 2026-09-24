"use client"

import { useI18n } from "@/lib/i18n-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CreditCard, Banknote, FileText, Layers, Landmark } from "lucide-react"
import type { PaymentType, PaymentDetails } from "@/lib/types"

interface PaymentSummaryCardProps {
  paymentType: PaymentType
  totalAmount: number
  paymentDetails?: PaymentDetails
  currency?: string
}

export function PaymentSummaryCard({
  paymentType,
  totalAmount,
  paymentDetails,
  currency = "EGP",
}: PaymentSummaryCardProps) {
  const { t, formatCurrency, formatDate } = useI18n()

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
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {getPaymentIcon()}
          {t("payment.summary")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("payment.type")}</span>
          <Badge className={getPaymentBadgeColor()}>{t(`payment.${paymentType}`)}</Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("payment.total-amount")}</span>
          <span className="font-semibold">{formatCurrency(totalAmount, currency)}</span>
        </div>

        {/* Cash - Simple display */}
        {paymentType === "cash" && (
          <div className="p-2 bg-green-50 rounded text-sm text-green-700">{t("payment.cash-full-payment")}</div>
        )}

        {/* Bank Transfer - Simple display */}
        {paymentType === "bank_transfer" && (
          <div className="p-2 bg-teal-50 rounded text-sm text-teal-700">{t("payment.bank-transfer-full-payment")}</div>
        )}

        {/* Installments */}
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

        {/* Cheque */}
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
                {formatCurrency(paymentDetails.chequeAmount || totalAmount, currency)}
              </span>
            </div>
            {paymentDetails.chequeNotes && (
              <div className="text-xs text-muted-foreground border-t pt-2 mt-2">{paymentDetails.chequeNotes}</div>
            )}
          </div>
        )}

        {/* Hybrid */}
        {paymentType === "hybrid" && paymentDetails && (
          <div className="space-y-3">
            {/* Down Payment */}
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

            {/* Remaining Installments */}
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
