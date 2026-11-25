"use client"

// E-invoice preview of one customer invoice (spec §9): the lines as they would be sent, each line's item code with a
// green / orange / red state and a confirm / change control (writes the code memory), the portal totals, what is
// still missing, the "already on the portal" mark, and the send / send again / credit note / cancel / portal PDF /
// correct-and-reissue actions by the state of the invoice's documents (step 2).
import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EtaCodePicker } from "@/components/accounting/eta-code-picker"
import { Money } from "@/components/erp/money"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDateTime, formatMoney } from "@/lib/format"
import { ETA_UNITS } from "@/lib/eta/egypt"
import type { CodeState } from "@/lib/eta/codes"
import type { EtaPreview, EtaPreviewLine } from "@/lib/eta/preview"
import type { EtaDocumentView } from "@/lib/eta/after-send"
import type { InvoiceEmailView } from "@/lib/eta/invoice-email"

/** What GET /api/eta/preview answers: the preview plus the portal documents per environment. */
export type EtaPreviewResponse = EtaPreview & {
  environment: "test" | "real"
  documents: Record<"test" | "real", EtaDocumentView[]>
  cancelWindowHours: number | null
  /** a real document is live: the company the invoice is issued for can't change */
  identityLocked?: boolean
  /** the customer e-mail of the valid e-invoice (lib/eta/invoice-email.ts) */
  email?: InvoiceEmailView
}

export interface EtaCodeRow {
  code_id: number
  item_code: string
  code_type?: string | null
  name?: string | null
  keywords?: string[] | null
  default_unit?: string | null
  active?: boolean | null
}

/** The server's error text when it sent one as text; otherwise the fallback (never "[object Object]"). */
export async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return body && typeof body.error === "string" && body.error.trim() ? body.error : fallback
}

const REFUSAL_REASONS = [
  "amount_mismatch", "already_live", "final", "not_found", "no_issue_date", "build_failed", "handled_manually",
  "already_on_portal", "portal_check_failed", "portal_check_later",
]
const MISSING_REASONS = ["company_rin", "company_activity", "company_address", "receiver_identity", "customer_tax_number", "customer_address", "line_codes", "portal_codes"]

/** A refusal reason code of the send routes in plain words. */
export function reasonText(code: string, t: (key: string) => string): string {
  if (MISSING_REASONS.includes(code)) return t(`eta.missing-${code}`)
  if (REFUSAL_REASONS.includes(code)) return t(`eta.refuse-${code}`)
  return code ? t("eta.refuse-other") : ""
}

/** The API's plain-word message (Arabic when the page is Arabic and the API sent one), with its reasons; else the fallback. */
export async function readApiError(res: Response, fallback: string, language: string, t: (key: string) => string): Promise<string> {
  const body = await res.json().catch(() => null)
  const main = body && language === "ar" && typeof body.errorAr === "string" && body.errorAr.trim()
    ? body.errorAr
    : body && typeof body.error === "string" && body.error.trim() ? body.error : fallback
  const reasons: string[] = body && Array.isArray(body.reasons) ? body.reasons.map((r: string) => reasonText(r, t)).filter(Boolean) : []
  return reasons.length ? `${main} ${reasons.join("; ")}` : main
}

/** "" or spaces is no unit. */
export const hasUnit = (u: string | null | undefined) => !!u && u.trim() !== ""

export const STATE_TONE: Record<CodeState, string> = {
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  orange: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
}

export function StatePill({ state }: { state: CodeState }) {
  const { t } = useI18n()
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATE_TONE[state]}`}>
      {t(`eta.state-${state}`)}
    </span>
  )
}

const NONE = "none"

function LineRow({ line, codes, onSaved, readOnly }: { line: EtaPreviewLine; codes: EtaCodeRow[]; onSaved: () => Promise<void>; readOnly?: boolean }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [codeId, setCodeId] = useState(line.codeId != null ? String(line.codeId) : NONE)
  const [unit, setUnit] = useState(hasUnit(line.unit) ? line.unit : NONE)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setCodeId(line.codeId != null ? String(line.codeId) : NONE)
    setUnit(hasUnit(line.unit) ? line.unit : NONE)
  }, [line.codeId, line.unit])

  // active codes, plus the line's own code so the picker never shows blank
  const options = codes.filter((c) => c.active !== false || c.code_id === line.codeId)
  const units: string[] = [...ETA_UNITS]
  if (hasUnit(line.unit) && !units.includes(line.unit)) units.push(line.unit)

  const confirm = async () => {
    if (codeId === NONE) return
    setSaving(true)
    try {
      const res = await fetch("/api/eta/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: line.name, codeId: Number(codeId), unitType: unit === NONE ? "" : unit, productId: line.productId ?? null }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.confirmed") })
      await onSaved()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium break-words min-w-0">{line.name}</p>
        <StatePill state={line.state} />
      </div>
      {line.portalItemCode && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {fill(t("eta.portal-code-note"), { code: line.portalItemCode })}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.quantity")}</p>
          <bdi className="tabular-nums">{line.quantity}</bdi>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.unit-price")}</p>
          <Money value={line.unitPrice} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("eta.line-total")}</p>
          <Money value={line.total} className="font-semibold" />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{t("eta.item-code")}</p>
          <EtaCodePicker
            codes={options}
            value={codeId === NONE ? null : Number(codeId)}
            onChange={(id) => setCodeId(id == null ? NONE : String(id))}
            ariaLabel={`${t("eta.item-code")} ${line.name}`}
            noneLabel={t("eta.choose-code")}
            disabled={readOnly}
          />
        </div>
        <div className="sm:w-40 space-y-1">
          <p className="text-xs text-muted-foreground">{t("eta.unit")}</p>
          <Select value={unit} onValueChange={setUnit} disabled={readOnly}>
            <SelectTrigger aria-label={`${t("eta.unit")} ${line.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("eta.no-unit")}</SelectItem>
              {units.map((u) => (
                <SelectItem key={u} value={u}>
                  {(ETA_UNITS as readonly string[]).includes(u) ? `${u} - ${t(`eta.unit-${u}`)}` : u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={confirm} disabled={saving || codeId === NONE}>
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t("eta.confirm")}
          </Button>
        )}
      </div>
    </li>
  )
}

const DAY_MS = 24 * 3600_000
const last = <T,>(rows: T[]): T | undefined => rows[rows.length - 1]
const isLive = (d: EtaDocumentView) => ["pending_signature", "submitted", "valid"].includes(d.status)

/**
 * The customer e-mail of the valid e-invoice (owner request 2026-11-24): "E-mailed to x on date" / "E-mail failed:
 * reason" / "No customer e-mail" / "E-mail not set up", and "Send by e-mail again" (logged as a manual send).
 */
function EtaEmailStatus({ email, invoiceId, reload }: { email: InvoiceEmailView; invoiceId: string; reload: () => Promise<void> }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const last = email.last
  const sendAgain = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/eta/invoice-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: Number(invoiceId) }) })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      toast({ title: t("eta.email-sent-now") })
    } catch (e) {
      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusy(false)
      await reload()
    }
  }
  let line: { text: string; tone: string }
  if (!email.dbReady) line = { text: t("eta.email-db-update-needed"), tone: "text-muted-foreground" }
  else if (last?.status === "sent") line = { text: fill(t("eta.email-sent"), { to: last.to || "", date: formatDateTime(last.at, language) }), tone: "text-emerald-800 dark:text-emerald-300" }
  else if (last?.status === "failed") line = { text: fill(t("eta.email-failed"), { reason: last.error || "" }), tone: "text-red-700 dark:text-red-300" }
  else if (last?.status === "no_email") line = { text: t("eta.email-no-customer-email"), tone: "text-amber-800 dark:text-amber-300" }
  else if (last?.status === "sending") line = { text: t("eta.email-sending"), tone: "text-muted-foreground" }
  else if (!email.configured || last?.status === "not_configured") line = { text: t("eta.email-not-set-up"), tone: "text-muted-foreground" }
  else line = { text: t("eta.email-not-sent"), tone: "text-muted-foreground" }
  return (
    <div className="space-y-1 text-sm">
      <p className={`break-words ${line.tone}`} role={last?.status === "failed" ? "alert" : undefined}>
        {line.text}
      </p>
      {email.dbReady && email.configured && (
        <Button variant="outline" size="sm" onClick={sendAgain} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
          {last ? t("eta.email-send-again") : t("eta.email-send")}
        </Button>
      )}
    </div>
  )
}

/** The send / credit note / cancel / reissue actions of the invoice, by the state of its documents on the selected portal. */
function EtaActions({
  preview, invoiceId, invoiceDate, reload, onChanged, onReissue,
}: {
  preview: EtaPreviewResponse
  invoiceId: string
  invoiceDate?: string
  reload: () => Promise<void>
  onChanged?: () => void
  onReissue?: () => void
}) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [cancelDoc, setCancelDoc] = useState<number | null>(null)
  const [reason, setReason] = useState("")

  const env = preview.environment
  const docs = (preview.documents?.[env] ?? []).filter((d) => d.status !== "manual")
  const invoices = docs.filter((d) => d.document_type === "I")
  const notes = docs.filter((d) => d.document_type === "C")
  const inv = last(invoices)
  const note = last(notes)
  const newest = last([...docs].sort((a, b) => a.doc_id - b.doc_id))
  const liveNote = notes.some(isLive)
  const old = invoiceDate ? Date.now() - Date.parse(invoiceDate) > 7 * DAY_MS : false

  const run = async (path: string, body: unknown, done: string) => {
    setBusy(true)
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      const answer = await res.json().catch(() => ({}))
      if (Array.isArray(answer.refused) && answer.refused[0]?.reasons?.[0] === "already_on_portal") {
        // found on the portal (typed by hand): marked as such, nothing sent - the window shows the mark
        toast({ title: reasonText("already_on_portal", t) })
        await reload()
        onChanged?.()
        return
      }
      if (Array.isArray(answer.refused) && answer.refused.length > 0) {
        throw new Error(answer.refused[0].reasons.map((r: string) => reasonText(r, t)).filter(Boolean).join("; ") || t("message.error"))
      }
      toast({ title: t(done) })
      setCancelDoc(null)
      setReason("")
      await reload()
      onChanged?.()
    } catch (e) {
      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const send = () => {
    if (old && !window.confirm(t("eta.old-confirm"))) return
    run("/api/eta/send", { invoiceIds: [Number(invoiceId)] }, "eta.queued")
  }

  const printout = async (docId: number) => {
    // Phones (iOS Safari above all) block a tab opened after an await, so the tab is opened on the tap itself and
    // the PDF is loaded into it once it arrives (owner report, 2026-11-22: "print portal invoice does nothing").
    const tab = window.open("", "_blank")
    setBusy(true)
    try {
      const res = await fetch(`/api/eta/printout?docId=${docId}`)
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      const url = URL.createObjectURL(await res.blob())
      if (tab && !tab.closed) tab.location.href = url
      else {
        // no tab could be opened: download the file instead
        const a = document.createElement("a")
        a.href = url
        a.download = `eta-${docId}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      if (tab && !tab.closed) tab.close()
      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const label = (d: EtaDocumentView) => {
    const kind = d.document_type === "C" ? t("eta.doc-credit-note") : t("eta.doc-invoice")
    const state = d.cancel_pending ? t("eta.doc-cancel-pending") : t(`eta.doc-${d.status}`)
    return `${kind} v${d.version}: ${state}`
  }
  const portalSilent = (d: EtaDocumentView) => d.status === "submitted" && !!d.submitted_at && Date.now() - Date.parse(d.submitted_at) > DAY_MS

  const canSend = docs.length === 0 && preview.missing.length === 0 && (env === "test" || !preview.handledManually)
  const canSendAgain = newest?.status === "invalid"
  const reversed = env === "real" && (note?.status === "valid" || ((inv?.status === "cancelled" || inv?.status === "rejected") && !liveNote))
  const validDocs = docs.filter((d) => d.status === "valid")

  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="font-semibold">{t("eta.actions-title")}</h3>
      <p className={`text-sm font-medium ${env === "test" ? "text-amber-800 dark:text-amber-300" : ""}`}>
        {env === "test" ? t("eta.test-banner") : t("eta.real-banner")}
      </p>

      {docs.length > 0 && (
        <ul className="space-y-2 text-sm">
          {docs.map((d) => (
            <li key={d.doc_id} className="space-y-1">
              <p className="font-medium">{label(d)}</p>
              {d.status === "pending_signature" && <p className="text-muted-foreground">{t("eta.waiting-signature")}</p>}
              {portalSilent(d) && (
                <p className="text-amber-800 dark:text-amber-300">
                  {t("eta.portal-silent")}{" "}
                  <button type="button" className="underline underline-offset-2" onClick={() => reload()}>
                    {t("eta.check-again")}
                  </button>
                </p>
              )}
              {d.status === "invalid" &&
                d.errors.map((e, i) => (
                  <p key={i} role="alert" className="text-red-700 dark:text-red-300 break-words">
                    {language === "ar" && e.messageAr ? e.messageAr : e.message}
                  </p>
                ))}
            </li>
          ))}
        </ul>
      )}

      {inv?.status === "valid" && preview.email && <EtaEmailStatus email={preview.email} invoiceId={invoiceId} reload={reload} />}
            {!(inv?.status === "valid") && preview.handledManually && preview.manualEtaUuid && preview.email && <EtaEmailStatus email={preview.email} invoiceId={invoiceId} reload={reload} />}

      {canSend && old && <p className="text-sm text-amber-800 dark:text-amber-300">{t("eta.old-warning")}</p>}
      {docs.length === 0 && preview.missing.length > 0 && <p className="text-sm text-muted-foreground">{t("eta.fix-missing")}</p>}

      <div className="flex flex-wrap gap-2">
        {canSend && (
          <Button onClick={send} disabled={busy}>
            {t(env === "test" ? "eta.send-test" : "eta.send")}
          </Button>
        )}
        {canSendAgain && (
          <Button onClick={() => run("/api/eta/send-again", { invoiceId: Number(invoiceId) }, "eta.queued")} disabled={busy}>
            {t("eta.send-again")}
          </Button>
        )}
        {inv?.status === "valid" && !liveNote && (
          <Button variant="outline" onClick={() => run("/api/eta/credit-note", { invoiceId: Number(invoiceId) }, "eta.credit-queued")} disabled={busy}>
            {t("eta.credit-note")}
          </Button>
        )}
        {validDocs.map((d) => (
          <Button key={`pdf-${d.doc_id}`} variant="outline" onClick={() => printout(d.doc_id)} disabled={busy}>
            {t("eta.portal-pdf")} ({d.document_type === "C" ? t("eta.doc-credit-note") : t("eta.doc-invoice")})
          </Button>
        ))}
        {validDocs
          .filter((d) => d.document_type === "C" || !liveNote)
          .map((d) => (
            <Button key={`cancel-${d.doc_id}`} variant="outline" onClick={() => setCancelDoc(d.doc_id)} disabled={busy}>
              {t("eta.cancel-portal")} ({d.document_type === "C" ? t("eta.doc-credit-note") : t("eta.doc-invoice")})
            </Button>
          ))}
        {reversed && onReissue && (
          <Button onClick={onReissue} disabled={busy}>
            {t("eta.reissue")}
          </Button>
        )}
      </div>

      {cancelDoc !== null && (
        <div className="rounded-lg border p-3 space-y-2">
          {preview.cancelWindowHours != null && <p className="text-sm text-muted-foreground">{fill(t("eta.cancel-window"), { hours: preview.cancelWindowHours })}</p>}
          <Label htmlFor="eta-cancel-reason">{t("eta.cancel-reason")}</Label>
          <Textarea id="eta-cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run("/api/eta/cancel", { docId: cancelDoc, reason: reason.trim() }, "eta.cancel-requested")}>
              {t("eta.cancel-portal")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setCancelDoc(null)}>
              {t("eta.cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

export function EtaPreviewDialog({
  invoiceId, invoiceNumber, invoiceDate, onClose, onChanged, onReissue, canEditCodes = true,
}: {
  invoiceId: string
  invoiceNumber: string
  invoiceDate?: string
  onClose: () => void
  /** called after something was sent, cancelled or credited, so the list can refresh its badges */
  onChanged?: () => void
  /** opens "Correct and reissue" for this invoice */
  onReissue?: () => void
  /** false: the viewer sees the codes read-only (only the accountant, CEO or admin confirms codes) */
  canEditCodes?: boolean
}) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [preview, setPreview] = useState<EtaPreviewResponse | null>(null)
  const [codes, setCodes] = useState<EtaCodeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [etaUuid, setEtaUuid] = useState("")
  const [marking, setMarking] = useState(false)
  const [makingSendable, setMakingSendable] = useState(false)
  const [choosing, setChoosing] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/eta/preview?invoiceId=${encodeURIComponent(invoiceId)}`)
      if (!res.ok) {
        setError(await readError(res, ""))
        setPreview(null)
        return
      }
      setPreview((await res.json()) as EtaPreviewResponse)
    } catch {
      setError("")
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    setLoading(true)
    load()
    fetch("/api/eta/codes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setCodes(Array.isArray(rows) ? rows : []))
      .catch(() => setCodes([]))
  }, [load])

  const markOnPortal = async () => {
    setMarking(true)
    try {
      const res = await fetch("/api/eta/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoiceId), etaUuid: etaUuid.trim() }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      setEtaUuid("")
      await load()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  // which of the customer's companies (tax identities) the invoice is issued for; the preview is rebuilt with it
  const chooseIdentity = async (value: string) => {
    setChoosing(true)
    try {
      const res = await fetch("/api/eta/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: Number(invoiceId), identityId: Number(value) }),
      })
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      await load()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setChoosing(false)
    }
  }

  // the receiver's missing address from an earlier portal document of its tax number (only empty fields are filled);
  // `auto`: once when the preview opens with the address missing - quiet unless it found one
  const [addressBusy, setAddressBusy] = useState(false)
  const [addressNote, setAddressNote] = useState("")
  const autoAddressTried = useRef(false)
  const addressFromPortal = useCallback(
    async (auto: boolean) => {
      setAddressBusy(true)
      if (!auto) setAddressNote("")
      try {
        const res = await fetch("/api/eta/receiver-address", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: Number(invoiceId), auto }),
        })
        const body = await res.json().catch(() => null)
        const note = body && typeof body.message === "string" ? (language === "ar" && body.messageAr ? body.messageAr : body.message) : ""
        if (res.ok && body?.status === "filled") {
          toast({ title: t("eta.address-portal-filled") })
          setAddressNote(note)
          await load()
          return
        }
        if (auto) return
        if (!res.ok) throw new Error(note || (body && typeof body.error === "string" ? body.error : t("message.error")))
        setAddressNote(body?.status === "not_found" || body?.status === "not_found_cached" ? t("eta.address-portal-not-found") : note)
      } catch (e) {
        if (!auto) setAddressNote(fill(t("eta.address-portal-failed"), { error: e instanceof Error ? e.message : String(e) }))
      } finally {
        setAddressBusy(false)
      }
    },
    [invoiceId, language, load, t, toast],
  )
  useEffect(() => {
    if (!preview || autoAddressTried.current || !canEditCodes || preview.handledManually) return
    if (!preview.missing.includes("customer_address")) return
    autoAddressTried.current = true
    addressFromPortal(true)
  }, [preview, canEditCodes, addressFromPortal])

  const undoMark = async () => {
    setMarking(true)
    try {
      const res = await fetch(`/api/eta/preview?invoiceId=${encodeURIComponent(invoiceId)}`, { method: "DELETE" })
      if (res.status === 404) {
        toast({ title: t("eta.portal-undo-none") })
        return
      }
      if (!res.ok) throw new Error(await readError(res, t("message.error")))
      toast({ title: t("eta.saved") })
      await load()
    } catch (e) {
      toast({ title: t("message.error"), description: fill(t("eta.save-failed"), { error: e instanceof Error ? e.message : String(e) }), variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  const missingText = (m: EtaPreview["missing"][number]) =>
    m === "amount_mismatch" && preview
      ? fill(t("eta.missing-amount_mismatch"), { stored: formatMoney(preview.storedAmount, language), total: formatMoney(preview.totals.total, language) })
      : t(`eta.missing-${m}`)

  const totals = preview
    ? [
        { key: "eta.total-sales", value: preview.totals.sales },
        { key: "eta.total-discount", value: preview.totals.discount },
        { key: "eta.total-net", value: preview.totals.net },
        { key: "eta.total-vat", value: preview.totals.vat },
        { key: "eta.total-total", value: preview.totals.total },
      ]
    : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fill(t("eta.preview-title"), { number: invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("eta.preview-help")}</DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("eta.loading")}
          </p>
        )}

        {!loading && error !== null && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <p className="text-sm font-medium">{t("eta.preview-error")}</p>
            {error && <p className="text-xs text-muted-foreground break-words">{error}</p>}
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); load() }}>
              <RefreshCw className="w-4 h-4 me-2" />
              {t("eta.retry")}
            </Button>
          </div>
        )}

        {!loading && preview && (
          <div className="space-y-5">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("eta.customer")}: </span>
              <span className="font-medium">{preview.customer.name || "-"}</span>
              {preview.customer.taxRegistrationNumber && (
                <span className="text-muted-foreground">
                  {" "}
                  · {t("eta.tax-number")}: <bdi>{preview.customer.taxRegistrationNumber}</bdi>
                </span>
              )}
            </div>

            {/* 2+ companies on the portal for this customer: pick one by NAME (tax numbers are never listed here) */}
            {(preview.identities?.length ?? 0) > 1 && (
              <div className="space-y-1 max-w-sm">
                <Label htmlFor="eta-identity">{t("eta.identity-choose")}</Label>
                <Select
                  value={preview.identityId != null ? String(preview.identityId) : undefined}
                  onValueChange={chooseIdentity}
                  disabled={choosing || !!preview.identityLocked}
                >
                  <SelectTrigger id="eta-identity" aria-label={t("eta.identity-choose")}>
                    <SelectValue placeholder={t("eta.identity-choose-placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.identities!.map((i) => (
                      <SelectItem key={i.identityId} value={String(i.identityId)}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {preview.identityLocked && <p className="text-xs text-muted-foreground">{t("eta.identity-locked")}</p>}
              </div>
            )}

            {preview.handledManually && (
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <p className="font-semibold">{t("eta.manual-title")}</p>
                <p className="text-sm text-muted-foreground">{t("eta.manual-note")}</p>
                {preview.manualEtaUuid && (
                  <p className="text-sm">
                    {t("eta.manual-id")}{" "}
                    <bdi className="font-mono break-all">{preview.manualEtaUuid}</bdi>
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={makingSendable}
                  onClick={async () => {
                    if (!window.confirm(t("eta.make-sendable-confirm"))) return
                    setMakingSendable(true)
                    try {
                      const res = await fetch("/api/eta/make-sendable", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ invoiceId: Number(invoiceId) }),
                      })
                      if (!res.ok) throw new Error(await readError(res, t("message.error")))
                      toast({ title: t("eta.make-sendable-done") })
                      await load()
                      onChanged?.()
                    } catch (e) {
                      toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
                    } finally {
                      setMakingSendable(false)
                    }
                  }}
                >
                  {t("eta.make-sendable")}
                </Button>
              </div>
            )}

            <section className="space-y-2">
              <h3 className="font-semibold">{t("eta.lines")}</h3>
              {!canEditCodes && <p className="text-sm text-muted-foreground">{t("eta.codes-by-accountant")}</p>}
              {preview.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("eta.no-lines")}</p>
              ) : (
                <ul className="space-y-2">
                  {preview.lines.map((line, i) => (
                    <LineRow key={`${i}-${line.name}`} line={line} codes={codes} onSaved={load} readOnly={!canEditCodes} />
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">{preview.handledManually ? t("eta.totals-reference") : t("eta.totals")}</h3>
              <dl className={`grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm ${preview.handledManually ? "opacity-70" : ""}`}>
                {totals.map((row) => (
                  <div key={row.key} className="rounded-lg border p-2">
                    <dt className="text-xs text-muted-foreground">{t(row.key)}</dt>
                    <dd className={row.key === "eta.total-total" ? "font-bold" : ""}>
                      <Money value={row.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">{t("eta.missing-title")}</h3>
              {preview.missing.length === 0 ? (
                <p className="text-sm text-emerald-800 dark:text-emerald-300">{t("eta.missing-none")}</p>
              ) : (
                <ul className="list-disc ps-5 space-y-1 text-sm">
                  {preview.missing.map((m) => (
                    <li key={m}>
                      {missingText(m)}
                      {m === "customer_address" && canEditCodes && (
                        <Button type="button" variant="outline" size="sm" className="ms-2 my-1" onClick={() => addressFromPortal(false)} disabled={addressBusy}>
                          {addressBusy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                          {t("eta.address-from-portal")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {addressNote && (
                <p role="status" className="text-sm text-muted-foreground">
                  {addressNote}
                </p>
              )}
            </section>

            <EtaActions preview={preview} invoiceId={invoiceId} invoiceDate={invoiceDate} reload={load} onChanged={onChanged} onReissue={onReissue} />

            <section className="rounded-lg border p-3 space-y-2">
              <h3 className="font-semibold">{t("eta.portal-section")}</h3>
              <p className="text-sm text-muted-foreground">{t("eta.portal-help")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="eta-portal-id">{t("eta.portal-id")}</Label>
                  <Input id="eta-portal-id" value={etaUuid} maxLength={100} onChange={(e) => setEtaUuid(e.target.value)} dir="ltr" />
                </div>
                <Button onClick={markOnPortal} disabled={marking}>
                  {t("eta.portal-mark")}
                </Button>
                {preview.handledManually && (
                  <Button variant="outline" onClick={undoMark} disabled={marking}>
                    {t("eta.portal-undo")}
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
