"use client"

import { useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2, Upload } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { readItemRows } from "@/lib/excel/read-item-rows"
import { sameItemName } from "@/lib/po-requests/apply-costs"

// "Quote received" on a price request (PR): the supplier's unit price per line (typed in, or read from the
// supplier's Excel sheet by item name) and, optionally, the supplier's quotation file. Saves the PR as "quoted".
export function QuoteReceivedDialog({
  open,
  onOpenChange,
  request,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: { request_id: number; request_number: string; po_request_items?: any[] }
  onSaved: () => void
}) {
  const { t } = useI18n()
  const items = request.po_request_items || []
  const [prices, setPrices] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.item_id, i.unit_price === null || i.unit_price === undefined ? "" : String(i.unit_price)])),
  )
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const excelRef = useRef<HTMLInputElement>(null)

  const handleExcel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ""
    if (!picked) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: "array" })
        const rows = readItemRows(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]) as Record<string, unknown>[])
        let matched = 0
        const next = { ...prices }
        for (const item of items) {
          const row = rows.find((r) => r.unitPrice !== null && sameItemName(r.productName, item.product_name))
          if (row) {
            next[item.item_id] = String(row.unitPrice)
            matched++
          }
        }
        setPrices(next)
        alert(fill(t("chain.prices-matched"), { matched: String(matched), total: String(items.length) }))
      } catch (error) {
        console.error("Excel parse error:", error)
        alert(t("sq.failed-to-parse-excel-file"))
      }
    }
    reader.readAsArrayBuffer(picked)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let fileUrl = ""
      if (file) {
        const form = new FormData()
        form.append("file", file)
        form.append("quotation_id", `pr-${request.request_id}`)
        form.append("document_type", "supplier_quote")
        const upload = await fetch("/api/documents/upload", { method: "POST", body: form })
        const uploaded = upload.ok ? await upload.json().catch(() => null) : null
        if (!uploaded?.url) throw new Error(t("error.upload-failed"))
        fileUrl = uploaded.url
      }
      const response = await fetch("/api/po-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: request.request_id,
          status: "quoted",
          items: items.map((i) => ({ item_id: i.item_id, unit_price: prices[i.item_id] === "" ? null : Number(prices[i.item_id]) })),
          ...(fileUrl ? { supplier_quote_file_url: fileUrl } : {}),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || t("chain.save-prices-failed"))
      onSaved()
      onOpenChange(false)
    } catch (error) {
      alert(error instanceof Error ? error.message : t("chain.save-prices-failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("po-req.quote-received")} - {request.request_number}
          </DialogTitle>
          <DialogDescription>{t("chain.quote-received-desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => excelRef.current?.click()}>
              <Upload className="h-4 w-4 me-1" />
              {t("chain.upload-excel")}
            </Button>
            <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcel} />
          </div>
          {items.map((item) => (
            <div key={item.item_id} className="flex items-center gap-2 border rounded-md p-2">
              <span className="flex-1 text-sm truncate">
                {item.product_name} <span className="text-muted-foreground">× {item.quantity}</span>
              </span>
              <Input
                className="w-32"
                type="number"
                min="0"
                step="0.01"
                aria-label={fill(t("chain.unit-price-for"), { name: item.product_name })}
                placeholder={t("field.unit-price")}
                value={prices[item.item_id] ?? ""}
                onChange={(e) => setPrices((prev) => ({ ...prev, [item.item_id]: e.target.value }))}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="supplier-quote-file">{t("chain.supplier-quote-file")}</Label>
            <Input id="supplier-quote-file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
            {t("chain.save-prices")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
