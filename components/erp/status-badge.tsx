"use client"

import { useI18n } from "@/lib/i18n-context"
import { formatEnum } from "@/lib/format"
import { statusTone, type StatusTone } from "@/lib/status-tone"
import { cn } from "@/lib/utils"

// Literal class names so Tailwind generates every tone.
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral",
  waiting: "bg-tone-waiting-bg text-tone-waiting",
  approved: "bg-tone-approved-bg text-tone-approved",
  ready: "bg-tone-ready-bg text-tone-ready",
  done: "bg-tone-done-bg text-tone-done",
  danger: "bg-tone-danger-bg text-tone-danger",
}

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const { t } = useI18n()
  const tone = statusTone(status)
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {formatEnum(status, t)}
    </span>
  )
}
