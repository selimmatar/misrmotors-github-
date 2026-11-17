"use client"

// Several supplier bills per purchase order (owner request, 2026-11-17): "Bill received items" on an open PO, the
// "Close PO" dialog that makes the final bill (with quantities marked "not coming"), and the "Billed X% · N bills" note.
// Server side: app/api/purchase-orders/bill and app/api/purchase-orders/close (lib/po-bill.ts).
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Money } from "@/components/erp/money"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate } from "@/lib/format"
import { toEnglishDigits } from "@/lib/po-requests/read-prices"
import { typedNumber } from "@/lib/typed-number"
import type { PurchaseOrder } from "@/lib/types"

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const today = () => new Date().toISOString().split("T")[0]

interface BillLine {
  poItemId: number
  name: string
  unitPrice: number
  ordered: number
  received: number
  billed: number
  notComing: number
  open: number
  rest: number
}
interface BillInfo {
  total: number
  factor: number
  billedAmount: number
  billedPercent: number
  ready: boolean
  lines: BillLine[]
  bills: { invoiceNumber: string; supplierInvoiceNumber: string | null; date: string; amount: number; final: boolean; no: number }[]
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || "Request failed")
  return json
}

function useBillInfo(poId: string) {
  const [info, setInfo] = useState<BillInfo | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    fetch(`/api/purchase-orders/bill?poId=${encodeURIComponent(poId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setInfo(d))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [poId])
  return { info, failed }
}

/** A quantity box: Arabic digits accepted, never above `max`. */
function QtyBox({ id, label, value, max, onChange }: { id: string; label: string; value: string; max: number; onChange: (v: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-describedby={`${id}-max`}
        onChange={(e) => {
          const text = toEnglishDigits(e.target.value).replace(/٫/g, ".")
          if (text !== "" && !/^\d*[.,]?\d*$/.test(text)) return
          onChange(typedNumber(text) > max ? String(max) : text)
        }}
      />
      <p id={`${id}-max`} className="text-xs text-muted-foreground">
        {fill(t("po.bill-max"), { n: max })}
      </p>
    </div>
  )
}

/** The supplier invoice number and date of a bill. */
function SupplierInvoiceFields({ number, date, onNumber, onDate }: { number: string; date: string; onNumber: (v: string) => void; onDate: (v: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="po-bill-supplier-invoice">{t("po.bill-supplier-invoice")}</Label>
        <Input id="po-bill-supplier-invoice" autoComplete="off" value={number} onChange={(e) => onNumber(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="po-bill-invoice-date">{t("po.bill-invoice-date")}</Label>
        <Input id="po-bill-invoice-date" type="date" value={date} onChange={(e) => onDate(e.target.value)} />
      </div>
    </div>
  )
}

/** Ordered / received / already billed of one PO line, as small labelled figures (wraps on a phone). */
function LineFigures({ line }: { line: BillLine }) {
  const { t } = useI18n()
  return (
    <dl className="grid grid-cols-3 gap-2 text-xs">
      <div>
        <dt className="text-muted-foreground">{t("po.bill-ordered")}</dt>
        <dd className="font-medium tabular-nums">{line.ordered}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("po.bill-received-qty")}</dt>
        <dd className="font-medium tabular-nums">{line.received}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("po.bill-billed")}</dt>
        <dd className="font-medium tabular-nums">{line.billed}</dd>
      </div>
    </dl>
  )
}

function EarlierBills({ info }: { info: BillInfo }) {
  const { t, language } = useI18n()
  if (info.bills.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{t("po.bill-earlier")}</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {info.bills.map((b) => (
          <li key={b.invoiceNumber} className="flex flex-wrap justify-between gap-2">
            <span>
              {b.no}. {b.invoiceNumber}
              {b.supplierInvoiceNumber ? ` · ${b.supplierInvoiceNumber}` : ""} · {formatDate(b.date, language)}
            </span>
            <Money value={b.amount} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "Bill received items": a bill for received quantities not billed yet; the PO stays open. */
export function BillReceivedDialog({ order, userId, onClose, onDone }: { order: PurchaseOrder; userId?: string | number | null; onClose: () => void; onDone: () => Promise<void> | void }) {
  const { t } = useI18n()
  const { info, failed } = useBillInfo(order.id)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [number, setNumber] = useState("")
  const [date, setDate] = useState(today())
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (info) setQty(Object.fromEntries(info.lines.map((l) => [l.poItemId, String(l.open)])))
  }, [info])
  const lines = (info?.lines || []).filter((l) => l.open > 0)
  const value = money(lines.reduce((s, l) => s + Math.min(typedNumber(qty[l.poItemId] || ""), l.open) * l.unitPrice, 0))
  const amount = money(value * (info?.factor || 1))

  const save = async () => {
    setSaving(true)
    try {
      const res = await post("/api/purchase-orders/bill", {
        id: order.id,
        userId,
        supplierInvoiceNumber: number.trim(),
        invoiceDate: date,
        lines: lines.map((l) => ({ poItemId: l.poItemId, quantity: Math.min(typedNumber(qty[l.poItemId] || ""), l.open) })),
      })
      alert(fill(t("po.bill-done"), { invoice: res.invoiceNumber, amount: money(Number(res.amount) || 0).toLocaleString("en-US") }))
      onClose()
      await onDone()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fill(t("po.bill-title"), { po: order.poNumber })}</DialogTitle>
        </DialogHeader>
        {!info && !failed && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("po.bill-loading")}
          </p>
        )}
        {failed && (
          <p className="text-sm text-red-700" role="alert">
            {t("po.bill-load-failed")}
          </p>
        )}
        {info && (
          <div className="space-y-4">
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("po.bill-nothing")}</p>
            ) : (
              <ul className="space-y-3">
                {lines.map((l) => (
                  <li key={l.poItemId} className="rounded-md border p-3 space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold break-words">{l.name}</p>
                      <span className="text-xs text-muted-foreground">
                        <Money value={l.unitPrice} />
                      </span>
                    </div>
                    <LineFigures line={l} />
                    <QtyBox
                      id={`po-bill-qty-${l.poItemId}`}
                      label={t("po.bill-now")}
                      value={qty[l.poItemId] ?? ""}
                      max={l.open}
                      onChange={(v) => setQty((prev) => ({ ...prev, [l.poItemId]: v }))}
                    />
                  </li>
                ))}
              </ul>
            )}
            <SupplierInvoiceFields number={number} date={date} onNumber={setNumber} onDate={setDate} />
            <p className="text-sm font-semibold" aria-live="polite">
              {t("po.bill-amount")} <Money value={amount} />
            </p>
            <p className="text-xs text-muted-foreground">{t("po.bill-credits-note")}</p>
            <EarlierBills info={info} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !info || !(value > 0)}>
            {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
            {t("po.bill-save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Close PO & send to Accounts Payable": the final bill takes everything not billed yet, except what is marked as not
 * coming (only quantities neither received nor billed). By default, once something was received, what is still missing
 * is marked as not coming; a PO with nothing received (paid in advance) bills the whole rest, as before.
 */
export function ClosePoDialog({ order, userId, onClose, onDone }: { order: PurchaseOrder; userId?: string | number | null; onClose: () => void; onDone: () => Promise<void> | void }) {
  const { t } = useI18n()
  const { info, failed } = useBillInfo(order.id)
  const [notComing, setNotComing] = useState<Record<number, string>>({})
  const [number, setNumber] = useState("")
  const [date, setDate] = useState(today())
  const [saving, setSaving] = useState(false)
  const missingOf = (l: BillLine) => money(Math.max(0, l.ordered - Math.max(l.received, l.billed)))
  useEffect(() => {
    if (!info) return
    const anyReceived = info.lines.some((l) => l.received > 0)
    setNotComing(Object.fromEntries(info.lines.map((l) => [l.poItemId, String(anyReceived ? missingOf(l) : 0)])))
  }, [info])
  const missing = (info?.lines || []).filter((l) => missingOf(l) > 0)
  const out = (l: BillLine) => Math.min(typedNumber(notComing[l.poItemId] || ""), missingOf(l))
  const rest = (info?.lines || []).map((l) => ({ l, q: money(Math.max(0, l.ordered - l.billed - out(l))) }))
  const coversAll = rest.every(({ l, q }) => l.billed + q >= l.ordered - 1e-6)
  const amount = info
    ? coversAll
      ? money(Math.max(0, info.total - info.billedAmount))
      : money(rest.reduce((s, { l, q }) => s + q * l.unitPrice, 0) * info.factor)
    : 0

  const save = async () => {
    setSaving(true)
    try {
      const res = await post("/api/purchase-orders/close", {
        id: order.id,
        userId,
        supplierInvoiceNumber: number.trim(),
        invoiceDate: date,
        notComing: missing.map((l) => ({ poItemId: l.poItemId, quantity: out(l) })),
      })
      // nothing was left to bill: the PO is closed without a 0 bill (2026-11-18)
      alert(res?.noBill ? t("po.closed-done-no-bill") : t("po.closed-done"))
      onClose()
      await onDone()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fill(t("po.close-title"), { po: order.poNumber })}</DialogTitle>
        </DialogHeader>
        {!info && !failed && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("po.bill-loading")}
          </p>
        )}
        {failed && (
          <p className="text-sm text-red-700" role="alert">
            {t("po.bill-load-failed")}
          </p>
        )}
        {info && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("po.close-note")}</p>
            {missing.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold">{t("po.close-not-coming-hint")}</p>
                <ul className="space-y-3">
                  {missing.map((l) => (
                    <li key={l.poItemId} className="rounded-md border p-3 space-y-2">
                      <p className="text-sm font-semibold break-words">{l.name}</p>
                      <LineFigures line={l} />
                      <QtyBox
                        id={`po-close-not-coming-${l.poItemId}`}
                        label={t("po.bill-not-coming")}
                        value={notComing[l.poItemId] ?? ""}
                        max={missingOf(l)}
                        onChange={(v) => setNotComing((prev) => ({ ...prev, [l.poItemId]: v }))}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <SupplierInvoiceFields number={number} date={date} onNumber={setNumber} onDate={setDate} />
            <p className="text-sm font-semibold" aria-live="polite">
              {t("po.bill-amount")} <Money value={amount} />
            </p>
            {amount <= 0 && <p className="text-sm text-sky-800">{t("po.close-no-bill-note")}</p>}
            <p className="text-xs text-muted-foreground">{t("po.bill-credits-note")}</p>
            <EarlierBills info={info} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !info}>
            {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
            {t("po.close-save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Billed 40% · 2 bills" on an open PO with bills for received items (the share of the PO total billed so far). */
export function PoBilledNote({ order, bills, closed }: { order: PurchaseOrder; bills: { amount?: number }[]; closed: boolean }) {
  const { t } = useI18n()
  if (closed || bills.length === 0) return null
  const total = Number(order.total) || 0
  const billed = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0)
  const pct = total > 0 ? Math.min(100, Math.round((billed / total) * 100)) : 0
  return (
    <Badge variant="outline" className="text-sky-800 border-sky-300 bg-sky-50 whitespace-nowrap">
      {bills.length === 1 ? fill(t("po.billed-summary-one"), { pct }) : fill(t("po.billed-summary"), { pct, n: bills.length })}
    </Badge>
  )
}
