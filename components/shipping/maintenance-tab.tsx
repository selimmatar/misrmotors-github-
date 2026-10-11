"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {Wrench, Clock, CheckCircle, AlertCircle, Eye, Upload, Printer, FileText } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { MaintenanceWorkOrder, MaintenanceReport } from "@/types/maintenance-workflow"
import { MaintenanceWorkerReportForm } from "./maintenance-worker-report-form"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { statusLabel } from "@/lib/format"

export function ShippingMaintenanceTab({ userRole }: { userRole: string }) {
  const { t } = useI18n()
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<MaintenanceWorkOrder | null>(null)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [detailsWorkOrder, setDetailsWorkOrder] = useState<MaintenanceWorkOrder | null>(null)
  const [showViewReportDialog, setShowViewReportDialog] = useState(false)
  const [viewingReport, setViewingReport] = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  const fetchReportForWorkOrder = async (workOrderId: number) => {
    setLoadingReport(true)
    try {
      const res = await fetch(`/api/maintenance/reports?work_order_id=${workOrderId}`)
      if (res.ok) {
        const reports = await res.json()
        if (reports.length > 0) {
          setViewingReport(reports[0])
          setShowViewReportDialog(true)
        }
      }
    } catch (err) {
      console.error("Error fetching report:", err)
    } finally {
      setLoadingReport(false)
    }
  }

  useEffect(() => {
    fetchWorkOrders()
  }, [])

  const fetchWorkOrders = async () => {
    try {
      const response = await fetch("/api/maintenance/work-orders")
      if (response.ok) {
        const data = await response.json()
        setWorkOrders(data)
      } else {
        console.error("Shipping Maintenance Tab: Failed to fetch work orders:", response.status)
      }
    } catch (error) {
      console.error("Error fetching work orders:", error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "status.pending", variant: "secondary" },
      assigned: { label: "maint.status-assigned", variant: "default" },
      in_progress: { label: "common.in-progress", variant: "outline" },
      on_hold: { label: "inventory.on-hold", variant: "secondary" },
      completed: { label: "status.completed", variant: "default" },
      cancelled: { label: "status.cancelled", variant: "destructive" },
    }
    const config = statusConfig[status]
    return <Badge variant={config ? config.variant : "outline"}>{config ? t(config.label) : status}</Badge>
  }

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-gray-100 text-gray-800",
      medium: "bg-blue-100 text-blue-800",
      high: "bg-orange-100 text-orange-800",
      urgent: "bg-red-100 text-red-800",
    }
    return <Badge className={colors[priority] || colors.medium}>{statusLabel(priority, t).toUpperCase()}</Badge>
  }

  const assignedWorkOrders = workOrders.filter((wo) => 
    wo.status === "pending" || wo.status === "assigned" || wo.status === "in_progress"
  )
  const reportSubmittedWorkOrders = workOrders.filter((wo) => 
    wo.status === "on_hold"
  )
  const completedWorkOrders = workOrders.filter((wo) => 
    wo.status === "completed"
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0 break-words">
          <h2 className="text-2xl font-bold">{t("maint.work-orders-title")}</h2>
          <p className="text-muted-foreground">{t("maint.view-manage")}</p>
        </div>
      </div>

      <Tabs defaultValue="assigned" className="space-y-4">
        <TabsList className="h-auto flex-wrap w-full justify-start">
          <TabsTrigger value="assigned">
            <Clock className="w-4 h-4 me-2" />
            {fill(t("maint.my-tasks-count"), { n: assignedWorkOrders.length })}
          </TabsTrigger>
          <TabsTrigger value="submitted">
            <Upload className="w-4 h-4 me-2" />
            {fill(t("maint.submitted-reports-count"), { n: reportSubmittedWorkOrders.length })}
          </TabsTrigger>
          <TabsTrigger value="completed">
            <CheckCircle className="w-4 h-4 me-2" />
            {fill(t("maint.completed-count"), { n: completedWorkOrders.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assigned" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t("maint.loading-work-orders")}
              </CardContent>
            </Card>
          ) : assignedWorkOrders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t("maint.no-assigned")}
              </CardContent>
            </Card>
          ) : (
            assignedWorkOrders.map((wo) => (
              <Card key={wo.work_order_id}>
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <Wrench className="w-5 h-5" />
                        {wo.work_order_number}
                      </CardTitle>
                      <CardDescription>{wo.title}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {getPriorityBadge(wo.priority)}
                      {getStatusBadge(wo.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{wo.description}</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">{t("maint.category-label")}</span> {wo.category}
                    </div>
                    {wo.location && (
                      <div>
                        <span className="font-medium">{t("maint.location-label")}</span> {wo.location}
                      </div>
                    )}
                    {wo.scheduled_date && (
                      <div>
                        <span className="font-medium">{t("maint.scheduled-label")}</span>{" "}
                        {new Date(wo.scheduled_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        setSelectedWorkOrder(wo)
                        setShowReportDialog(true)
                      }}
                    >
                      <Upload className="w-4 h-4 me-2" />
                      {t("maint.submit-report")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDetailsWorkOrder(wo)
                        setShowDetailsDialog(true)
                      }}
                    >
                      <Eye className="w-4 h-4 me-2" />
                      {t("action.view-details")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => window.open(`/api/maintenance/work-orders/${wo.work_order_id}/pdf`, '_blank')}
                    >
                      <Printer className="w-4 h-4 me-2" />
                      {t("maint.print-template")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="submitted" className="space-y-4">
          {reportSubmittedWorkOrders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t("maint.no-submitted-reports")}
              </CardContent>
            </Card>
          ) : (
            reportSubmittedWorkOrders.map((wo) => (
              <Card key={wo.work_order_id}>
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <Wrench className="w-5 h-5" />
                        {wo.work_order_number}
                      </CardTitle>
                      <CardDescription>{wo.title}</CardDescription>
                    </div>
                    {getStatusBadge(wo.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("maint.report-awaiting-review")}
                  </p>
                  <Button
                    variant="outline"
                    disabled={loadingReport}
                    onClick={() => fetchReportForWorkOrder(wo.work_order_id)}
                  >
                    <Eye className="w-4 h-4 me-2" />
                    {loadingReport ? t("loading") : t("maint.view-report")}
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          {completedWorkOrders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t("ops.no-completed-wos")}
              </CardContent>
            </Card>
          ) : (
            completedWorkOrders.map((wo) => (
              <Card key={wo.work_order_id}>
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-700" />
                        {wo.work_order_number}
                      </CardTitle>
                      <CardDescription>{wo.title}</CardDescription>
                    </div>
                    {getStatusBadge(wo.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingReport}
                    onClick={() => fetchReportForWorkOrder(wo.work_order_id)}
                  >
                    <Eye className="w-4 h-4 me-2" />
                    {t("maint.view-report")}
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* View Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              {fill(t("maint.wo-details-title"), { number: detailsWorkOrder?.work_order_number ?? "" })}
            </DialogTitle>
          </DialogHeader>
          {detailsWorkOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("common.title")}</p>
                  <p className="font-semibold">{detailsWorkOrder.title}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("status")}</p>
                  {getStatusBadge(detailsWorkOrder.status)}
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("common.priority")}</p>
                  {getPriorityBadge(detailsWorkOrder.priority)}
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("maint.category")}</p>
                  <p>{detailsWorkOrder.category}</p>
                </div>
                {detailsWorkOrder.location && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("warehouse.location")}</p>
                    <p>{detailsWorkOrder.location}</p>
                  </div>
                )}
                {detailsWorkOrder.scheduled_date && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("maint.scheduled-date")}</p>
                    <p>{new Date(detailsWorkOrder.scheduled_date).toLocaleDateString()}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("created")}</p>
                  <p>{new Date(detailsWorkOrder.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("description")}</p>
                <p className="mt-1">{detailsWorkOrder.description}</p>
              </div>
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  onClick={() => window.open(`/api/maintenance/work-orders/${detailsWorkOrder.work_order_id}/pdf`, '_blank')}
                >
                  <Printer className="w-4 h-4 me-2" />
                  {t("maint.print-wo-template")}
                </Button>
                <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
                  {t("close")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Report Dialog */}
      <Dialog open={showViewReportDialog} onOpenChange={setShowViewReportDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {fill(t("maint.submitted-report-title"), { number: viewingReport?.work_order_number ?? "" })}
            </DialogTitle>
          </DialogHeader>
          {viewingReport && (
            <div className="space-y-6">
              {/* Report Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("common.work-order")}</p>
                  <p className="font-semibold">{viewingReport.work_order_number}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("common.sales-order")}</p>
                  <p className="font-semibold">{viewingReport.work_order?.sales_order?.so_number || t("label.na")}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("status")}</p>
                  {getStatusBadge(viewingReport.status)}
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("common.submitted")}</p>
                  <p>{viewingReport.submitted_at ? new Date(viewingReport.submitted_at).toLocaleString() : t("label.na")}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("so.customer")}</p>
                  <p>{viewingReport.customer_name || t("label.na")}</p>
                </div>
              </div>

              {/* Findings */}
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{t("common.findings")}</p>
                <div className="p-3 bg-muted rounded-md text-sm">{viewingReport.findings || t("maint.no-findings")}</div>
              </div>

              {/* Cost Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-3 border rounded-md text-center">
                  <p className="text-sm text-muted-foreground">{t("common.labor-hours")}</p>
                  <p className="text-lg font-bold">{viewingReport.labor_hours || viewingReport.actual_hours || 0}</p>
                </div>
                <div className="p-3 border rounded-md text-center">
                  <p className="text-sm text-muted-foreground">{t("maint.labor-cost")}</p>
                  <p className="text-lg font-bold">{t("common.egp-2")} {(viewingReport.labor_cost || 0).toLocaleString()}</p>
                </div>
                <div className="p-3 border rounded-md text-center">
                  <p className="text-sm text-muted-foreground">{t("common.total-cost")}</p>
                  <p className="text-lg font-bold">{t("common.egp-2")} {(viewingReport.actual_cost || 0).toLocaleString()}</p>
                </div>
              </div>

              {/* Materials Used */}
              {viewingReport.parts_used && viewingReport.parts_used.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">{t("common.materials-parts-used")}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("common.source")}</TableHead>
                        <TableHead>{t("common.item")}</TableHead>
                        <TableHead className="text-end">{t("common.qty")}</TableHead>
                        <TableHead className="text-end">{t("common.unit-cost")}</TableHead>
                        <TableHead className="text-end">{t("total")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingReport.parts_used.map((item: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Badge variant={item.type === "inventory" ? "default" : "secondary"}>
                              {item.type === "inventory" ? t("group.inventory") : t("common.outsourced-2")}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell className="text-end">{item.quantity}</TableCell>
                          <TableCell className="text-end">{t("common.egp-2")} {(item.unitCost || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-end font-semibold">{t("common.egp-2")} {(item.totalCost || 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Follow-up */}
              {viewingReport.follow_up_required && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-sm font-medium text-amber-800">{t("maint.follow-up-required")}</p>
                  <p className="text-sm text-amber-700">{viewingReport.follow_up_notes || t("maint.additional-work-needed")}</p>
                </div>
              )}

              {/* Uploaded PDF */}
              {viewingReport.uploaded_pdf_url && (
                <Button
                  variant="outline"
                  onClick={() => window.open(viewingReport.uploaded_pdf_url, "_blank")}
                >
                  <FileText className="w-4 h-4 me-2" />
                  {t("maint.view-uploaded-pdf")}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Submission Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("maint.submit-maintenance-report")}</DialogTitle>
          </DialogHeader>
          {selectedWorkOrder && (
            <MaintenanceWorkerReportForm
              workOrder={selectedWorkOrder}
              onSuccess={() => {
                setShowReportDialog(false)
                fetchWorkOrders()
              }}
              onCancel={() => setShowReportDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
