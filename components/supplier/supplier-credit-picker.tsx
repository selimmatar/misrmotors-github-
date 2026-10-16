"use client"

// FEAT-01: lists the selected supplier's open credits (raised by returned items) on the new-PO form and lets the
// user deduct all or part of each one. The amounts are only a selection: the server re-checks and reserves them.
// The list itself is shared with customer credits (components/payment/credit-picker.tsx).
import { useEffect, useState } from "react"
import { CreditPickerList, type CreditAmounts } from "@/components/payment/credit-picker"
import { formatDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

export { appliedCreditTotal, creditSelections, type CreditAmounts } from "@/components/payment/credit-picker"

export type OpenSupplierCredit = {
  credit_id: number
  supplier_id: number
  amount: number
  description?: string | null
  created_at?: string | null
  po_number?: string | null
}

export function SupplierCreditPicker({
  supplierId,
  orderTotal,
  value,
  onChange,
  reloadKey = 0,
}: {
  supplierId: string
  /** Bump to fetch the open credits again (e.g. after the server refused a credit someone else just used). */
  reloadKey?: number
  orderTotal: number
  value: CreditAmounts
  onChange: (next: CreditAmounts) => void
}) {
  const { t, language } = useI18n()
  const [credits, setCredits] = useState<OpenSupplierCredit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!supplierId) {
      setCredits([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch("/api/supplier-credits")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (cancelled) return
        const list = (Array.isArray(rows) ? rows : []).filter(
          (c: any) => String(c.supplier_id) === String(supplierId) && Number(c.amount) > 0,
        )
        setCredits(list.map((c: any) => ({ ...c, amount: Number(c.amount) })))
      })
      .catch(() => !cancelled && setCredits([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [supplierId, reloadKey])

  if (!supplierId || (!loading && credits.length === 0)) return null

  return (
    <CreditPickerList
      credits={credits.map((c) => ({
        ...c,
        detail: [c.description, c.po_number ? fill(t("supplier.credit-po"), { number: c.po_number }) : null, c.created_at ? formatDate(c.created_at, language) : null]
          .filter(Boolean)
          .join(" "),
      }))}
      loading={loading}
      limit={orderTotal}
      value={value}
      onChange={onChange}
      title={t("po.credit.title")}
      hint={t("po.credit.hint")}
      overLimitMessage={t("po.credit.more-than-total")}
    />
  )
}
