"use client"

// The customer card's credits: open credits (raised by overpayments) with their total, and the used ones with the
// invoice they were used on. Read-only; credits are used from the receivables screen.
import { useEffect, useState } from "react"
import { Money } from "@/components/erp/money"
import { formatDate, formatMoney } from "@/lib/format"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { parseRemainderNote } from "@/lib/supplier-credit-note"

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function CustomerCreditsCard({ customerId, reloadKey = 0 }: { customerId: string; reloadKey?: number }) {
  const { t, language } = useI18n()
  const [credits, setCredits] = useState<any[]>([])

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    fetch(`/api/customer-credits?customer_id=${encodeURIComponent(customerId)}&include=used`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => !cancelled && setCredits(Array.isArray(rows) ? rows : []))
      .catch(() => !cancelled && setCredits([]))
    return () => {
      cancelled = true
    }
  }, [customerId, reloadKey])

  const open = credits.filter((c) => c.status === "active")
  const used = credits.filter((c) => c.status === "used")
  const openTotal = money(open.reduce((sum, c) => sum + (Number(c.amount) || 0), 0))

  const title = (credit: any) =>
    credit.credit_type === "overpayment" && credit.invoice_number
      ? fill(t("customer.credit-overpayment-on"), { number: credit.invoice_number })
      : credit.credit_type === "sales_return"
      ? fill(t("customer.credit-return"), { id: credit.reference_id })
      : credit.description || t("customer.credits")
  // notes are saved in English (DB data); the remainder note of a split credit is shown in the user's language
  const note = (credit: any) => {
    const r = parseRemainderNote(credit.notes)
    if (r) return fill(t("customer.credit-remainder-note"), { id: r.creditId, amount: formatMoney(Number(r.amount), language), invoice: r.poNumber })
    return null
  }

  return (
    <div className="border-t pt-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-semibold">{t("customer.credits")}</h3>
        <span className="text-sm text-muted-foreground">
          {t("customer.open-credit")} {t("common.egp")}:{" "}
          <span className="font-semibold text-green-700 dark:text-green-400">
            <Money value={openTotal} />
          </span>
        </span>
      </div>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">{t("customer.no-credits")}</p>
      ) : (
        <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-sm text-green-700 dark:text-green-400 mb-3">{t("customer.credits-description")}</p>
          <div className="space-y-2">
            {open.map((credit) => (
              <div key={credit.credit_id} className="flex justify-between items-start text-sm border-b border-green-200 dark:border-green-800 pb-2 last:border-0">
                <div className="flex-1">
                  <p className="font-medium text-green-900 dark:text-green-300">{title(credit)}</p>
                  <p className="text-xs text-green-700 dark:text-green-500 mt-1">
                    {formatDate(credit.created_at, language)}
                  </p>
                  {note(credit) && <p className="text-xs text-green-700/80 dark:text-green-500/80 mt-0.5">{note(credit)}</p>}
                </div>
                <p className="ms-4 font-semibold text-green-700 dark:text-green-400">
                  <Money value={credit.amount} /> {t("common.egp-2")}
                </p>
              </div>
            ))}
          </div>
          <div className="border-t border-green-200 dark:border-green-800 mt-3 pt-3 flex justify-between items-center font-semibold">
            <span>{t("customer.total-open-credit")}</span>
            <span className="text-lg text-green-700 dark:text-green-400">
              <Money value={openTotal} /> {t("common.egp-2")}
            </span>
          </div>
        </div>
      )}
      {used.length > 0 && (
        <div className="mt-4 rounded-lg border p-4">
          <h4 className="text-sm font-semibold mb-2">{t("customer.used-credits")}</h4>
          <div className="space-y-2">
            {used.map((credit) => (
              <div key={credit.credit_id} className="flex justify-between items-start text-sm border-b pb-2 last:border-0">
                <div className="flex-1">
                  <p className="font-medium">{title(credit)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fill(t("customer.credit-used-on-invoice"), { number: credit.used_in_invoice_number || `#${credit.used_in_invoice_id}` })}
                    {credit.used_at && <>{" • "}{formatDate(credit.used_at, language)}</>}
                  </p>
                </div>
                <p className="ms-4 font-semibold">
                  <Money value={credit.amount} /> {t("common.egp-2")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
