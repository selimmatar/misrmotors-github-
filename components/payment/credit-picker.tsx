"use client"

// The open credits of one supplier or customer, with an amount to use from each. The amounts are only a selection:
// the server re-checks and reserves them. Used by the new-PO form (supplier credits) and the receivables screen
// (customer credits).
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Money } from "@/components/erp/money"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

/** creditId -> amount typed by the user (string, as in the input) */
export type CreditAmounts = Record<string, string>

export type PickableCredit = { credit_id: number; amount: number; detail?: string }

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** The selections to send: only positive amounts, rounded to cents. */
export function creditSelections(amounts: CreditAmounts) {
  return Object.entries(amounts)
    .map(([creditId, raw]) => ({ creditId: Number(creditId), amount: money(Number.parseFloat(raw) || 0) }))
    .filter((s) => s.amount > 0)
}

export function appliedCreditTotal(amounts: CreditAmounts) {
  return money(creditSelections(amounts).reduce((sum, s) => sum + s.amount, 0))
}

export function CreditPickerList({
  credits,
  loading,
  limit,
  value,
  onChange,
  title,
  hint,
  overLimitMessage,
}: {
  credits: PickableCredit[]
  loading: boolean
  /** the most that may be used in total (order total, invoice balance) */
  limit: number
  value: CreditAmounts
  onChange: (next: CreditAmounts) => void
  title: string
  hint: string
  overLimitMessage: string
}) {
  const { t } = useI18n()
  const available = money(credits.reduce((sum, c) => sum + c.amount, 0))
  const applied = appliedCreditTotal(value)
  const overTotal = applied > money(limit) + 0.005

  const setAmount = (id: number, raw: string) => onChange({ ...value, [String(id)]: raw })
  const useFull = (c: PickableCredit) => {
    // Never more than what is still needed to reach the limit.
    const others = applied - money(Number.parseFloat(value[String(c.credit_id)] || "0") || 0)
    const room = Math.max(money(limit) - others, 0)
    setAmount(c.credit_id, String(money(Math.min(c.amount, room))))
  }

  return (
    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">
          {t("po.credit.available")}: <Money value={available} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
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
                  {c.detail && <div className="truncate text-xs text-muted-foreground">{c.detail}</div>}
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
      {overTotal && <p className="text-xs text-red-700 dark:text-red-400">{overLimitMessage}</p>}
    </div>
  )
}
