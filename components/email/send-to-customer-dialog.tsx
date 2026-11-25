"use client"

// "Send to customer" (owner request 2026-11-27): the window behind the Send button of a quotation or a sales order.
// Shows who the e-mail will go to (the customer's purchasing contact and main e-mail, editable) and earlier sends.
// Nothing is sent until the person presses Send. The document goes as a PDF (POST /api/document-email).
import { useEffect, useState } from "react"
import { Mail, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDateTime } from "@/lib/format"
import type { DocEmailView, DocKind } from "@/lib/email/document-email"

export function SendToCustomerButton(props: { kind: DocKind; id: number | string; size?: "sm" | "default"; className?: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" size={props.size || "sm"} variant="outline" className={`gap-2 ${props.className || ""}`} onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4" />
        {t("send.to-customer")}
      </Button>
      {open && <SendToCustomerDialog kind={props.kind} id={props.id} open={open} onOpenChange={setOpen} />}
    </>
  )
}

export function SendToCustomerDialog(props: { kind: DocKind; id: number | string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, language } = useI18n()
  const [view, setView] = useState<DocEmailView | null>(null)
  const [to, setTo] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const ar = language === "ar"

  useEffect(() => {
    if (!props.open) return
    let live = true
    setLoading(true)
    setMessage(null)
    fetch(`/api/document-email?kind=${props.kind}&id=${encodeURIComponent(String(props.id))}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!live) return
        if (!r.ok || !body) {
          setMessage({ text: t("send.load-failed"), ok: false })
          return
        }
        setView(body)
        setTo((body.suggested || []).join(", "))
      })
      .catch(() => live && setMessage({ text: t("send.load-failed"), ok: false }))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [props.open, props.kind, props.id, t])

  const sentBefore = (view?.history || []).some((h) => h.status === "sent")

  const send = async () => {
    if (!to.trim()) {
      setMessage({ text: t("send.need-address"), ok: false })
      return
    }
    if (sentBefore && !window.confirm(t("send.again-confirm"))) return
    setSending(true)
    setMessage(null)
    try {
      const r = await fetch("/api/document-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: props.kind, id: Number(props.id), to }),
      })
      const body = await r.json().catch(() => null)
      if (body?.email) setView(body.email)
      if (r.ok && body?.status === "sent") setMessage({ text: fill(t("send.sent"), { to: (body.to || []).join(", ") }), ok: true })
      else setMessage({ text: (ar ? body?.errorAr : body?.error) || body?.error || t("send.failed"), ok: false })
    } catch {
      setMessage({ text: t("send.failed"), ok: false })
    } finally {
      setSending(false)
    }
  }

  const title = props.kind === "quotation" ? t("send.title-quotation") : t("send.title-sales-order")
  return (
    <Dialog open={props.open} onOpenChange={(o) => !sending && props.onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{view ? `${title} ${view.number}` : title}</DialogTitle>
          <DialogDescription>{view?.customerName ? fill(t("send.description"), { customer: view.customerName }) : t("send.description-plain")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            {view && !view.dbReady && <p className="text-sm text-amber-700 dark:text-amber-300">{t("send.db-update-needed")}</p>}
            {view && !view.configured && <p className="text-sm text-amber-700 dark:text-amber-300">{t("send.not-configured")}</p>}
            <div className="space-y-1">
              <Label htmlFor="send-to">{t("send.to")}</Label>
              <Input id="send-to" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder="purchasing@example.com, info@example.com" />
              <p className="text-xs text-muted-foreground">{view && !view.suggested.length ? t("send.no-suggested") : t("send.to-hint")}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t("send.pdf-note")}</p>
            {view && view.history.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("send.history")}</p>
                <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                  {view.history.map((h, i) => (
                    <li key={i} className={h.status === "sent" ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}>
                      {formatDateTime(h.at, language)} — {h.status === "sent" ? fill(t("send.history-sent"), { to: h.sentTo }) : fill(t("send.history-failed"), { reason: h.error || h.status })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {message && (
              <p role="status" className={`text-sm ${message.ok ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                {message.text}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={sending}>
            {t("action.close")}
          </Button>
          <Button onClick={send} disabled={loading || sending || !view || !view.dbReady || !view.configured} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {sending ? t("send.sending") : sentBefore ? t("send.again") : t("send.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
