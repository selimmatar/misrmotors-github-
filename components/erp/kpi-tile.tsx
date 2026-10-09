import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface KpiTileProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  // Only the first tile on a page may be strong.
  strong?: boolean
  className?: string
}

export function KpiTile({ label, value, sub, strong, className }: KpiTileProps) {
  return (
    <div
      className={cn(
        "@container flex min-h-[104px] min-w-0 flex-col gap-1 rounded-xl border bg-card p-4",
        strong && "border-transparent bg-strong text-strong-foreground",
        className,
      )}
    >
      <p className={cn("text-xs uppercase tracking-wide", strong ? "opacity-75" : "text-muted-foreground")}>{label}</p>
      {/* Scales with the tile (22px phone / 28px laptop at most) so a seven-figure amount fits a two-column phone
          grid; <bdi> keeps "-1,500.00" in order inside Arabic pages. */}
      <div className="text-[clamp(16px,13.5cqi,22px)] font-extrabold leading-tight tabular-nums break-words md:text-[clamp(16px,13.5cqi,28px)]">
        <bdi>{value}</bdi>
      </div>
      {sub && <div className={cn("text-xs", strong ? "opacity-75" : "text-muted-foreground")}>{sub}</div>}
    </div>
  )
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4", className)}>{children}</div>
}
