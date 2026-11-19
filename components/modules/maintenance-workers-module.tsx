"use client"

import { WorkerLinksManager } from "@/components/accounting/worker-links-manager"
import { useI18n } from "@/lib/i18n-context"

// Admin / CEO only (owner request 2026-11-19): worker photo links and carbon booklets live here, not in Receivables.
export function MaintenanceWorkersModule() {
  const { language } = useI18n()
  const ar = language === "ar"
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-balance">{ar ? "الصيانة" : "Maintenance"}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          {ar
            ? "روابط تصوير الفواتير للفنيين ودفاتر الفواتير المرقمة."
            : "Photo links for maintenance workers and numbered invoice booklets."}
        </p>
      </div>
      <WorkerLinksManager />
    </div>
  )
}
