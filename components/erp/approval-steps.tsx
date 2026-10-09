"use client"

import { Check } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { APPROVAL_STEPS, approvalAriaLabel, approvalState } from "@/lib/approval-steps"
import { cn } from "@/lib/utils"

// Sales-order approval track: Accountant → Warehouse → Shipping → Delivered. Renders nothing for statuses
// without a track (quotation, cancelled, unknown).
export function ApprovalSteps({ status, className }: { status: string | null | undefined; className?: string }) {
  const { t } = useI18n()
  const state = approvalState(status)
  if (!state) return null
  return (
    <ol aria-label={approvalAriaLabel(state, t)} className={cn("flex flex-wrap items-center gap-1", className)}>
      {APPROVAL_STEPS.map((step, i) => {
        const done = i < state.done
        const current = step === state.current
        return (
          <li
            key={step}
            aria-current={current ? "step" : undefined}
            className={cn(
              "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium",
              done
                ? "bg-tone-done-bg text-tone-done"
                : current
                  ? "bg-tone-approved-bg text-tone-approved"
                  : "bg-tone-neutral-bg text-tone-neutral",
            )}
          >
            {done ? <Check className="size-3" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
            {t(`approval.${step}`)}
          </li>
        )
      })}
    </ol>
  )
}
