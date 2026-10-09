"use client"

import { MaintenanceInvoiceTab } from "@/components/accounting/maintenance-invoice-tab"
import { PageHeader } from "@/components/erp/page-header"
import { useI18n } from "@/lib/i18n-context"

export function MaintenanceInvoicesModule() {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.finance")}
        title={t("module.maintenance-invoices")}
        subtitle="Create invoices for approved maintenance work orders"
      />

      <MaintenanceInvoiceTab showHeading={false} />
    </div>
  )
}
