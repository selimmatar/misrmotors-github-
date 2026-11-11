"use client"

// Open purchase orders (owner request, 2026-11-11): the Open / Closed badge, the "More" menu of a PO (exchange an
// item, record an advance, close & send to Accounts Payable, reopen) with its dialogs, and the PO history shown in the
// PO details (exchanges with their cost difference, items sent back, advances, close / reopen).
import { useEffect, useState } from "react"
import { ArrowLeftRight, Banknote, Lock, LockOpen, MoreHorizontal, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ProductSearchCombobox } from "@/components/product-search-combobox"
import { Money } from "@/components/erp/money"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDate } from "@/lib/format"
import { PO_CLOSABLE_STATUSES, PO_CLOSE_ROLES } from "@/lib/po-edit"
import type { PurchaseOrder } from "@/lib/types"

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const today = () => new Date().toISOString().split("T")[0]

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || "Request failed")
  return json
}

/** "Open" while the PO has no supplier bill, "Closed" once it was sent to Accounts Payable. */
export function PoOpenBadge({ closed }: { closed: boolean }) {
  const { t } = useI18n()
  return closed ? (
    <Badge variant="outline" className="gap-1 text-slate-700 border-slate-300 bg-slate-50">
      <Lock className="h-3 w-3" /> {t("po.closed")}
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-emerald-800 border-emerald-300 bg-emerald-50">
      <LockOpen className="h-3 w-3" /> {t("po.open")}
    </Badge>
  )
}

interface MenuProps {
  order: PurchaseOrder
  closed: boolean
  canEdit: boolean
  role: string
  userId?: string | number | null
  products: { id: string; productName: string; sku: string }[]
  inventory?: any[]
  onDone: () => Promise<void> | void
  /** Show the words next to the icon (in the PO details popup). */
  labelled?: boolean
}

export function PoOpenMenu({ order, closed, canEdit, role, userId, products, inventory = [], onDone, labelled = false }: MenuProps) {
  const { t } = useI18n()
  const [dialog, setDialog] = useState<"exchange" | "advance" | null>(null)
  const [busy, setBusy] = useState(false)
  const may = PO_CLOSE_ROLES.includes(role)
  const canClose = may && !closed && PO_CLOSABLE_STATUSES.includes(order.status)
  const canReopen = may && closed
  const canAdvance = may && !closed && !["rejected", "draft"].includes(order.status)
  if (!canEdit && !canClose && !canReopen && !canAdvance) return null

  const run = async (url: string, body: unknown, confirmText: string, done: string) => {
    if (!confirm(confirmText)) return
    setBusy(true)
    try {
      await post(url, body)
      alert(done)
      await onDone()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={labelled ? "outline" : "ghost"} size="sm" title={t("po.more-actions")} aria-label={t("po.more-actions")} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
            {labelled && <span className="ms-1">{t("po.more-actions-long")}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onSelect={() => setDialog("exchange")}>
              <ArrowLeftRight className="w-4 h-4 me-2" /> {t("po.exchange-item")}
            </DropdownMenuItem>
          )}
          {canAdvance && (
            <DropdownMenuItem onSelect={() => setDialog("advance")}>
              <Banknote className="w-4 h-4 me-2" /> {t("po.record-advance")}
            </DropdownMenuItem>
          )}
          {canClose && (
            <DropdownMenuItem
              onSelect={() =>
                run(
                  "/api/purchase-orders/close",
                  { id: order.id, userId },
                  fill(t("po.close-confirm"), { po: order.poNumber, total: money(Number(order.total) || 0).toLocaleString("en-US") }),
                  t("po.closed-done"),
                )
              }
            >
              <Lock className="w-4 h-4 me-2" /> {t("po.close-send-ap")}
            </DropdownMenuItem>
          )}
          {canReopen && (
            <DropdownMenuItem
              onSelect={() => run("/api/purchase-orders/reopen", { id: order.id, userId }, fill(t("po.reopen-confirm"), { po: order.poNumber }), t("po.reopened-done"))}
            >
              <LockOpen className="w-4 h-4 me-2" /> {t("po.reopen")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "exchange" && (
        <ExchangeDialog order={order} userId={userId} products={products} inventory={inventory} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog === "advance" && <AdvanceDialog order={order} userId={userId} onClose={() => setDialog(null)} onDone={onDone} />}
    </>
  )
}

interface ExchangeRow {
  key: number
  fromId: string
  qty: number
  kind: "product" | "typed"
  productId: string
  name: string
  toQty: number
  toPrice: number
  notes: string
}

// Several exchanges in one go (owner request, 2026-11-12): each row replaces some or all of a PO line (X) with a new
// item (Y); they are saved together, all or nothing.
function ExchangeDialog({
  order,
  userId,
  products,
  inventory,
  onClose,
  onDone,
}: {
  order: PurchaseOrder
  userId?: string | number | null
  products: { id: string; productName: string; sku: string }[]
  inventory: any[]
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const lines = (order.items || []).filter((i: any) => (Number(i.quantity) || 0) > 0 && i.id)
  const lineOf = (id: string): any => lines.find((l: any) => l.id === id)
  const nextKey = useState(() => ({ n: 0 }))[0]
  const newRow = (fromId = lines[0]?.id || ""): ExchangeRow => {
    const q = Number(lineOf(fromId)?.quantity) || 1
    return { key: ++nextKey.n, fromId, qty: q, kind: "typed", productId: "", name: "", toQty: q, toPrice: 0, notes: "" }
  }
  const [rows, setRows] = useState<ExchangeRow[]>(() => [newRow()])
  const [saving, setSaving] = useState(false)
  const update = (key: number, patch: Partial<ExchangeRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const fromCost = (r: ExchangeRow) => money(r.qty * (Number(lineOf(r.fromId)?.unitPrice) || 0))
  const toCost = (r: ExchangeRow) => money(r.toQty * r.toPrice)
  const total = money(rows.reduce((s, r) => s + toCost(r) - fromCost(r), 0))
  // the next unused line is offered when another exchange is added
  const nextFrom = () => lines.find((l: any) => !rows.some((r) => r.fromId === l.id))?.id || lines[0]?.id || ""

  const save = async () => {
    const bad = rows.find((r) => !lineOf(r.fromId) || !(r.qty > 0) || !(r.toQty > 0) || r.toPrice < 0 || (r.kind === "product" ? !r.productId : !r.name.trim()))
    if (bad) {
      alert(fill(t("po.exchange-fill-row"), { n: rows.indexOf(bad) + 1 }))
      return
    }
    setSaving(true)
    try {
      await post("/api/purchase-orders/exchange", {
        id: order.id,
        userId,
        exchanges: rows.map((r) => ({
          fromItemId: r.fromId,
          quantity: r.qty,
          notes: r.notes,
          to: r.kind === "product" ? { productId: r.productId, quantity: r.toQty, unitPrice: r.toPrice } : { name: r.name.trim(), quantity: r.toQty, unitPrice: r.toPrice },
        })),
      })
      alert(fill(t("po.exchanges-saved"), { n: rows.length }))
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("po.exchange-item")} · {order.poNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {rows.map((r, index) => (
            <div key={r.key} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{fill(t("po.exchange-number"), { n: index + 1 })}</p>
                {rows.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}>
                    {t("po.exchange-remove")}
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2 space-y-1">
                  <Label htmlFor={`exchange-from-${r.key}`}>{t("po.exchange-from")}</Label>
                  <Select
                    value={r.fromId}
                    onValueChange={(v) => {
                      const q = Number(lineOf(v)?.quantity) || 1
                      update(r.key, { fromId: v, qty: q, toQty: q })
                    }}
                  >
                    <SelectTrigger id={`exchange-from-${r.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {lines.map((l: any) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.productName} · {l.quantity} × {Number(l.unitPrice).toLocaleString("en-US")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`exchange-from-qty-${r.key}`}>{t("quantity")}</Label>
                  <Input id={`exchange-from-qty-${r.key}`} type="number" min={1} max={Number(lineOf(r.fromId)?.quantity) || undefined} value={r.qty} onChange={(e) => update(r.key, { qty: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("po.exchange-cost")} <Money value={fromCost(r)} />
              </p>

              <p className="text-sm font-semibold">{t("po.exchange-with")}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={r.kind === "typed" ? "default" : "outline"} onClick={() => update(r.key, { kind: "typed" })}>
                  {t("po.exchange-typed")}
                </Button>
                <Button type="button" size="sm" variant={r.kind === "product" ? "default" : "outline"} onClick={() => update(r.key, { kind: "product" })}>
                  {t("po.exchange-product")}
                </Button>
              </div>
              {r.kind === "product" ? (
                <ProductSearchCombobox products={products} inventory={inventory} warehouseId="all" value={r.productId || undefined} onSelect={(v) => update(r.key, { productId: v })} />
              ) : (
                <Input aria-label={t("common.item-name")} placeholder={t("common.item-name")} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`exchange-to-qty-${r.key}`}>{t("quantity")}</Label>
                  <Input id={`exchange-to-qty-${r.key}`} type="number" min={1} value={r.toQty} onChange={(e) => update(r.key, { toQty: Number(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`exchange-to-price-${r.key}`}>{t("po.cost-per-unit")}</Label>
                  <Input id={`exchange-to-price-${r.key}`} type="number" min={0} step="0.01" value={r.toPrice} onChange={(e) => update(r.key, { toPrice: Number(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`exchange-notes-${r.key}`}>{t("po.exchange-notes")}</Label>
                  <Input id={`exchange-notes-${r.key}`} value={r.notes} onChange={(e) => update(r.key, { notes: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("po.exchange-cost")} <Money value={toCost(r)} /> · {t("po.exchange-difference")} {toCost(r) - fromCost(r) > 0 ? "+" : ""}
                <Money value={money(toCost(r) - fromCost(r))} />
              </p>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, newRow(nextFrom())])} disabled={lines.length === 0}>
            {t("po.exchange-add")}
          </Button>

          <p className={`text-sm font-semibold ${total > 0 ? "text-red-700" : total < 0 ? "text-emerald-700" : ""}`}>
            {fill(t("po.exchange-total-difference"), { n: rows.length })} {total > 0 ? "+" : ""}
            <Money value={total} />
          </p>
          <p className="text-xs text-muted-foreground">{t("po.exchange-stock-note")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
            {rows.length > 1 ? fill(t("po.exchanges-save"), { n: rows.length }) : t("po.exchange-save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdvanceDialog({ order, userId, onClose, onDone }: { order: PurchaseOrder; userId?: string | number | null; onClose: () => void; onDone: () => Promise<void> | void }) {
  const { t } = useI18n()
  const [amount, setAmount] = useState<number>(0)
  const [method, setMethod] = useState("cash")
  const [date, setDate] = useState(today())
  const [reference, setReference] = useState("")
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!(amount > 0)) {
      alert(t("po.advance-amount-needed"))
      return
    }
    setSaving(true)
    try {
      await post("/api/purchase-orders/advance", { id: order.id, amount, paymentMethod: method, paymentDate: date, referenceNumber: reference, userId })
      alert(t("po.advance-saved"))
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("po.record-advance")} · {order.poNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("po.advance-help")}</p>
          <div className="space-y-1">
            <Label htmlFor="advance-amount">{t("po.advance-amount")}</Label>
            <Input id="advance-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="advance-method">{t("po.advance-method")}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="advance-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t("payment.cash")}</SelectItem>
                <SelectItem value="bank_transfer">{t("payment.bank_transfer")}</SelectItem>
                <SelectItem value="cheque">{t("payment.cheque")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="advance-date">{t("po.advance-date")}</Label>
            <Input id="advance-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="advance-ref">{t("po.advance-reference")}</Label>
            <Input id="advance-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
            {t("po.advance-save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Side {
  name?: string
  quantity?: number
  unitPrice?: number
  total?: number
}
interface History {
  exchanges: { date: string; notes?: string | null; from: Side; to: Side; difference: number }[]
  sentBack: { date: string; name?: string; quantity?: number; total?: number; soNumber?: string | null }[]
  closings: { date: string; kind: "closed" | "reopened" }[]
  advances: { id: number; amount: number; method: string; date: string; ref: string; released: boolean }[]
}

/** The PO's history in its details view: exchanges (with the cost difference), items sent back, advances, close / reopen. */
export function PoHistory({ poId }: { poId: string }) {
  const { t, language } = useI18n()
  const [data, setData] = useState<History | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/purchase-orders/exchange?poId=${encodeURIComponent(poId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => !cancelled && setData(json))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [poId])
  if (failed) return <p className="text-sm text-destructive">{t("po.history-failed")}</p>
  if (!data) return null
  const empty = data.exchanges.length + data.sentBack.length + data.advances.length + data.closings.length === 0
  if (empty) return null
  const side = (s: Side) => `${s.name || "-"} × ${s.quantity ?? 0}`
  return (
    <div className="space-y-4">
      {data.exchanges.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-lg border-b pb-2">{t("po.exchanges")}</h3>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-start p-2">{t("reports.date")}</th>
                  <th className="text-start p-2">{t("po.exchange-replaced")}</th>
                  <th className="text-end p-2">{t("po.exchange-cost")}</th>
                  <th className="text-start p-2">{t("po.exchange-with")}</th>
                  <th className="text-end p-2">{t("po.exchange-cost")}</th>
                  <th className="text-end p-2">{t("po.exchange-difference")}</th>
                </tr>
              </thead>
              <tbody>
                {data.exchanges.map((e, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="p-2 whitespace-nowrap">{formatDate(e.date, language)}</td>
                    <td className="p-2">{side(e.from)}</td>
                    <td className="p-2 text-end"><Money value={Number(e.from.total) || 0} /></td>
                    <td className="p-2">
                      {side(e.to)}
                      {e.notes && <div className="text-xs text-muted-foreground">{e.notes}</div>}
                    </td>
                    <td className="p-2 text-end"><Money value={Number(e.to.total) || 0} /></td>
                    <td className={`p-2 text-end font-semibold ${e.difference > 0 ? "text-red-700" : e.difference < 0 ? "text-emerald-700" : ""}`}>
                      {e.difference > 0 ? "+" : ""}
                      <Money value={e.difference} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data.sentBack.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2 text-lg border-b pb-2">{t("po.sent-back")}</h3>
          <ul className="text-sm space-y-1">
            {data.sentBack.map((s, i) => (
              <li key={i}>
                {formatDate(s.date, language)} · {s.name} × {s.quantity} · <Money value={Number(s.total) || 0} />
                {s.soNumber ? ` · ${s.soNumber}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.advances.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2 text-lg border-b pb-2">{t("po.advances")}</h3>
          <ul className="text-sm space-y-1">
            {data.advances.map((a) => (
              <li key={a.id}>
                {formatDate(a.date, language)} · <Money value={a.amount} /> · {t(`payment.${a.method}`)}
                {a.ref ? ` · ${a.ref}` : ""}
                {a.released ? ` · ${t("po.advance-released")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.closings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.closings.map((c) => `${formatDate(c.date, language)}: ${t(c.kind === "closed" ? "po.history-closed" : "po.history-reopened")}`).join(" · ")}
        </p>
      )}
    </div>
  )
}
