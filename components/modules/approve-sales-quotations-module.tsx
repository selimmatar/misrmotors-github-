"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Eye, CheckCircle, XCircle, FileText, Loader2, AlertCircle, Printer, Search } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/erp/page-header"
import { StatusBadge } from "@/components/erp/status-badge"
import { Money } from "@/components/erp/money"
import { Input } from "@/components/ui/input"
import { useAppContext } from "@/lib/app-context"
import { QuotationPreviewDialog } from "@/components/quotation/quotation-preview-dialog"
import { ApproveConvertQuotationDialog } from "@/components/sales-quotation/approve-convert-quotation-dialog"
import type { UserRole } from "@/lib/types"

interface Quotation {
  id: number
  quotation_number: string
  quotation_request_number?: string
  department_name?: string
  receiver_name?: string
  customer_id?: number | null
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  validity_days: number
  notes: string | null
  subtotal: number
  tax: number
  total: number
  net_total?: number
  status: string
  created_at: string
  created_by: string | null
  updated_at: string
  delivery_address?: string
  delivery_contact_name?: string
  delivery_contact_phone?: string
  discount_type?: string
  discount_value?: number
  discount_amount?: number
  payment_type?: string
  payment_details?: any
  so_type?: string
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
  embedded?: boolean
}

export function ApproveSalesQuotationsModule({ userRole, embedded = false }: ApproveSalesQuotationsModuleProps) {
  const { t, language } = useI18n()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [selectedQuotation, setSelectedQuotation] = useState<QuotationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  
  const { refreshSalesOrders } = useAppContext()

  useEffect(() => {
    fetchQuotations()
  }, [])

  // `silent` refreshes the list without the full-page spinner (used after saving from inside the
  // Approve & Convert dialog, which would otherwise be unmounted while the list reloads).
  const fetchQuotations = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      // Fetch from sales_quotations table
      const response = await fetch("/api/sales-quotations")
      if (!response.ok) throw new Error("Failed to fetch quotations")
      
      const data = await response.json()
      // Get quotations with pending/draft status
      // Quotations already converted into a sales order (converted_so) are not listed again.
      const pendingQuotations = (data.quotations || []).filter(
        (q: any) => (q.status === "sent" || q.status === "pending") && !q.converted_so,
      )
      
      setQuotations(pendingQuotations)
    } catch (error) {
      console.error("Failed to fetch quotations:", error)
    } finally {
      if (!silent) setLoading(false)
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

  const handlePrintPreview = async (quotation: Quotation) => {
    try {
      // The list only carries summary fields (no items) - fetch the full
      // quotation so the print/preview dialog actually shows the line items.
      const response = await fetch(`/api/sales-quotations?id=${quotation.id}`)
      if (!response.ok) throw new Error("Failed to fetch quotation details")

      const data = await response.json()
      const fullQuotation = data.quotation

      if (!fullQuotation) {
        throw new Error("Quotation not found")
      }

      setSelectedQuotation({
        ...fullQuotation,
        items: (fullQuotation.items || []).map((item: any) => ({
          ...item,
          total: item.quantity * item.unit_price,
        })),
      } as QuotationDetails)
      setShowPrintDialog(true)
    } catch (error) {
      console.error("Error loading quotation for preview:", error)
      alert("Failed to load quotation for preview")
    }
  }

  // Fetches the full quotation (with line items) before opening the "Approve & Convert
  // to SO" dialog, since the list view only carries summary fields.
  const openApproveConvertDialog = async (quotation: Quotation) => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/sales-quotations?id=${quotation.id}`)
      if (!response.ok) throw new Error("Failed to fetch quotation details")

      const data = await response.json()
      const fullQuotation = data.quotation
      if (!fullQuotation) throw new Error("Quotation not found")

      setSelectedQuotation({
        ...fullQuotation,
        items: (fullQuotation.items || []).map((item: any) => ({
          ...item,
          total: item.quantity * item.unit_price,
        })),
      } as QuotationDetails)
      setShowApproveDialog(true)
    } catch (error) {
      console.error("Error loading quotation for approval:", error)
      alert("Failed to load quotation for approval")
    } finally {
      setActionLoading(false)
    }
  }

  const handleQuotationApproved = (soNumber: string) => {
    if (selectedQuotation) {
      setQuotations((prev) => prev.filter((q) => q.id !== selectedQuotation.id))
    }
    setShowApproveDialog(false)
    setSelectedQuotation(null)
    refreshSalesOrders()
    alert(`Quotation approved! Sales Order ${soNumber} created.`)
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

  const filteredQuotations = quotations.filter((quotation) => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return true
    return (
      quotation.quotation_number?.toLowerCase().includes(query) ||
      quotation.customer_name?.toLowerCase().includes(query) ||
      quotation.customer_phone?.toLowerCase().includes(query) ||
      quotation.customer_email?.toLowerCase().includes(query)
    )
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          group={t("group.sales")}
          title={t("module.approve-sales-quotations")}
          subtitle="Review and approve pending quotations to convert them into Sales Orders"
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pending Quotations</CardTitle>
          <CardDescription>
            Quotations awaiting approval will appear here
          </CardDescription>
          <div className="relative mt-2">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by quotation number, customer name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ps-9"
              aria-label={t("a11y.sales.search-pending-quotations")}
            />
          </div>
        </CardHeader>
        <CardContent>
          {quotations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No pending quotations found</p>
              <p className="text-sm mt-2">Quotations in "Sent" status will appear here for approval</p>
            </div>
          ) : filteredQuotations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No quotations match your search</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredQuotations.map((quotation) => (
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
                      <p className="font-semibold"><Money value={quotation.total} /> EGP</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created Date</p>
                      <p className="font-semibold">{formatDate(quotation.created_at, language)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <StatusBadge status={quotation.status} label={quotation.status === "sent" ? "Sent to Customer" : undefined} />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 bg-transparent"
                      onClick={() => handlePrintPreview(quotation)}
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
                      onClick={() => openApproveConvertDialog(quotation)}
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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
                  <StatusBadge status={selectedQuotation.status} label={selectedQuotation.status === "sent" ? "Sent to Customer" : undefined} />
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
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-start p-3 text-sm font-medium">#</th>
                        <th className="text-start p-3 text-sm font-medium">Product Name</th>
                        <th className="text-end p-3 text-sm font-medium">Quantity</th>
                        <th className="text-end p-3 text-sm font-medium">Unit Price (EGP)</th>
                        <th className="text-end p-3 text-sm font-medium">Total (EGP)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedQuotation.items || []).map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-3 text-sm">{item.line_no}</td>
                          <td className="p-3 text-sm font-medium">{item.product_name}</td>
                          <td className="p-3 text-sm text-end">{item.quantity}</td>
                          <td className="p-3 text-sm text-end"><Money value={item.unit_price} /></td>
                          <td className="p-3 text-sm text-end font-semibold">
                            <Money value={item.total} />
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
                        <span className="font-semibold"><Money value={subtotal} /> EGP</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">VAT (14%):</span>
                        <span className="font-semibold"><Money value={calculatedTax} /> EGP</span>
                      </div>
                      <div className="flex justify-between text-lg">
                        <span className="font-bold">Total:</span>
                        <span className="font-bold"><Money value={calculatedTotal} /> EGP</span>
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
                    <Loader2 className="w-4 h-4 animate-spin me-2" />
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

      {/* Approve & Convert to SO Dialog - lets the sales rep edit items, customer,
          delivery, and payment terms before the sales order is created, in case the
          customer only approved some of the quoted items. */}
      {showApproveDialog && selectedQuotation && (
        <ApproveConvertQuotationDialog
          quotation={selectedQuotation}
          onOpenChange={(open) => {
            setShowApproveDialog(open)
            if (!open) setSelectedQuotation(null)
          }}
          onApproved={handleQuotationApproved}
          onSaved={() => fetchQuotations(true)}
        />
      )}

      {/* Print/Preview Dialog */}
      <QuotationPreviewDialog
        quotation={selectedQuotation}
        open={showPrintDialog}
        onOpenChange={setShowPrintDialog}
      />
    </div>
  )
}
