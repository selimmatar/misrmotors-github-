"use client"

// A customer's companies on the e-invoice portal (tax identities): a mother company and its sister companies /
// branches, each with its own name, receiver type, tax number / national ID and address. Each add / edit / switch
// off saves at once (/api/customers/tax-identities). With none, the e-invoice uses the customer card's old fields.
import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { GOVERNORATES, toLatinDigits } from "@/lib/eta/egypt"
import type { TaxIdentity } from "@/lib/eta/identities"

type Draft = {
  name: string
  receiverType: "B" | "P" | "F"
  taxRegistrationNumber: string
  nationalId: string
  governorate: string
  region: string
  street: string
  buildingNumber: string
}

/** The card's old e-invoice fields: the first company's starting values when the customer has none yet. */
export interface CardTaxFields {
  name: string
  receiverType?: "B" | "P" | "F"
  taxRegistrationNumber?: string
  nationalId?: string
  governorate?: string
  region?: string
  street?: string
  buildingNumber?: string
}

const NONE = "none"
const TYPE_KEY: Record<string, string> = { B: "eta.receiver-business", P: "eta.receiver-person", F: "eta.receiver-foreign" }

const draftOf = (i: TaxIdentity): Draft => ({
  name: i.name,
  receiverType: (["B", "P", "F"].includes(i.receiverType) ? i.receiverType : "B") as Draft["receiverType"],
  taxRegistrationNumber: i.taxRegistrationNumber,
  nationalId: i.nationalId,
  governorate: i.governorate,
  region: i.region,
  street: i.street,
  buildingNumber: i.buildingNumber,
})

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return body && typeof body.error === "string" && body.error.trim() ? body.error : fallback
}

export function CustomerTaxIdentities({ customerId, card, canEdit = true }: { customerId: string | number | null | undefined; card: CardTaxFields; canEdit?: boolean }) {
  const { t, language } = useI18n()
  const [items, setItems] = useState<TaxIdentity[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  /** "new", an identity id being edited, or null */
  const [editing, setEditing] = useState<"new" | number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  const id = customerId != null && String(customerId).trim() !== "" ? String(customerId) : null

  const load = useCallback(async () => {
    if (!id) return
    setLoadFailed(false)
    try {
      const res = await fetch(`/api/customers/tax-identities?customerId=${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(await errorText(res, t("message.error")))
      setItems((await res.json()) as TaxIdentity[])
    } catch {
      setLoadFailed(true)
      setItems([])
    }
  }, [id, t])

  useEffect(() => {
    load()
  }, [load])

  if (!id) return <p className="text-sm text-muted-foreground">{t("eta.identity-save-first")}</p>

  const startNew = () => {
    const first = (items || []).length === 0
    setDraft({
      name: first ? card.name : "",
      receiverType: first ? card.receiverType || "B" : "B",
      taxRegistrationNumber: first ? card.taxRegistrationNumber || "" : "",
      nationalId: first ? card.nationalId || "" : "",
      governorate: first ? card.governorate || "" : "",
      region: first ? card.region || "" : "",
      street: first ? card.street || "" : "",
      buildingNumber: first ? card.buildingNumber || "" : "",
    })
    setEditing("new")
    setMessage("")
  }

  const startEdit = (i: TaxIdentity) => {
    setDraft(draftOf(i))
    setEditing(i.identityId)
    setMessage("")
  }

  const cancel = () => {
    setEditing(null)
    setDraft(null)
  }

  const send = async (method: "POST" | "PUT", body: Record<string, unknown>) => {
    setBusy(true)
    setMessage("")
    try {
      const res = await fetch("/api/customers/tax-identities", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: Number(id), ...body }),
      })
      if (!res.ok) throw new Error(await errorText(res, t("message.error")))
      const saved = await res.json()
      const warnings: string[] = Array.isArray(saved?.warnings) ? saved.warnings : []
      const notes = Array.from(new Set(warnings.map((w) => (w.split(":")[0] === "national_id" ? t("eta.national-id-warning") : t("eta.tax-number-warning")))))
      setMessage(notes.length ? notes.join(" ") : t("eta.identity-saved"))
      await load()
      return true
    } catch (e) {
      setMessage(fill(t("message.not-saved"), { error: e instanceof Error ? e.message : String(e) }))
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      setMessage(t("eta.identity-name-required"))
      return
    }
    const body = {
      ...draft,
      name: draft.name.trim(),
      taxRegistrationNumber: toLatinDigits(draft.taxRegistrationNumber),
      nationalId: draft.receiverType === "P" ? toLatinDigits(draft.nationalId) : "",
      buildingNumber: toLatinDigits(draft.buildingNumber),
    }
    const ok = editing === "new" ? await send("POST", body) : await send("PUT", { identityId: editing, ...body })
    if (ok) cancel()
  }

  const setField = (key: keyof Draft, value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  const governorateLabel = (value: string) => {
    const g = GOVERNORATES.find((x) => x.en === value)
    return g ? (language === "ar" ? g.ar : g.en) : value
  }

  const form = draft && (
    <div className="rounded-lg border p-3 space-y-3" role="group" aria-label={editing === "new" ? t("eta.identity-add") : fill(t("eta.identity-edit-named"), { name: draft.name })}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="identity-name">{t("eta.identity-name")} *</Label>
          <Input id="identity-name" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="identity-type">{t("eta.receiver-type")}</Label>
          <Select value={draft.receiverType} onValueChange={(v) => setField("receiverType", v)}>
            <SelectTrigger id="identity-type" aria-label={t("eta.receiver-type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="B">{t("eta.receiver-business")}</SelectItem>
              <SelectItem value="P">{t("eta.receiver-person")}</SelectItem>
              <SelectItem value="F">{t("eta.receiver-foreign")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.receiverType === "P" ? (
          <div className="space-y-1">
            <Label htmlFor="identity-national-id">{t("eta.national-id")}</Label>
            <Input id="identity-national-id" inputMode="numeric" dir="ltr" value={draft.nationalId} onChange={(e) => setField("nationalId", e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="identity-tax-number">{t("eta.tax-number")}</Label>
            <Input id="identity-tax-number" inputMode="numeric" dir="ltr" value={draft.taxRegistrationNumber} onChange={(e) => setField("taxRegistrationNumber", e.target.value)} />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="identity-governorate">{t("eta.governorate")}</Label>
          <Select value={draft.governorate || NONE} onValueChange={(v) => setField("governorate", v === NONE ? "" : v)}>
            <SelectTrigger id="identity-governorate" aria-label={t("eta.governorate")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("eta.none")}</SelectItem>
              {GOVERNORATES.map((g) => (
                <SelectItem key={g.en} value={g.en}>
                  {language === "ar" ? g.ar : g.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="identity-region">{t("eta.region")}</Label>
          <Input id="identity-region" value={draft.region} onChange={(e) => setField("region", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="identity-street">{t("eta.street")}</Label>
          <Input id="identity-street" value={draft.street} onChange={(e) => setField("street", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="identity-building">{t("eta.building-number")}</Label>
          <Input id="identity-building" value={draft.buildingNumber} onChange={(e) => setField("buildingNumber", e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={busy}>
          {t("action.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
          {t("action.save")}
        </Button>
      </div>
    </div>
  )

  return (
    <section className="space-y-3" aria-labelledby="identities-title">
      <div>
        <p id="identities-title" className="text-sm font-medium">{t("eta.identities-title")}</p>
        <p className="text-xs text-muted-foreground">{t("eta.identities-help")}</p>
      </div>

      {items === null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("eta.loading")}
        </p>
      )}
      {loadFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t("eta.identity-load-failed")}
        </p>
      )}
      {items !== null && !loadFailed && items.length === 0 && <p className="text-sm text-muted-foreground">{t("eta.identities-none")}</p>}

      {items !== null && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((i) =>
            editing === i.identityId ? (
              <li key={i.identityId}>{form}</li>
            ) : (
              <li key={i.identityId} className={`rounded-lg border p-3 text-sm space-y-1 ${i.active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium break-words min-w-0">
                    {i.name}
                    {!i.active && <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">{t("eta.identity-off")}</span>}
                  </p>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={busy || editing !== null} onClick={() => startEdit(i)} aria-label={fill(t("eta.identity-edit-named"), { name: i.name })}>
                        <Pencil className="w-4 h-4 me-1" />
                        {t("action.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || editing !== null}
                        onClick={() => send("PUT", { identityId: i.identityId, active: !i.active })}
                        aria-label={fill(t(i.active ? "eta.identity-switch-off-named" : "eta.identity-switch-on-named"), { name: i.name })}
                      >
                        {t(i.active ? "eta.identity-switch-off" : "eta.identity-switch-on")}
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {t(TYPE_KEY[i.receiverType] || "eta.receiver-business")}
                  {" · "}
                  {i.receiverType === "P" ? t("eta.national-id") : t("eta.tax-number")}:{" "}
                  <bdi className="tabular-nums">{(i.receiverType === "P" ? i.nationalId : i.taxRegistrationNumber) || "-"}</bdi>
                </p>
                <p className="text-muted-foreground break-words">
                  {[governorateLabel(i.governorate), i.region, i.street, i.buildingNumber].filter(Boolean).join(language === "ar" ? "، " : ", ") || "-"}
                </p>
              </li>
            ),
          )}
        </ul>
      )}

      {editing === "new" && form}
      {canEdit && editing === null && (
        <Button type="button" variant="outline" size="sm" onClick={startNew} disabled={busy || items === null}>
          <Plus className="w-4 h-4 me-1" />
          {t("eta.identity-add")}
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  )
}
