"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, CheckSquare, FileText } from "lucide-react"
import type { UserRole } from "@/lib/types"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"
import { SalesOrderModule } from "@/components/modules/sales-order-module"
import { ApproveSalesQuotationsModule } from "@/components/modules/approve-sales-quotations-module"
import { SalesQuotationModule } from "@/components/modules/sales-quotation-module"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MaintenanceApprovalTab } from "@/components/sales/maintenance-approval-tab"
import { WaitingForYou, useWaiting } from "@/components/notifications/waiting-for-you"
import type { ReportToReview, UnappliedPrice } from "@/lib/notifications/waiting"

interface SalesQuotationsHubModuleProps {
  userRole: UserRole
}

// Combines the three previously separate quotation-related tabs (Create Quotations,
// Approve Quotations, Sales Quotations) into one "Sales Quotations" section, organized
// as sub-tabs. This is purely a navigation/layout change - each tab renders the exact
// same component with the exact same behavior as before the merge.
export function SalesQuotationsHubModule({ userRole }: SalesQuotationsHubModuleProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState("sales-quotations")
  const [openQuotationId, setOpenQuotationId] = useState<number | null>(null)
  const [showReports, setShowReports] = useState(false)
  const waiting = useWaiting<{ prices?: UnappliedPrice[]; reports?: ReportToReview[] }>("sales-orders", userRole)

  return (
    <div className="flex flex-col gap-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-6">
        <PageHeader group={t("group.sales")} title={t("module.sales-orders")}>
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            <TabsTrigger value="create-quotations" className="gap-2">
              <Plus className="w-4 h-4" />
              {t("quote.create-quotations")}
            </TabsTrigger>
            <TabsTrigger value="approve-quotations" className="gap-2">
              <CheckSquare className="w-4 h-4" />
              {t("module.approve-sales-quotations")}
            </TabsTrigger>
            <TabsTrigger value="sales-quotations" className="gap-2">
              <FileText className="w-4 h-4" />
              {t("quote.sales-quotations")}
            </TabsTrigger>
          </TabsList>
        </PageHeader>

        <WaitingForYou
          sections={[
            {
              key: "prices",
              heading: t("waiting.price-not-applied"),
              rows: (waiting.data?.prices || []).map((p) => ({
                key: String(p.request_id),
                title: [p.request_number, p.quotation_number, p.customer_name].filter(Boolean).join(" · "),
                detail: p.items.map((i) => `${i.name}: ${i.price}`).join("، "),
                action: t("waiting.open-quotation"),
                onOpen: () => {
                  setActiveTab("approve-quotations")
                  setOpenQuotationId(p.quotation_id)
                },
              })),
            },
            {
              key: "reports",
              heading: t("waiting.reports-to-review"),
              rows: (waiting.data?.reports || []).map((r) => ({
                key: String(r.work_order_id),
                title: [r.work_order_number, r.customer_name].filter(Boolean).join(" · "),
                action: t("waiting.open"),
                onOpen: () => setShowReports(true),
              })),
            },
          ]}
        />

        <TabsContent value="create-quotations" className="mt-0">
          <SalesQuotationModule userRole={userRole} embedded />
        </TabsContent>
        <TabsContent value="approve-quotations" className="mt-0">
          <ApproveSalesQuotationsModule
            userRole={userRole}
            embedded
            openQuotationId={openQuotationId}
            onOpened={() => setOpenQuotationId(null)}
          />
        </TabsContent>
        <TabsContent value="sales-quotations" className="mt-0">
          <SalesOrderModule userRole={userRole} embedded />
        </TabsContent>
      </Tabs>

      <Dialog
        open={showReports}
        onOpenChange={(open) => {
          setShowReports(open)
          if (!open) waiting.reload()
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("waiting.reports-to-review")}</DialogTitle>
          </DialogHeader>
          <MaintenanceApprovalTab userRole={userRole} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
