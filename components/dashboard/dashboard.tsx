"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { PurchaseOrderModule } from "@/components/modules/purchase-order-module"
import { PORequestModule } from "@/components/modules/po-request-module"
import { SupplierModule } from "@/components/modules/supplier-module"
import { AccountsPayableModule } from "@/components/modules/accounts-payable-module"
import { CustomerModule } from "@/components/modules/customer-module"
import { SalesOrderModule } from "@/components/modules/sales-order-module"
import { AccountsReceivableModule } from "@/components/modules/accounts-receivable-module"
import { FinancialDashboard } from "@/components/modules/financial-dashboard"
import { InventoryModule } from "@/components/modules/inventory-module"
import { ProductModule } from "@/components/modules/product-module"
import { PricingReviewModule } from "@/components/modules/pricing-review-module"
import { InventoryCostingSettings } from "@/components/modules/inventory-costing-settings"
import { AIAssistantModule } from "@/components/modules/ai-assistant-module"
import { UserManagementModule } from "@/components/modules/user-management-module"
import { AccountantModule } from "@/components/modules/accountant-module"
import { ApproveSalesOrdersModule } from "@/components/modules/approve-sales-orders-module"
import { PaymentScheduleModule } from "@/components/modules/payment-schedule-module"
import { ShippingModule } from "@/components/modules/shipping-module"
import { BalanceModule } from "@/components/modules/balance-module"
import { GoodsReceiptModule } from "@/components/modules/goods-receipt-module"
import { AnalyticsDashboard } from "@/components/modules/analytics-dashboard"
import { CEOChatAssistant } from "@/components/modules/ceo-chat-assistant"
import { ReorderSuggestionsModule } from "@/components/modules/reorder-suggestions-module"
import { LostSalesModule } from "@/components/modules/lost-sales-module"
import { InventoryAuditModule } from "@/components/modules/inventory-audit-module"
import MetricsValidationModule from "@/components/modules/metrics-validation-module"
import { SystemHealthModule } from "@/components/modules/system-health-module"
import DeliveryPermitsModule from "@/components/modules/delivery-permits-module" // Added delivery-permits module type
import { SalesQuotationModule } from "@/components/modules/sales-quotation-module" // Import SalesQuotationModule
import { ApproveSalesQuotationsModule } from "@/components/modules/approve-sales-quotations-module"
import { WarehouseDeliveryModule } from "@/components/modules/warehouse-delivery-module" // Import WarehouseDeliveryModule
import { CourierManagementModule } from "@/components/modules/courier-management-module" // Import CourierManagementModule
import { HRManagementModule } from "@/components/modules/hr-management-module" // Import HR Management Module
import { WarehouseTransfersModule } from "@/components/modules/warehouse-transfers-module"
import { GoodsReceiptTrackingModule } from "@/components/modules/goods-receipt-tracking-module"
import { MaintenanceInvoicesModule } from "@/components/modules/maintenance-invoices-module"
import { OperationsManagementModule } from "@/components/modules/operations-management-module"
import type { User } from "@/lib/types"

interface DashboardProps {
  user: User
  onLogout: () => void
}

type ModuleType =
  | "dashboard"
  | "purchase-orders"
  | "suppliers"
  | "accounts-payable"
  | "customers"
  | "sales-orders"
  | "accounts-receivable"
  | "inventory"
  | "inventory-audit"
  | "products"
  | "pricing-review"
  | "costing-settings"
  | "ai-assistant"
  | "user-management"
  | "accountant"
  | "approve-sales-orders"
  | "shipment"
  | "balance"
  | "goods-receipt"
  | "upcoming-orders"
  | "previous-orders"
  | "analytics"
  | "ceo-chat"
  | "reorder-suggestions"
  | "lost-sales"
  | "metrics-validation"
  | "system-health"
  | "delivery-permits" // Added delivery-permits module type
  | "sales-quotations" // Added sales-quotations module type
  | "approve-sales-quotations" // Added approve-sales-quotations module type
  | "warehouse-delivery" // Added warehouse-delivery module type
  | "courier-management" // Added courier-management module type
  | "hr-management" // Added HR management module type
  | "warehouse-transfers" // Added warehouse-transfers module type
  | "goods-receipt-tracking" // Added goods-receipt-tracking module type
  | "payment-schedule" // Added payment-schedule module type
  | "maintenance-invoices" // Added maintenance-invoices module type
  | "operations-management" // Added operations-management module type

export function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeModule, setActiveModule] = useState<ModuleType>(user.role === "shipment" ? "shipment" : "dashboard")
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    const handleNavigate = (event: CustomEvent) => {
      setActiveModule(event.detail as ModuleType)
    }
    window.addEventListener("navigate-to-module", handleNavigate as EventListener)
    return () => {
      window.removeEventListener("navigate-to-module", handleNavigate as EventListener)
    }
  }, [])

  const renderModule = () => {
    if (user.role === "admin") {
      if (activeModule === "system-health") {
        return <SystemHealthModule />
      }
      if (activeModule === "metrics-validation") {
        return <MetricsValidationModule />
      }
      if (activeModule === "hr-management") {
        return <HRManagementModule userRole={user.role} />
      }
      return <UserManagementModule />
    }
    switch (activeModule) {
      case "analytics":
        return <AnalyticsDashboard userRole={user.role} />
case "po-requests":
  return <PORequestModule />
  case "purchase-orders":
  return <PurchaseOrderModule userRole={user.role} />
      case "suppliers":
        return <SupplierModule userRole={user.role} />
      case "accounts-payable":
        return <AccountsPayableModule />
      case "accountant":
        return <AccountantModule />
      case "approve-sales-orders":
        return <ApproveSalesOrdersModule />
      case "payment-schedule":
        return <PaymentScheduleModule />
      case "customers":
        return <CustomerModule userRole={user.role} />
      case "sales-orders":
        return <SalesOrderModule userRole={user.role} />
      case "accounts-receivable":
        return <AccountsReceivableModule userRole={user.role} />
      case "maintenance-invoices":
        return <MaintenanceInvoicesModule />
      case "inventory":
        return <InventoryModule userRole={user.role} />
      case "inventory-audit":
        return <InventoryAuditModule userRole={user.role} />
      case "products":
        return <ProductModule />
      case "pricing-review":
        return <PricingReviewModule userRole={user.role} />
      case "costing-settings":
        return <InventoryCostingSettings />
      case "ai-assistant":
        return <AIAssistantModule userRole={user.role} />
      case "ceo-chat":
        return <CEOChatAssistant />
      case "reorder-suggestions":
        return <ReorderSuggestionsModule />
      case "lost-sales":
        return <LostSalesModule userRole={user.role} />
      case "metrics-validation":
        return <MetricsValidationModule />
      case "system-health":
        return <SystemHealthModule />
      case "hr-management":
        return <HRManagementModule userRole={user.role} />
      case "delivery-permits":
        return <DeliveryPermitsModule userRole={user.role} />
      case "sales-quotations":
        return <SalesQuotationModule userRole={user.role} />
      case "approve-sales-quotations":
        return <ApproveSalesQuotationsModule userRole={user.role} />
      case "warehouse-delivery":
        return <WarehouseDeliveryModule />
      case "warehouse-transfers":
        return <WarehouseTransfersModule userRole={user.role} />
      case "courier-management":
        return <CourierManagementModule />
      case "operations-management":
        return <OperationsManagementModule />
      case "shipment":
      case "upcoming-orders":
      case "previous-orders":
        return <ShippingModule />
      case "balance":
        return <BalanceModule />
      case "goods-receipt":
        return <GoodsReceiptModule />
      case "goods-receipt-tracking":
        return <GoodsReceiptTrackingModule />
      case "dashboard":
      default:
        if (user.role === "shipment") {
          return <ShippingModule />
        }
        return <FinancialDashboard user={user} />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeModule={activeModule}
        onModuleChange={setActiveModule}
        userRole={user.role}
        onLogout={onLogout}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header user={user} onLogout={onLogout} onMenuClick={() => setMobileSidebarOpen(true)} />
        <main className="flex-1 overflow-auto p-4 md:p-6">{renderModule()}</main>
      </div>
    </div>
  )
}
