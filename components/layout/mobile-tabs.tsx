"use client"

import { useState } from "react"
import {
  DollarSign,
  Home,
  LayoutDashboard,
  Menu,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { NavItem } from "@/components/layout/nav-config"
import { buildMobileTabs, groupFor, type GroupId } from "@/lib/nav-groups"
import { useI18n } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"

const GROUP_ICON: Record<GroupId, LucideIcon> = {
  overview: LayoutDashboard,
  sales: TrendingUp,
  purchasing: ShoppingCart,
  inventory: Warehouse,
  finance: DollarSign,
  operations: Truck,
  admin: Settings,
}

interface MobileTabsProps {
  items: NavItem[]
  activeModule: string
  onNavigate: (id: string) => void
  onOpenMenu: () => void
}

// Phone bottom bar: Home, up to 3 of the role's groups, Menu (spec §5). A group with several items opens a
// bottom sheet; Menu opens the full drawer.
export function MobileTabs({ items, activeModule, onNavigate, onOpenMenu }: MobileTabsProps) {
  const { t } = useI18n()
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null)
  const tabs = buildMobileTabs(items)
  const homeActive = tabs.some((tab) => tab.kind === "home" && tab.moduleId === activeModule)
  const activeGroup = groupFor(activeModule)
  const sheetTab = tabs.find((tab) => tab.kind === "group" && tab.group === openGroup)
  const sheetItems = sheetTab?.kind === "group" ? sheetTab.items : []

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs",
      active ? "font-semibold text-link" : "text-muted-foreground",
    )

  return (
    <>
      <nav
        aria-label={t("nav.menu")}
        className="fixed inset-x-0 bottom-0 z-40 md:hidden bg-card border-t pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => {
            if (tab.kind === "home") {
              return (
                <button
                  key="home"
                  type="button"
                  aria-current={homeActive ? "page" : undefined}
                  className={tabClass(homeActive)}
                  onClick={() => onNavigate(tab.moduleId)}
                >
                  <Home className="size-5" />
                  <span className="max-w-full truncate px-1">{t("nav.home")}</span>
                </button>
              )
            }
            if (tab.kind === "group") {
              // Home wins when its module also sits in this group (admin, shipping), so one tab is current.
              const active = !homeActive && activeGroup === tab.group
              const Icon = GROUP_ICON[tab.group]
              return (
                <button
                  key={tab.group}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                  onClick={() => (tab.items.length === 1 ? onNavigate(tab.items[0].id) : setOpenGroup(tab.group))}
                >
                  <Icon className="size-5" />
                  <span className="max-w-full truncate px-1">{t(`group.${tab.group}`)}</span>
                </button>
              )
            }
            return (
              <button key="menu" type="button" className={tabClass(false)} onClick={onOpenMenu}>
                <Menu className="size-5" />
                <span className="max-w-full truncate px-1">{t("nav.menu")}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <Sheet open={openGroup !== null} onOpenChange={(open) => !open && setOpenGroup(null)}>
        <SheetContent side="bottom" className="bg-card rounded-t-xl pb-[env(safe-area-inset-bottom)]">
          {/* The sheet's close button is pinned physically right; clear it on whichever side it lands. */}
          <SheetHeader className="pe-10 rtl:pe-4 rtl:ps-10">
            <SheetTitle>{openGroup ? t(`group.${openGroup}`) : ""}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1 px-2 pb-4">
            {sheetItems.map((item) => {
              const Icon = item.icon
              const active = item.id === activeModule
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-start",
                    active ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" : "hover:bg-muted",
                  )}
                  onClick={() => {
                    onNavigate(item.id)
                    setOpenGroup(null)
                  }}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{t(item.label)}</span>
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
