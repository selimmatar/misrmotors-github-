"use client"
import type { User } from "@/lib/types"
import { useAppContext } from "@/lib/app-context"
import { LanguageToggle } from "./language-toggle"
import { useI18n } from "@/lib/i18n-context"

interface HeaderProps {
  user: User
  onLogout: () => void
}

export function Header({ user, onLogout }: HeaderProps) {
  const { resetAllData } = useAppContext()
  const { t } = useI18n()

  const handleReset = () => {
    resetAllData()
  }

  return (
    <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold">
          {t("welcome")}, {user.name}
        </h2>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <LanguageToggle />
      </div>
    </header>
  )
}
