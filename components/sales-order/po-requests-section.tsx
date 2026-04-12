"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Upload, FileText, Trash2, Search, ExternalLink } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface PORequest {
  id: string
  po_request_number: string
  file_name: string
  file_url: string
  note: string | null
  uploaded_at: string
}

interface PORequestsSectionProps {
  soId: number
}

export function PORequestsSection({ soId }: PORequestsSectionProps) {
  const [poRequests, setPORequests] = useState<PORequest[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showUploadDialog, setShowUploadDialog] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [manualNumber, setManualNumber] = useState("")
  const [useManualNumber, setUseManualNumber] = useState(false)

  const { toast } = useToast()

  useEffect(() => {
    fetchPORequests()
  }, [soId])

  const fetchPORequests = async () => {
    try {
      const response = await fetch(`/api/sales-orders/po-requests?soId=${soId}`)
      const data = await response.json()

      if (response.ok) {
        setPORequests(data.poRequests || [])
      }
    } catch (error) {
      console.error("[v0] Error fetching PO requests:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!file) {
      toast({ title: "Error", description: "Please select a file", variant: "destructive" })
      return
    }

    if (useManualNumber && !manualNumber.trim()) {
      toast({ title: "Error", description: "Please enter a PO Request Number", variant: "destructive" })
      return
    }

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append("soId", soId.toString())
      formData.append("file", file)
      formData.append("note", note)
      if (useManualNumber) {
        formData.append("manualNumber", manualNumber.trim())
      }

      const response = await fetch("/api/sales-orders/po-requests", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (response.ok) {
        toast({ title: "Success", description: "PO Request uploaded successfully" })
        setShowUploadDialog(false)
        setFile(null)
        setNote("")
        setManualNumber("")
        setUseManualNumber(false)
        fetchPORequests()
      } else {
        toast({ title: "Error", description: data.error || "Upload failed", variant: "destructive" })
      }
    } catch (error) {
      console.error("[v0] Upload error:", error)
      toast({ title: "Error", description: "Upload failed", variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this PO Request?")) return

    try {
      const response = await fetch(`/api/sales-orders/po-requests?id=${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({ title: "Success", description: "PO Request deleted" })
        fetchPORequests()
      } else {
        const data = await response.json()
        toast({ title: "Error", description: data.error || "Delete failed", variant: "destructive" })
      }
    } catch (error) {
      console.error("[v0] Delete error:", error)
      toast({ title: "Error", description: "Delete failed", variant: "destructive" })
    }
  }

  const filteredRequests = poRequests.filter((pr) =>
    pr.po_request_number.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>PO Requests</CardTitle>
            <CardDescription>Purchase order request documents attached to this sales order</CardDescription>
          </div>
          <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Upload PO Request
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload PO Request</DialogTitle>
                <DialogDescription>Attach a purchase order request document to this sales order</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>File</Label>
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="useManualNumber"
                    checked={useManualNumber}
                    onChange={(e) => setUseManualNumber(e.target.checked)}
                  />
                  <Label htmlFor="useManualNumber">Use manual PO Request Number</Label>
                </div>
                {useManualNumber && (
                  <div>
                    <Label>PO Request Number</Label>
                    <Input
                      value={manualNumber}
                      onChange={(e) => setManualNumber(e.target.value)}
                      placeholder="e.g., PR-2026-000123"
                    />
                  </div>
                )}
                <div>
                  <Label>Note (Optional)</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Additional notes..." />
                </div>
                <Button onClick={handleUpload} disabled={uploading} className="w-full">
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by PO Request Number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PO requests found</p>
          ) : (
            <div className="space-y-2">
              {filteredRequests.map((pr) => (
                <div key={pr.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <span className="font-medium">{pr.po_request_number}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{pr.file_name}</p>
                    {pr.note && <p className="text-xs text-muted-foreground mt-1">{pr.note}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      Uploaded: {new Date(pr.uploaded_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button size="sm" variant="outline" onClick={() => window.open(pr.file_url, "_blank")}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(pr.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
