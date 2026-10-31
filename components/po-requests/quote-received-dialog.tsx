"use client"

import { useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Camera, Loader2, Upload } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { readItemRows } from "@/lib/excel/read-item-rows"
import { sameItemName } from "@/lib/po-requests/apply-costs"
import { nameWithBrand, sortRequestItems } from "@/lib/po-requests/read-prices"
import { shrinkPhoto } from "@/lib/shrink-photo"

type NameBox = "brand" | "code"
const NAME_BOXES: NameBox[] = ["brand", "code"]

// "Quote received" on a price request (PR): the supplier's unit price per line (typed in, read from the
// supplier's Excel sheet by item name, or read from a photo of the printed PR with hand-written prices) and,
// optionally, the supplier's quotation file. Saves the PR as "quoted"; nothing is saved before Save.
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
  const items = sortRequestItems(request.po_request_items || [])
  const [prices, setPrices] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.item_id, i.unit_price === null || i.unit_price === undefined ? "" : String(i.unit_price)])),
  )
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const excelRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [fromPhoto, setFromPhoto] = useState<Set<number>>(new Set())
  const [photoNote, setPhotoNote] = useState("")
  // Brand and code read from the "الماركة" / "الكود" boxes per item, and the ticked ones that join the item name
  // on Save ("name – brand – code").
  const [boxes, setBoxes] = useState<Record<NameBox, Record<number, string>>>({ brand: {}, code: {} })
  const [addToName, setAddToName] = useState<Record<NameBox, Set<number>>>({ brand: new Set(), code: new Set() })
  const boxText = (box: NameBox, itemId: number) => (boxes[box][itemId] || "").trim()
  const ticked = (box: NameBox, itemId: number) => addToName[box].has(itemId) && !!boxText(box, itemId)
  const newName = (item: { item_id: number; product_name: string }) =>
    NAME_BOXES.filter((box) => ticked(box, item.item_id)).reduce((name, box) => nameWithBrand(name, boxText(box, item.item_id)), item.product_name)

  // Several photos can be picked at once (a long request printed on more than one page): each is read in turn and
  // what they read is put together. A photo that fails is skipped and counted; the first photo is attached.
  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])
    event.target.value = ""
    if (picked.length === 0) return
    setReading(true)
    setPhotoNote("")
    const readIds = new Set<number>()
    let wrongRequest = false
    let failed = 0
    let lastError = ""
    let attached = !!file
    for (const one of picked) {
      try {
        const photo = await shrinkPhoto(one)
        const response = await fetch("/api/po-requests/read-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: request.request_id, image: photo.base64, media_type: "image/jpeg" }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || t("chain.photo-read-failed"))
        const read: Record<string, number> = body.prices || {}
        setPrices((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(read).map(([id, price]) => [id, String(price)])) }))
        Object.keys(read).forEach((id) => readIds.add(Number(id)))
        setBoxes((prev) => ({ brand: { ...prev.brand, ...(body.brands || {}) }, code: { ...prev.code, ...(body.codes || {}) } }))
        if (!attached) {
          setFile(photo.file)
          attached = true
        }
        if (body.request_number_matches === false) wrongRequest = true
      } catch (error) {
        failed += 1
        lastError = error instanceof Error ? error.message : t("chain.photo-read-failed")
      }
    }
    setFromPhoto(readIds)
    setReading(false)
    if (failed === picked.length) {
      alert(lastError)
      return
    }
    const notes = [fill(t("chain.photo-read-result"), { read: String(readIds.size), total: String(items.length) })]
    if (wrongRequest) notes.unshift(fill(t("chain.photo-wrong-request"), { number: request.request_number }))
    if (failed > 0) notes.push(fill(t("chain.photos-failed"), { failed: String(failed), total: String(picked.length) }))
    setPhotoNote(notes.join(" "))
  }

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
          items: items.map((i) => ({
            item_id: i.item_id,
            unit_price: prices[i.item_id] === "" ? null : Number(prices[i.item_id]),
            ...(NAME_BOXES.some((box) => ticked(box, i.item_id)) ? { product_name: newName(i) } : {}),
          })),
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => photoRef.current?.click()} disabled={reading}>
              {reading ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Camera className="h-4 w-4 me-1" />}
              {reading ? t("chain.reading-photo") : t("chain.read-photo")}
            </Button>
            <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhoto} />
            <Button type="button" size="sm" variant="outline" onClick={() => excelRef.current?.click()}>
              <Upload className="h-4 w-4 me-1" />
              {t("chain.upload-excel")}
            </Button>
            <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcel} />
          </div>
          {photoNote && (
            <p role="status" className="text-sm rounded-md bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100 p-2">
              {photoNote}
            </p>
          )}
          {items.map((item, index) => (
            <div key={item.item_id} className="border rounded-md p-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-sm">
                  <span className="block truncate">
                    <span className="text-muted-foreground">{index + 1}.</span> {item.product_name}{" "}
                    <span className="text-muted-foreground">× {item.quantity}</span>
                  </span>
                  {fromPhoto.has(item.item_id) && <span className="block text-xs text-amber-700 dark:text-amber-300">{t("chain.photo-check")}</span>}
                </span>
                <Input
                  className={`w-32 ${fromPhoto.has(item.item_id) ? "border-amber-500 ring-1 ring-amber-500" : ""}`}
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={fill(t("chain.unit-price-for"), { name: item.product_name })}
                  placeholder={t("field.unit-price")}
                  value={prices[item.item_id] ?? ""}
                  onChange={(e) => {
                    setPrices((prev) => ({ ...prev, [item.item_id]: e.target.value }))
                    setFromPhoto((prev) => (prev.has(item.item_id) ? new Set([...prev].filter((id) => id !== item.item_id)) : prev))
                  }}
                />
              </div>
              {NAME_BOXES.filter((box) => item.item_id in boxes[box]).map((box) => (
                <div key={box} className="flex flex-wrap items-center gap-2 text-sm">
                  <Label htmlFor={`${box}-${item.item_id}`} className="text-muted-foreground">
                    {t(`chain.${box}`)}
                  </Label>
                  <Input
                    id={`${box}-${item.item_id}`}
                    className="h-8 w-40 border-amber-500"
                    value={boxes[box][item.item_id]}
                    onChange={(e) => setBoxes((prev) => ({ ...prev, [box]: { ...prev[box], [item.item_id]: e.target.value } }))}
                  />
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      aria-label={`${t(`chain.add-${box}-to-name`)}: ${item.product_name}`}
                      checked={addToName[box].has(item.item_id)}
                      disabled={!boxText(box, item.item_id)}
                      onCheckedChange={(checked) =>
                        setAddToName((prev) => {
                          const next = new Set(prev[box])
                          if (checked) next.add(item.item_id)
                          else next.delete(item.item_id)
                          return { ...prev, [box]: next }
                        })
                      }
                    />
                    {t(`chain.add-${box}-to-name`)}
                  </label>
                </div>
              ))}
              {NAME_BOXES.some((box) => ticked(box, item.item_id)) && (
                <span className="block text-xs text-muted-foreground">{newName(item)}</span>
              )}
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="supplier-quote-file">{t("chain.supplier-quote-file")}</Label>
            <Input id="supplier-quote-file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            {file && fromPhoto.size > 0 && file.name.startsWith("price-photo") && (
              <p className="text-xs text-muted-foreground">{t("chain.photo-attached")}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || reading}>
            {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
            {t("chain.save-prices")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
