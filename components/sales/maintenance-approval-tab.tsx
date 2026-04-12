"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { CheckCircle, XCircle, Eye, Clock, DollarSign, Wrench, FileText } from "lucide-react"
import { WorkflowStatusBadge, WorkflowTimeline, getWorkflowStage } from "@/components/maintenance/workflow-status-manager"

interface MaterialItem {
  type: "inventory" | "outsourced"
  productId?: number
  productName: string
  sku?: string
  quantity: number
  unitCost: number
  totalCost: number
}

interface MaintenanceReport {
  report_id: number
  work_order_id: number
  work_order_number: string
  sales_order_number?: string
  customer_name: string
  title: string
  description: string
  summary: string
  findings: string
  actions_taken?: string
  actual_hours?: number
  actual_cost?: number
  parts_used?: MaterialItem[]
  uploaded_pdf_url?: string
  submitted_at: string
  status: string
}

export function MaintenanceApprovalTab({ userRole }: { userRole: string }) {
  const [reports, setReports] = useState<MaintenanceReport[]>([])
  const [selectedReport, setSelectedReport] = useState<MaintenanceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")

  useEffect(() => {
    fetchPendingReports()
  }, [])

  const fetchPendingReports = async () => {
    try {
      setLoading(true)
      console.log("[v0] Fetching pending maintenance reports for sales approval...")
      
      const response = await fetch("/api/maintenance/reports")
      
      if (response.ok) {
        const allReports = await response.json()
        console.log("[v0] Fetched all reports:", allReports)
        setReports(allReports)
      } else {
        const errorText = await response.text()
        console.error("[v0] Error fetching reports:", errorText)
      }
    } catch (error) {
      console.error("[v0] Error fetching pending reports:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    if (!selectedReport) return
    setLoading(true)
    try {
      const response = await fetch("/api/maintenance/reports/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: selectedReport.report_id,
          work_order_id: selectedReport.work_order_id,
          approved: true,
        }),
      })

      if (response.ok) {
        alert("Report approved successfully!")
        setSelectedReport(null)
        fetchPendingReports()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error("[v0] Error approving report:", error)
      alert("Failed to approve report")
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!selectedReport || !rejectionReason.trim()) {
      alert("Please provide a reason for rejection")
      return
    }
    setLoading(true)
    try {
      const response = await fetch("/api/maintenance/reports/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: selectedReport.report_id,
          work_order_id: selectedReport.work_order_id,
          approved: false,
          rejection_reason: rejectionReason,
        }),
      })

      if (response.ok) {
        alert("Report rejected and sent back to shipping")
        setSelectedReport(null)
        setRejectionReason("")
        fetchPendingReports()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error("[v0] Error rejecting report:", error)
      alert("Failed to reject report")
    } finally {
      setLoading(false)
    }
  }

  const pendingReports = reports.filter(r => r.status === "on_hold")
  const approvedReports = reports.filter(r => r.status === "completed")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Maintenance Report Approvals</h2>
          <p className="text-muted-foreground">Review and approve maintenance reports from shipping team</p>
        </div>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">
            <Clock className="w-4 h-4 mr-2" />
            Pending Approval ({pendingReports.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            <CheckCircle className="w-4 h-4 mr-2" />
            Approved ({approvedReports.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          {pendingReports.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pending reports to review</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work Order</TableHead>
                    <TableHead>Sales Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingReports.map((report) => (
                    <TableRow key={report.report_id}>
                      <TableCell className="font-mono">{report.work_order_number}</TableCell>
                      <TableCell className="font-mono">{report.sales_order_number || "N/A"}</TableCell>
                      <TableCell>{report.customer_name}</TableCell>
                      <TableCell>{report.title}</TableCell>
                      <TableCell className="font-semibold">EGP {report.actual_cost?.toFixed(2) || "0.00"}</TableCell>
                      <TableCell>{new Date(report.submitted_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          onClick={() => setSelectedReport(report)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="approved" className="space-y-4">
          {approvedReports.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No approved reports yet</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedReports.map((report) => (
                    <TableRow key={report.report_id}>
                      <TableCell className="font-mono">{report.work_order_number}</TableCell>
                      <TableCell>{report.customer_name}</TableCell>
                      <TableCell>EGP {report.actual_cost?.toFixed(2) || "0.00"}</TableCell>
                      <TableCell>
                        <Badge variant="default">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Approved
                        </Badge>
                      </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {report.uploaded_pdf_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(report.uploaded_pdf_url, '_blank')}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            View PDF
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedReport(report)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          Review
                        </Button>
                      </div>
                    </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Maintenance Report</DialogTitle>
            <DialogDescription>
              {selectedReport?.work_order_number} - {selectedReport?.customer_name}
            </DialogDescription>
          </DialogHeader>

          {selectedReport && (
            <div className="space-y-6">
              <WorkflowTimeline currentStage="report_pending" />

              <Card>
                <CardHeader>
                  <CardTitle>Work Order Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Work Order</p>
                      <p className="font-mono font-semibold">{selectedReport.work_order_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Customer</p>
                      <p className="font-semibold">{selectedReport.customer_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Title</p>
                      <p>{selectedReport.title}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Submitted</p>
                      <p>{new Date(selectedReport.submitted_at).toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Report Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Summary</p>
                    <p className="text-sm">{selectedReport.summary}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Findings</p>
                    <p className="text-sm">{selectedReport.findings}</p>
                  </div>
                  {selectedReport.actions_taken && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Actions Taken</p>
                      <p className="text-sm">{selectedReport.actions_taken}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <p className="text-sm text-muted-foreground">Labor Hours</p>
                      <p className="text-lg font-semibold">{selectedReport.actual_hours || 0} hrs</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Cost</p>
                      <p className="text-lg font-semibold">EGP {selectedReport.actual_cost?.toFixed(2) || "0.00"}</p>
                    </div>
                  </div>

                  {selectedReport.uploaded_pdf_url && (
                    <div className="pt-4 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-transparent"
                        onClick={() => window.open(selectedReport.uploaded_pdf_url, '_blank')}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        View Uploaded Work Order PDF
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Materials Used */}
              {selectedReport.parts_used && selectedReport.parts_used.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wrench className="w-5 h-5" />
                      Materials & Parts Used
                    </CardTitle>
                    <CardDescription>
                      Items used during maintenance - inventory items will be deducted upon approval
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Source</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Unit Cost</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedReport.parts_used.map((item: MaterialItem, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <Badge variant={item.type === "inventory" ? "default" : "secondary"}>
                                {item.type === "inventory" ? "Inventory" : "Outsourced"}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{item.productName}</TableCell>
                            <TableCell className="font-mono text-sm">{item.sku || "-"}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">EGP {(item.unitCost || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold">EGP {(item.totalCost || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={5} className="text-right font-semibold">Materials Total:</TableCell>
                          <TableCell className="text-right font-bold">
                            EGP {selectedReport.parts_used.reduce((sum: number, m: MaterialItem) => sum + (m.totalCost || 0), 0).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>

                    {selectedReport.parts_used.some((m: MaterialItem) => m.type === "inventory") && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                        <p className="text-sm text-amber-800 font-medium">
                          Approving this report will deduct the following from inventory:
                        </p>
                        <ul className="mt-1 text-sm text-amber-700 list-disc list-inside">
                          {selectedReport.parts_used
                            .filter((m: MaterialItem) => m.type === "inventory")
                            .map((m: MaterialItem, idx: number) => (
                              <li key={idx}>{m.productName} ({m.sku}) - {m.quantity} units</li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedReport.status === "on_hold" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Rejection Reason (if rejecting)</label>
                    <Textarea
                      placeholder="Provide reason for rejection..."
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedReport(null)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleReject}
                      disabled={loading || !rejectionReason.trim()}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      onClick={handleApprove}
                      disabled={loading}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                  </DialogFooter>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
