"use client"

import type React from "react"

import { useI18n } from "@/lib/i18n-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"

interface ChequeFieldsProps {
  chequeNumber: string
  bankName: string
  dueDate: string
  amount: number
  notes?: string
  totalAmount: number
  onChange: (field: string, value: string | number) => void
  prefix?: string
}

export function ChequeFields({
  chequeNumber,
  bankName,
  dueDate,
  amount,
  notes,
  totalAmount,
  onChange,
  prefix = "",
}: ChequeFieldsProps) {
  const { t, formatCurrency } = useI18n()

  console.log("[v0] ChequeFields render - chequeNumber:", chequeNumber, "bankName:", bankName, "prefix:", prefix)

  const handleChange = (fieldName: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.type === "number" ? Number.parseFloat(e.target.value) || 0 : e.target.value

    console.log("[v0] ChequeFields handleChange - fieldName:", fieldName, "value:", value, "type:", e.target.type)

    // Map UI field names to PaymentDetails field names
    let mappedField: string

    if (prefix) {
      // For prefixed fields (e.g., downPayment): downPaymentChequeNumber
      const prefixFieldMap: Record<string, string> = {
        chequeNumber: `${prefix}ChequeNumber`,
        bankName: `${prefix}ChequeBank`,
        dueDate: `${prefix}ChequeDueDate`,
        amount: `${prefix}ChequeAmount`,
        notes: `${prefix}ChequeNotes`,
      }
      mappedField = prefixFieldMap[fieldName] || fieldName
    } else {
      // For non-prefixed fields: chequeNumber, chequeBankName, etc.
      const fieldMap: Record<string, string> = {
        chequeNumber: "chequeNumber",
        bankName: "chequeBankName",
        dueDate: "chequeDueDate",
        amount: "chequeAmount",
        notes: "chequeNotes",
      }
      mappedField = fieldMap[fieldName] || fieldName
    }

    console.log("[v0] ChequeFields calling onChange with mappedField:", mappedField, "value:", value)
    onChange(mappedField, value)
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardContent className="pt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("payment.cheque-number")}</Label>
            <Input
              type="text"
              value={chequeNumber || ""}
              onChange={handleChange("chequeNumber")}
              placeholder={t("payment.enter-cheque-number")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("payment.bank-name")}</Label>
            <Input
              type="text"
              value={bankName || ""}
              onChange={handleChange("bankName")}
              placeholder={t("payment.enter-bank-name")}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("payment.cheque-due-date")}</Label>
            <Input type="date" value={dueDate || ""} onChange={handleChange("dueDate")} />
          </div>
          <div className="space-y-2">
            <Label>{t("payment.cheque-amount")}</Label>
            <Input
              type="number"
              value={amount || totalAmount || 0}
              onChange={handleChange("amount")}
              placeholder={formatCurrency(totalAmount)}
            />
            <p className="text-xs text-muted-foreground">
              {t("payment.default-full-amount")}: {formatCurrency(totalAmount)}
            </p>
          </div>
        </div>

        {!prefix && (
          <div className="space-y-2">
            <Label>
              {t("payment.cheque-notes")} ({t("optional")})
            </Label>
            <Textarea
              value={notes || ""}
              onChange={handleChange("notes")}
              placeholder={t("payment.cheque-notes-placeholder")}
              rows={2}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
