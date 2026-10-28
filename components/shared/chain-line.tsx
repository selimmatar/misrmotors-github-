"use client"

import { useEffect, useState } from "react"
import { Link2 } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { chainText, type Chain } from "@/lib/po-requests/chain"

// One line "Q-0031 → PR-0007 → SO-0045 → PO-0028" on a quotation, PR, sales order or PO page, so a document can
// be matched with the supplier's papers. Shows nothing when the document is not linked to any other.
export function ChainLine({ quotationId, prId, soId, poId }: { quotationId?: number | string; prId?: number | string; soId?: number | string; poId?: number | string }) {
  const { t } = useI18n()
  const [text, setText] = useState("")
  const param =
    quotationId != null ? `quotation_id=${quotationId}` : prId != null ? `pr_id=${prId}` : soId != null ? `so_id=${soId}` : poId != null ? `po_id=${poId}` : ""

  useEffect(() => {
    setText("")
    if (!param) return
    let cancelled = false
    fetch(`/api/chain?${param}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((chain: Chain | null) => {
        if (!cancelled && chain) setText(chainText(chain))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [param])

  if (!text) return null
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{t("chain.linked")}</span>
      <span dir="ltr">{text}</span>
    </p>
  )
}
