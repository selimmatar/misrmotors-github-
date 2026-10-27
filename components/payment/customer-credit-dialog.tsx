"use client"

// Uses a party's open credits on an open invoice: a customer's credits (overpayments, returns) on an AR invoice via
// POST /api/accounts-receivable/apply-credit, or a supplier's credits (returned items) on an AP invoice via
// POST /api/accounts-payable/apply-credit. The user picks the credits and an amount from each; the server re-checks,
// reserves them and raises the invoice's paid amount. No cash is recorded.
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Money } from "@/components/erp/money"
import { CreditPickerList, appliedCreditTotal, creditSelections, type CreditAmounts, type PickableCredit } from "@/components/payment/credit-picker"
import { formatDate, formatMoney } from "@/lib/format"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

type CreditInvoice = { id: string; invoiceNumber: string; customerId: string; amount: number; collectedAmount?: number }
type SupplierCreditInvoice = { id: string; invoiceNumber: string; supplierId: string; amount: number; paidAmount?: number }
export type CreditParty = "customer" | "supplier"

const APPLY_URL: Record<CreditParty, string> = {
  customer: "/api/accounts-receivable/apply-credit",
  supplier: "/api/accounts-payable/apply-credit",
}
const TEXT: Record<CreditParty, { title: string; hint: string; none: string }> = {
  customer: { title: "ar.credit.title", hint: "ar.credit.hint", none: "ar.credit.none" },
  supplier: { title: "ap.credit.title", hint: "ap.credit.hint", none: "ap.credit.none" },
}

/** The party's open credits (active, amount > 0), as returned by the credits API. */
export async function loadOpenCredits(party: CreditParty, partyId: string): Promise<any[]> {
  const url = party === "customer" ? `/api/customer-credits?customer_id=${encodeURIComponent(partyId)}` : "/api/supplier-credits"
  const res = await fetch(url)
  const rows = res.ok ? await res.json() : []
  return (Array.isArray(rows) ? rows : []).filter(
    (c: any) =>
      c.status === "active" && Number(c.amount) > 0 && (party === "customer" || String(c.supplier_id) === String(partyId)),
  )
}

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const newKey = () =>
  `credit-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export function CustomerCreditDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: CreditInvoice | null
  onApplied: () => void | Promise<void>
}) {
  const inv = props.invoice
  return (
    <InvoiceCreditDialog
      {...props}
      party="customer"
      invoice={inv && { id: inv.id, invoiceNumber: inv.invoiceNumber, partyId: inv.customerId, amount: inv.amount, paid: inv.collectedAmount }}
    />
  )
}

export function SupplierCreditDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: SupplierCreditInvoice | null
  onApplied: () => void | Promise<void>
}) {
  const inv = props.invoice
  return (
    <InvoiceCreditDialog
      {...props}
      party="supplier"
      invoice={inv && { id: inv.id, invoiceNumber: inv.invoiceNumber, partyId: inv.supplierId, amount: inv.amount, paid: inv.paidAmount }}
    />
  )
}

/**
 * Shown inside a payment window: "Use customer credit (12,000 EGP open)". Renders nothing when the party has no open
 * credit, so it only appears when there is something to use.
 */
export function UseCreditButton({ party, partyId, onClick }: { party: CreditParty; partyId: string; onClick: () => void }) {
  const { t, language } = useI18n()
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!partyId) return
    let cancelled = false
    loadOpenCredits(party, partyId)
      .then((rows) => !cancelled && setTotal(money(rows.reduce((sum, c) => sum + Number(c.amount), 0))))
      .catch(() => !cancelled && setTotal(0))
    return () => {
      cancelled = true
    }
  }, [party, partyId])
  if (total <= 0) return null
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed p-3">
      <span className="text-sm">{fill(t("credit.open-available"), { amount: formatMoney(total, language) })}</span>
      <Button type="button" variant="outline" size="sm" onClick={onClick}>
        {t(party === "customer" ? "ar.credit.use-customer" : "ap.credit.use-supplier")}
      </Button>
    </div>
  )
}

function InvoiceCreditDialog({
  open,
  onOpenChange,
  invoice,
  onApplied,
  party,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: { id: string; invoiceNumber: string; partyId: string; amount: number; paid?: number } | null
  onApplied: () => void | Promise<void>
  party: CreditParty
}) {
  const { t, language } = useI18n()
  const [credits, setCredits] = useState<PickableCredit[]>([])
  const [loading, setLoading] = useState(false)
  const [amounts, setAmounts] = useState<CreditAmounts>({})
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const keyRef = useRef<string>(newKey())

  useEffect(() => {
    if (open) {
      keyRef.current = newKey()
      setAmounts({})
    }
  }, [open, invoice?.id])

  useEffect(() => {
    if (!open || !invoice?.partyId) return
    let cancelled = false
    setLoading(true)
    loadOpenCredits(party, invoice.partyId)
      .then((list) => {
        if (cancelled) return
        setCredits(
          list.map((c: any) => ({
            credit_id: c.credit_id,
            amount: Number(c.amount),
            detail: [
              c.credit_type === "overpayment" && c.invoice_number
                ? fill(t("customer.credit-overpayment-on"), { number: c.invoice_number })
                : c.credit_type === "sales_return"
                ? fill(t("customer.credit-return"), { id: c.reference_id })
                : c.description,
              c.po_number ? fill(t("supplier.credit-po"), { number: c.po_number }) : null,
              c.created_at ? formatDate(c.created_at, language) : null,
            ]
              .filter(Boolean)
              .join(" • "),
          })),
        )
      })
      .catch(() => !cancelled && setCredits([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, invoice?.partyId, party, reloadKey, language, t])

  if (!invoice) return null
  const remaining = money(Math.max((invoice.amount || 0) - (invoice.paid || 0), 0))
  const applied = appliedCreditTotal(amounts)
  const invalid =
    applied <= 0 ||
    applied > remaining + 0.005 ||
    creditSelections(amounts).some((s) => s.amount > (credits.find((c) => c.credit_id === s.creditId)?.amount ?? 0) + 0.005)

  const apply = async () => {
    if (saving || invalid) return
    setSaving(true)
    try {
      const response = await fetch(APPLY_URL[party], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoice.id), idempotencyKey: keyRef.current, credits: creditSelections(amounts) }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok) {
        alert(fill(t("ar.credit.applied"), { amount: formatMoney(result.applied ?? applied, language) }))
        await onApplied()
        onOpenChange(false)
        return
      }
      // a refused request wrote nothing: the next try is a new request
      if (!result.partialFailure) keyRef.current = newKey()
      if (result.code === "CREDIT_NOT_AVAILABLE") {
        alert(t("ar.credit.err-not-available"))
        setAmounts({})
        setReloadKey((k) => k + 1)
      } else if (result.code === "CREDIT_AMOUNT_INVALID") {
        alert(t("po.credit.err-amount"))
        setReloadKey((k) => k + 1)
      } else if (result.code === "CREDIT_EXCEEDS_TOTAL") {
        alert(t("ar.credit.more-than-balance"))
        await onApplied()
      } else {
        alert(result.error || t("message.error"))
        if (result.partialFailure || response.status === 409) await onApplied()
      }
    } catch (error) {
      console.error(`Applying ${party} credit failed:`, error)
      alert(t("message.error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ar.credit.use")}</DialogTitle>
          <DialogDescription>
            {invoice.invoiceNumber} • {t("ar.credit.remaining")}: <Money value={remaining} /> {t("common.egp-2")}
          </DialogDescription>
        </DialogHeader>
        {!loading && credits.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">{t(TEXT[party].none)}</p>
        ) : (
          <CreditPickerList
            credits={credits}
            loading={loading}
            limit={remaining}
            value={amounts}
            onChange={setAmounts}
            title={t(TEXT[party].title)}
            hint={t(TEXT[party].hint)}
            overLimitMessage={t("ar.credit.more-than-balance")}
          />
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button onClick={apply} disabled={saving || invalid}>
            {saving ? t("ar.credit.applying") : t("ar.credit.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
