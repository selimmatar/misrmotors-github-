"use client"

// Notes / latest updates on a sales order, quotation or purchase order (owner request, 2026-11-12): a small button with
// the number of notes; it opens a panel to write a new update and read, edit or delete the earlier ones (newest first).
import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, StickyNote, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"

export type NoteTarget = "so" | "quotation" | "po"
interface Note {
  id: number
  text: string
  at: string | null
  editedAt: string | null
}

/** Note counts for every document of a list (for the badges); `refresh` after a change. */
export function useNoteCounts(type: NoteTarget) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const refresh = useCallback(() => {
    fetch(`/api/notes?type=${type}&counts=1`)
      .then((r) => (r.ok ? r.json() : { counts: {} }))
      .then((body) => setCounts(body.counts || {}))
      .catch(() => setCounts({}))
  }, [type])
  useEffect(() => {
    refresh()
  }, [refresh])
  return { counts, refresh }
}

const when = (value: string | null, language: string) => {
  if (!value) return ""
  // performed_at is stored without a time zone (UTC)
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(language === "ar" ? "ar-EG" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function NotesButton({
  type,
  id,
  title,
  count = 0,
  onChanged,
  labelled = false,
}: {
  type: NoteTarget
  id: string | number
  title: string
  count?: number
  onChanged?: () => void
  labelled?: boolean
}) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [text, setText] = useState("")
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setNotes(null)
    fetch(`/api/notes?type=${type}&id=${encodeURIComponent(String(id))}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((body) => setNotes(body.notes || []))
      .catch(() => setNotes([]))
  }, [type, id])
  useEffect(() => {
    if (open) load()
  }, [open, load])

  const send = async (method: "POST" | "PUT" | "DELETE", payload?: unknown, query = "") => {
    setBusy(true)
    try {
      const res = await fetch(`/api/notes${query}`, {
        method,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || t("message.error"))
        return false
      }
      load()
      onChanged?.()
      return true
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!text.trim()) return
    if (await send("POST", { type, id, text })) setText("")
  }
  const saveEdit = async () => {
    if (!editing) return
    if (await send("PUT", { noteId: editing.id, text: editing.text })) setEditing(null)
  }
  const remove = async (noteId: number) => {
    if (!confirm(t("notes.delete-confirm"))) return
    await send("DELETE", undefined, `?noteId=${noteId}`)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title={t("notes.title")}
        aria-label={t("notes.title")}
      >
        <StickyNote className="w-4 h-4" />
        {labelled && <span>{t("notes.title")}</span>}
        {count > 0 && <span className="rounded-full bg-amber-100 text-amber-900 text-xs px-1.5 leading-5">{count}</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {t("notes.title")} · {title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              aria-label={t("notes.new")}
              placeholder={t("notes.placeholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={add} disabled={busy || !text.trim()}>
                {busy ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
                {t("notes.add")}
              </Button>
            </div>
          </div>
          <div className="border-t pt-3 space-y-3 max-h-[50vh] overflow-y-auto">
            {notes === null ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t("notes.loading")}
              </p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("notes.none")}</p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="rounded-md border p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {when(n.at, language)}
                      {n.editedAt ? ` · ${t("notes.edited")}` : ""}
                    </span>
                    <span className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing({ id: n.id, text: n.text })} aria-label={t("action.edit")}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => remove(n.id)} aria-label={t("action.delete")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </span>
                  </div>
                  {editing?.id === n.id ? (
                    <div className="space-y-2">
                      <Textarea aria-label={t("action.edit")} value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} rows={3} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                          {t("action.cancel")}
                        </Button>
                        <Button size="sm" onClick={saveEdit} disabled={busy || !editing.text.trim()}>
                          {t("action.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{n.text}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
