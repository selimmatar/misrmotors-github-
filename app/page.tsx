"use client"

import { useCallback, useEffect, useState } from "react"
import { AppProvider } from "@/lib/app-context"
import { SWRProvider } from "@/lib/swr-config"
import { LoginPage } from "@/components/auth/login-page"
import { ChangePasswordScreen } from "@/components/auth/change-password-screen"
import type { LoggedInUser } from "@/components/auth/account-login"
import { Dashboard } from "@/components/dashboard/dashboard"
import { toast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { installAuthFetch } from "@/lib/auth/client-fetch"
import { isRole } from "@/lib/auth/roles"
import { primaryRole } from "@/lib/auth/role-nav"
import type { User, UserRole } from "@/lib/types"

type Mode = "off" | "test" | "on"

function toUser(u: LoggedInUser & { email?: string | null; username?: string | null }): User | null {
  const roles = (u.roles || []).filter(isRole) as UserRole[]
  const role = primaryRole(roles)
  if (!role) return null
  return { id: String(u.userId), userId: u.userId, name: u.name, email: u.email || u.username || "", password: "", role, roles }
}

export default function Home() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()

  // Who is logged in (also tells the screen whether logins are switched on).
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { mode: "off", user: null }))
      .then((body) => {
        setMode(body?.mode === "on" || body?.mode === "test" ? body.mode : "off")
        const u = body?.user ? toUser(body.user) : null
        if (u) {
          setUser(u)
          setMustChange(!!body.user.mustChangePassword)
        }
      })
      .catch(() => setMode("off"))
  }, [])

  const handleLogout = useCallback(() => {
    setUser(null)
    setMustChange(false)
    fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined)
  }, [])

  // A finished login ("Please log in") anywhere in the app returns here; "not allowed" only shows a message.
  useEffect(
    () =>
      installAuthFetch({
        onLogout: () => {
          setUser(null)
          setMustChange(false)
          setNotice(t("signin.session-ended"))
          // Close the session on the server too (logout is always allowed, so this can never loop).
          fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined)
        },
        onForbidden: () => toast({ title: t("signin.no-permission"), variant: "destructive" }),
      }),
    [t],
  )

  const handleAccountLogin = (u: LoggedInUser) => {
    const next = toUser(u)
    if (!next) return
    setNotice(undefined)
    setUser(next)
    setMustChange(!!u.mustChangePassword)
  }

  if (mode === null) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">{t("signin.loading")}</div>
  }

  if (!user) {
    return <LoginPage mode={mode} onLogin={setUser} onAccountLogin={handleAccountLogin} notice={notice} />
  }

  if (mustChange) {
    return <ChangePasswordScreen onDone={() => setMustChange(false)} onLogout={handleLogout} />
  }

  return (
    <SWRProvider>
      <AppProvider>
        <Dashboard user={user} onLogout={handleLogout} />
      </AppProvider>
    </SWRProvider>
  )
}
