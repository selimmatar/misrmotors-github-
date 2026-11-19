"use client"

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { AlertCircle, Camera, Check, ImageUp, Loader2 } from "lucide-react"
import { WORKER_TEXT, useWorkerLanguage, type WorkerErrorCode } from "./worker-text"

type Stage = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; code: WorkerErrorCode }

const MAX_SIDE = 2000

/** Makes the photo smaller on the phone so it sends fast on weak mobile data. Keeps the original when it cannot. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82))
    return small && small.size > 0 ? small : file
  } catch {
    return file
  }
}

const CODE_BY_STATUS: Record<number, WorkerErrorCode> = { 404: "inactive", 413: "too_big", 415: "not_photo", 429: "limit" }

export function WorkerUploadScreen({ secret, workerName }: { secret: string; workerName: string }) {
  const { lang, toggle } = useWorkerLanguage()
  const text = WORKER_TEXT[lang]
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>({ kind: "idle" })

  useEffect(() => {
    if (stage.kind === "done") navigator.vibrate?.(120)
  }, [stage.kind])

  const gallery = useRef<HTMLInputElement>(null)
  const openCamera = () => input.current?.click()
  const openGallery = () => gallery.current?.click()
  const uploadButton = (
    <button
      type="button"
      onClick={openGallery}
      disabled={stage.kind === "sending"}
      className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-border px-6 text-xl font-bold disabled:opacity-60"
    >
      <ImageUp className="size-7" aria-hidden="true" />
      {text.upload}
    </button>
  )

  const send = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setStage({ kind: "sending" })
    try {
      const photo = await shrinkPhoto(file)
      const form = new FormData()
      form.append("photo", photo, photo === file ? file.name : "invoice.jpg")
      const response = await fetch(`/api/worker-upload/${secret}`, { method: "POST", body: form })
      if (response.ok) setStage({ kind: "done" })
      else setStage({ kind: "error", code: CODE_BY_STATUS[response.status] ?? "failed" })
    } catch {
      setStage({ kind: "error", code: "offline" })
    }
  }

  return (
    <div dir={text.dir} lang={lang} className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <span className="text-lg font-bold leading-tight">{text.company}</span>
          <span className="text-base leading-tight text-muted-foreground">{text.hello(workerName)}</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="min-h-11 rounded-lg border border-border px-4 text-base font-bold"
          lang={lang === "ar" ? "en" : "ar"}
        >
          {text.switchTo}
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={send}
        />
        <input
          ref={gallery}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={send}
        />

        {stage.kind === "done" ? (
          <div role="status" className="flex w-full max-w-sm flex-col items-center gap-6">
            <div className="flex size-40 items-center justify-center rounded-full bg-success text-success-foreground">
              <Check className="size-24" strokeWidth={3} aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-4xl font-extrabold text-balance">{text.received}</h1>
              <p className="text-xl leading-relaxed text-muted-foreground text-pretty">{text.receivedHint}</p>
            </div>
            <button
              type="button"
              onClick={openCamera}
              className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-primary px-6 text-2xl font-bold text-primary"
            >
              <Camera className="size-7" aria-hidden="true" />
              {text.another}
            </button>
            {uploadButton}
          </div>
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center gap-6">
            <button
              type="button"
              onClick={openCamera}
              disabled={stage.kind === "sending"}
              className="flex aspect-square w-full flex-col items-center justify-center gap-5 rounded-3xl bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-80"
            >
              {stage.kind === "sending" ? (
                <Loader2 className="size-28 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="size-28" strokeWidth={1.75} aria-hidden="true" />
              )}
              <span className="text-4xl font-extrabold">{stage.kind === "sending" ? text.sending : text.take}</span>
            </button>
            {uploadButton}

            {stage.kind === "error" ? (
              <div role="alert" className="flex w-full items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-start text-destructive">
                <AlertCircle className="mt-1 size-7 shrink-0" aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  <p className="text-xl font-bold">{text.failed}</p>
                  <p className="text-lg leading-relaxed">{text.errors[stage.code]}</p>
                </div>
              </div>
            ) : (
              <p className="text-xl leading-relaxed text-muted-foreground text-pretty">{text.hint}</p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
