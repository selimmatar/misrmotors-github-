"use client"

import { Link2Off } from "lucide-react"
import { WORKER_TEXT, useWorkerLanguage } from "./worker-text"

export function WorkerLinkInactive() {
  const { lang, toggle } = useWorkerLanguage()
  const text = WORKER_TEXT[lang]
  return (
    <div dir={text.dir} lang={lang} className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <span className="text-lg font-bold">{text.company}</span>
        <button type="button" onClick={toggle} className="min-h-11 rounded-lg border border-border px-4 text-base font-bold">
          {text.switchTo}
        </button>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <Link2Off className="size-20 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-3xl font-extrabold text-balance">{text.inactiveTitle}</h1>
        <p className="max-w-sm text-xl leading-relaxed text-muted-foreground text-pretty">{text.errors.inactive}</p>
      </main>
    </div>
  )
}
