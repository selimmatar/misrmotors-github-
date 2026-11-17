"use client"

// Maintenance quick invoice (spec 2026-11-17): the maintenance role's one screen. Pick a customer, type the lines
// (what was done, quantity, price before VAT), see the totals with 14% VAT, press Create invoice. The server makes
// the order, the approved delivery permit and the invoice in one call (app/api/maintenance/quick-invoice).
import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, CheckCircle } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/erp/page-header"
import { Money } from "@/components/erp/money"
import { quickTotals } from "@/lib/maintenance-quick-invoice"

interface Line {
  name: string
  quantity: string
  unitPrice: string
}
const emptyLine = (): Line => ({ name: "", quantity: "1", unitPrice: "" })

export function MaintenanceQuickInvoiceModule() {
  const { t } = useI18n()
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([])
  const [customerSearch, setCustomerSearch] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [created, setCreated] = useState<{ invoiceNumber: string; amount: number; customerName: string } | null>(null)

  useEffect(() => {
    fetch("/api/maintenance/quick-invoice")
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .then((body) => setCustomers(Array.isArray(body?.customers) ? body.customers : []))
      .catch(() => setCustomers([]))
  }, [])

  const shownCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    const list = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers
    // keep the chosen customer in the list while searching
    const chosen = customers.find((c) => String(c.id) === customerId)
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list
  }, [customers, customerSearch, customerId])

  const parsed = lines.map((l) => ({ name: l.name.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }))
  const valid = parsed.filter((l) => l.name && l.quantity > 0 && l.unitPrice > 0)
  const totals = quickTotals(valid)
  const ready = !!customerId && valid.length > 0 && valid.length === parsed.length && !saving

  const setLine = (index: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const createInvoice = async () => {
    if (!ready) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/maintenance/quick-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: Number(customerId), lines: valid }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body?.error || t("mqi.failed"))
        return
      }
      setCreated({ invoiceNumber: body.invoiceNumber, amount: Number(body.amount) || 0, customerName: body.customerName || "" })
      setLines([emptyLine()])
      setCustomerId("")
      setCustomerSearch("")
    } catch {
      setError(t("mqi.failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("mqi.title")} subtitle={t("mqi.description")} />

      {created && (
        <Card role="status">
          <CardContent className="flex items-center gap-3 pt-6">
            <CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="text-sm">
              {fill(t("mqi.created"), { number: created.invoiceNumber, customer: created.customerName })} <Money value={created.amount} />{" "}
              {t("common.egp")}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("mqi.customer")}</CardTitle>
          <CardDescription>{t("mqi.customer-hint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mqi-customer-search">{t("mqi.customer-search")}</Label>
            <Input id="mqi-customer-search" type="search" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mqi-customer">{t("mqi.customer")}</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="mqi-customer">
                <SelectValue placeholder={t("mqi.choose-customer")} />
              </SelectTrigger>
              <SelectContent>
                {shownCustomers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("mqi.lines")}</CardTitle>
          <CardDescription>{t("mqi.lines-hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.map((line, index) => (
            <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_9rem_auto]">
              <div className="space-y-1">
                <Label htmlFor={`mqi-name-${index}`}>{t("mqi.line-name")}</Label>
                <Input id={`mqi-name-${index}`} value={line.name} maxLength={200} onChange={(e) => setLine(index, { name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`mqi-qty-${index}`}>{t("mqi.line-quantity")}</Label>
                <Input id={`mqi-qty-${index}`} type="number" inputMode="decimal" min="0" step="any" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`mqi-price-${index}`}>{t("mqi.line-price")}</Label>
                <Input id={`mqi-price-${index}`} type="number" inputMode="decimal" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setLine(index, { unitPrice: e.target.value })} />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={fill(t("mqi.remove-line"), { n: index + 1 })}
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            {t("mqi.add-line")}
          </Button>

          <dl className="grid max-w-sm gap-1 border-t pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt>{t("mqi.net")}</dt>
              <dd>
                <Money value={totals.net} /> {t("common.egp")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{t("mqi.vat")}</dt>
              <dd>
                <Money value={totals.vat} /> {t("common.egp")}
              </dd>
            </div>
            <div className="flex justify-between gap-4 font-semibold">
              <dt>{t("mqi.total")}</dt>
              <dd>
                <Money value={totals.total} /> {t("common.egp")}
              </dd>
            </div>
          </dl>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="button" disabled={!ready} onClick={createInvoice}>
            {saving ? t("mqi.creating") : t("mqi.create")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
