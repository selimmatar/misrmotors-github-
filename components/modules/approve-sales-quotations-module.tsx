"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Eye, CheckCircle, XCircle, FileText, Loader2, AlertCircle, Printer, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useAppContext } from "@/lib/app-context"
import { QuotationPreviewDialog } from "@/components/quotation/quotation-preview-dialog"
import type { UserRole } from "@/lib/types"

interface Quotation {
  id: number
  quotation_number: string
  quotation_request_number?: string
  department_name?: string
  receiver_name?: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  validity_days: number
  notes: string | null
  subtotal: number
  tax: number
  total: number
  status: string
  created_at: string
  created_by: string | null
  updated_at: string
}

interface QuotationItem {
  id: number
  quotation_id: number
  line_no: number
  item_type: string
  product_id: number | null
  product_name: string
  quantity: number
  unit_price: number
  total: number
  supplier_name?: string
}

interface QuotationDetails extends Quotation {
  items: QuotationItem[]
}

interface ApproveSalesQuotationsModuleProps {
  userRole: UserRole
}

export function ApproveSalesQuotationsModule({ userRole }: ApproveSalesQuotationsModuleProps) {
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [selectedQuotation, setSelectedQuotation] = useState<QuotationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [approvalDocument, setApprovalDocument] = useState<File | null>(null)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  
  const { refreshSalesOrders } = useAppContext()

  useEffect(() => {
    fetchQuotations()
  }, [])

  const fetchQuotations = async () => {
    try {
      setLoading(true)
      // Fetch from sales_quotations table
      const response = await fetch("/api/sales-quotations")
      if (!response.ok) throw new Error("Failed to fetch quotations")
      
      const data = await response.json()
      // Get quotations with pending/draft status
      const pendingQuotations = (data.quotations || []).filter((q: any) =>
        q.status === "sent" || q.status === "pending"
      )
      
      setQuotations(pendingQuotations)
    } catch (error) {
      console.error("Failed to fetch quotations:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchQuotationDetails = async (id: number) => {
    try {
      // Fetch quotation with items from the sales_quotations API
      const response = await fetch(`/api/sales-quotations?id=${id}`)
      if (!response.ok) throw new Error("Failed to fetch quotation details")
      
      const data = await response.json()
      const quotation = data.quotation
      
      if (!quotation) {
        throw new Error("Quotation not found")
      }
      
      setSelectedQuotation({
        ...quotation,
        items: (quotation.items || []).map((item: any) => ({
          ...item,
          total: item.quantity * item.unit_price,
        })),
      } as QuotationDetails)
      setShowDetailsDialog(true)
    } catch (error) {
      console.error("Error fetching quotation details:", error)
      alert("Failed to load quotation details")
    }
  }

  const handleApproveWithDocument = async () => {
    if (!selectedQuotation) return
    
    if (!approvalDocument) {
      alert("Please upload an approval document before approving")
      return
    }

    try {
      setActionLoading(true)
      setUploadingDocument(true)
      
      // First upload the document
      const formData = new FormData()
      formData.append("file", approvalDocument)
      formData.append("quotation_id", selectedQuotation.id.toString())
      formData.append("document_type", "approval")
      
      const uploadResponse = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      })
      
      let documentUrl = ""
      if (uploadResponse.ok) {
        const uploadResult = await uploadResponse.json()
        documentUrl = uploadResult.url || ""
      }
      
      setUploadingDocument(false)
      
      // Then approve the quotation
      const response = await fetch("/api/sales-quotations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          quotation_id: selectedQuotation.id,
          approval_document_url: documentUrl,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to approve quotation")
      }

      const { sales_order } = await response.json()

      setApprovalDocument(null)
      setShowApproveDialog(false)
      setShowDetailsDialog(false)
      refreshSalesOrders()
      alert(`Quotation approved! Sales Order ${sales_order.so_number} created.`)
    } catch (error) {
      console.error("Error approving quotation:", error)
      // Restore the card if approval failed
      if (selectedQuotation) {
        setQuotations((prev) => [...prev, selectedQuotation as any])
      }
      alert(error instanceof Error ? error.message : "Failed to approve quotation")
    } finally {
      setActionLoading(false)
      setUploadingDocument(false)
    }
  }

  const handleReject = async () => {
    if (!selectedQuotation) return
    if (!rejectionReason.trim()) {
      alert("Please provide a rejection reason")
      return
    }

    try {
      setActionLoading(true)
      const response = await fetch("/api/sales-quotations/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_id: selectedQuotation.id,
          rejection_reason: rejectionReason,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to reject quotation")
      }

      // Optimistically remove rejected quotation from list
      setQuotations((prev) => prev.filter((q) => q.id !== selectedQuotation?.id))
      setShowDetailsDialog(false)
      setShowRejectDialog(false)
      setRejectionReason("")
      alert("Quotation rejected successfully.")
    } catch (error) {
      console.error("Error rejecting quotation:", error)
      alert(error instanceof Error ? error.message : "Failed to reject quotation")
    } finally {
      setActionLoading(false)
    }
  }

  const handleApprove = async (quotation: QuotationDetails) => {
    if (!quotation) return

    try {
      setActionLoading(true)
      const response = await fetch("/api/sales-quotations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          quotation_id: quotation.id,
          approval_document_url: "",
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to approve quotation")
      }

      const { sales_order } = await response.json()

      // Optimistically remove approved quotation from list
      setQuotations((prev) => prev.filter((q) => q.id !== quotation.id))
      setShowApproveDialog(false)
      setShowDetailsDialog(false)
      refreshSalesOrders()
      alert(`Quotation approved! Sales Order ${sales_order.so_number} created.`)
    } catch (error) {
      console.error("Error approving quotation:", error)
      alert(error instanceof Error ? error.message : "Failed to approve quotation")
    } finally {
      setActionLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const formatCurrency = (amount: number) => {
    return `${amount.toFixed(2)} EGP`
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "Draft", variant: "secondary" },
      sent: { label: "Sent to Customer", variant: "default" },
      accepted: { label: "Accepted", variant: "default" },
      rejected: { label: "Rejected", variant: "destructive" },
      expired: { label: "Expired", variant: "outline" },
    }

    const config = statusMap[status] || { label: status, variant: "outline" as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Approve Sales Quotations</h1>
        <p className="text-muted-foreground mt-2">
          Review and approve pending quotations to convert them into Sales Orders
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Quotations</CardTitle>
          <CardDescription>
            Quotations awaiting approval will appear here
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quotations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No pending quotations found</p>
              <p className="text-sm mt-2">Quotations in "Sent" status will appear here for approval</p>
            </div>
          ) : (
            <div className="space-y-4">
              {quotations.map((quotation) => (
                <div key={quotation.id} className="border rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                    <div>
                      <p className="text-sm text-muted-foreground">Quotation Number</p>
                      <p className="font-semibold">{quotation.quotation_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Customer</p>
                      <p className="font-semibold">{quotation.customer_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="font-semibold">{formatCurrency(quotation.total)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created Date</p>
                      <p className="font-semibold">{formatDate(quotation.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      {getStatusBadge(quotation.status)}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 bg-transparent"
                      onClick={() => {
                        setSelectedQuotation(quotation as any)
                        setShowPrintDialog(true)
                      }}
                    >
                      <Printer className="w-4 h-4" />
                      Print/Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-2"
                      onClick={() => {
                        setSelectedQuotation(quotation as any)
                        setShowRejectDialog(true)
                      }}
                      disabled={actionLoading}
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        setSelectedQuotation(quotation as any)
                        setQuotations((prev) => prev.filter((q) => q.id !== quotation.id))
                        setShowApproveDialog(true)
                      }}
                      disabled={actionLoading}
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve & Convert to SO
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quotation Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quotation Details</DialogTitle>
            <DialogDescription>
              Review quotation details before approval
            </DialogDescription>
          </DialogHeader>
          {selectedQuotation && (
            <div className="space-y-6">
              {/* Customer Information */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Quotation Number</p>
                  <p className="font-semibold">{selectedQuotation.quotation_number}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  {getStatusBadge(selectedQuotation.status)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Customer Name</p>
                  <p className="font-semibold">{selectedQuotation.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-semibold">{selectedQuotation.customer_phone || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-semibold">{selectedQuotation.customer_email || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Validity (Days)</p>
                  <p className="font-semibold">{selectedQuotation.validity_days} days</p>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">Items</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3 text-sm font-medium">#</th>
                        <th className="text-left p-3 text-sm font-medium">Product Name</th>
                        <th className="text-right p-3 text-sm font-medium">Quantity</th>
                        <th className="text-right p-3 text-sm font-medium">Unit Price</th>
                        <th className="text-right p-3 text-sm font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedQuotation.items || []).map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-3 text-sm">{item.line_no}</td>
                          <td className="p-3 text-sm font-medium">{item.product_name}</td>
                          <td className="p-3 text-sm text-right">{item.quantity}</td>
                          <td className="p-3 text-sm text-right">{formatCurrency(item.unit_price)}</td>
                          <td className="p-3 text-sm text-right font-semibold">
                            {formatCurrency(item.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="border-t pt-4 space-y-2">
                {(() => {
                  // Calculate VAT from subtotal if not provided or is 0
                  const subtotal = selectedQuotation.subtotal || 0
                  const calculatedTax = selectedQuotation.tax && selectedQuotation.tax > 0 ? selectedQuotation.tax : subtotal * 0.14
                  const calculatedTotal = selectedQuotation.total && selectedQuotation.total > subtotal ? selectedQuotation.total : subtotal + calculatedTax
                  
                  return (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span className="font-semibold">{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">VAT (14%):</span>
                        <span className="font-semibold">{formatCurrency(calculatedTax)}</span>
                      </div>
                      <div className="flex justify-between text-lg">
                        <span className="font-bold">Total:</span>
                        <span className="font-bold">{formatCurrency(calculatedTotal)}</span>
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* Notes */}
              {selectedQuotation.notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Notes</p>
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    {selectedQuotation.notes}
                  </div>
                </div>
              )}


            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Quotation</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this quotation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rejection-reason">Rejection Reason *</Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRejectDialog(false)
                  setRejectionReason("")
                }}
                className="bg-transparent"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={actionLoading || !rejectionReason.trim()}
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Rejecting...
                  </>
                ) : (
                  "Reject Quotation"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approval Document Upload Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Quotation</DialogTitle>
            <DialogDescription>
              Upload an approval document (signed quotation, authorization letter, etc.) to approve this quotation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="approval-document">Approval Document *</Label>
              <div className="mt-2">
                <Input
                  id="approval-document"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) setApprovalDocument(file)
                  }}
                />
              </div>
              {approvalDocument && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {approvalDocument.name}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Supported formats: PDF, JPG, PNG, DOC, DOCX
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowApproveDialog(false)
                  setApprovalDocument(null)
                }}
                className="bg-transparent"
              >
                Cancel
              </Button>
              <Button
                onClick={handleApproveWithDocument}
                disabled={actionLoading || !approvalDocument}
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {uploadingDocument ? "Uploading..." : "Approving..."}
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload & Approve
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Print/Preview Dialog */}
      <QuotationPreviewDialog
        quotation={selectedQuotation}
        open={showPrintDialog}
        onOpenChange={setShowPrintDialog}
      />
    </div>
  )
}
