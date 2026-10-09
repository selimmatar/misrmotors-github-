"use client"

import { useI18n } from "@/lib/i18n-context"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

// A visible amount. <bdi> keeps "-1,500.00" in order inside Arabic pages. The currency lives in the column header
// or tile label, never here (spec §4.1).
export function Money({ value, className }: { value: number | string | null | undefined; className?: string }) {
  const { language } = useI18n()
  return <bdi className={cn("whitespace-nowrap tabular-nums", className)}>{formatMoney(value, language)}</bdi>
}
