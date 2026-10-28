"use client"

import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { stockShortfall } from "@/lib/quotation-shortfall"

// Under a quotation's stock line: "3 in stock", plus "2 missing" in orange when the line asks for more than is free.
export function StockShortfallNote({ free, requested }: { free: number | null; requested: number }) {
  const { t } = useI18n()
  if (free === null) return null
  const missing = stockShortfall(requested, free)
  return (
    <p className="text-xs text-muted-foreground">
      {free} {t("common.in-stock")}
      {missing > 0 && (
        <span className="ms-2 font-medium text-orange-700 dark:text-orange-400" title={t("sq.n-missing-hint")}>
          {fill(t("sq.n-missing"), { count: String(missing) })}
        </span>
      )}
    </p>
  )
}
