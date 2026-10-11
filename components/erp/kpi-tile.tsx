import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface KpiTileProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  // Only the first tile on a page may be strong.
  strong?: boolean
  // Makes the tile a button (keyboard-focusable); without it the tile is a plain block.
  onClick?: () => void
  className?: string
}

export function KpiTile({ label, value, sub, strong, onClick, className }: KpiTileProps) {
  // A clickable tile is a real <button type="button">, so it takes focus and never submits a surrounding form.
  const Root = onClick ? "button" : "div"
  return (
    <Root
      data-slot="kpi-tile"
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "@container flex min-h-[72px] md:min-h-[104px] min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 md:p-4",
        onClick && "text-start cursor-pointer transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        strong && "border-transparent bg-strong text-strong-foreground",
        className,
      )}
    >
      <span className={cn("block text-xs uppercase tracking-wide", strong ? "opacity-75" : "text-muted-foreground")}>{label}</span>
      {/* Scales with the tile (22px phone / 28px laptop at most) so a seven-figure amount fits a two-column phone
          grid; <bdi> keeps "-1,500.00" in order inside Arabic pages. */}
      <span className="block text-[clamp(16px,13.5cqi,22px)] font-extrabold leading-tight tabular-nums break-words md:text-[clamp(16px,13.5cqi,28px)]">
        <bdi>{value}</bdi>
      </span>
      {sub && <span className={cn("block text-xs", strong ? "opacity-75" : "text-muted-foreground")}>{sub}</span>}
    </Root>
  )
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4", className)}>{children}</div>
}
