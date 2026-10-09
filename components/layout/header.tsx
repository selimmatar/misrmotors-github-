"use client"
import type { User } from "@/lib/types"
import { LanguageToggle } from "./language-toggle"
import { useI18n } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"

interface HeaderProps {
  user: User
  onLogout: () => void
  onMenuClick?: () => void
}

export function Header({ user, onLogout, onMenuClick }: HeaderProps) {
  const { t } = useI18n()

  return (
    <header className="bg-card border-b border-border px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold truncate">
            {t("welcome")}, {user.name}
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground truncate">{user.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <LanguageToggle />
      </div>
    </header>
  )
}
