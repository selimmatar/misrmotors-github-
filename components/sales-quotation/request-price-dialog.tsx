"use client"

import { useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Upload } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { readItemRows } from "@/lib/excel/read-item-rows"
import type { Supplier } from "@/lib/types"

// "Request price from supplier" on a saved quotation: makes a price request (PR) for one supplier, linked to the
// quotation, with the lines that need a supplier price (outsourced lines, and the missing part of stock lines).
export interface RequestPriceLine {
  /** the quotation line number (1, 2, ...) as saved */
  lineNo: number
  productId?: number | null
  productName: string
  quantity: number
  outsourced: boolean
  /** stock lines: how much free stock is missing */
  missing?: number
}

interface Row {
  key: string
  lineNo: number | null
  productId: number | null
  productName: string
  quantity: number
  selected: boolean
}

let rowSeq = 0
const nextKey = () => `pr-row-${++rowSeq}`

export function RequestPriceDialog({
  open,
  onOpenChange,
  quotation,
  lines,
  suppliers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  quotation: { id: number; quotation_number: string }
  lines: RequestPriceLine[]
  suppliers: Supplier[]
  onCreated?: (requestNumber: string) => void
}) {
  const { t } = useI18n()
  const [supplierId, setSupplierId] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[]>(() =>
    lines.map((line) => ({
      key: nextKey(),
      lineNo: line.lineNo,
      productId: line.productId ?? null,
      productName: line.productName,
      // stock line: ask only for the missing part; outsourced line: the whole quantity
      quantity: !line.outsourced && (line.missing || 0) > 0 ? (line.missing as number) : line.quantity,
      selected: line.outsourced || (line.missing || 0) > 0,
    })),
  )

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleExcel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: "array" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const read = readItemRows(XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[])
        if (read.length === 0) {
          alert(t("sq.no-valid-items-found-in"))
          return
        }
        setRows((prev) => [
          ...prev,
          ...read.map((r) => ({ key: nextKey(), lineNo: null, productId: null, productName: r.productName, quantity: r.quantity, selected: true })),
        ])
      } catch (error) {
        console.error("Excel parse error:", error)
        alert(t("sq.failed-to-parse-excel-file"))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const chosen = rows.filter((r) => r.selected && r.productName.trim() && r.quantity > 0)

  const handleCreate = async () => {
    if (!supplierId) {
      alert(t("po-req.please-select-a-supplier"))
      return
    }
    if (chosen.length === 0) {
      alert(t("common.please-add-at-least-one"))
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/po-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: Number(supplierId),
          sales_quotation_id: quotation.id,
          notes: notes || null,
          items: chosen.map((r) => ({
            product_id: r.productId,
            product_name: r.productName.trim(),
            quantity: r.quantity,
            unit: "unit",
            quotation_line_no: r.lineNo,
          })),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || t("po-req.error-creating-request"))
      alert(fill(t("chain.request-created"), { number: body.request_number || "" }))
      onCreated?.(body.request_number || "")
      onOpenChange(false)
    } catch (error) {
      alert(error instanceof Error ? error.message : t("po-req.error-creating-request"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("chain.request-price")}</DialogTitle>
          <DialogDescription>{fill(t("chain.request-price-desc"), { number: quotation.quotation_number })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("po-req.supplier-required")}</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("common.select-supplier")} />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{t("po-req.required-items")}</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 me-1" />
                {t("chain.upload-excel")}
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcel} />
            </div>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("chain.no-lines")}</p>}
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2 border rounded-md p-2">
                <Checkbox
                  checked={r.selected}
                  onCheckedChange={(v) => update(r.key, { selected: v === true })}
                  aria-label={r.productName || t("common.item-name")}
                />
                {r.lineNo === null ? (
                  <Input className="flex-1" value={r.productName} onChange={(e) => update(r.key, { productName: e.target.value })} />
                ) : (
                  <span className="flex-1 text-sm truncate">{r.productName}</span>
                )}
                <Input
                  className="w-24"
                  type="number"
                  min="1"
                  aria-label={t("quantity")}
                  value={r.quantity}
                  onChange={(e) => update(r.key, { quantity: Number(e.target.value) || 0 })}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label>{t("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("po-req.supplier-notes-placeholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={saving || chosen.length === 0}>
            {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
            {t("po-req.create-request")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
