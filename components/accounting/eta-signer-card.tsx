"use client"

// E-invoice settings, "Portal and signer" (spec §9): whether each portal's login is set, what waits to be signed, what
// was sent today, and the signer program's connection (connect / disconnect for the CEO and admins). The key of a new
// signer is shown once, right after connecting; it is never kept here once dismissed and never stored.
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { formatDateTime } from "@/lib/format"
import { readApiError } from "@/components/accounting/eta-preview-dialog"

interface SignerState { paired: boolean; name: string | null; lastSeenAt: string | null; unlocked: boolean; connected: boolean }
interface PortalState { waiting: number; sentToday: number; credentials: { test: boolean; real: boolean } }

export function EtaSignerCard({ mayManage }: { mayManage: boolean }) {
  const { t, language } = useI18n()
  const { toast } = useToast()
  const [signer, setSigner] = useState<SignerState | null>(null)
  const [portal, setPortal] = useState<PortalState | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [shownKey, setShownKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([fetch("/api/eta/signer"), fetch("/api/eta/statuses")])
      if (s.ok) setSigner(await s.json())
      if (p.ok) setPortal(await p.json())
    } catch {
      /* shown as "not available" below */
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const fail = (e: unknown) => toast({ title: t("message.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })

  const connect = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/eta/signer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      const pairedKey = (await res.json()).key
      setShownKey(typeof pairedKey === "string" ? pairedKey : null)
      setName("")
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm(t("eta.signer-disconnect-confirm"))) return
    setBusy(true)
    try {
      const res = await fetch("/api/eta/signer", { method: "DELETE" })
      if (!res.ok) throw new Error(await readApiError(res, t("message.error"), language, t))
      setShownKey(null)
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shownKey || "")
      toast({ title: t("eta.signer-copied") })
    } catch {
      toast({ title: t("eta.signer-copy-failed"), variant: "destructive" })
    }
  }

  const yesNo = (v: boolean) => (v ? t("eta.credentials-set") : t("eta.credentials-not-set"))
  const signerLine = !signer
    ? t("eta.loading")
    : !signer.paired
      ? t("eta.signer-none")
      : `${signer.name || t("eta.signer")} - ${signer.connected ? t("eta.signer-online") : t("eta.signer-offline")}${signer.lastSeenAt ? ` (${fill(t("eta.signer-last-seen"), { time: formatDateTime(signer.lastSeenAt, language) })})` : ""}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("eta.signer-section")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg border p-2">
            <dt className="text-xs text-muted-foreground">{t("eta.env-test")}</dt>
            <dd className="font-medium">{portal ? yesNo(portal.credentials.test) : "-"}</dd>
          </div>
          <div className="rounded-lg border p-2">
            <dt className="text-xs text-muted-foreground">{t("eta.env-real")}</dt>
            <dd className="font-medium">{portal ? yesNo(portal.credentials.real) : "-"}</dd>
          </div>
          <div className="rounded-lg border p-2">
            <dt className="text-xs text-muted-foreground">{t("eta.waiting-to-sign")}</dt>
            <dd className="font-medium tabular-nums">{portal ? portal.waiting : "-"}</dd>
          </div>
          <div className="rounded-lg border p-2">
            <dt className="text-xs text-muted-foreground">{t("eta.sent-today")}</dt>
            <dd className="font-medium tabular-nums">{portal ? portal.sentToday : "-"}</dd>
          </div>
        </dl>

        <div className="space-y-1">
          <p className="text-sm font-medium break-words">{signerLine}</p>
          {signer?.paired && <p className="text-sm text-muted-foreground">{signer.unlocked ? t("eta.signer-unlocked") : t("eta.signer-locked")}</p>}
        </div>

        {shownKey && (
          <div role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
            <p className="text-sm font-medium">{t("eta.signer-key-once")}</p>
            <p className="font-mono text-sm break-all" dir="ltr">{shownKey}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={copy}>{t("eta.signer-copy")}</Button>
              <Button size="sm" variant="outline" onClick={() => setShownKey(null)}>{t("eta.signer-key-done")}</Button>
            </div>
          </div>
        )}

        {mayManage ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="eta-signer-name">{t("eta.signer-name")}</Label>
              <Input id="eta-signer-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button onClick={connect} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {signer?.paired ? t("eta.signer-replace") : t("eta.signer-connect")}
            </Button>
            {signer?.paired && (
              <Button variant="outline" onClick={disconnect} disabled={busy}>
                {t("eta.signer-disconnect")}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("eta.signer-only-top")}</p>
        )}
      </CardContent>
    </Card>
  )
}
