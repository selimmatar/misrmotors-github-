"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n-context"
import { Upload, FileImage, Loader2 } from "lucide-react"
import { SignedFilesPicker } from "./signed-files-picker"
import { sentSignedFiles } from "@/lib/dp-signed-choice"

interface SignedUploadWidgetProps {
  permitId: string
  /** the uploaded files come along for the "not received" check (components/delivery-permit/not-received-dialog.tsx) */
  onUploadComplete: (fileUrl: string, files?: File[], sentFileIds?: string[]) => void
  existingFiles?: Array<{ id: string; fileUrl: string; fileName?: string; uploadedAt?: string; fileType?: string }>
}

// The signed permit upload on the delivery permit card: "Take photo" (the phone camera, several pages one after
// another) or "Upload file" (photos / PDF), each file with a thumbnail and a remove "×" (./signed-files-picker.tsx).
export function SignedUploadWidget({ permitId, onUploadComplete, existingFiles = [] }: SignedUploadWidgetProps) {
  const { t } = useI18n()
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [skipped, setSkipped] = useState<Set<File>>(new Set())
  const toSend = selectedFiles.filter((f) => !skipped.has(f))
  const [notes, setNotes] = useState("")

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return
    if (toSend.length === 0) {
      alert(t("permit.choose-one-photo"))
      return
    }

    setIsUploading(true)
    try {
      let lastUrl = ""
      const sentIds: string[] = []
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("permitId", permitId)
        formData.append("notes", notes)
        formData.append("chosen", skipped.has(file) ? "0" : "1")

        const response = await fetch("/api/delivery-permits/upload", {
          method: "POST",
          body: formData,
        })

        if (!response.ok) {
          throw new Error("Upload failed")
        }

        const result = await response.json()
        lastUrl = result.url
        if (!skipped.has(file) && result.id) sentIds.push(String(result.id))
      }
      const files = toSend
      setSelectedFiles([])
      setSkipped(new Set())
      setNotes("")
      onUploadComplete(lastUrl, files, sentIds)
    } catch (error) {
      console.error("Upload error:", error)
      alert(t("error.upload-failed"))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {t("permit.upload-signed")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing Files */}
        {sentSignedFiles(existingFiles).length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">{t("permit.uploaded-files")}</Label>
            <div className="grid gap-2">
              {sentSignedFiles(existingFiles).map((file) => (
                <a
                  key={file.id}
                  href={file.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md text-sm hover:bg-green-100 transition-colors"
                >
                  <FileImage className="h-4 w-4 text-green-700" />
                  <span className="flex-1 truncate">{file.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : ""}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Take photo / Upload file */}
        <div className="space-y-3">
          <SignedFilesPicker id={`signed-upload-${permitId}`} files={selectedFiles} onChange={setSelectedFiles} disabled={isUploading} skipped={skipped} onSkippedChange={setSkipped} />
          <p className="text-xs text-muted-foreground">{t("permit.supported-formats")}</p>

          {selectedFiles.length > 0 && (
            <>
              <div className="space-y-2">
                <Label>{t("field.notes")}</Label>
                <Textarea
                  placeholder={t("permit.upload-notes-placeholder")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <Button onClick={handleUpload} disabled={isUploading || toSend.length === 0} className="w-full">
                {isUploading ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 me-2" />
                )}
                {isUploading ? t("action.uploading") : t("action.upload")}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
