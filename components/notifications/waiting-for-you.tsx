"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
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

// The items behind a screen's sidebar counter, each with a button that opens it. Shows nothing when empty.
export function WaitingForYou({ sections }: { sections: WaitingSection[] }) {
  const { t } = useI18n()
  const shown = sections.filter((s) => s.rows.length > 0)
  if (shown.length === 0) return null
  return (
    <section aria-label={t("waiting.title")} className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3 dark:border-amber-800 dark:bg-amber-950">
      <h2 className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-100">
        <Bell className="h-4 w-4" aria-hidden="true" />
        {t("waiting.title")}
      </h2>
      {shown.map((section) => (
        <div key={section.key} className="space-y-1.5">
          <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {section.heading} ({section.rows.length})
          </h3>
          <ul className="space-y-1.5">
            {section.rows.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-md bg-background p-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{row.title}</span>
                  {row.detail && <span className="block text-xs text-muted-foreground">{row.detail}</span>}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={row.onOpen}>
                  {row.action}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
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
