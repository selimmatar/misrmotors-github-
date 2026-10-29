"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"

export interface WaitingRow {
  key: string
  title: string
  detail?: string
  action: string
  onOpen: () => void
}

export interface WaitingSection {
  key: string
  heading: string
  rows: WaitingRow[]
}

// A small button with the number of items behind a screen's sidebar counter; it opens a list where each item
// has a button that opens it. Shows nothing when empty. A section given as false (switched off) is skipped.
export function WaitingForYou({ sections }: { sections: (WaitingSection | false)[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const shown = sections.filter((s): s is WaitingSection => !!s && s.rows.length > 0)
  if (shown.length === 0) return null
  const total = shown.reduce((sum, s) => sum + s.rows.length, 0)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${t("waiting.title")} (${total})`}
          className="gap-2 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {t("waiting.title")}
          <span className="rounded-full bg-amber-200 px-2 text-xs font-semibold text-amber-950 dark:bg-amber-800 dark:text-amber-50">{total}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" aria-hidden="true" />
            {t("waiting.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {shown.map((section) => (
            <div key={section.key} className="space-y-1.5">
              <h3 className="text-sm font-medium">
                {section.heading} ({section.rows.length})
              </h3>
              <ul className="space-y-1.5">
                {section.rows.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{row.title}</span>
                      {row.detail && <span className="block text-xs text-muted-foreground">{row.detail}</span>}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen(false)
                        row.onOpen()
                      }}
                    >
                      {row.action}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Loads /api/pending-counts/details for one screen; reload() after the person acts on an item.
export function useWaiting<T>(screen: string, role: string | undefined): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const reload = useCallback(() => {
    if (!role) return
    fetch(`/api/pending-counts/details?screen=${encodeURIComponent(screen)}&role=${encodeURIComponent(role)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setData(body))
      .catch(() => setData(null))
  }, [screen, role])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, reload }
}
