"use client"

import { Fragment, type ReactNode } from "react"
import { useIsMobile } from "@/components/ui/use-mobile"
import { cn } from "@/lib/utils"

export interface ResponsiveListProps<T> {
  rows: T[]
  table: ReactNode
  card: (row: T, index: number) => ReactNode
  empty?: ReactNode
  className?: string
}

// Table at 768px and above, one card per row below. Only one branch mounts, so row actions never render twice.
export function ResponsiveList<T>({ rows, table, card, empty, className }: ResponsiveListProps<T>) {
  const isMobile = useIsMobile()
  if (rows.length === 0 && empty !== undefined) return <div className={className}>{empty}</div>
  if (!isMobile) return <div className={className}>{table}</div>
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {rows.map((row, i) => (
        <Fragment key={i}>{card(row, i)}</Fragment>
      ))}
    </div>
  )
}

export interface ListCardProps {
  id: ReactNode
  amount?: ReactNode
  party?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  className?: string
}

export function ListCard({ id, amount, party, status, actions, className }: ListCardProps) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 break-words font-semibold text-link">{id}</div>
        {amount != null && (
          <div className="shrink-0 text-end font-semibold tabular-nums">
            <bdi>{amount}</bdi>
          </div>
        )}
      </div>
      {(party != null || status != null) && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-muted-foreground">{party}</div>
          {status != null && <div className="shrink-0">{status}</div>}
        </div>
      )}
      {actions != null && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
