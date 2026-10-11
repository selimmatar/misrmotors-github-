"use client"
import type { User } from "@/lib/types"
import { LanguageToggle } from "./language-toggle"
import { useI18n } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Menu } from "lucide-react"
import { ROLE_DISPLAY_NAMES, ROLE_MODULES } from "@/components/layout/nav-config"
import { pageFor } from "@/lib/nav-groups"
import { initials } from "@/lib/format"

interface HeaderProps {
  user: User
  onLogout: () => void
  onMenuClick?: () => void
  activeModule: string
}

// Dark slate bar on a phone (menu, page title), white on a laptop (group label). Language and the user chip
// sit at the end.
export function Header({ user, onMenuClick, activeModule }: HeaderProps) {
  const { t } = useI18n()
  const page = pageFor(activeModule, ROLE_MODULES[user.role] || [])
  const roleLabel = t(ROLE_DISPLAY_NAMES[user.role])

  return (
    <header className="bg-strong text-strong-foreground md:bg-card md:text-foreground border-b box-content h-14 pt-[env(safe-area-inset-top)] px-3 md:px-6 flex items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden shrink-0"
        onClick={onMenuClick}
        aria-label={t("a11y.open-menu")}
      >
        <Menu className="w-5 h-5" />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold md:hidden">{t(page.labelKey)}</p>
        <p className="hidden truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground md:block">
          {t(`group.${page.group}`)}
        </p>
      </div>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <LanguageToggle className="bg-transparent border-white/30 md:border-input" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("nav.account")}
              className="flex items-center justify-center gap-2 rounded-md p-1 max-md:min-h-11 max-md:min-w-11 hover:bg-white/10 md:px-2 md:hover:bg-muted"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-strong text-xs font-bold text-strong-foreground ring-1 ring-white/40 md:ring-0">
                {initials(user.name)}
              </span>
              <span className="hidden min-w-0 max-w-48 flex-col text-start md:flex">
                <span className="truncate text-sm font-semibold">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{user.name}</span>
              <span className="text-xs font-normal">{roleLabel}</span>
              <span className="break-all text-xs font-normal text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
