"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Wrench,
  CheckCircle,
  XCircle,
  DollarSign,
  Clock,
  AlertTriangle,
  Send,
  Eye,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MaintenanceWorkOrder, MaintenanceReport } from "@/types/maintenance-workflow"

export function SalesMaintenanceReviewTab({ userRole }: { userRole: string }) {
  const [workOrders, setWorkOrders] = useState<(MaintenanceWorkOrder & { report?: MaintenanceReport })[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<(MaintenanceWorkOrder & { report?: MaintenanceReport }) | null>(null)
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [reviewNotes, setReviewNotes] = useState("")
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchPendingReviews()
  }, [])

  const fetchPendingReviews = async () => {
    try {
      const response = await fetch("/api/maintenance/work-orders?status=report_submitted,pending_sales_review")
      if (response.ok) {
        const orders = await response.json()
        
        // Fetch reports for each order
        const ordersWithReports = await Promise.all(
          orders.map(async (order: MaintenanceWorkOrder) => {
            const reportRes = await fetch(`/api/maintenance/reports?work_order_id=${order.work_order_id}`)
            if (reportRes.ok) {
              const reports = await reportRes.json()
              return { ...order, report: reports[0] }
            }
            return order
          })
        )
        
        setWorkOrders(ordersWithReports)
      }
    } catch (error) {
      console.error("Error fetching pending reviews:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (workOrder: MaintenanceWorkOrder & { report?: MaintenanceReport }) => {
    setProcessing(true)
    try {
      // Update work order status to sales_approved
      await fetch("/api/maintenance/work-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: workOrder.work_order_id,
          status: "sales_approved",
        }),
      })

      // Update report if it exists
      if (workOrder.report) {
        await fetch("/api/maintenance/reports", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            report_id: workOrder.report.report_id,
            approved_at: new Date().toISOString(),
          }),
        })
      }

      setShowReviewDialog(false)
      fetchPendingReviews()
    } catch (error) {
      console.error("Error approving report:", error)
      alert("Failed to approve report")
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async (workOrder: MaintenanceWorkOrder) => {
    if (!reviewNotes) {
      alert("Please provide rejection notes")
      return
    }

    setProcessing(true)
    try {
      await fetch("/api/maintenance/work-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: workOrder.work_order_id,
          status: "in_progress",
          notes: `Rejected by sales: ${reviewNotes}`,
        }),
      })

      setShowReviewDialog(false)
      setReviewNotes("")
      fetchPendingReviews()
    } catch (error) {
      console.error("Error rejecting report:", error)
      alert("Failed to reject report")
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Maintenance Reports Review</h2>
          <p className="text-muted-foreground">Review and approve maintenance reports from workers</p>
        </div>
        <Badge variant="secondary" className="text-lg px-4 py-2">
          {workOrders.length} Pending
        </Badge>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading reports...
          </CardContent>
        </Card>
      ) : workOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600 opacity-50" />
            <p className="text-lg font-medium">All caught up!</p>
            <p className="text-muted-foreground">No pending maintenance reports to review</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {workOrders.map((wo) => (
            <Card key={wo.work_order_id} className="border-l-4 border-l-blue-500">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Wrench className="w-5 h-5" />
                      {wo.work_order_number}
                    </CardTitle>
                    <CardDescription>{wo.title}</CardDescription>
                  </div>
                  <Badge variant="secondary">Pending Review</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {wo.report && (
                  <>
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Report Summary</h4>
                      <div className="p-4 bg-muted rounded-lg space-y-3">
                        <div>
                          <span className="text-sm font-medium">Findings:</span>
                          <p className="text-sm text-muted-foreground mt-1">{wo.report.findings}</p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {wo.report.is_settled ? (
                            <>
                              <CheckCircle className="w-4 h-4 text-green-600" />
                              <span className="text-sm font-medium text-green-600">Issue Resolved</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-4 h-4 text-orange-600" />
                              <span className="text-sm font-medium text-orange-600">Additional Work Required</span>
                            </>
                          )}
                        </div>

                        {!wo.report.is_settled && wo.report.equipment_needed && (
                          <div className="pt-2 border-t">
                            <span className="text-sm font-medium">Equipment Needed:</span>
                            <p className="text-sm text-muted-foreground mt-1">{wo.report.equipment_needed}</p>
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                          {wo.report.labor_hours && (
                            <div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                Labor Hours
                              </div>
                              <div className="font-medium">{wo.report.labor_hours}h</div>
                            </div>
                          )}
                          {wo.report.labor_cost && (
                            <div>
                              <div className="text-xs text-muted-foreground">Labor Cost</div>
                              <div className="font-medium">{wo.report.labor_cost.toLocaleString()} EGP</div>
                            </div>
                          )}
                          {wo.report.equipment_cost && (
                            <div>
                              <div className="text-xs text-muted-foreground">Equipment Cost</div>
                              <div className="font-medium">{wo.report.equipment_cost.toLocaleString()} EGP</div>
                            </div>
                          )}
                        </div>

                        {wo.report.total_cost && (
                          <div className="pt-2 border-t">
                            <div className="flex justify-between items-center">
                              <span className="font-medium">Total Cost:</span>
                              <span className="text-xl font-bold text-blue-600">
                                {wo.report.total_cost.toLocaleString()} EGP
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <Alert>
                      <AlertDescription className="text-sm">
                        Review the maintenance report and approve to send to accounting for invoice creation.
                      </AlertDescription>
                    </Alert>
                  </>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setSelectedWorkOrder(wo)
                      setShowReviewDialog(true)
                    }}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Review & Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Maintenance Report</DialogTitle>
          </DialogHeader>
          {selectedWorkOrder && (
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6 space-y-2">
                  <div className="text-sm">
                    <span className="font-medium">Work Order:</span> {selectedWorkOrder.work_order_number}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Task:</span> {selectedWorkOrder.title}
                  </div>
                </CardContent>
              </Card>

              <div>
                <Label>Review Notes (Optional)</Label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add any notes about this review..."
                  rows={3}
                />
              </div>

              <Alert>
                <AlertDescription>
                  Approving this report will send it to the accounting department to create an invoice for the customer.
                </AlertDescription>
              </Alert>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowReviewDialog(false)}
                  disabled={processing}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => selectedWorkOrder && handleReject(selectedWorkOrder)}
                  disabled={processing}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={() => selectedWorkOrder && handleApprove(selectedWorkOrder)}
                  disabled={processing}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {processing ? "Processing..." : "Approve & Send to Accounting"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
