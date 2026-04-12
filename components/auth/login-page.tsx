"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserIcon, Package, DollarSign, ShoppingCart, Warehouse, Shield } from "lucide-react"
import type { User } from "@/lib/types"

interface LoginPageProps {
  onLogin: (user: User) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
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
      description: "System administration and user management",
      color: "bg-red-500 hover:bg-red-600",
    },
    {
      role: "ceo" as const,
      name: "CEO / Owner",
      icon: UserIcon,
      description: "Executive dashboard and approvals",
      color: "bg-purple-500 hover:bg-purple-600",
    },
    {
      role: "accountant" as const,
      name: "Accountant",
      icon: DollarSign,
      description: "Financial management and invoice approval",
      color: "bg-green-500 hover:bg-green-600",
    },
    {
      role: "sales-rep" as const,
      name: "Sales Representative",
      icon: ShoppingCart,
      description: "Sales orders and customer management",
      color: "bg-blue-500 hover:bg-blue-600",
    },
    {
      role: "po-rep" as const,
      name: "Purchasing Agent",
      icon: Package,
      description: "Purchase orders and supplier management",
      color: "bg-orange-500 hover:bg-orange-600",
    },
    {
      role: "warehouse-rep" as const,
      name: "Warehouse Representative",
      icon: Warehouse,
      description: "Inventory and warehouse operations",
      color: "bg-teal-500 hover:bg-teal-600",
    },
    {
      role: "shipment" as const,
      name: "Shipping & Operations",
      icon: Package,
      description: "Delivery, shipment and operations management",
      color: "bg-indigo-500 hover:bg-indigo-600",
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            <img src="/images/image.png" alt="Misr Motors Logo" className="h-24 w-auto" />
          </div>
          <CardTitle className="text-3xl">Misr Motors</CardTitle>
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
                  className={`h-auto p-6 flex flex-col items-center gap-3 text-white border-white/20 ${roleData.color} transition-all hover:scale-105`}
                  onClick={() => handleRoleSelection(roleData.role, roleData.name)}
                >
                  <Icon className="h-12 w-12" />
                  <div className="text-center">
                    <div className="font-semibold text-lg">{roleData.name}</div>
                    <div className="text-xs text-white/80 mt-1">{roleData.description}</div>
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
