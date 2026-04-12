"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { GitCompare as FileCompare, Upload, CheckCircle2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAppContext } from "@/lib/app-context"

interface SupplierQuoteComparisonProps {
  salesQuotationId: number
  quotationItems: Array<{
    id: string
    productName: string
    quantity: number
    unitPrice: number
  }>
}

export function SupplierQuoteComparison({ salesQuotationId, quotationItems }: SupplierQuoteComparisonProps) {
  const { suppliers } = useAppContext()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [uploads, setUploads] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const [currentUpload, setCurrentUpload] = useState({
    supplierName: "",
    supplierId: "",
    currency: "EGP",
    file: null as File | null,
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setCurrentUpload({ ...currentUpload, file: e.target.files[0] })
    }
  }

  const handleUpload = async () => {
    if (!currentUpload.file || !currentUpload.supplierName) {
      alert("Please fill all required fields")
      return
    }

    setLoading(true)
    const formData = new FormData()
    formData.append("sales_quotation_id", salesQuotationId.toString())
    formData.append("supplier_name", currentUpload.supplierName)
    if (currentUpload.supplierId) {
      formData.append("supplier_id", currentUpload.supplierId)
    }
    formData.append("currency", currentUpload.currency)
    formData.append("file", currentUpload.file)

    try {
      const res = await fetch("/api/sales-quotations/supplier-quotes/upload", {
        method: "POST",
        body: formData,
      })

      if (res.ok) {
        const { upload } = await res.json()
        setUploads([...uploads, upload])
        setCurrentUpload({
          supplierName: "",
          supplierId: "",
          currency: "EGP",
          file: null,
        })
        alert("Uploaded successfully!")
      } else {
        alert("Upload failed")
      }
    } catch (error) {
      console.error(error)
      alert("Upload error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          <FileCompare className="h-4 w-4" />
          Compare Supplier Quotations
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare Supplier Quotations</DialogTitle>
          <DialogDescription>
            Upload supplier PDFs, extract items, and get recommendations for the best prices
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step 1: Upload PDFs */}
          <div className="space-y-4">
            <h3 className="font-semibold">Step 1: Upload Supplier Quotations</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Supplier Name *</Label>
                <Input
                  value={currentUpload.supplierName}
                  onChange={(e) =>
                    setCurrentUpload({
                      ...currentUpload,
                      supplierName: e.target.value,
                    })
                  }
                  placeholder="Enter supplier name"
                />
              </div>
              <div>
                <Label>Existing Supplier (Optional)</Label>
                <Select
                  value={currentUpload.supplierId}
                  onValueChange={(value) => setCurrentUpload({ ...currentUpload, supplierId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s: any) => (
                      <SelectItem key={s.supplier_id || s.id} value={(s.supplier_id || s.id).toString()}>
                        {s.supplier_name || s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Currency</Label>
                <Select
                  value={currentUpload.currency}
                  onValueChange={(value) => setCurrentUpload({ ...currentUpload, currency: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EGP">EGP</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>PDF File *</Label>
                <Input type="file" accept=".pdf" onChange={handleFileChange} />
              </div>
            </div>
            <Button onClick={handleUpload} disabled={loading} className="gap-2">
              <Upload className="h-4 w-4" />
              {loading ? "Uploading..." : "Upload PDF"}
            </Button>

            {uploads.length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium mb-2">Uploaded Files:</h4>
                <ul className="space-y-1">
                  {uploads.map((u) => (
                    <li key={u.id} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      {u.supplier_name_raw} - {u.file_name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* TODO: Steps 2-5 will be implemented in next phases */}
          <div className="text-sm text-muted-foreground">
            Steps 2-5 (Extract, Match, Recommend, Create PRs) will be implemented in the next phase.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
