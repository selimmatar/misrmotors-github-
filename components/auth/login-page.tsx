"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserIcon, Package, DollarSign, ShoppingCart, Warehouse, Shield } from "lucide-react"
import type { User } from "@/lib/types"
import type { StatusTone } from "@/lib/status-tone"
import { useI18n } from "@/lib/i18n-context"

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
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useI18n()
  const handleRoleSelection = (role: User["role"], name: string) => {
    const user: User = {
      id: `${role}-${Date.now()}`,
      name: name,
      email: `${role}@misrmotors.com`,
      password: "",
      role: role,
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            <img src="/images/image.png" alt={t("frame.logo-alt")} className="h-24 w-auto" />
          </div>
          <CardTitle className="text-3xl">{t("misr-motors")}</CardTitle>
          <CardDescription className="text-lg">Select your role to access the system</CardDescription>
        </CardHeader>
        <CardContent>
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
