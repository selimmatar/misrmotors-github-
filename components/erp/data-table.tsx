"use client"

import type { ComponentProps } from "react"
import { Table, TableCell, TableHead } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"

// Thin styled wrappers over components/ui/table. Header cells start-align (RTL-safe); the end-aligned heads
// use `!` because ErpTable's descendant rule outranks a plain class on the cell.
export function ErpTable({ className, ...props }: ComponentProps<typeof Table>) {
  return (
    <Table
      className={cn(
        "[&_tbody_tr]:h-[38px] [&_th]:h-8 [&_th]:text-start [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function NumHead({ className, ...props }: ComponentProps<typeof TableHead>) {
  return <TableHead className={cn("whitespace-nowrap text-end! tabular-nums", className)} {...props} />
}

// <bdi> keeps a negative amount ("-1,500.00") in order inside Arabic pages.
export function NumCell({ className, children, ...props }: ComponentProps<typeof TableCell>) {
  return (
    <TableCell className={cn("whitespace-nowrap text-end tabular-nums", className)} {...props}>
      <bdi>{children}</bdi>
    </TableCell>
  )
}

export function IdCell({ className, ...props }: ComponentProps<typeof TableCell>) {
  return <TableCell className={cn("whitespace-nowrap font-semibold text-link", className)} {...props} />
}

export function ActionsHead({ className, children, ...props }: ComponentProps<typeof TableHead>) {
  const { t } = useI18n()
  return (
    <TableHead className={cn("sticky end-0 bg-card text-end!", className)} {...props}>
      {children ?? t("field.actions")}
    </TableHead>
  )
}

export function ActionsCell({ className, children, ...props }: ComponentProps<typeof TableCell>) {
  return (
    <TableCell className={cn("sticky end-0 whitespace-nowrap bg-card", className)} {...props}>
      <div className="flex justify-end gap-1">{children}</div>
    </TableCell>
  )
}
