"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { stockShortfall } from "@/lib/quotation-shortfall"
import type { Supplier } from "@/lib/types"
import { RequestPriceDialog, type RequestPriceLine } from "./request-price-dialog"

// "Request price from supplier" for a saved quotation, outside the Approve & Convert window (the quotation screen
// after saving, and the waiting-quotations list). Works out the missing stock first, then opens the PR dialog.
export function RequestPriceButton({
  quotation,
  lines,
  suppliers,
  size = "sm",
}: {
  quotation: { id: number; quotation_number: string }
  /** loads the lines when clicked (the list only has summaries); or the lines themselves */
  lines: Omit<RequestPriceLine, "missing">[] | (() => Promise<Omit<RequestPriceLine, "missing">[]>)
  suppliers: Supplier[]
  size?: "sm" | "default"
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dialogLines, setDialogLines] = useState<RequestPriceLine[]>([])

  const handleClick = async () => {
    setLoading(true)
    try {
      const base = typeof lines === "function" ? await lines() : lines
      const stockIds = [...new Set(base.filter((l) => !l.outsourced && l.productId).map((l) => String(l.productId)))]
      let free: Record<string, number> = {}
      if (stockIds.length) {
        const response = await fetch(`/api/sales-quotations/availability?quotation_id=${quotation.id}&product_ids=${stockIds.join(",")}`)
        if (response.ok) free = (await response.json()).availability || {}
      }
      setDialogLines(
        base.map((l) => ({
          ...l,
          missing: !l.outsourced && l.productId ? stockShortfall(l.quantity, free[String(l.productId)]) : 0,
        })),
      )
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
      {open && (
        <RequestPriceDialog open={open} onOpenChange={setOpen} quotation={quotation} lines={dialogLines} suppliers={suppliers} />
      )}
    </>
  )
}
