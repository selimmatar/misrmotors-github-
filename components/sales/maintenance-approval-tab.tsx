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
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"

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
  const { t } = useI18n()
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
      
      const response = await fetch("/api/maintenance/reports")
      
      if (response.ok) {
        const allReports = await response.json()
        setReports(allReports)
      } else {
        const errorText = await response.text()
        console.error("Error fetching reports:", errorText)
      }
    } catch (error) {
      console.error("Error fetching pending reports:", error)
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
        alert(t("maint-approval.report-approved"))
        setSelectedReport(null)
        fetchPendingReports()
      } else {
        const error = await response.json()
        alert(fill(t("maint-approval.error-with-message"), { error: error.error }))
      }
    } catch (error) {
      console.error("Error approving report:", error)
      alert(t("maint-approval.failed-to-approve"))
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!selectedReport || !rejectionReason.trim()) {
      alert(t("maint-approval.reason-required"))
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
        alert(t("maint-approval.report-rejected"))
        setSelectedReport(null)
        setRejectionReason("")
        fetchPendingReports()
      } else {
        const error = await response.json()
        alert(fill(t("maint-approval.error-with-message"), { error: error.error }))
      }
    } catch (error) {
      console.error("Error rejecting report:", error)
      alert(t("maint-approval.failed-to-reject"))
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
          <h2 className="text-2xl font-bold">{t("maint-approval.title")}</h2>
          <p className="text-muted-foreground">{t("maint-approval.subtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="pending">
            <Clock className="w-4 h-4 mr-2" />
            {fill(t("maint-approval.pending-approval-count"), { count: pendingReports.length })}
          </TabsTrigger>
          <TabsTrigger value="approved">
            <CheckCircle className="w-4 h-4 mr-2" />
            {fill(t("maint-approval.approved-count"), { count: approvedReports.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          {pendingReports.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("maint-approval.no-pending")}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.work-order")}</TableHead>
                    <TableHead>{t("common.sales-order")}</TableHead>
                    <TableHead>{t("so.customer")}</TableHead>
                    <TableHead>{t("common.title")}</TableHead>
                    <TableHead>{t("maint-approval.cost")}</TableHead>
                    <TableHead>{t("common.submitted")}</TableHead>
                    <TableHead>{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingReports.map((report) => (
                    <TableRow key={report.report_id}>
                      <TableCell className="font-mono">{report.work_order_number}</TableCell>
                      <TableCell className="font-mono">{report.sales_order_number || "N/A"}</TableCell>
                      <TableCell>{report.customer_name}</TableCell>
                      <TableCell>{report.title}</TableCell>
                      <TableCell className="font-semibold">{t("common.egp-2")} {report.actual_cost?.toFixed(2) || "0.00"}</TableCell>
                      <TableCell>{new Date(report.submitted_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          onClick={() => setSelectedReport(report)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          {t("maint-approval.review")}
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
                <p className="text-muted-foreground">{t("maint-approval.no-approved")}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.work-order")}</TableHead>
                    <TableHead>{t("so.customer")}</TableHead>
                    <TableHead>{t("maint-approval.cost")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedReports.map((report) => (
                    <TableRow key={report.report_id}>
                      <TableCell className="font-mono">{report.work_order_number}</TableCell>
                      <TableCell>{report.customer_name}</TableCell>
                      <TableCell>{t("common.egp-2")} {report.actual_cost?.toFixed(2) || "0.00"}</TableCell>
                      <TableCell>
                        <Badge variant="default">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {t("status.approved")}
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
                            {t("maint-approval.view-pdf")}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedReport(report)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          {t("maint-approval.review")}
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("maint-approval.review-report")}</DialogTitle>
            <DialogDescription>
              {selectedReport?.work_order_number} - {selectedReport?.customer_name}
            </DialogDescription>
          </DialogHeader>

          {selectedReport && (
            <div className="space-y-6">
              <WorkflowTimeline currentStage="report_pending" />

              <Card>
                <CardHeader>
                  <CardTitle>{t("maint-approval.work-order-details")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.work-order")}</p>
                      <p className="font-mono font-semibold">{selectedReport.work_order_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("so.customer")}</p>
                      <p className="font-semibold">{selectedReport.customer_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.title")}</p>
                      <p>{selectedReport.title}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.submitted")}</p>
                      <p>{new Date(selectedReport.submitted_at).toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("maint-approval.report-details")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{t("maint-approval.summary")}</p>
                    <p className="text-sm">{selectedReport.summary}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{t("common.findings")}</p>
                    <p className="text-sm">{selectedReport.findings}</p>
                  </div>
                  {selectedReport.actions_taken && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t("maint-approval.actions-taken")}</p>
                      <p className="text-sm">{selectedReport.actions_taken}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.labor-hours")}</p>
                      <p className="text-lg font-semibold">{selectedReport.actual_hours || 0} {t("mi.hrs")}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("common.total-cost")}</p>
                      <p className="text-lg font-semibold">{t("common.egp-2")} {selectedReport.actual_cost?.toFixed(2) || "0.00"}</p>
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
                        {t("maint-approval.view-uploaded-pdf")}
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
                      {t("common.materials-parts-used")}
                    </CardTitle>
                    <CardDescription>
                      {t("maint-approval.items-used-hint")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.source")}</TableHead>
                          <TableHead>{t("common.item")}</TableHead>
                          <TableHead>{t("common.sku")}</TableHead>
                          <TableHead className="text-right">{t("common.qty")}</TableHead>
                          <TableHead className="text-right">{t("common.unit-cost")}</TableHead>
                          <TableHead className="text-right">{t("total")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedReport.parts_used.map((item: MaterialItem, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <Badge variant={item.type === "inventory" ? "default" : "secondary"}>
                                {item.type === "inventory" ? t("group.inventory") : t("common.outsourced-2")}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{item.productName}</TableCell>
                            <TableCell className="font-mono text-sm">{item.sku || "-"}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">{t("common.egp-2")} {(item.unitCost || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold">{t("common.egp-2")} {(item.totalCost || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={5} className="text-right font-semibold">{t("maint-approval.materials-total")}</TableCell>
                          <TableCell className="text-right font-bold">
                            {t("common.egp-2")} {selectedReport.parts_used.reduce((sum: number, m: MaterialItem) => sum + (m.totalCost || 0), 0).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>

                    {selectedReport.parts_used.some((m: MaterialItem) => m.type === "inventory") && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                        <p className="text-sm text-amber-800 font-medium">
                          {t("maint-approval.deduct-warning")}
                        </p>
                        <ul className="mt-1 text-sm text-amber-700 list-disc list-inside">
                          {selectedReport.parts_used
                            .filter((m: MaterialItem) => m.type === "inventory")
                            .map((m: MaterialItem, idx: number) => (
                              <li key={idx}>{m.productName} ({m.sku}) - {m.quantity} {t("common.units")}</li>
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
                    <label className="text-sm font-medium">{t("maint-approval.rejection-reason-label")}</label>
                    <Textarea
                      placeholder={t("maint-approval.rejection-placeholder")}
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
                      {t("cancel")}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleReject}
                      disabled={loading || !rejectionReason.trim()}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      {t("action.reject")}
                    </Button>
                    <Button
                      onClick={handleApprove}
                      disabled={loading}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      {t("action.approve")}
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
