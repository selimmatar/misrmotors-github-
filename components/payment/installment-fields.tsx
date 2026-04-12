"use client"
import { useI18n } from "@/lib/i18n-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Minus, Plus, Calendar } from "lucide-react"
import { PaymentScheduleBuilder, type PaymentScheduleEntry } from "./payment-schedule-builder"

interface InstallmentFieldsProps {
  // New prop names
  months?: number
  monthlyAmount?: number
  totalAmount?: number
  paymentStartDate?: string
  onMonthsChange?: (months: number) => void
  onPaymentStartDateChange?: (date: string) => void
  // Alternative prop names for backward compatibility
  installmentMonths?: number
  onInstallmentMonthsChange?: (months: number) => void
  showScheduleBuilder?: boolean
  scheduleMode?: "AUTO" | "MANUAL"
  scheduleEntries?: PaymentScheduleEntry[]
  onScheduleModeChange?: (mode: "AUTO" | "MANUAL") => void
  onScheduleEntriesChange?: (entries: PaymentScheduleEntry[]) => void
}

export function InstallmentFields({
  months,
  monthlyAmount,
  totalAmount,
  paymentStartDate,
  onMonthsChange,
  onPaymentStartDateChange,
  // Alternative props
  installmentMonths,
  onInstallmentMonthsChange,
  // Schedule builder props
  showScheduleBuilder = false,
  scheduleMode = "AUTO",
  scheduleEntries = [],
  onScheduleModeChange,
  onScheduleEntriesChange,
}: InstallmentFieldsProps) {
  const { t, formatCurrency } = useI18n()

  const actualMonths = months ?? installmentMonths ?? 6
  const handleMonthsChange = onMonthsChange ?? onInstallmentMonthsChange ?? (() => {})
  const actualTotalAmount = totalAmount ?? 0
  const actualMonthlyAmount = monthlyAmount ?? actualTotalAmount / actualMonths

  // Calculate end date based on start date and months
  const getEndDate = () => {
    if (!paymentStartDate) return null
    const start = new Date(paymentStartDate)
    start.setMonth(start.getMonth() + actualMonths - 1)
    return start.toLocaleDateString()
  }

  if (showScheduleBuilder && onScheduleModeChange && onScheduleEntriesChange) {
    return (
      <PaymentScheduleBuilder
        totalAmount={actualTotalAmount}
        paymentStartDate={paymentStartDate}
        installmentMonths={actualMonths}
        scheduleMode={scheduleMode}
        scheduleEntries={scheduleEntries}
        onScheduleModeChange={onScheduleModeChange}
        onEntriesChange={onScheduleEntriesChange}
        onPaymentStartDateChange={onPaymentStartDateChange}
        onInstallmentMonthsChange={handleMonthsChange}
        isHybrid={false}
      />
    )
  }

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardContent className="pt-4 space-y-4">
        <div className="space-y-2">
          <Label>{t("payment.installment-months")}</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => handleMonthsChange(Math.max(1, actualMonths - 1))}
              disabled={actualMonths <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              value={actualMonths}
              onChange={(e) => handleMonthsChange(Math.max(1, Number.parseInt(e.target.value) || 1))}
              className="w-20 text-center"
              min="1"
              max="60"
            />
            <span className="text-sm text-muted-foreground">{t("months")}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => handleMonthsChange(Math.min(60, actualMonths + 1))}
              disabled={actualMonths >= 60}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t("payment.payment-start-date")}
          </Label>
          <Input
            type="date"
            value={paymentStartDate || ""}
            onChange={(e) => onPaymentStartDateChange?.(e.target.value)}
          />
          {paymentStartDate && (
            <p className="text-xs text-muted-foreground">
              {t("payment.payment-end-date")}: {getEndDate()}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 p-3 bg-white rounded-lg border">
          <div>
            <p className="text-xs text-muted-foreground">{t("payment.total-amount")}</p>
            <p className="font-semibold">{formatCurrency(actualTotalAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("payment.monthly-amount")}</p>
            <p className="font-semibold text-blue-600">{formatCurrency(actualMonthlyAmount)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
