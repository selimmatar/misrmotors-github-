"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard,
  ShoppingCart,
  Building2,
  Warehouse,
  CreditCard,
  Users,
  TrendingUp,
  DollarSign,
  Package,
  UsersIcon,
  Wallet,
  Sparkles,
  TrendingUpIcon,
  Settings,
  BarChart3,
  Calculator,
  PackageX,
  ClipboardCheck,
  CheckSquare,
  Activity,
  FileText,
  Truck,
  UserCog,
  ArrowLeftRight,
  Wrench,
} from "lucide-react"
import type { UserRole } from "@/lib/types"
import { useI18n } from "@/lib/i18n-context"

interface SidebarProps {
  activeModule: string
  onModuleChange: (module: any) => void
  userRole: UserRole
  onLogout?: () => void
}

export function Sidebar({ activeModule, onModuleChange, userRole, onLogout }: SidebarProps) {
  const { t } = useI18n()
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({})

  const fetchPendingCounts = useCallback(async () => {
    try {
      const response = await fetch(`/api/pending-counts?role=${userRole}`)
      if (response.ok) {
        const data = await response.json()
        setPendingCounts(data)
      }
    } catch {
      // silently fail
    }
  }, [userRole])

  useEffect(() => {
    fetchPendingCounts()
    const interval = setInterval(fetchPendingCounts, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchPendingCounts])

  const roleModules: Record<UserRole, Array<{ id: string; label: string; icon: any }>> = {
    admin: [
      { id: "user-management", label: "module.user-management", icon: UsersIcon },
      { id: "hr-management", label: "module.hr-management", icon: UserCog },
      { id: "metrics-validation", label: "module.metrics-validation", icon: CheckSquare },
      { id: "system-health", label: "module.system-health", icon: Activity },
    ],
    ceo: [
      { id: "dashboard", label: "module.dashboard", icon: LayoutDashboard },
      { id: "analytics", label: "module.analytics", icon: BarChart3 },
      { id: "ceo-chat", label: "module.ceo-chat", icon: Sparkles },
      { id: "hr-management", label: "module.hr-management", icon: UserCog },
      { id: "suppliers", label: "module.suppliers", icon: Building2 },
      { id: "products", label: "module.products", icon: Package },
      { id: "po-requests", label: "module.po-requests", icon: FileText },
      { id: "purchase-orders", label: "module.purchase-orders", icon: ShoppingCart },
      { id: "pricing-review", label: "module.pricing-review", icon: TrendingUpIcon },
      { id: "costing-settings", label: "module.costing-settings", icon: Settings },
      { id: "inventory", label: "module.inventory", icon: Warehouse },
      { id: "inventory-audit", label: "module.inventory-audit", icon: ClipboardCheck },
      { id: "goods-receipt-tracking", label: "module.goods-receipt-tracking", icon: ClipboardCheck },
      { id: "reorder-suggestions", label: "module.reorder-suggestions", icon: Calculator },
      { id: "lost-sales", label: "module.lost-sales", icon: PackageX },
      { id: "accounts-payable", label: "module.accounts-payable", icon: CreditCard },
      { id: "customers", label: "module.customers", icon: Users },
      { id: "sales-orders", label: "module.sales-orders", icon: TrendingUp },
      { id: "approve-sales-quotations", label: "module.approve-sales-quotations", icon: CheckSquare },
      { id: "delivery-permits", label: "module.delivery-permits", icon: FileText },
      { id: "accounts-receivable", label: "module.accounts-receivable", icon: DollarSign },
      { id: "balance", label: "module.balance", icon: Wallet },
      { id: "metrics-validation", label: "module.metrics-validation", icon: CheckSquare },
      { id: "system-health", label: "module.system-health", icon: Activity },
    ],
    accountant: [
      { id: "dashboard", label: "module.dashboard", icon: LayoutDashboard },
      { id: "analytics", label: "module.analytics", icon: BarChart3 },
      { id: "approve-sales-orders", label: "module.approve-sales-orders", icon: CheckSquare },
      { id: "payment-schedule", label: "module.payment-schedule", icon: DollarSign },
      { id: "purchase-orders", label: "module.purchase-orders", icon: ShoppingCart },
      { id: "pricing-review", label: "module.pricing-review", icon: TrendingUpIcon },
      { id: "costing-settings", label: "module.costing-settings", icon: Settings },
      { id: "accounts-payable", label: "module.accounts-payable", icon: CreditCard },
      { id: "accounts-receivable", label: "module.accounts-receivable", icon: DollarSign },
      { id: "maintenance-invoices", label: "Maintenance", icon: Wrench },
      { id: "customers", label: "module.customers", icon: Users },
      { id: "suppliers", label: "module.suppliers", icon: Building2 },
      { id: "delivery-permits", label: "module.delivery-permits", icon: FileText },
      { id: "balance", label: "module.balance", icon: Wallet },
    ],
    "sales-rep": [
      { id: "dashboard", label: "module.dashboard", icon: LayoutDashboard },
      { id: "analytics", label: "module.analytics", icon: BarChart3 },
      { id: "customers", label: "module.customers", icon: Users },
      { id: "sales-orders", label: "module.sales-orders", icon: TrendingUp },
      { id: "approve-sales-quotations", label: "module.approve-sales-quotations", icon: CheckSquare },
      { id: "delivery-permits", label: "module.delivery-permits", icon: FileText },
      { id: "inventory", label: "module.inventory", icon: Warehouse },
      { id: "lost-sales", label: "module.lost-sales", icon: PackageX },
      { id: "accounts-receivable", label: "module.accounts-receivable", icon: DollarSign },
      { id: "operations-management", label: "module.operations-management", icon: Wrench },
    ],
    "warehouse-rep": [
      { id: "dashboard", label: "module.dashboard", icon: LayoutDashboard },
      { id: "inventory", label: "module.inventory", icon: Warehouse },
      { id: "inventory-audit", label: "module.inventory-audit", icon: ClipboardCheck },
      { id: "warehouse-transfers", label: "module.warehouse-transfers", icon: ArrowLeftRight },
      { id: "warehouse-delivery", label: "module.warehouse-delivery", icon: Package },
      { id: "delivery-permits", label: "module.delivery-permits", icon: FileText },
      { id: "goods-receipt", label: "module.goods-receipt", icon: Package },
      { id: "goods-receipt-tracking", label: "module.goods-receipt-tracking", icon: ClipboardCheck },
    ],
    "po-rep": [
      { id: "dashboard", label: "module.dashboard", icon: LayoutDashboard },
      { id: "analytics", label: "module.analytics", icon: BarChart3 },
      { id: "suppliers", label: "module.suppliers", icon: Building2 },
      { id: "products", label: "module.products", icon: Package },
      { id: "po-requests", label: "module.po-requests", icon: FileText },
      { id: "purchase-orders", label: "module.purchase-orders", icon: ShoppingCart },
      { id: "goods-receipt-tracking", label: "module.goods-receipt-tracking", icon: ClipboardCheck },
      { id: "inventory", label: "module.inventory", icon: Warehouse },
      { id: "reorder-suggestions", label: "module.reorder-suggestions", icon: Calculator },
      { id: "lost-sales", label: "module.lost-sales", icon: PackageX },
    ],
    shipment: [
      { id: "shipment", label: "module.shipping", icon: Truck },
      { id: "courier-management", label: "module.courier-management", icon: UserCog },
      { id: "delivery-permits", label: "module.delivery-permits", icon: FileText },
      { id: "operations-management", label: "module.operations-management", icon: Users },
    ],
  }

  const modules = roleModules[userRole] || []

  const roleDisplayNames: Record<UserRole, string> = {
    admin: "role.administrator",
    ceo: "role.ceo",
    accountant: "role.accountant",
    "sales-rep": "role.sales-rep",
    "warehouse-rep": "role.warehouse-rep",
    "po-rep": "role.po-rep",
    shipment: "role.shipment",
  }

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3 mb-2">
          <img src="/images/image.png" alt="Misr Motors Logo" className="h-12 w-auto" />
          <h1 className="text-xl font-bold text-sidebar-foreground">{t("misr-motors")}</h1>
        </div>
        <p className="text-sm text-sidebar-foreground/60">{t(roleDisplayNames[userRole])}</p>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {modules.map((module) => {
          const IconComponent = module.icon
          const count = pendingCounts[module.id] || 0
          return (
            <Button
              key={module.id}
              variant={activeModule === module.id ? "default" : "ghost"}
              className="w-full justify-start gap-3 relative"
              onClick={() => onModuleChange(module.id)}
            >
              <IconComponent className="w-4 h-4" />
              <span className="flex-1 text-left">{t(module.label)}</span>
              {count > 0 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 min-w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-1">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Button>
          )
        })}
      </nav>

      {onLogout && (
        <div className="p-4 border-t border-sidebar-border">
          <Button variant="outline" className="w-full bg-transparent" onClick={onLogout}>
            {t("action.logout")}
          </Button>
        </div>
      )}
    </div>
  )
}
