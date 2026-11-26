"use client"

// Picking the signed delivery permit (owner request 2026-11-26): two clear buttons.
//   "Take photo"  -> a file input with accept image/* and capture environment: opens the phone's back camera directly
//                    (iPhone Safari, Android Chrome). Each photo is added to the list, so several pages can be taken one
//                    after another; it is shrunk first (lib/shrink-photo.ts) so the upload stays small on mobile data.
//   "Upload file" -> the usual picker: photos or PDFs from the gallery / files (several at once).
// Every file shows a thumbnail (a PDF icon for a PDF) with a remove "×". The caller does the rest as before (upload,
// the "not received" reader and confirmation).
// With onSkippedChange, each photo also has a "send" tick (owner request 2026-11-26): every photo is uploaded, but only
// the ticked ones go to the approver and the invoice e-mail (lib/dp-signed-choice.ts).
import type React from "react"
import { useEffect, useMemo, useRef } from "react"
import { Camera, FileText, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/lib/i18n-context"
import { shrinkPhoto } from "@/lib/shrink-photo"

export const CAMERA_ACCEPT = "image/*"
export const CAMERA_CAPTURE = "environment"
export const FILE_ACCEPT = "image/*,.pdf"

interface Props {
  id: string
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
  /** photos the user unticked: uploaded, not sent */
  skipped?: Set<File>
  onSkippedChange?: (skipped: Set<File>) => void
}

export function SignedFilesPicker({ id, files, onChange, disabled, skipped, onSkippedChange }: Props) {
  const { t } = useI18n()
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // read the latest list inside the async camera handler (two photos taken quickly must both stay)
  const latest = useRef(files)
  latest.current = files

  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files])
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])

  const onCamera = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = "" // the same input can take the next photo
    const added: File[] = []
    for (const [i, f] of picked.entries()) {
      try {
        added.push((await shrinkPhoto(f, `signed-permit-${latest.current.length + i + 1}`)).file)
      } catch {
        added.push(f) // a photo the browser can't redraw is sent as taken
      }
    }
    if (added.length) onChange([...latest.current, ...added])
  }

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ""
    if (picked.length) onChange([...latest.current, ...picked])
  }

  const remove = (index: number) => onChange(files.filter((_, i) => i !== index))
  const toggle = (file: File, send: boolean) => {
    const next = new Set(skipped)
    if (send) next.delete(file)
    else next.add(file)
    onSkippedChange?.(next)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button type="button" className="h-12 text-base" onClick={() => cameraRef.current?.click()} disabled={disabled}>
          <Camera className="w-5 h-5 me-2" />
          {files.length > 0 ? t("permit.take-another-photo") : t("permit.take-photo")}
        </Button>
        <Button type="button" variant="outline" className="h-12 text-base" onClick={() => fileRef.current?.click()} disabled={disabled}>
          <Upload className="w-5 h-5 me-2" />
          {t("permit.upload-file")}
        </Button>
      </div>
      <input
        ref={cameraRef}
        id={`${id}-camera`}
        type="file"
        accept={CAMERA_ACCEPT}
        capture={CAMERA_CAPTURE}
        className="sr-only"
        tabIndex={-1}
        aria-label={t("permit.take-photo")}
        onChange={onCamera}
      />
      <input
        ref={fileRef}
        id={`${id}-file`}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label={t("permit.upload-file")}
        onChange={onFiles}
      />
      {files.length > 0 ? (
        <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2" aria-label={t("permit.photos-to-upload")}>
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className={`relative rounded-md border bg-muted/40 overflow-hidden aspect-square ${skipped?.has(f) ? "opacity-50" : ""}`}
            >
              {previews[i] ? (
                <img src={previews[i]!} alt={`${t("permit.preview")} ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-1 text-center">
                  <FileText className="w-8 h-8 text-muted-foreground" />
                  <span className="text-xs break-all line-clamp-2">{f.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={disabled}
                className="absolute top-1 end-1 rounded-full bg-black/60 text-white w-7 h-7 flex items-center justify-center"
                aria-label={`${t("action.remove")} ${i + 1}`}
                title={t("action.remove")}
              >
                <X className="w-4 h-4" />
              </button>
              {onSkippedChange && (
                <label className="absolute bottom-1 start-1 flex items-center gap-1 rounded bg-black/60 text-white text-xs px-1.5 py-1">
                  <Checkbox
                    checked={!skipped?.has(f)}
                    onCheckedChange={(v) => toggle(f, v === true)}
                    disabled={disabled}
                    aria-label={`${t("permit.send-photo")} ${i + 1}`}
                    className="border-white"
                  />
                  {t("permit.send-photo")}
                </label>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 1 && onSkippedChange ? (
        <p className="text-xs text-muted-foreground">{t("permit.send-photo-help")}</p>
      ) : files.length > 0 ? null : (
        <p className="text-xs text-muted-foreground">{t("permit.photo-hint")}</p>
      )}
    </div>
  )
}
