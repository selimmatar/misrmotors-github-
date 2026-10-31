"use client"

import { useState } from "react"

// Reached from the emailed "reset password" link (after /auth/callback logged the person in).
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password.length < 8) return setError("Password must be at least 8 characters / كلمة المرور 8 أحرف على الأقل")
    if (password !== again) return setError("The two passwords are different / كلمتا المرور غير متطابقتين")
    setBusy(true)
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {}
      return setError(body?.error || "Could not change the password / تعذر تغيير كلمة المرور")
    }
    window.location.href = "/"
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold">Set a new password · تعيين كلمة مرور جديدة</h1>
        <input
          type="password"
          autoComplete="new-password"
          className="w-full rounded-md border px-3 py-2"
          placeholder="New password · كلمة المرور الجديدة"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          className="w-full rounded-md border px-3 py-2"
          placeholder="Type it again · أعد كتابتها"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-3 py-2 text-primary-foreground">
          {busy ? "…" : "Save · حفظ"}
        </button>
      </form>
    </main>
  )
}
