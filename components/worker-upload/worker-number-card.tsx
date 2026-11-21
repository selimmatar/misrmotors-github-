"use client"

import { useState } from "react"
import { FilePlus2, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react"
import type { WorkerNumberState } from "@/lib/shared-invoice-numbers"
import { WORKER_TEXT, type WorkerLang } from "./worker-text"

type Action = "take" | "cancel" | "undo"

/** Shared numbering: before writing, the worker reserves the page number; shown big with the pages to cross out. */
export function WorkerStartCard({
  lang,
  numbers,
  busy,
  next,
  onAction,
}: {
  lang: WorkerLang
  numbers: WorkerNumberState
  busy: boolean
  next?: boolean
  onAction: (action: Action) => void
}) {
  const text = WORKER_TEXT[lang]
  return (
    <section aria-label={text.startTitle} className="flex w-full flex-col items-center gap-4">
      {next ? null : (
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold text-balance">{text.startTitle}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground text-pretty">{text.startHint}</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => onAction("take")}
        disabled={busy}
        className="flex min-h-24 w-full items-center justify-center gap-4 rounded-3xl bg-primary px-6 text-3xl font-extrabold text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-80"
      >
        {busy ? <Loader2 className="size-10 animate-spin" aria-hidden="true" /> : <FilePlus2 className="size-10" aria-hidden="true" />}
        {busy ? text.working : next ? text.startNext : text.start}
      </button>
      {numbers.undoable ? (
        <button
          type="button"
          onClick={() => onAction("undo")}
          disabled={busy}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border-2 border-border px-4 text-lg font-bold disabled:opacity-60"
        >
          <RotateCcw className="size-6" aria-hidden="true" />
          {text.undo(numbers.undoable)}
        </button>
      ) : null}
    </section>
  )
}

export function WorkerReservedCard({
  lang,
  numbers,
  busy,
  onAction,
}: {
  lang: WorkerLang
  numbers: WorkerNumberState & { reserved: number }
  busy: boolean
  onAction: (action: Action) => void
}) {
  const text = WORKER_TEXT[lang]
  return (
    <section
      aria-label={text.reserved}
      className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-primary bg-primary/10 px-4 py-4"
    >
      <span className="text-lg font-bold">{text.reserved}</span>
      <span dir="ltr" className="font-mono text-5xl font-extrabold tracking-wide text-primary">
        {numbers.reserved}
      </span>
      <span className="text-base leading-relaxed text-muted-foreground text-pretty">{text.reservedHint(numbers.reserved)}</span>
      {numbers.crossOut.length ? (
        <div role="note" className="mt-3 flex w-full flex-col gap-2 rounded-xl bg-warning/15 p-3 text-start">
          <p className="flex items-center gap-2 text-lg font-bold">
            <TriangleAlert className="size-6 shrink-0 text-warning" aria-hidden="true" />
            {text.crossOutTitle}
          </p>
          <ul dir="ltr" className="flex flex-wrap justify-end gap-2">
            {numbers.crossOut.map((n) => (
              <li key={n} className="rounded-lg border-2 border-warning px-3 py-1 font-mono text-xl font-bold line-through">
                {n}
              </li>
            ))}
          </ul>
          <p className="text-base leading-relaxed text-pretty">{text.crossOutHint}</p>
        </div>
      ) : null}
    </section>
  )
}

export function WorkerCancelNumber({ lang, busy, onAction }: { lang: WorkerLang; busy: boolean; onAction: (action: Action) => void }) {
  const text = WORKER_TEXT[lang]
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-lg font-bold text-destructive disabled:opacity-60"
      >
        <X className="size-5" aria-hidden="true" />
        {text.cancel}
      </button>
    )
  return (
    <div role="alertdialog" aria-label={text.cancel} className="flex w-full flex-col gap-3 rounded-2xl border-2 border-destructive p-4">
      <p className="text-lg font-bold leading-relaxed text-pretty">{text.cancelConfirm}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            setAsking(false)
            onAction("cancel")
          }}
          className="min-h-12 flex-1 rounded-xl bg-destructive px-4 text-lg font-bold text-destructive-foreground"
        >
          {text.cancelYes}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-12 flex-1 rounded-xl border-2 border-border px-4 text-lg font-bold">
          {text.cancelNo}
        </button>
      </div>
    </div>
  )
}
