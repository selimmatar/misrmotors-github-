"use client"

import { useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { WORKER_TEXT, type WorkerLang } from "./worker-text"
import type { SentItem, SentStatus } from "@/lib/worker-sent-list"

// The worker's own sent photos (owner, 2026-11-22): read-only, newest first, his link only.
const TONE: Record<SentStatus, string> = {
  review: "bg-warning/15 text-foreground",
  created: "bg-success/15 text-foreground",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
}

function when(iso: string, lang: WorkerLang) {
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
      timeZone: "Africa/Cairo",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function WorkerSentList({ lang, items, loading, failed, onRefresh }: {
  lang: WorkerLang
  items: SentItem[] | null
  loading: boolean
  failed: boolean
  onRefresh: () => void
}) {
  const text = WORKER_TEXT[lang]
  return (
    <section aria-labelledby="worker-sent-title" className="flex w-full max-w-sm flex-col gap-3 text-start">
      <div className="flex items-center justify-between gap-3">
        <h2 id="worker-sent-title" className="text-xl font-bold">
          {text.sentTitle}
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-base font-bold disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-5" aria-hidden="true" />}
          {text.sentRefresh}
        </button>
      </div>
      {failed && !items?.length ? (
        <p className="text-base text-destructive">{text.sentFailed}</p>
      ) : !items?.length ? (
        <p className="text-base text-muted-foreground">{text.sentEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base text-muted-foreground">{when(item.sentAt, lang)}</span>
                <span className={`rounded-full px-3 py-1 text-base font-bold ${TONE[item.status]}`}>{text.sentStatus[item.status]}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
                <dt className="text-muted-foreground">{text.sentNumber}</dt>
                <dd className="min-w-0 break-all font-mono font-bold">
                  {item.number ? <span dir="ltr">{item.number}</span> : text.sentUnknown}
                </dd>
                <dt className="text-muted-foreground">{text.sentCustomer}</dt>
                <dd className="min-w-0 break-words">{item.customer || text.sentUnknown}</dd>
                <dt className="text-muted-foreground">{text.sentTotal}</dt>
                <dd className="font-mono">
                  {item.total != null ? <span dir="ltr">{money(item.total)}</span> : text.sentUnknown}
                </dd>
                {item.reason ? (
                  <>
                    <dt className="text-muted-foreground">{text.sentReason}</dt>
                    <dd className="min-w-0 break-words">{item.reason}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
