"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserIcon, Package, DollarSign, ShoppingCart, Warehouse, Shield } from "lucide-react"
import type { User } from "@/lib/types"
import type { StatusTone } from "@/lib/status-tone"
import { useI18n } from "@/lib/i18n-context"
import { useState } from "react"
import { AccountLogin, type LoggedInUser } from "@/components/auth/account-login"

const TONE_ICON: Record<StatusTone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral",
  waiting: "bg-tone-waiting-bg text-tone-waiting",
  approved: "bg-tone-approved-bg text-tone-approved",
  ready: "bg-tone-ready-bg text-tone-ready",
  done: "bg-tone-done-bg text-tone-done",
  danger: "bg-tone-danger-bg text-tone-danger",
}

interface LoginPageProps {
  onLogin: (user: User) => void
  /** AUTH_MODE from /api/auth/me. "off": the role picker stays, with an account login beside it. */
  mode: "off" | "test" | "on"
  onAccountLogin: (user: LoggedInUser) => void
  notice?: string
}

export function LoginPage({ onLogin, mode, onAccountLogin, notice }: LoginPageProps) {
  const { t } = useI18n()
  const [showAccount, setShowAccount] = useState(Boolean(notice))
  const handleRoleSelection = (role: User["role"], name: string) => {
    const user: User = {
      id: `${role}-${Date.now()}`,
      name: name,
      email: `${role}@misrmotors.com`,
      password: "",
      role: role,
      roles: [role],
    }
    onLogin(user)
  }

  const roles = [
    {
      role: "admin" as const,
      name: "Administrator",
      icon: Shield,
      labelKey: "login.role.admin",
      descriptionKey: "login.desc.admin",
      tone: "danger" as StatusTone,
    },
    {
      role: "ceo" as const,
      name: "CEO / Owner",
      icon: UserIcon,
      labelKey: "login.role.ceo",
      descriptionKey: "login.desc.ceo",
      tone: "ready" as StatusTone,
    },
    {
      role: "accountant" as const,
      name: "Accountant",
      icon: DollarSign,
      labelKey: "login.role.accountant",
      descriptionKey: "login.desc.accountant",
      tone: "done" as StatusTone,
    },
    {
      role: "sales-rep" as const,
      name: "Sales Representative",
      icon: ShoppingCart,
      labelKey: "login.role.sales-rep",
      descriptionKey: "login.desc.sales-rep",
      tone: "approved" as StatusTone,
    },
    {
      role: "po-rep" as const,
      name: "Purchasing Agent",
      icon: Package,
      labelKey: "login.role.po-rep",
      descriptionKey: "login.desc.po-rep",
      tone: "waiting" as StatusTone,
    },
    {
      role: "warehouse-rep" as const,
      name: "Warehouse Representative",
      icon: Warehouse,
      labelKey: "login.role.warehouse-rep",
      descriptionKey: "login.desc.warehouse-rep",
      tone: "neutral" as StatusTone,
    },
    {
      role: "shipment" as const,
      name: "Shipping & Operations",
      icon: Package,
      labelKey: "login.role.shipment",
      descriptionKey: "login.desc.shipment",
      tone: "approved" as StatusTone,
    },
  ]

  // Logins switched on (or in test): accounts only. Switched off: the old role picker stays, with an account login above it.
  const pickerAllowed = mode === "off"
  if (!pickerAllowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-2 text-center">
            <div className="flex justify-center mb-2">
              <img src="/images/image.png" alt={t("frame.logo-alt")} className="h-20 w-auto" />
            </div>
            <CardTitle className="text-2xl">{t("signin.title")}</CardTitle>
            <CardDescription>{t("signin.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountLogin onLoggedIn={onAccountLogin} notice={notice} />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            <img src="/images/image.png" alt={t("frame.logo-alt")} className="h-24 w-auto" />
          </div>
          <CardTitle className="text-3xl">{t("misr-motors")}</CardTitle>
          <CardDescription className="text-lg">{t("login.select-role")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="mx-auto w-full max-w-md">
            {showAccount ? (
              <AccountLogin onLoggedIn={onAccountLogin} notice={notice} />
            ) : (
              <Button className="w-full" onClick={() => setShowAccount(true)}>
                {t("signin.use-account")}
              </Button>
            )}
          </div>
          <p className="text-center text-sm text-muted-foreground">{t("signin.or-pick-role")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((roleData) => {
              const Icon = roleData.icon
              return (
                <Button
                  key={roleData.role}
                  variant="outline"
                  className="h-auto p-5 flex flex-col items-center gap-3 whitespace-normal bg-card text-foreground hover:border-primary hover:bg-card hover:text-foreground"
                  onClick={() => handleRoleSelection(roleData.role, roleData.name)}
                >
                  <span className={`flex size-12 items-center justify-center rounded-full ${TONE_ICON[roleData.tone]}`}>
                    <Icon className="size-6" />
                  </span>
                  <div className="text-center">
                    <div className="font-semibold text-base">{t(roleData.labelKey)}</div>
                    <div className="text-xs text-muted-foreground mt-1">{t(roleData.descriptionKey)}</div>
                  </div>
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
