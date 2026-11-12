"use client"

// "Exchange with supplier" for a returned item (owner request, 2026-11-12): the returned item is filled in (name,
// quantity, cost, its PO); the person adds the new item and its cost, sees the difference, and may rename the
// customer's order line to the new item. Saved as an exchange on that PO: no credit; the new item waits in Goods Receipt.
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { Money } from "@/components/erp/money"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { typedNumber } from "@/lib/typed-number"
import { toEnglishDigits } from "@/lib/po-requests/read-prices"

interface Preview {
  name: string
  quantity: number
  unitCost: number
  poNumber: string
  closed: boolean
  paid: boolean
  soItemId: number | null
  soLineName: string | null
  soQuantity: number | null
  soUnitPrice: number | null
  error?: string
}

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** Arabic or English digits and one decimal point; null when the typed text is not a number being typed. */
const cleanNumber = (text: string) => {
  const v = toEnglishDigits(text).replace(/٫/g, ".")
  return v === "" || /^\d*[.,]?\d*$/.test(v) ? v : null
}

export function ReturnedExchangeDialog({
  item,
  products,
  onClose,
  onDone,
}: {
  item: any
  products: { id: string; productName: string; sku: string }[]
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const inventoryId = item?.inventoryId || item?.id
  const [preview, setPreview] = useState<Preview | null>(null)
  const [kind, setKind] = useState<"typed" | "product">("typed")
  const [name, setName] = useState("")
  const [productId, setProductId] = useState("")
  const [qty, setQty] = useState("")
  const [cost, setCost] = useState("")
  const [rename, setRename] = useState(true)
  const [selling, setSelling] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/inventory/exchange-returned?inventoryId=${encodeURIComponent(inventoryId)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setPreview({ error: body.error || body.message || t("message.error") } as Preview)
          return
        }
        setPreview(body)
        setQty(String(body.quantity))
        setSelling(body.soUnitPrice != null ? String(body.soUnitPrice) : "")
      })
      .catch(() => !cancelled && setPreview({ error: t("message.error") } as Preview))
    return () => {
      cancelled = true
    }
  }, [inventoryId, t])

  const oldCost = preview && !preview.error ? money(preview.quantity * preview.unitCost) : 0
  const newCost = money(typedNumber(qty) * typedNumber(cost))
  const diff = money(newCost - oldCost)

  const save = async () => {
    if (!(typedNumber(qty) > 0) || cost.trim() === "" || (kind === "product" ? !productId : !name.trim())) {
      alert(t("inv.exchange-fill"))
      return
    }
    if (preview?.closed && !confirm(fill(t("inv.exchange-reopen-confirm"), { po: preview.poNumber }))) return
    setSaving(true)
    try {
      const res = await fetch("/api/inventory/exchange-returned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryId,
          to:
            kind === "product"
              ? { productId, quantity: typedNumber(qty), unitPrice: typedNumber(cost) }
              : { name: name.trim(), quantity: typedNumber(qty), unitPrice: typedNumber(cost) },
          updateOrder: rename && !!preview?.soItemId,
          sellingPrice: rename && selling.trim() !== "" ? typedNumber(selling) : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || body.message || t("message.error"))
        return
      }
      const note = body.orderLine?.updated
        ? t("inv.exchange-order-updated")
        : body.orderLine?.note
          ? `${t("inv.exchange-order-not-renamed")} ${body.orderLine.note}`
          : ""
      alert(`${fill(t("inv.exchange-saved"), { po: body.poNumber })}${note ? `\n${note}` : ""}`)
      onClose()
      await onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("inv.exchange-with-supplier")}</DialogTitle>
        </DialogHeader>
        {!preview ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("inv.credit-preview-loading")}
          </p>
        ) : preview.error ? (
          <p className="text-sm text-destructive">{preview.error}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm space-y-1 bg-amber-50 border-amber-200">
              <p>
                <strong>{t("inv.exchange-returned")}</strong> {preview.name} × {preview.quantity} · <Money value={oldCost} />
              </p>
              <p className="text-muted-foreground">{fill(t("inv.exchange-from-po"), { po: preview.poNumber })}</p>
              {preview.paid ? (
                <p className="text-destructive">{fill(t("inv.exchange-paid"), { po: preview.poNumber })}</p>
              ) : preview.closed ? (
                <p className="text-amber-800">{fill(t("inv.exchange-will-reopen"), { po: preview.poNumber })}</p>
              ) : null}
            </div>

            <p className="text-sm font-semibold">{t("po.exchange-with")}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={kind === "typed" ? "default" : "outline"} onClick={() => setKind("typed")}>
                {t("po.exchange-typed")}
              </Button>
              <Button type="button" size="sm" variant={kind === "product" ? "default" : "outline"} onClick={() => setKind("product")}>
                {t("po.exchange-product")}
              </Button>
            </div>
            {kind === "product" ? (
              <ProductSearchCombobox products={products} inventory={[]} warehouseId="all" value={productId || undefined} onSelect={setProductId} />
            ) : (
              <Input aria-label={t("common.item-name")} placeholder={t("common.item-name")} value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rx-qty">{t("quantity")}</Label>
                <Input
                  id="rx-qty"
                  type="text"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => {
                    const v = cleanNumber(e.target.value)
                    if (v !== null) setQty(v)
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rx-cost">{t("po.cost-per-unit")}</Label>
                <Input
                  id="rx-cost"
                  type="text"
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => {
                    const v = cleanNumber(e.target.value)
                    if (v !== null) setCost(v)
                  }}
                />
              </div>
            </div>
            <p className={`text-sm font-semibold ${diff > 0 ? "text-red-700" : diff < 0 ? "text-emerald-700" : ""}`}>
              {t("po.exchange-difference")} {diff > 0 ? "+" : ""}
              <Money value={diff} />
            </p>

            {preview.soItemId && (
              <div className="rounded-md border p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />
                  {t("inv.exchange-update-order")}
                </label>
                {rename && (
                  <p className="text-sm text-muted-foreground">
                    {fill(t("inv.exchange-order-preview"), {
                      old: preview.soLineName || preview.name,
                      from: preview.soQuantity ?? 0,
                      to: Math.max(0, (preview.soQuantity ?? 0) - preview.quantity),
                      item: (kind === "product" ? products.find((p) => p.id === productId)?.productName : name.trim()) || "…",
                      qty: typedNumber(qty),
                      price: selling.trim() === "" ? String(preview.soUnitPrice ?? 0) : selling,
                    })}
                  </p>
                )}
                {rename && (
                  <div className="space-y-1">
                    <Label htmlFor="rx-selling">{t("inv.exchange-selling-price")}</Label>
                    <Input
                      id="rx-selling"
                      type="text"
                      inputMode="decimal"
                      value={selling}
                      onChange={(e) => {
                        const v = cleanNumber(e.target.value)
                        if (v !== null) setSelling(v)
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("inv.exchange-help")}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !preview || !!preview.error || !!preview.paid}>
            {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
            {t("inv.exchange-save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
