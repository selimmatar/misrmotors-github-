"use client"

// FEAT-01: lists the selected supplier's open credits (raised by returned items) on the new-PO form and lets the
// user deduct all or part of each one. The amounts are only a selection: the server re-checks and reserves them.
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Money } from "@/components/erp/money"
import { formatDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

export type OpenSupplierCredit = {
  credit_id: number
  supplier_id: number
  amount: number
  description?: string | null
  created_at?: string | null
  po_number?: string | null
}

/** creditId -> amount typed by the user (string, as in the input) */
export type CreditAmounts = Record<string, string>

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** The selections to send with the PO: only positive amounts, rounded to cents. */
export function creditSelections(amounts: CreditAmounts) {
  return Object.entries(amounts)
    .map(([creditId, raw]) => ({ creditId: Number(creditId), amount: money(Number.parseFloat(raw) || 0) }))
    .filter((s) => s.amount > 0)
}

export function appliedCreditTotal(amounts: CreditAmounts) {
  return money(creditSelections(amounts).reduce((sum, s) => sum + s.amount, 0))
}

export function SupplierCreditPicker({
  supplierId,
  orderTotal,
  value,
  onChange,
}: {
  supplierId: string
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
  }, [supplierId])

  if (!supplierId || (!loading && credits.length === 0)) return null

  const available = money(credits.reduce((sum, c) => sum + c.amount, 0))
  const applied = appliedCreditTotal(value)
  const overTotal = applied > money(orderTotal) + 0.005

  const setAmount = (id: number, raw: string) => onChange({ ...value, [String(id)]: raw })
  const useFull = (c: OpenSupplierCredit) => {
    // Never more than what is still needed to cover the order total.
    const others = applied - money(Number.parseFloat(value[String(c.credit_id)] || "0") || 0)
    const room = Math.max(money(orderTotal) - others, 0)
    setAmount(c.credit_id, String(money(Math.min(c.amount, room))))
  }

  return (
    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t("po.credit.title")}</span>
        <span className="text-sm text-muted-foreground">
          {t("po.credit.available")}: <Money value={available} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t("po.credit.hint")}</p>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("po.credit.loading")}</p>
      ) : (
        <div className="space-y-2">
          {credits.map((c) => {
            const raw = value[String(c.credit_id)] ?? ""
            const n = Number.parseFloat(raw) || 0
            const tooMuch = n > c.amount + 0.005
            return (
              <div key={c.credit_id} className="flex flex-wrap items-center gap-2 rounded bg-background/70 p-2">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">
                    #{c.credit_id} · <Money value={c.amount} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[c.description, c.po_number ? fill(t("supplier.credit-po"), { number: c.po_number }) : null, c.created_at ? formatDate(c.created_at, language) : null]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  max={c.amount}
                  inputMode="decimal"
                  aria-label={fill(t("po.credit.amount-for"), { id: String(c.credit_id) })}
                  className={`w-32 ${tooMuch ? "border-red-500" : ""}`}
                  placeholder="0.00"
                  value={raw}
                  onChange={(e) => setAmount(c.credit_id, e.target.value)}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => useFull(c)}>
                  {t("po.credit.use-all")}
                </Button>
                {raw !== "" && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAmount(c.credit_id, "")}>
                    {t("action.clear")}
                  </Button>
                )}
                {tooMuch && <p className="w-full text-xs text-red-700 dark:text-red-400">{t("po.credit.more-than-available")}</p>}
              </div>
            )
          })}
        </div>
      )}
      {overTotal && <p className="text-xs text-red-700 dark:text-red-400">{t("po.credit.more-than-total")}</p>}
    </div>
  )
}
