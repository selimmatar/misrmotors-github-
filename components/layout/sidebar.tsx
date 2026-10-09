"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import type { UserRole } from "@/lib/types"
import { useI18n } from "@/lib/i18n-context"
import { ROLE_MODULES, ROLE_DISPLAY_NAMES } from "@/components/layout/nav-config"

interface SidebarProps {
  activeModule: string
  onModuleChange: (module: any) => void
  userRole: UserRole
  onLogout?: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ activeModule, onModuleChange, userRole, onLogout, mobileOpen, onMobileClose }: SidebarProps) {
  const { t } = useI18n()
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({})

  const fetchPendingCounts = useCallback(async () => {
    try {
      const response = await fetch(`/api/pending-counts?role=${userRole}`)
      if (response.ok) {
        const data = await response.json()
        setPendingCounts(data)
      }
    } catch {
      // silently fail
    }
  }, [userRole])

  useEffect(() => {
    fetchPendingCounts()
    const interval = setInterval(fetchPendingCounts, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchPendingCounts])

  const modules = ROLE_MODULES[userRole] || []

  const sidebarContent = (
    <>
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3 mb-2">
          <img src="/images/image.png" alt="Misr Motors Logo" className="h-12 w-auto" />
          <h1 className="text-xl font-bold text-sidebar-foreground">{t("misr-motors")}</h1>
        </div>
        <p className="text-sm text-sidebar-foreground/60">{t(ROLE_DISPLAY_NAMES[userRole])}</p>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {modules.map((module) => {
          const IconComponent = module.icon
          const count = pendingCounts[module.id] || 0
          return (
            <Button
              key={module.id}
              variant={activeModule === module.id ? "default" : "ghost"}
              className="w-full justify-start gap-3 relative"
              onClick={() => {
                onModuleChange(module.id)
                onMobileClose?.()
              }}
            >
              <IconComponent className="w-4 h-4" />
              <span className="flex-1 text-left">{t(module.label)}</span>
              {count > 0 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 min-w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-1">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Button>
          )
        })}
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
      <div className="hidden md:flex w-64 bg-sidebar border-r border-sidebar-border flex-col shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar border-r border-sidebar-border flex flex-col">
            <div className="absolute top-3 right-3">
              <Button variant="ghost" size="icon" onClick={onMobileClose} aria-label="Close menu">
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
