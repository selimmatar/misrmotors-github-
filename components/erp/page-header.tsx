import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface PageHeaderProps {
  group?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

// Breadcrumb, title and the actions row (end side; wraps to its own line below 768px). `children` sits under
// the title, for tabs.
export function PageHeader({ group, title, subtitle, actions, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {group && (
            <p className="text-xs text-muted-foreground">
              {group} / {title}
            </p>
          )}
          <h1 className="text-[22px] font-extrabold leading-tight text-balance md:text-[28px]">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex w-full flex-wrap gap-2 md:w-auto">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
