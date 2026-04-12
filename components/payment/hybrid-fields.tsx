"use client"

import { useI18n } from "@/lib/i18n-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChequeFields } from "./cheque-fields"
import { Button } from "@/components/ui/button"
import { Minus, Plus, Calendar } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import type { DownPaymentType } from "@/lib/types"
import { PaymentScheduleBuilder, type PaymentScheduleEntry } from "./payment-schedule-builder"

interface HybridFieldsProps {
  totalAmount: number
  downPaymentType: DownPaymentType
  downPaymentAmount: number
  downPaymentPercent: number
  remainingAmount?: number
  remainingInstallmentMonths: number
  monthlyAmount?: number
  paymentStartDate?: string
  downPaymentDueDate?: string
  // Cheque fields for down payment
  downPaymentChequeNumber?: string
  downPaymentChequeBank?: string
  downPaymentChequeDueDate?: string
  onChange?: (field: string, value: string | number) => void
  // Individual change handlers (alternative pattern)
  onDownPaymentTypeChange?: (value: DownPaymentType) => void
  onDownPaymentAmountChange?: (value: number) => void
  onDownPaymentPercentChange?: (value: number) => void
  onRemainingInstallmentMonthsChange?: (value: number) => void
  onPaymentStartDateChange?: (value: string) => void
  onDownPaymentDueDateChange?: (value: string) => void
  onDownPaymentChequeNumberChange?: (value: string) => void
  onDownPaymentChequeBankChange?: (value: string) => void
  onDownPaymentChequeDueDateChange?: (value: string) => void
  showScheduleBuilder?: boolean
  scheduleMode?: "AUTO" | "MANUAL"
  scheduleEntries?: PaymentScheduleEntry[]
  onScheduleModeChange?: (mode: "AUTO" | "MANUAL") => void
  onScheduleEntriesChange?: (entries: PaymentScheduleEntry[]) => void
}

export function HybridFields({
  totalAmount,
  downPaymentType,
  downPaymentAmount,
  downPaymentPercent,
  remainingAmount: remainingAmountProp,
  remainingInstallmentMonths,
  monthlyAmount: monthlyAmountProp,
  paymentStartDate = "",
  downPaymentDueDate = "",
  downPaymentChequeNumber = "",
  downPaymentChequeBank = "",
  downPaymentChequeDueDate = "",
  onChange,
  onDownPaymentTypeChange,
  onDownPaymentAmountChange,
  onDownPaymentPercentChange,
  onRemainingInstallmentMonthsChange,
  onPaymentStartDateChange,
  onDownPaymentDueDateChange,
  onDownPaymentChequeNumberChange,
  onDownPaymentChequeBankChange,
  onDownPaymentChequeDueDateChange,
  showScheduleBuilder = false,
  scheduleMode = "AUTO",
  scheduleEntries = [],
  onScheduleModeChange,
  onScheduleEntriesChange,
}: HybridFieldsProps) {
  const { t, formatCurrency } = useI18n()

  const [amountInput, setAmountInput] = useState(downPaymentAmount > 0 ? downPaymentAmount.toString() : "")
  const [percentInput, setPercentInput] = useState(downPaymentPercent > 0 ? downPaymentPercent.toString() : "")
  const [dateInput, setDateInput] = useState("")
  const [downPaymentDateInput, setDownPaymentDateInput] = useState(downPaymentDueDate)

  const effectiveDownPaymentAmount = amountInput ? Number.parseFloat(amountInput) || 0 : 0
  const effectiveRemainingAmount = totalAmount - effectiveDownPaymentAmount
  const effectiveMonthlyAmount =
    remainingInstallmentMonths > 0 ? effectiveRemainingAmount / remainingInstallmentMonths : 0

  const defaultStartDate = useMemo(() => {
    const today = new Date()
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    return nextMonth.toISOString().split("T")[0]
  }, [])

  const defaultDownPaymentDate = useMemo(() => {
    return new Date().toISOString().split("T")[0]
  }, [])

  useEffect(() => {
    const initialDate = paymentStartDate || defaultStartDate
    setDateInput(initialDate)
    if (!paymentStartDate && (onChange || onPaymentStartDateChange)) {
      handleChange("paymentStartDate", initialDate)
    }
  }, [])

  useEffect(() => {
    if (paymentStartDate) {
      setDateInput(paymentStartDate)
    }
  }, [paymentStartDate])

  useEffect(() => {
    if (downPaymentDueDate) {
      setDownPaymentDateInput(downPaymentDueDate)
    }
  }, [downPaymentDueDate])

  const handleChange = (field: string, value: string | number) => {
    if (onChange) {
      onChange(field, value)
    } else {
      switch (field) {
        case "downPaymentType":
          onDownPaymentTypeChange?.(value as DownPaymentType)
          break
        case "downPaymentAmount":
          onDownPaymentAmountChange?.(value as number)
          break
        case "downPaymentPercent":
          onDownPaymentPercentChange?.(value as number)
          break
        case "remainingInstallmentMonths":
          onRemainingInstallmentMonthsChange?.(value as number)
          break
        case "paymentStartDate":
          onPaymentStartDateChange?.(value as string)
          break
        case "downPaymentDueDate":
          onDownPaymentDueDateChange?.(value as string)
          break
        case "downPaymentChequeNumber":
          onDownPaymentChequeNumberChange?.(value as string)
          break
        case "downPaymentChequeBank":
          onDownPaymentChequeBankChange?.(value as string)
          break
        case "downPaymentChequeDueDate":
          onDownPaymentChequeDueDateChange?.(value as string)
          break
      }
    }
  }

  const handleAmountChange = (amount: number) => {
    const percent = totalAmount > 0 ? (amount / totalAmount) * 100 : 0
    const remaining = totalAmount - amount
    const monthly = remainingInstallmentMonths > 0 ? remaining / remainingInstallmentMonths : 0

    setAmountInput(amount.toString())
    setPercentInput((Math.round(percent * 100) / 100).toString())

    // Only send the primary field (amount) - don't send percent to avoid re-calculation loop
    handleChange("downPaymentAmount", amount)
    handleChange("remainingAmount", remaining)
    handleChange("monthlyAmount", Math.round(monthly * 100) / 100)
  }

  const handlePercentChange = (percent: number) => {
    const amount = (percent / 100) * totalAmount
    const remaining = totalAmount - amount
    const monthly = remainingInstallmentMonths > 0 ? remaining / remainingInstallmentMonths : 0

    setPercentInput(percent.toString())
    setAmountInput((Math.round(amount * 100) / 100).toString())

    // Only send the primary field (percent) - don't send amount to avoid re-calculation loop
    handleChange("downPaymentPercent", percent)
    handleChange("remainingAmount", remaining)
    handleChange("monthlyAmount", Math.round(monthly * 100) / 100)
  }

  const handleMonthsChange = (months: number) => {
    const remaining = totalAmount - downPaymentAmount
    const monthly = months > 0 ? remaining / months : 0
    handleChange("remainingInstallmentMonths", months)
    handleChange("monthlyAmount", Math.round(monthly * 100) / 100)
  }

  const handleAmountInputChange = (inputValue: string) => {
    const cleanValue = inputValue.replace(/[^0-9.]/g, "")
    setAmountInput(cleanValue)

    const num = Number.parseFloat(cleanValue)
    if (!isNaN(num)) {
      handleAmountChange(num)
    } else if (cleanValue === "" || cleanValue === "0") {
      handleAmountChange(0)
    }
  }

  const handlePercentInputChange = (inputValue: string) => {
    const cleanValue = inputValue.replace(/[^0-9.]/g, "")
    setPercentInput(cleanValue)

    let num = Number.parseFloat(cleanValue)
    if (!isNaN(num)) {
      if (num > 100) num = 100
      handlePercentChange(num)
    } else if (cleanValue === "" || cleanValue === "0") {
      handlePercentChange(0)
    }
  }

  const handleDateInputChange = (value: string) => {
    setDateInput(value)
    handleChange("paymentStartDate", value)
  }

  const handleDownPaymentDueDateChange = (value: string) => {
    setDownPaymentDateInput(value)
    handleChange("downPaymentDueDate", value)
  }

  const getEndDate = () => {
    if (!dateInput) return null
    const start = new Date(dateInput)
    start.setMonth(start.getMonth() + remainingInstallmentMonths - 1)
    return start.toLocaleDateString()
  }

  const getPaymentSchedule = () => {
    if (!dateInput || remainingInstallmentMonths <= 0) return []
    const schedule = []
    const start = new Date(dateInput)
    for (let i = 0; i < Math.min(remainingInstallmentMonths, 6); i++) {
      const paymentDate = new Date(start.getFullYear(), start.getMonth() + i, start.getDate())
      schedule.push(paymentDate.toLocaleDateString())
    }
    return schedule
  }

  return (
    <Card className="border-purple-200 bg-purple-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("payment.hybrid-payment")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Down Payment Section */}
        <div className="space-y-3 p-3 bg-white rounded-lg border">
          <h4 className="font-medium text-sm">{t("payment.down-payment")}</h4>

          <div className="space-y-2">
            <Label>{t("payment.down-payment-method")}</Label>
            <Select value={downPaymentType} onValueChange={(v) => handleChange("downPaymentType", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t("payment.cash")}</SelectItem>
                <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("payment.down-payment-amount")}</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => handleAmountInputChange(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("payment.down-payment-percent")}</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={percentInput}
                  onChange={(e) => handlePercentInputChange(e.target.value)}
                  placeholder="0"
                />
                <span className="flex items-center text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          {!showScheduleBuilder && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("payment.down-payment-due-date") || "Down Payment Due Date"}
              </Label>
              <Input
                type="date"
                value={downPaymentDateInput || defaultDownPaymentDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => handleDownPaymentDueDateChange(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Cheque Fields for Down Payment */}
        {downPaymentType === "cheque" && (
          <ChequeFields
            chequeNumber={downPaymentChequeNumber}
            bankName={downPaymentChequeBank}
            dueDate={downPaymentChequeDueDate}
            amount={downPaymentAmount}
            totalAmount={downPaymentAmount}
            onChange={(field, value) => {
              if (field === "chequeNumber") handleChange("downPaymentChequeNumber", value)
              else if (field === "bankName") handleChange("downPaymentChequeBank", value)
              else if (field === "dueDate") handleChange("downPaymentChequeDueDate", value)
            }}
            prefix="downPayment"
          />
        )}

        {showScheduleBuilder && onScheduleModeChange && onScheduleEntriesChange ? (
          <PaymentScheduleBuilder
            totalAmount={totalAmount}
            downPaymentAmount={effectiveDownPaymentAmount}
            downPaymentDueDate={downPaymentDateInput || defaultDownPaymentDate}
            paymentStartDate={dateInput}
            installmentMonths={remainingInstallmentMonths}
            scheduleMode={scheduleMode}
            scheduleEntries={scheduleEntries}
            onScheduleModeChange={onScheduleModeChange}
            onEntriesChange={onScheduleEntriesChange}
            onPaymentStartDateChange={handleDateInputChange}
            onInstallmentMonthsChange={handleMonthsChange}
            onDownPaymentDueDateChange={handleDownPaymentDueDateChange}
            isHybrid={true}
          />
        ) : (
          <>
            {/* Remaining Installments Section (Legacy) */}
            <div className="space-y-3 p-3 bg-white rounded-lg border">
              <h4 className="font-medium text-sm">{t("payment.remaining-installments")}</h4>

              <div className="space-y-2">
                <Label>{t("payment.installment-months")}</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleMonthsChange(Math.max(1, remainingInstallmentMonths - 1))}
                    disabled={remainingInstallmentMonths <= 1}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    value={remainingInstallmentMonths}
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
                    onClick={() => handleMonthsChange(Math.min(60, remainingInstallmentMonths + 1))}
                    disabled={remainingInstallmentMonths >= 60}
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
                  value={dateInput}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => handleDateInputChange(e.target.value)}
                />
                {dateInput && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("payment.payment-end-date")}: {getEndDate()}
                    </p>
                    {remainingInstallmentMonths > 0 && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">{t("payment.schedule-preview")}:</span>{" "}
                        {getPaymentSchedule().join(", ")}
                        {remainingInstallmentMonths > 6 && "..."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-white rounded-lg border">
              <div>
                <p className="text-xs text-muted-foreground">{t("payment.down-payment")}</p>
                <p className="font-semibold text-green-600">{formatCurrency(effectiveDownPaymentAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("payment.remaining-amount")}</p>
                <p className="font-semibold text-orange-600">{formatCurrency(effectiveRemainingAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("payment.monthly-amount")}</p>
                <p className="font-semibold text-blue-600">{formatCurrency(effectiveMonthlyAmount)}</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
