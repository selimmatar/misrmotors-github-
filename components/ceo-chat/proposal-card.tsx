"use client"

// A card for an action the CEO chat proposes (owner request, 2026-11-14). Nothing is saved until Confirm:
// it posts the card to /api/ai/ceo-chat/confirm, which runs the normal screen route with the person's login.
import { useState } from "react"
import { Check, Loader2, StickyNote, ShoppingCart, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Money } from "@/components/erp/money"
import { useI18n } from "@/lib/i18n-context"
import type { Proposal } from "@/lib/ai/ceo-tools"

type State = { kind: "open" } | { kind: "saving" } | { kind: "done"; message: string } | { kind: "cancelled" } | { kind: "failed"; message: string }

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { t } = useI18n()
  const [state, setState] = useState<State>({ kind: "open" })
  const Icon = proposal.kind === "note" ? StickyNote : proposal.kind === "purchase_order" ? ShoppingCart : FileText

  const confirm = async () => {
    setState({ kind: "saving" })
    try {
      const res = await fetch("/api/ai/ceo-chat/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposal }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) setState({ kind: "failed", message: body.error || t("message.error") })
      else setState({ kind: "done", message: body.message || t("ceo.card-done") })
    } catch {
      setState({ kind: "failed", message: t("message.error") })
    }
  }

  return (
    <div className="mt-2 rounded-xl border bg-card p-3 text-sm space-y-2 text-foreground">
      <p className="flex items-center gap-2 font-semibold">
        <Icon className="w-4 h-4 text-primary" aria-hidden="true" /> {proposal.title}
      </p>

      {proposal.kind === "note" && <p className="rounded-md bg-amber-500/15 px-2 py-1 whitespace-pre-wrap">{proposal.text}</p>}

      {proposal.kind === "purchase_order" && (
        <>
          {proposal.soNumber && <p className="text-xs text-muted-foreground">{t("ceo.card-for-order")} {proposal.soNumber}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-start font-semibold py-1">{t("ov.item")}</th>
                  <th className="text-end font-semibold py-1">{t("quantity")}</th>
                  <th className="text-end font-semibold py-1">{t("po.cost-per-unit")}</th>
                </tr>
              </thead>
              <tbody>
                {proposal.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">
                      {l.name}
                      {!l.sourceSoItemId && proposal.soNumber && <span className="block text-amber-700 dark:text-amber-400">{t("ceo.card-not-linked")}</span>}
                    </td>
                    <td className="py-1 text-end">{l.quantity}</td>
                    <td className="py-1 text-end"><Money value={l.unitCost} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-end font-semibold">{t("ceo.card-total")} <Money value={proposal.total} /></p>
          <p className="text-xs text-muted-foreground">{t("ceo.card-po-help")}</p>
        </>
      )}

      {proposal.kind === "quotation" && (
        <>
          {!proposal.customerId && <p className="text-xs text-amber-700 dark:text-amber-400">{t("ceo.card-new-customer")}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-start font-semibold py-1">{t("ov.item")}</th>
                  <th className="text-end font-semibold py-1">{t("quantity")}</th>
                  <th className="text-end font-semibold py-1">{t("ceo.card-price")}</th>
                </tr>
              </thead>
              <tbody>
                {proposal.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">
                      {l.name}
                      {!l.productId && <span className="block text-muted-foreground">{t("ceo.card-outsourced")}</span>}
                    </td>
                    <td className="py-1 text-end">{l.quantity}</td>
                    <td className="py-1 text-end"><Money value={l.unitPrice} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-end font-semibold">{t("ceo.card-subtotal")} <Money value={proposal.total} /></p>
          {proposal.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{proposal.notes}</p>}
        </>
      )}

      {state.kind === "open" || state.kind === "saving" ? (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setState({ kind: "cancelled" })} disabled={state.kind === "saving"}>
            <X className="w-4 h-4 me-1" /> {t("action.cancel")}
          </Button>
          <Button size="sm" onClick={confirm} disabled={state.kind === "saving"}>
            {state.kind === "saving" ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Check className="w-4 h-4 me-1" />} {t("ceo.card-confirm")}
          </Button>
        </div>
      ) : state.kind === "done" ? (
        <p className="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1" role="status">
          <Check className="w-4 h-4" /> {state.message}
        </p>
      ) : state.kind === "cancelled" ? (
        <p className="text-muted-foreground" role="status">{t("ceo.card-cancelled")}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
          <p className="text-destructive">{state.message}</p>
          <Button size="sm" variant="outline" onClick={() => setState({ kind: "open" })}>{t("common.retry")}</Button>
        </div>
      )}
    </div>
  )
}
