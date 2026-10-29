"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { stockShortfall } from "@/lib/quotation-shortfall"
import type { Supplier } from "@/lib/types"
import { RequestPriceDialog, type RequestPriceLine } from "./request-price-dialog"

// "Request price from supplier" for a quotation, outside the Approve & Convert window (the quotation screen,
// and the waiting-quotations list). Works out the missing stock first, then opens the PR dialog.
type Lines = Omit<RequestPriceLine, "missing">[]
type QuotationRef = { id: number; quotation_number: string }

export function RequestPriceButton({
  quotation,
  lines,
  prepare,
  suppliers,
  size = "sm",
}: {
  quotation?: QuotationRef
  /** loads the lines when clicked (the list only has summaries); or the lines themselves */
  lines?: Lines | (() => Promise<Lines>)
  /** for a quotation not saved yet: saves it on the click; null when it could not be saved (the user was told why) */
  prepare?: () => Promise<{ quotation: QuotationRef; lines: Lines } | null>
  suppliers: Supplier[]
  size?: "sm" | "default"
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dialogLines, setDialogLines] = useState<RequestPriceLine[]>([])
  const [dialogQuotation, setDialogQuotation] = useState<QuotationRef | null>(null)

  const handleClick = async () => {
    setLoading(true)
    try {
      const prepared = prepare ? await prepare() : null
      if (prepare && !prepared) return
      const target = prepared?.quotation ?? quotation
      if (!target) return
      const base = prepared ? prepared.lines : typeof lines === "function" ? await lines() : lines || []
      const stockIds = [...new Set(base.filter((l) => !l.outsourced && l.productId).map((l) => String(l.productId)))]
      let free: Record<string, number> = {}
      if (stockIds.length) {
        const response = await fetch(`/api/sales-quotations/availability?quotation_id=${target.id}&product_ids=${stockIds.join(",")}`)
        if (response.ok) free = (await response.json()).availability || {}
      }
      setDialogLines(
        base.map((l) => ({
          ...l,
          missing: !l.outsourced && l.productId ? stockShortfall(l.quantity, free[String(l.productId)]) : 0,
        })),
      )
      setDialogQuotation(target)
      setOpen(true)
    } catch (error) {
      console.error("Error preparing price request:", error)
      alert(t("po-req.error-creating-request"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={handleClick} disabled={loading}>
        {loading && <Loader2 className="w-4 h-4 animate-spin me-2" />}
        {t("chain.request-price")}
      </Button>
      {open && dialogQuotation && (
        <RequestPriceDialog open={open} onOpenChange={setOpen} quotation={dialogQuotation} lines={dialogLines} suppliers={suppliers} />
      )}
    </>
  )
}
