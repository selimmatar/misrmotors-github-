"use client"

import { MaintenanceInvoiceTab } from "@/components/accounting/maintenance-invoice-tab"

export function MaintenanceInvoicesModule() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Maintenance Invoices</h2>
        <p className="text-muted-foreground">
          Create invoices for approved maintenance work orders
        </p>
      </div>
      
      <MaintenanceInvoiceTab />
    </div>
  )
}
