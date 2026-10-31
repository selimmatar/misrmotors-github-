"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/lib/i18n-context"

// First login with a temporary password: the person picks their own before seeing the app.
export function ChangePasswordScreen({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const { t } = useI18n()
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password.length < 8) return setError(t("signin.too-short"))
    if (password !== again) return setError(t("signin.mismatch"))
    setBusy(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) return setError(t("signin.change-failed"))
      onDone()
    } catch {
      setError(t("signin.change-failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("signin.change-title")}</CardTitle>
          <CardDescription>{t("signin.change-help")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("signin.new-password")}</Label>
              <Input id="new-password" type="password" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repeat-password">{t("signin.repeat-password")}</Label>
              <Input id="repeat-password" type="password" dir="ltr" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {t("signin.save-continue")}
            </Button>
            <Button type="button" variant="link" className="px-0" onClick={onLogout}>
              {t("signin.log-out")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
