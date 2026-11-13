"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import type { UserRole } from "@/lib/types"
import { useI18n } from "@/lib/i18n-context"
import { ROLE_DISPLAY_NAMES } from "@/components/layout/nav-config"
import { groupItems, hideIdleApprovals } from "@/lib/nav-groups"
import { navItemsForRoles } from "@/lib/auth/role-nav"
import { cn } from "@/lib/utils"

interface SidebarProps {
  activeModule: string
  onModuleChange: (module: any) => void
  userRole: UserRole
  /** All of the person's roles; the menu joins their screens. Defaults to [userRole]. */
  roles?: UserRole[]
  onLogout?: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ activeModule, onModuleChange, userRole, roles, onLogout, mobileOpen, onMobileClose }: SidebarProps) {
  const { t } = useI18n()
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({})

  const roleList = roles?.length ? roles : [userRole]
  const roleKey = roleList.join(",")

  // One count list per role; a screen two roles share shows the larger number.
  const fetchPendingCounts = useCallback(async () => {
    const merged: Record<string, number> = {}
    let any = false
    await Promise.all(
      roleKey.split(",").map(async (role) => {
        try {
          const response = await fetch(`/api/pending-counts?role=${role}`)
          if (!response.ok) return
          const data = (await response.json()) as Record<string, number>
          any = true
          for (const [id, n] of Object.entries(data || {})) merged[id] = Math.max(merged[id] || 0, Number(n) || 0)
        } catch {
          // silently fail
        }
      }),
    )
    if (any) setPendingCounts(merged)
  }, [roleKey])

  useEffect(() => {
    fetchPendingCounts()
    const interval = setInterval(fetchPendingCounts, 30000) // refresh every 30s
    // a suggestion hidden or shown again in "Waiting for you" updates the counter right away
    window.addEventListener("pending-counts-refresh", fetchPendingCounts)
    return () => {
      clearInterval(interval)
      window.removeEventListener("pending-counts-refresh", fetchPendingCounts)
    }
  }, [fetchPendingCounts])

  const modules = hideIdleApprovals(navItemsForRoles(roleList), pendingCounts)
  const groups = groupItems(modules)

  const sidebarContent = (
    <>
      <div className="flex flex-col gap-1 border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <img src="/images/image.png" alt={t("frame.logo-alt")} className="h-10 w-auto" />
          <h1 className="text-lg font-extrabold text-sidebar-foreground">{t("misr-motors")}</h1>
        </div>
        <p className="text-xs text-muted-foreground">{t(ROLE_DISPLAY_NAMES[userRole])}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {groups.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`group.${group}`)}
            </p>
            {items.map((module) => {
              const IconComponent = module.icon
              const count = module.disabled ? 0 : pendingCounts[module.id] || 0
              const active = activeModule === module.id
              return (
                <button
                  key={module.id}
                  type="button"
                  disabled={module.disabled}
                  aria-disabled={module.disabled || undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 max-md:min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-start text-sidebar-foreground transition-colors",
                    module.disabled
                      ? "cursor-not-allowed opacity-50"
                      : active
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "hover:bg-muted",
                  )}
                  onClick={() => {
                    if (module.disabled) return
                    onModuleChange(module.id)
                    onMobileClose?.()
                  }}
                >
                  <IconComponent className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(module.label)}</span>
                  {count > 0 && (
                    <span className="ms-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-700 px-1 text-xs font-bold text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {onLogout && (
        <div className="p-4 border-t border-sidebar-border">
          <Button variant="outline" className="w-full bg-transparent" onClick={onLogout}>
            {t("action.logout")}
          </Button>
        </div>
      )}
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex w-64 bg-sidebar border-e border-sidebar-border flex-col shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
          <div className="absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-sidebar border-e border-sidebar-border flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="absolute top-3 end-3">
              <Button variant="ghost" size="icon" onClick={onMobileClose} aria-label={t("a11y.close-menu")}>
                <X className="w-5 h-5" />
              </Button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
