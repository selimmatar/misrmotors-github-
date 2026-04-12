"use client"

import { useState } from "react"
import { AppProvider } from "@/lib/app-context"
import { SWRProvider } from "@/lib/swr-config"
import { LoginPage } from "@/components/auth/login-page"
import { Dashboard } from "@/components/dashboard/dashboard"
import type { User } from "@/lib/types"

export default function Home() {
  const [user, setUser] = useState<User | null>(null)

  const handleLogin = (userData: User) => {
    setUser(userData)
  }

  const handleLogout = () => {
    setUser(null)
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <SWRProvider>
      <AppProvider>
        <Dashboard user={user} onLogout={handleLogout} />
      </AppProvider>
    </SWRProvider>
  )
}
