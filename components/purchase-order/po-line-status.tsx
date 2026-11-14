"use client"

// The status label on each PO line (owner request, 2026-11-14): not received yet / partly received / received /
// out for delivery / partly delivered / delivered. Worked out on the server (lib/po-line-status.ts).
import { useEffect, useState } from "react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import type { PoLineStatus } from "@/lib/po-line-status"

export function usePoLineStatuses(poId: string | number | null | undefined) {
  const [lines, setLines] = useState<Map<string, PoLineStatus> | null>(null)
  useEffect(() => {
    if (!poId) return
    let cancelled = false
    setLines(null)
    fetch(`/api/purchase-orders/line-status?poId=${encodeURIComponent(String(poId))}`)
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((body) => !cancelled && setLines(new Map((body.lines || []).map((l: PoLineStatus) => [String(l.poItemId), l]))))
      .catch(() => !cancelled && setLines(new Map()))
    return () => {
      cancelled = true
    }
  }, [poId])
  return lines
}

const TONE: Record<PoLineStatus["state"], string> = {
  not_received: "bg-muted text-muted-foreground",
  partly_received: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  received: "bg-primary/10 text-primary",
  out_for_delivery: "bg-indigo-500/15 text-indigo-800 dark:text-indigo-300",
  partly_delivered: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  delivered: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
}

const q = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")

export function PoLineStatusBadge({ status }: { status: PoLineStatus | undefined }) {
  const { t } = useI18n()
  if (!status) return <span className="text-xs text-muted-foreground">—</span>
  const detail =
    status.state === "partly_received"
      ? fill(t("po.line-received-of"), { got: q(status.received), of: q(status.ordered) })
      : status.state === "partly_delivered"
        ? fill(t("po.line-delivered-of"), { done: q(status.delivered || 0), of: q(status.ordered) })
        : status.state === "out_for_delivery" && (status.outForDelivery || 0) < status.ordered
          ? fill(t("po.line-out-of"), { out: q(status.outForDelivery || 0), of: q(status.ordered) })
          : status.state === "received" && status.delivered === null
            ? t("po.line-for-stock")
            : null
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-block w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[status.state]}`}>{t(`po.line-state.${status.state}`)}</span>
      {detail && <span className="text-[11px] text-muted-foreground">{detail}</span>}
      {status.soNumber && <span className="text-[11px] text-muted-foreground">{status.soNumber}</span>}
    </span>
  )
}
