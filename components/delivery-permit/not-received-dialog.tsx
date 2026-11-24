"use client"

// The confirmation step before a signed delivery permit upload is completed (owner request, 2026-11-24): the upload is
// read for the "لم يُستلم" boxes (POST /api/delivery-permits/read-signed), each line is shown with "Returned / not
// received" pre-ticked from the reading and an editable quantity, and only the lines the shipping user confirms become
// returns (POST /api/delivery-permits/not-received -> the existing return flow). Reading problems -> all unticked.
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { shrinkPhoto } from "@/lib/shrink-photo"
import { Check, Loader2 } from "lucide-react"

export interface NotReceivedRow {
  itemId: number
  name: string
  sku: string | null
  quantity: number
  returnable: number
  notReceived: boolean
  returnQuantity: number
  receivedQuantity: number | null
  fromReader: boolean
}

export interface ConfirmedLine {
  itemId: number
  notReceived: boolean
  quantity: number
}

interface Props {
  open: boolean
  permitId: string
  files: File[]
  onCancel: () => void
  /** called with every line (ticked or not); the caller completes the upload, then records the ticked ones */
  onConfirm: (lines: ConfirmedLine[]) => Promise<void> | void
}

/** Records the confirmed "not received" lines as one return (the existing return flow). */
export async function recordNotReceived(permitId: string, lines: ConfirmedLine[], createdBy?: string | null): Promise<{ ok: boolean; count: number; error?: string }> {
  const ticked = lines.filter((l) => l.notReceived && l.quantity > 0)
  if (ticked.length === 0) return { ok: true, count: 0 }
  try {
    const response = await fetch("/api/delivery-permits/not-received", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permitId: Number(permitId), idempotencyKey: `nr-${crypto.randomUUID()}`, lines: ticked, createdBy: createdBy || null }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, count: 0, error: body.error || String(response.status) }
    return { ok: true, count: Number(body.lines) || ticked.length }
  } catch (error: any) {
    return { ok: false, count: 0, error: error?.message || "network error" }
  }
}

export function NotReceivedDialog({ open, permitId, files, onCancel, onConfirm }: Props) {
  const { t, language } = useI18n()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [read, setRead] = useState(false)
  const [rows, setRows] = useState<NotReceivedRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const started = useRef<string>("")

  useEffect(() => {
    if (!open) {
      started.current = ""
      return
    }
    const run = `${permitId}:${files.map((f) => f.name + f.size).join("|")}`
    if (started.current === run) return
    started.current = run
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      setRows([])
      try {
        const images: { image: string; media_type: string }[] = []
        for (const file of files) {
          if (!file.type.startsWith("image/")) continue // a PDF is not read: its lines start unticked
          try {
            const photo = await shrinkPhoto(file, "signed-permit")
            images.push({ image: photo.base64, media_type: "image/jpeg" })
          } catch {
            // an unreadable photo is skipped
          }
        }
        const response = await fetch("/api/delivery-permits/read-signed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permit_id: Number(permitId), images }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(body.rows)) {
          setLoadError(body.error || t("message.error"))
          return
        }
        setRead(!!body.read)
        setRows(body.rows)
      } catch (error: any) {
        setLoadError(error?.message || t("message.error"))
      } finally {
        setLoading(false)
      }
    })()
  }, [open, permitId, files, t])

  const setRow = (index: number, patch: Partial<NotReceivedRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const toggle = (index: number, checked: boolean) => {
    const row = rows[index]
    setRow(index, { notReceived: checked, returnQuantity: checked && row.returnQuantity <= 0 ? Math.floor(row.returnable) : row.returnQuantity })
  }

  const setQuantity = (index: number, raw: string) => {
    const row = rows[index]
    const n = Math.max(0, Math.min(Math.floor(Number(raw) || 0), Math.floor(row.returnable)))
    setRow(index, { returnQuantity: n, notReceived: n > 0 ? true : row.notReceived })
  }

  const confirm = async () => {
    setSaving(true)
    try {
      await onConfirm(rows.map((r) => ({ itemId: r.itemId, notReceived: r.notReceived && r.returnQuantity > 0, quantity: r.returnQuantity })))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" dir={language === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("dp-nr.title")}</DialogTitle>
          <DialogDescription>{t("dp-nr.description")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("dp-nr.reading")}
          </div>
        ) : loadError ? (
          <p className="text-sm rounded-md bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2">{loadError}</p>
        ) : (
          <div className="space-y-3">
            <p
              className={`text-sm rounded-md px-3 py-2 ${read ? "bg-sky-500/10 text-sky-800 dark:text-sky-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}
            >
              {read ? t("dp-nr.read-ok") : t("dp-nr.could-not-read")}
            </p>
            {rows.map((row, index) => (
              <div
                key={row.itemId}
                className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${row.notReceived ? "border-orange-300 bg-orange-500/10" : ""}`}
              >
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <Checkbox
                    checked={row.notReceived}
                    disabled={row.returnable <= 0}
                    onCheckedChange={(v) => toggle(index, v === true)}
                    aria-label={t("dp-nr.returned")}
                  />
                  <span className="min-w-0 break-words">
                    <span className="font-medium">
                      {index + 1}. {row.name}
                    </span>
                    {row.sku && <span className="text-xs text-muted-foreground ms-1">({row.sku})</span>}
                    <span className="block text-xs text-muted-foreground">
                      {t("dp-nr.returned")}
                      {row.fromReader && <span className="ms-2 font-semibold text-orange-700 dark:text-orange-300">· {t("dp-nr.marked")}</span>}
                      {row.receivedQuantity !== null && <span className="ms-2">· {fill(t("dp-nr.received-written"), { qty: row.receivedQuantity })}</span>}
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={Math.floor(row.returnable)}
                    step={1}
                    value={row.returnQuantity}
                    onChange={(e) => setQuantity(index, e.target.value)}
                    className="w-20"
                    aria-label={t("dp-nr.quantity")}
                    disabled={row.returnable <= 0}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">{fill(t("dp-nr.of"), { qty: row.quantity })}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={confirm} disabled={loading || saving} className="bg-green-600 hover:bg-green-700">
            {saving ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Check className="h-4 w-4 me-2" />}
            {t("dp-nr.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
