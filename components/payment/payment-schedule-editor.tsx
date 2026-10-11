"use client"

import { useState, useEffect } from "react"
import { useI18n } from "@/lib/i18n-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, Plus } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface PaymentScheduleEntry {
  id: string
  dueDate: string
  amount: number
  description?: string
}

interface PaymentScheduleEditorProps {
  paymentType: "installments" | "hybrid"
  totalAmount: number
  downPaymentAmount?: number
  downPaymentDueDate?: string
  installmentMonths: number
  paymentStartDate: string
  onScheduleChange: (entries: PaymentScheduleEntry[]) => void
}

export function PaymentScheduleEditor({
  paymentType,
  totalAmount,
  downPaymentAmount = 0,
  downPaymentDueDate = "",
  installmentMonths,
  paymentStartDate,
  onScheduleChange,
}: PaymentScheduleEditorProps) {
  const { t } = useI18n()
  const [scheduleEntries, setScheduleEntries] = useState<PaymentScheduleEntry[]>([])
  const [showManualEdit, setShowManualEdit] = useState(false)

  // Generate automatic schedule
  const generateAutoSchedule = () => {
    const entries: PaymentScheduleEntry[] = []
    
    // For hybrid, add down payment first
    if (paymentType === "hybrid" && downPaymentAmount > 0) {
      entries.push({
        id: `down-payment`,
        dueDate: downPaymentDueDate || new Date().toISOString().split("T")[0],
        amount: downPaymentAmount,
        description: "Down Payment",
      })
    }

    // Calculate remaining amount and monthly amount
    const remainingAmount = totalAmount - downPaymentAmount
    const monthlyAmount = remainingAmount / installmentMonths

    // Generate monthly entries
    const startDate = new Date(paymentStartDate || new Date().toISOString().split("T")[0])

    for (let i = 0; i < installmentMonths; i++) {
      const dueDate = new Date(startDate)
      dueDate.setMonth(dueDate.getMonth() + i + 1)

      entries.push({
        id: `installment-${i + 1}`,
        dueDate: dueDate.toISOString().split("T")[0],
        amount: Math.round(monthlyAmount * 100) / 100,
        description: `Installment ${i + 1}/${installmentMonths}`,
      })
    }

    setScheduleEntries(entries)
    onScheduleChange(entries)
  }

  // Initialize schedule on mount or when key props change
  useEffect(() => {
    generateAutoSchedule()
  }, [paymentType, totalAmount, downPaymentAmount, installmentMonths, paymentStartDate])

  const updateEntry = (id: string, field: "dueDate" | "amount", value: string | number) => {
    const updated = scheduleEntries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            [field]: field === "amount" ? Number(value) : value,
          }
        : entry
    )
    setScheduleEntries(updated)
    onScheduleChange(updated)
  }

  const removeEntry = (id: string) => {
    const updated = scheduleEntries.filter((entry) => entry.id !== id)
    setScheduleEntries(updated)
    onScheduleChange(updated)
  }

  const addEntry = () => {
    const newEntry: PaymentScheduleEntry = {
      id: `entry-${Date.now()}`,
      dueDate: new Date().toISOString().split("T")[0],
      amount: 0,
      description: "Custom Entry",
    }
    const updated = [...scheduleEntries, newEntry]
    setScheduleEntries(updated)
    onScheduleChange(updated)
  }

  const totalScheduled = scheduleEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const remainingAmount = totalAmount - totalScheduled

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Payment Schedule</CardTitle>
            <CardDescription>
              Customize payment dates and amounts for each installment
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant={!showManualEdit ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setShowManualEdit(false)
                generateAutoSchedule()
              }}
            >
              Auto Schedule
            </Button>
            <Button
              variant={showManualEdit ? "default" : "outline"}
              size="sm"
              onClick={() => setShowManualEdit(true)}
            >
              Manual Edit
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Amount (EGP)</TableHead>
                <TableHead className="w-10">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scheduleEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.description}</TableCell>
                  <TableCell>
                    {showManualEdit ? (
                      <Input
                        type="date"
                        value={entry.dueDate}
                        onChange={(e) => updateEntry(entry.id, "dueDate", e.target.value)}
                        className="w-32"
                      />
                    ) : (
                      entry.dueDate
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {showManualEdit ? (
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={entry.amount}
                        onChange={(e) => updateEntry(entry.id, "amount", e.target.value)}
                        className="w-32 text-right"
                      />
                    ) : (
                      `${entry.amount.toFixed(2)}`
                    )}
                  </TableCell>
                  <TableCell>
                    {showManualEdit && (
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label={t("action.delete")}
                        onClick={() => removeEntry(entry.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
          <div>
            <Label className="text-xs text-muted-foreground">Total Amount</Label>
            <div className="text-lg font-bold">{totalAmount.toFixed(2)} EGP</div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Total Scheduled</Label>
            <div className="text-lg font-bold text-blue-600">{totalScheduled.toFixed(2)} EGP</div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Remaining</Label>
            <div
              className={`text-lg font-bold ${
                remainingAmount > 0.01 ? "text-red-700" : "text-green-700"
              }`}
            >
              {remainingAmount.toFixed(2)} EGP
            </div>
          </div>
        </div>

        {showManualEdit && (
          <Button onClick={addEntry} variant="outline" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Payment Entry
          </Button>
        )}

        {Math.abs(remainingAmount) > 0.01 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
            ⚠️ Total scheduled amount ({totalScheduled.toFixed(2)} EGP) does not match total amount (
            {totalAmount.toFixed(2)} EGP). Difference: {remainingAmount.toFixed(2)} EGP
          </div>
        )}
      </CardContent>
    </Card>
  )
}
