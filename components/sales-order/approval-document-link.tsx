"use client"

import { AlertTriangle, FileText } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { approvalDocumentState } from "@/lib/approval-document"

// The customer approval document uploaded when the quotation was converted to this sales order.
export function ApprovalDocumentLink({ url, className }: { url?: string | null; className?: string }) {
  const { t } = useI18n()
  const state = approvalDocumentState(url)
  if (state.kind === "none") return null
  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground mb-1">{t("so.approval-document")}</p>
      {state.kind === "link" ? (
        <a
          href={state.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm inline-flex items-center gap-1"
        >
          <FileText className="w-4 h-4" />
          {t("so.view-approval-document")}
        </a>
      ) : (
        <p className="text-sm text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {t("so.approval-document-missing")}
        </p>
      )}
    </div>
  )
}
