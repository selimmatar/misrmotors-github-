"use client"

// Uses the customer's open credits (raised by overpayments) on an open AR invoice. The user picks the credits and an
// amount from each; POST /api/accounts-receivable/apply-credit re-checks, reserves them and raises the invoice. No
// cash is recorded.
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Money } from "@/components/erp/money"
import { CreditPickerList, appliedCreditTotal, creditSelections, type CreditAmounts, type PickableCredit } from "@/components/payment/credit-picker"
import { formatDate, formatMoney } from "@/lib/format"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

type CreditInvoice = { id: string; invoiceNumber: string; customerId: string; amount: number; collectedAmount?: number }

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const newKey = () =>
  `credit-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export function CustomerCreditDialog({
  open,
  onOpenChange,
  invoice,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: CreditInvoice | null
  onApplied: () => void | Promise<void>
}) {
  const { t, language } = useI18n()
  const [credits, setCredits] = useState<PickableCredit[]>([])
  const [loading, setLoading] = useState(false)
  const [amounts, setAmounts] = useState<CreditAmounts>({})
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const keyRef = useRef<string>(newKey())

  useEffect(() => {
    if (open) {
      keyRef.current = newKey()
      setAmounts({})
    }
  }, [open, invoice?.id])

  useEffect(() => {
    if (!open || !invoice?.customerId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/customer-credits?customer_id=${encodeURIComponent(invoice.customerId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (cancelled) return
        const list = (Array.isArray(rows) ? rows : []).filter((c: any) => c.status === "active" && Number(c.amount) > 0)
        setCredits(
          list.map((c: any) => ({
            credit_id: c.credit_id,
            amount: Number(c.amount),
            detail: [
              c.credit_type === "overpayment" && c.invoice_number
                ? fill(t("customer.credit-overpayment-on"), { number: c.invoice_number })
                : c.credit_type === "sales_return"
                ? fill(t("customer.credit-return"), { id: c.reference_id })
                : c.description,
              c.created_at ? formatDate(c.created_at, language) : null,
            ]
              .filter(Boolean)
              .join(" • "),
          })),
        )
      })
      .catch(() => !cancelled && setCredits([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, invoice?.customerId, reloadKey, language, t])

  if (!invoice) return null
  const remaining = money(Math.max((invoice.amount || 0) - (invoice.collectedAmount || 0), 0))
  const applied = appliedCreditTotal(amounts)
  const invalid =
    applied <= 0 ||
    applied > remaining + 0.005 ||
    creditSelections(amounts).some((s) => s.amount > (credits.find((c) => c.credit_id === s.creditId)?.amount ?? 0) + 0.005)

  const apply = async () => {
    if (saving || invalid) return
    setSaving(true)
    try {
      const response = await fetch("/api/accounts-receivable/apply-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoice.id), idempotencyKey: keyRef.current, credits: creditSelections(amounts) }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok) {
        alert(fill(t("ar.credit.applied"), { amount: formatMoney(result.applied ?? applied, language) }))
        await onApplied()
        onOpenChange(false)
        return
      }
      // a refused request wrote nothing: the next try is a new request
      if (!result.partialFailure) keyRef.current = newKey()
      if (result.code === "CREDIT_NOT_AVAILABLE") {
        alert(t("ar.credit.err-not-available"))
        setAmounts({})
        setReloadKey((k) => k + 1)
      } else if (result.code === "CREDIT_AMOUNT_INVALID") {
        alert(t("po.credit.err-amount"))
        setReloadKey((k) => k + 1)
      } else if (result.code === "CREDIT_EXCEEDS_TOTAL") {
        alert(t("ar.credit.more-than-balance"))
        await onApplied()
      } else {
        alert(result.error || t("message.error"))
        if (result.partialFailure || response.status === 409) await onApplied()
      }
    } catch (error) {
      console.error("AR - applying customer credit failed:", error)
      alert(t("message.error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ar.credit.use")}</DialogTitle>
          <DialogDescription>
            {invoice.invoiceNumber} • {t("ar.credit.remaining")}: <Money value={remaining} /> {t("common.egp-2")}
          </DialogDescription>
        </DialogHeader>
        {!loading && credits.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">{t("ar.credit.none")}</p>
        ) : (
          <CreditPickerList
            credits={credits}
            loading={loading}
            limit={remaining}
            value={amounts}
            onChange={setAmounts}
            title={t("ar.credit.title")}
            hint={t("ar.credit.hint")}
            overLimitMessage={t("ar.credit.more-than-balance")}
          />
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button onClick={apply} disabled={saving || invalid}>
            {saving ? t("ar.credit.applying") : t("ar.credit.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
