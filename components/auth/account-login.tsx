"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"

export interface LoggedInUser {
  userId: number
  name: string
  roles: string[]
  mustChangePassword: boolean
}

const ERROR_KEY: Record<string, string> = {
  BAD_LOGIN: "signin.bad-login",
  ACCOUNT_OFF: "signin.account-off",
}

// "Email or username" + password, and the "forgot password" email form.
export function AccountLogin({ onLoggedIn, notice }: { onLoggedIn: (user: LoggedInUser) => void; notice?: string }) {
  const { t } = useI18n()
  const [view, setView] = useState<"login" | "forgot" | "sent">("login")
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.user) {
        setError(t(ERROR_KEY[body?.code] || "signin.failed"))
        return
      }
      setPassword("")
      onLoggedIn(body.user)
    } catch {
      setError(t("signin.failed"))
    } finally {
      setBusy(false)
    }
  }

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    setBusy(false)
    setView("sent")
  }

  if (view !== "login") {
    return (
      <form onSubmit={sendReset} className="space-y-4">
        <h2 className="text-lg font-semibold">{t("signin.forgot-title")}</h2>
        {view === "sent" ? (
          <p role="status" className="text-sm">{t("signin.forgot-sent")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("signin.forgot-help")}</p>
            <div className="space-y-2">
              <Label htmlFor="forgot-email">{t("signin.email")}</Label>
              <Input id="forgot-email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
              {t("signin.forgot-send")}
            </Button>
          </>
        )}
        <Button type="button" variant="link" className="px-0" onClick={() => setView("login")}>
          {t("signin.back")}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {notice && <p role="status" className="rounded-md bg-tone-waiting-bg px-3 py-2 text-sm text-tone-waiting">{notice}</p>}
      <div className="space-y-2">
        <Label htmlFor="login-id">{t("signin.identifier")}</Label>
        <Input id="login-id" dir="ltr" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">{t("signin.password")}</Label>
        <div className="flex gap-2">
          <Input
            id="login-password"
            dir="ltr"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => setShow((s) => !s)} aria-label={t(show ? "signin.hide-password" : "signin.show-password")}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !identifier.trim() || !password}>
        {busy ? t("signin.signing-in") : t("signin.submit")}
      </Button>
      <Button type="button" variant="link" className="px-0" onClick={() => setView("forgot")}>
        {t("signin.forgot")}
      </Button>
    </form>
  )
}
