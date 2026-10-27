"use client"

// Extra contact people for a customer or a supplier: list, add, edit, remove.
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { Pencil, Plus, Trash2 } from "lucide-react"

export interface PartyContact {
  id: string
  name: string
  jobTitle: string
  phone: string
  email: string
  notes: string
}

type Draft = Omit<PartyContact, "id"> & { id?: string }
const EMPTY: Draft = { name: "", jobTitle: "", phone: "", email: "", notes: "" }

interface ContactsCardProps {
  owner: { customerId: string } | { supplierId: string }
  canEdit: boolean
}

export function ContactsCard({ owner, canEdit }: ContactsCardProps) {
  const { t } = useI18n()
  const [contacts, setContacts] = useState<PartyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const query = "customerId" in owner ? `customerId=${owner.customerId}` : `supplierId=${owner.supplierId}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/party-contacts?${query}`)
      if (res.ok) setContacts(await res.json())
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      alert(t("message.fill-required-fields"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/party-contacts", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ...owner }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
      setDraft(null)
      await load()
    } catch (error) {
      alert(fill(t("message.not-saved"), { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (contact: PartyContact) => {
    if (!confirm(fill(t("party.remove-contact-confirm"), { name: contact.name }))) return
    const res = await fetch(`/api/party-contacts?id=${contact.id}`, { method: "DELETE" })
    if (!res.ok) {
      alert(fill(t("message.not-saved"), { error: res.statusText }))
      return
    }
    await load()
  }

  const field = (key: keyof Draft, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`contact-${key}`}>{label}</Label>
      <Input
        id={`contact-${key}`}
        type={type}
        value={String(draft?.[key] ?? "")}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
      />
    </div>
  )

  return (
    <div className="border-t pt-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-semibold">{t("party.contacts")}</h3>
        {canEdit && (
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="w-4 h-4" />
            {t("party.add-contact")}
          </Button>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("party.loading-contacts")}</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("party.no-contacts")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map((c) => (
            <div key={c.id} className="border rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{c.name}</p>
                  {c.jobTitle && <p className="text-muted-foreground break-words">{c.jobTitle}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" aria-label={`${t("action.edit")} ${c.name}`} onClick={() => setDraft({ ...c })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`${t("action.delete")} ${c.name}`} onClick={() => remove(c)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              {c.phone && <p dir="ltr" className="text-start">{c.phone}</p>}
              {c.email && <p className="break-all">{c.email}</p>}
              {c.notes && <p className="text-muted-foreground break-words">{c.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(draft?.id ? "party.edit-contact" : "party.add-contact")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field("name", `${t("field.name")} *`)}
            {field("jobTitle", t("party.job-title"))}
            {field("phone", t("field.phone"), "tel")}
            {field("email", t("field.email"), "email")}
            <div className="sm:col-span-2">{field("notes", t("field.notes"))}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              {t("action.cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {t("action.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
