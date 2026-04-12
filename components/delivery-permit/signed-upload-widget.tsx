"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n-context"
import { Upload, FileImage, X, Loader2 } from "lucide-react"

interface SignedUploadWidgetProps {
  permitId: string
  onUploadComplete: (fileUrl: string) => void
  existingFiles?: Array<{ id: string; fileUrl: string; fileName: string; uploadedAt: string }>
}

export function SignedUploadWidget({ permitId, onUploadComplete, existingFiles = [] }: SignedUploadWidgetProps) {
  const { t } = useI18n()
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [notes, setNotes] = useState("")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      // Create preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader()
        reader.onloadend = () => {
          setPreviewUrl(reader.result as string)
        }
        reader.readAsDataURL(file)
      } else {
        setPreviewUrl(null)
      }
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("permitId", permitId)
      formData.append("notes", notes)

      const response = await fetch("/api/delivery-permits/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Upload failed")
      }

      const result = await response.json()
      onUploadComplete(result.url)
      setSelectedFile(null)
      setPreviewUrl(null)
      setNotes("")
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (error) {
      console.error("Upload error:", error)
      alert(t("error.upload-failed"))
    } finally {
      setIsUploading(false)
    }
  }

  const clearSelection = () => {
    setSelectedFile(null)
    setPreviewUrl(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
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
        {existingFiles.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">{t("permit.uploaded-files")}</Label>
            <div className="grid gap-2">
              {existingFiles.map((file) => (
                <a
                  key={file.id}
                  href={file.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md text-sm hover:bg-green-100 transition-colors"
                >
                  <FileImage className="h-4 w-4 text-green-600" />
                  <span className="flex-1 truncate">{file.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(file.uploadedAt).toLocaleDateString()}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Upload Area */}
        <div className="space-y-3">
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              selectedFile ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            {selectedFile ? (
              <div className="space-y-2">
                {previewUrl ? (
                  <img src={previewUrl || "/placeholder.svg"} alt="Preview" className="max-h-32 mx-auto rounded" />
                ) : (
                  <FileImage className="h-12 w-12 mx-auto text-primary" />
                )}
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    clearSelection()
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  {t("action.remove")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("permit.click-to-upload")}</p>
                <p className="text-xs text-muted-foreground">{t("permit.supported-formats")}</p>
              </div>
            )}
          </div>
          <Input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileSelect} />

          {selectedFile && (
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
              <Button onClick={handleUpload} disabled={isUploading} className="w-full">
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("action.uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {t("action.upload")}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
