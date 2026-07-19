"use client"

import type React from "react"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n-context"
import { Upload, FileText, X, Loader2, ExternalLink } from "lucide-react"

interface QuotationRequestUploadWidgetProps {
  soId?: string
  onUploadComplete: (data: { qrNumber: string; fileUrl: string }) => void
  existingFile?: {
    quotation_request_number: string
    quotation_request_file_path: string
    quotation_request_file_name: string
    quotation_request_uploaded_at: string
  }
}

export function QuotationRequestUploadWidget({
  soId,
  onUploadComplete,
  existingFile,
}: QuotationRequestUploadWidgetProps) {
  const { t } = useI18n()
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      if (soId) {
        formData.append("soId", soId)
      }


      const response = await fetch("/api/sales-orders/quotation-request", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Upload failed")
      }

      const result = await response.json()

      onUploadComplete({
        qrNumber: result.qrNumber,
        fileUrl: result.fileUrl,
      })

      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }

      alert("Quotation request uploaded successfully!")
    } catch (error) {
      console.error("[v0] QR Upload error:", error)
      alert(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsUploading(false)
    }
  }

  const clearSelection = () => {
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t("so.quotation-request")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing File */}
        {existingFile && (
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Uploaded Document</Label>
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
              <FileText className="h-5 w-5 text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">QR {existingFile.quotation_request_number}</p>
                <p className="text-xs text-muted-foreground truncate">{existingFile.quotation_request_file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(existingFile.quotation_request_uploaded_at).toLocaleDateString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.open(existingFile.quotation_request_file_path, "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Upload Area */}
        {!existingFile && (
          <div className="space-y-3">
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                selectedFile ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div className="space-y-2">
                  <FileText className="h-12 w-12 mx-auto text-primary" />
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
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload quotation request document</p>
                  <p className="text-xs text-muted-foreground">PDF, Images (Max 10MB)</p>
                </div>
              )}
            </div>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={handleFileSelect}
            />

            {selectedFile && (
              <Button onClick={handleUpload} disabled={isUploading} className="w-full">
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Quotation Request
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
