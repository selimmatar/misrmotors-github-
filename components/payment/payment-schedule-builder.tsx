"use client"

import { useEffect, useMemo, useState } from "react"
import { useI18n } from "@/lib/i18n-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Trash2, Plus, Calendar, AlertCircle, CheckCircle2 } from "lucide-react"

export interface PaymentScheduleEntry {
  id: string
  dueDate: string
  amount: number
  note?: string
  isDownPayment?: boolean
}

interface PaymentScheduleBuilderProps {
  totalAmount: number
  downPaymentAmount?: number
  downPaymentDueDate?: string
  paymentStartDate?: string
  installmentMonths?: number
  scheduleMode: "AUTO" | "MANUAL"
  scheduleEntries: PaymentScheduleEntry[]
  onScheduleModeChange: (mode: "AUTO" | "MANUAL") => void
  onEntriesChange: (entries: PaymentScheduleEntry[]) => void
  onPaymentStartDateChange?: (date: string) => void
  onInstallmentMonthsChange?: (months: number) => void
  onDownPaymentDueDateChange?: (date: string) => void
  isHybrid?: boolean
}

export function PaymentScheduleBuilder({
  totalAmount,
  downPaymentAmount = 0,
  downPaymentDueDate = "",
  paymentStartDate = "",
  installmentMonths = 6,
  scheduleMode,
  scheduleEntries,
  onScheduleModeChange,
  onEntriesChange,
  onPaymentStartDateChange,
  onInstallmentMonthsChange,
  onDownPaymentDueDateChange,
  isHybrid = false,
}: PaymentScheduleBuilderProps) {
  const { t, formatCurrency } = useI18n()

  const [localDownPaymentDate, setLocalDownPaymentDate] = useState(downPaymentDueDate)

  // Sync local state with prop
  useEffect(() => {
    if (downPaymentDueDate !== localDownPaymentDate) {
      setLocalDownPaymentDate(downPaymentDueDate)
    }
  }, [downPaymentDueDate])

  // Calculate amounts - include down payment in total scheduled for hybrid
  const payableAmount = isHybrid ? totalAmount - downPaymentAmount : totalAmount
  const installmentTotal = scheduleEntries.filter((e) => !e.isDownPayment).reduce((sum, entry) => sum + entry.amount, 0)
  const totalScheduled = installmentTotal
  const difference = payableAmount - totalScheduled
  const isValid = Math.abs(difference) < 0.01

  // Default dates
  const defaultStartDate = useMemo(() => {
    const today = new Date()
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    return nextMonth.toISOString().split("T")[0]
  }, [])

  const defaultDownPaymentDate = useMemo(() => {
    return new Date().toISOString().split("T")[0]
  }, [])

  const effectiveStartDate = paymentStartDate || defaultStartDate
  const effectiveDownPaymentDate = localDownPaymentDate || defaultDownPaymentDate

  const handleDownPaymentDateChange = (date: string) => {
    setLocalDownPaymentDate(date)
    onDownPaymentDueDateChange?.(date)
  }

  // Generate AUTO schedule
  useEffect(() => {
    if (scheduleMode === "AUTO" && payableAmount > 0 && installmentMonths > 0) {
      const monthlyAmount = payableAmount / installmentMonths
      const entries: PaymentScheduleEntry[] = []

      for (let i = 0; i < installmentMonths; i++) {
        const dueDate = new Date(effectiveStartDate)
        dueDate.setMonth(dueDate.getMonth() + i)

        entries.push({
          id: `auto-${i}`,
          dueDate: dueDate.toISOString().split("T")[0],
          amount: Math.round(monthlyAmount * 100) / 100,
          note: `Installment ${i + 1}`,
        })
      }

      // Adjust last entry for rounding
      if (entries.length > 0) {
        const currentTotal = entries.reduce((sum, e) => sum + e.amount, 0)
        const diff = payableAmount - currentTotal
        entries[entries.length - 1].amount += diff
        entries[entries.length - 1].amount = Math.round(entries[entries.length - 1].amount * 100) / 100
      }

      onEntriesChange(entries)
    }
  }, [scheduleMode, payableAmount, installmentMonths, effectiveStartDate])

  // Add manual entry
  const handleAddEntry = () => {
    const lastEntry = scheduleEntries.filter((e) => !e.isDownPayment).slice(-1)[0]
    let newDate = effectiveStartDate

    if (lastEntry) {
      const lastDate = new Date(lastEntry.dueDate)
      lastDate.setMonth(lastDate.getMonth() + 1)
      newDate = lastDate.toISOString().split("T")[0]
    }

    const newEntry: PaymentScheduleEntry = {
      id: `manual-${Date.now()}`,
      dueDate: newDate,
      amount: Math.max(0, Math.round((payableAmount - totalScheduled) * 100) / 100),
      note: "",
    }

    onEntriesChange([...scheduleEntries, newEntry])
  }

  // Remove entry
  const handleRemoveEntry = (id: string) => {
    onEntriesChange(scheduleEntries.filter((e) => e.id !== id))
  }

  // Update entry
  const handleUpdateEntry = (id: string, field: keyof PaymentScheduleEntry, value: string | number) => {
    onEntriesChange(scheduleEntries.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)))
  }

  // Distribute remaining amount equally
  const handleDistributeEqually = () => {
    const nonDownPaymentEntries = scheduleEntries.filter((e) => !e.isDownPayment)
    if (nonDownPaymentEntries.length === 0) return
    const amountPerEntry = payableAmount / nonDownPaymentEntries.length
    const updatedEntries = scheduleEntries.map((entry, index) => {
      if (entry.isDownPayment) return entry
      const nonDpIndex = nonDownPaymentEntries.findIndex((e) => e.id === entry.id)
      return {
        ...entry,
        amount:
          nonDpIndex === nonDownPaymentEntries.length - 1
            ? Math.round((payableAmount - amountPerEntry * (nonDownPaymentEntries.length - 1)) * 100) / 100
            : Math.round(amountPerEntry * 100) / 100,
      }
    })
    onEntriesChange(updatedEntries)
  }

  return (
    <Card className="border-indigo-200 bg-indigo-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          {t("payment.schedule-builder") || "Payment Schedule Builder"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isHybrid && downPaymentAmount > 0 && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-green-800">{t("payment.down-payment")}</span>
              <span className="font-bold text-green-800 text-lg">{formatCurrency(downPaymentAmount)}</span>
            </div>
            <div className="space-y-2">
              <Label className="text-green-700 text-sm">
                {t("payment.down-payment-due-date") || "Down Payment Due Date"}
              </Label>
              <Input
                type="date"
                value={effectiveDownPaymentDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => handleDownPaymentDateChange(e.target.value)}
                className="bg-white border-green-300 focus:border-green-500"
              />
            </div>
          </div>
        )}

        {/* Mode Selection */}
        <Tabs value={scheduleMode} onValueChange={(v) => onScheduleModeChange(v as "AUTO" | "MANUAL")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="AUTO">{t("payment.auto-schedule") || "Auto (Equal Split)"}</TabsTrigger>
            <TabsTrigger value="MANUAL">{t("payment.manual-schedule") || "Manual (Custom)"}</TabsTrigger>
          </TabsList>

          <TabsContent value="AUTO" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("payment.installments-start-date") || "Installments Start Date"}</Label>
                <Input
                  type="date"
                  value={effectiveStartDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => onPaymentStartDateChange?.(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("payment.number-of-installments") || "Number of Installments"}</Label>
                <Input
                  type="number"
                  value={installmentMonths}
                  min={1}
                  max={60}
                  onChange={(e) => onInstallmentMonthsChange?.(Math.max(1, Number.parseInt(e.target.value) || 1))}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="MANUAL" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <Button type="button" variant="outline" size="sm" onClick={handleAddEntry}>
                <Plus className="h-4 w-4 mr-1" />
                {t("payment.add-payment") || "Add Payment"}
              </Button>
              {scheduleEntries.filter((e) => !e.isDownPayment).length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDistributeEqually}>
                  {t("payment.distribute-equally") || "Distribute Equally"}
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Schedule Table */}
        {scheduleEntries.filter((e) => !e.isDownPayment).length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>{t("payment.due-date") || "Due Date"}</TableHead>
                  <TableHead>{t("payment.amount") || "Amount"}</TableHead>
                  <TableHead>{t("common.note") || "Note"}</TableHead>
                  {scheduleMode === "MANUAL" && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduleEntries
                  .filter((e) => !e.isDownPayment)
                  .map((entry, index) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell>
                        {scheduleMode === "MANUAL" ? (
                          <Input
                            type="date"
                            value={entry.dueDate}
                            className="w-40"
                            onChange={(e) => handleUpdateEntry(entry.id, "dueDate", e.target.value)}
                          />
                        ) : (
                          new Date(entry.dueDate).toLocaleDateString()
                        )}
                      </TableCell>
                      <TableCell>
                        {scheduleMode === "MANUAL" ? (
                          <Input
                            type="number"
                            value={entry.amount}
                            className="w-32"
                            step="0.01"
                            onChange={(e) =>
                              handleUpdateEntry(entry.id, "amount", Number.parseFloat(e.target.value) || 0)
                            }
                          />
                        ) : (
                          formatCurrency(entry.amount)
                        )}
                      </TableCell>
                      <TableCell>
                        {scheduleMode === "MANUAL" ? (
                          <Input
                            type="text"
                            value={entry.note || ""}
                            placeholder={t("common.optional") || "Optional"}
                            className="w-full"
                            onChange={(e) => handleUpdateEntry(entry.id, "note", e.target.value)}
                          />
                        ) : (
                          <span className="text-muted-foreground text-sm">{entry.note}</span>
                        )}
                      </TableCell>
                      {scheduleMode === "MANUAL" && (
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveEntry(entry.id)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Validation Summary */}
        <div className="p-3 bg-white rounded-lg border space-y-2">
          {isHybrid && downPaymentAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("payment.down-payment")}:</span>
              <span className="font-medium text-green-600">{formatCurrency(downPaymentAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("payment.remaining-to-schedule") || "Remaining to Schedule"}:
            </span>
            <span className="font-medium">{formatCurrency(payableAmount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("payment.total-scheduled") || "Total Scheduled"}:</span>
            <span className="font-medium">{formatCurrency(totalScheduled)}</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-muted-foreground">{t("payment.difference") || "Difference"}:</span>
            <div className="flex items-center gap-2">
              {isValid ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-green-600">{formatCurrency(0)}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="font-medium text-red-600">{formatCurrency(difference)}</span>
                </>
              )}
            </div>
          </div>
          {!isValid && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {t("payment.schedule-must-match") || "Schedule total must match payable amount to save"}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
