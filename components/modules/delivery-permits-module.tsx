"use client"

import { CorrectPermitDialog } from "@/components/delivery-permit/correct-permit-dialog"
import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { takeDocumentFor } from "@/lib/open-document"
import { useI18n } from "@/lib/i18n-context"
import { fill } from "@/lib/i18n-format"
import { DeliveryPermitCard } from "@/components/delivery-permit"
import { ApproveRejectControls } from "@/components/delivery-permit/approve-reject-controls"
import { SendBackToShippingButton } from "@/components/delivery-permit/send-back-button"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { StatusBadge } from "@/components/erp/status-badge"
import { Money } from "@/components/erp/money"
import { ErpTable, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { formatDate } from "@/lib/format"
import type { DeliveryPermit, UserRole } from "@/lib/types"
import { Search, FileText, RefreshCw, Eye, Download, X } from "lucide-react"
import { sentSignedFiles } from "@/lib/dp-signed-choice"

interface DeliveryPermitsModuleProps {
  userRole: UserRole
}

export default function DeliveryPermitsModule({ userRole }: DeliveryPermitsModuleProps) {
  const { t, language } = useI18n()
  const [permits, setPermits] = useState<DeliveryPermit[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  // a DP clicked in the order overview: search for it and open its details once the list has loaded
  const openOnLoad = useRef<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>("all")
  const [selectedPermit, setSelectedPermit] = useState<DeliveryPermit | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [permitToReview, setPermitToReview] = useState<DeliveryPermit | null>(null)
  const [permitToCorrect, setPermitToCorrect] = useState<DeliveryPermit | null>(null)

  const fetchPermits = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/delivery-permits")
      if (response.ok) {
        const data = await response.json()
        setPermits(data)
      }
    } catch (error) {
      console.error("Error fetching permits:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPermits()
  }, [])

  const statusCounts = {
    all: permits.length,
    out_for_delivery: permits.filter((p) => p.status === "OUT_FOR_DELIVERY").length,
    submitted: permits.filter((p) => p.status === "SUBMITTED_SIGNED").length,
    approved: permits.filter((p) => p.status === "APPROVED").length,
    rejected: permits.filter((p) => p.status === "REJECTED").length,
  }

  // The people who can approve a signed permit (DeliveryPermitCard's APPROVE button)
  const canApprove = userRole === "accountant" || userRole === "admin" || userRole === "ceo"

  const filteredPermits = permits.filter((permit) => {
    const matchesSearch =
      permit.permitNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      permit.soNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      permit.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      permit.recipientName?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesTab =
      activeTab === "all" ||
      (activeTab === "out_for_delivery" && permit.status === "OUT_FOR_DELIVERY") ||
      (activeTab === "submitted" && permit.status === "SUBMITTED_SIGNED") ||
      (activeTab === "approved" && permit.status === "APPROVED") ||
      (activeTab === "rejected" && permit.status === "REJECTED")

    return matchesSearch && matchesTab
  })

  useEffect(() => {
    const asked = takeDocumentFor("delivery-permits")
    if (!asked) return
    openOnLoad.current = asked
    setSearchTerm(asked)
    setActiveTab("all")
  }, [])
  useEffect(() => {
    const asked = openOnLoad.current
    if (!asked) return
    const permit = permits.find((p) => p.permitNo === asked)
    if (!permit) return
    openOnLoad.current = null
    setSelectedPermit(permit)
    setShowDetails(true)
  }, [permits])

  const handleViewDetails = (permit: DeliveryPermit) => {
    setSelectedPermit(permit)
    setShowDetails(true)
  }

  const handlePrintPDF = (permit: DeliveryPermit) => {
    const url = `${window.location.origin}/api/delivery-permits/pdf?permitId=${permit.id}`
    window.open(url, "_blank")
  }

  const handleOpenReviewDialog = (permit: DeliveryPermit) => {
    setPermitToReview(permit)
    setShowReviewDialog(true)
  }

  // Approve / reject straight from the review window (owner report, 2026-11-12: it only had Close).
  // "SEND_BACK_TO_SHIPPING": a wrong / unclear signed upload goes back to shipping to upload again (2026-11-24), from
  // the review window or from an already rejected, uninvoiced permit (e.g. DP-2026-0005).
  const permitAction = async (permit: DeliveryPermit, action: "APPROVE" | "REJECT" | "SEND_BACK_TO_SHIPPING", extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/delivery-permits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permitId: permit.id, action, ...extra }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      alert(body.error || t("message.error"))
      return false
    }
    if (body.message && body.stockPutBack === false) alert(body.message)
    fetchPermits()
    return true
  }
  const reviewAction = async (action: "APPROVE" | "REJECT" | "SEND_BACK_TO_SHIPPING", extra: Record<string, unknown> = {}) => {
    if (!permitToReview) return
    if (await permitAction(permitToReview, action, extra)) setShowReviewDialog(false)
  }

  // the sent signed photos of the permit under review; the approver can cancel one (it is kept, not sent)
  const reviewFiles = sentSignedFiles(permitToReview?.files).filter((f) => f.fileType === "SIGNED_PERMIT" && f.fileUrl)
  const [cancellingFile, setCancellingFile] = useState<string | null>(null)
  const cancelPhoto = async (fileId: string) => {
    if (!permitToReview || !confirm(t("permit.cancel-photo-confirm"))) return
    setCancellingFile(fileId)
    try {
      const response = await fetch("/api/delivery-permits/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permitId: permitToReview.id, fileId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert((language === "ar" && body.errorAr) || body.error || t("message.error"))
        return
      }
      setPermitToReview({
        ...permitToReview,
        files: (permitToReview.files || []).map((f) => (f.id === fileId ? { ...f, fileType: "SIGNED_PERMIT_UNUSED" as const } : f)),
      })
      fetchPermits()
    } finally {
      setCancellingFile(null)
    }
  }

  const handlePrintSignedDP = () => {
    if (permitToReview?.signedDocumentUrl) {
      window.open(permitToReview.signedDocumentUrl, "_blank")
    }
  }


  const renderStatus = (permit: DeliveryPermit) => (
    <StatusBadge
      status={permit.status || "DRAFT"}
      label={t(`permit.status.${(permit.status || "DRAFT").toLowerCase().replace(/_/g, "-")}`)}
    />
  )

  const renderRowActions = (permit: DeliveryPermit) => (
    <>
      <Button variant="outline" size="sm" onClick={() => handleViewDetails(permit)}>
        {t("action.view-details")}
      </Button>
      {canApprove && permit.openCorrection && (
        <Button variant="outline" size="sm" onClick={() => setPermitToCorrect(permit)}>
          {t("eta.permit-action")}
        </Button>
      )}
      {permit.status === "SUBMITTED_SIGNED" && (
        <Button variant="outline" size="sm" onClick={() => handleOpenReviewDialog(permit)}>
          <Eye className="h-4 w-4 me-1" />
          {t("permit.signed-document")}
        </Button>
      )}
      {canApprove && permit.status === "REJECTED" && (!permit.nextActions || permit.nextActions.includes("SEND_BACK_TO_SHIPPING")) && (
        <SendBackToShippingButton
          size="sm"
          initialReason={permit.rejectionReason}
          onSendBack={async (reason) => {
            await permitAction(permit, "SEND_BACK_TO_SHIPPING", { reason })
          }}
        />
      )}
    </>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.sales")}
        title={t("module.delivery-permits")}
        subtitle={t("permit.module-description")}
        actions={
          <Button variant="outline" onClick={fetchPermits} disabled={loading}>
            <RefreshCw className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`} />
            {t("action.refresh")}
          </Button>
        }
      />

      {canApprove && statusCounts.submitted > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <span className="font-medium">{fill(t("permit.waiting-for-you"), { count: statusCounts.submitted })}</span>
          <Button size="sm" variant="outline" onClick={() => setActiveTab("submitted")}>
            {t("permit.show-waiting")}
          </Button>
        </div>
      )}

      {/* Stats Cards */}
      <KpiGrid className="md:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t("permit.status.out-for-delivery")} value={statusCounts.out_for_delivery} onClick={() => setActiveTab("out_for_delivery")} />
        <KpiTile label={t("permit.status.submitted-signed")} value={statusCounts.submitted} onClick={() => setActiveTab("submitted")} />
        <KpiTile label={t("permit.status.approved")} value={statusCounts.approved} onClick={() => setActiveTab("approved")} />
        <KpiTile label={t("permit.status.rejected")} value={statusCounts.rejected} onClick={() => setActiveTab("rejected")} />
      </KpiGrid>

      {/* Search and Tabs */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("permit.search-placeholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 h-auto flex-wrap w-full justify-start">
              <TabsTrigger value="all">
                {t("all")} ({statusCounts.all})
              </TabsTrigger>
              <TabsTrigger value="out_for_delivery">{t("permit.status.out-for-delivery")}</TabsTrigger>
              <TabsTrigger value="submitted">{t("permit.awaiting-approval")} ({statusCounts.submitted})</TabsTrigger>
              <TabsTrigger value="approved">{t("permit.status.approved")}</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab}>
              <ResponsiveList
                rows={loading ? [] : filteredPermits}
                empty={
                  loading ? (
                    <div className="py-8 text-center">{t("loading")}...</div>
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">{t("no-data")}</div>
                  )
                }
                table={
                  <div className="rounded-md border">
                    <ErpTable>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("permit.permit-no")}</TableHead>
                          <TableHead>{t("field.so-number")}</TableHead>
                          <TableHead>{t("field.customer")}</TableHead>
                          <TableHead>{t("permit.recipient")}</TableHead>
                          <TableHead>{t("field.status")}</TableHead>
                          <TableHead>{t("field.date")}</TableHead>
                          <ActionsHead>{t("field.actions")}</ActionsHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPermits.map((permit) => (
                          <TableRow key={permit.id}>
                            <IdCell>{permit.permitNo}</IdCell>
                            <TableCell>{permit.soNumber || "-"}</TableCell>
                            <TableCell>{permit.customerName || "-"}</TableCell>
                            <TableCell>{permit.recipientName || "-"}</TableCell>
                            <TableCell>{renderStatus(permit)}</TableCell>
                            <TableCell>{formatDate(permit.createdAt, language)}</TableCell>
                            <ActionsCell>{renderRowActions(permit)}</ActionsCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </ErpTable>
                  </div>
                }
                card={(permit) => (
                  <ListCard
                    id={permit.permitNo}
                    party={permit.customerName || "-"}
                    status={renderStatus(permit)}
                    actions={renderRowActions(permit)}
                  />
                )}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {permitToCorrect && permitToCorrect.openCorrection && (
        <CorrectPermitDialog
          permit={permitToCorrect}
          onClose={() => setPermitToCorrect(null)}
          onDone={() => {
            setPermitToCorrect(null)
            fetchPermits()
          }}
        />
      )}

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("permit.details")} - {selectedPermit?.permitNo}
            </DialogTitle>
          </DialogHeader>
          <DeliveryPermitCard
            permit={selectedPermit}
            userRole={userRole}
            onRefresh={() => {
              fetchPermits()
              setShowDetails(false)
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("permit.review-signed-dp")} - {permitToReview?.permitNo}
            </DialogTitle>
          </DialogHeader>

          {permitToReview && (
            <div className="space-y-6">
              {/* DP Info Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.so-number")}</p>
                    <p className="font-medium">{permitToReview.soNumber || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
                    <p className="font-medium">{permitToReview.customerName || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("permit.recipient")}</p>
                    <p className="font-medium">{permitToReview.recipientName || "-"}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("permit.delivery-address")}</p>
                    <p className="font-medium">{permitToReview.deliveryAddress || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("field.date")}</p>
                    <p className="font-medium">{formatDate(permitToReview.createdAt, language)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("shipping.driver")}</p>
                    <p className="font-medium">{permitToReview.driverName || "-"}</p>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              {permitToReview.items && permitToReview.items.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">{t("permit.items")}</p>
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("field.product")}</TableHead>
                          <TableHead className="text-end">{t("field.quantity")}</TableHead>
                          <TableHead className="text-end">{t("field.unit-price")} {t("common.egp")}</TableHead>
                          <TableHead className="text-end">{t("field.total")} {t("common.egp")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {permitToReview.items.map((item, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {item.itemNameSnapshot || item.productName || fill(t("permit.product-number"), { id: String(item.productId) })}
                            </TableCell>
                            <TableCell className="text-end">
                              {item.quantity}
                              {Number((item as any).returnedQuantity) > 0 && (
                                <span className="block text-xs text-red-700">
                                  {fill(t("permit.returned-net"), { returned: (item as any).returnedQuantity, net: Number(item.quantity) - Number((item as any).returnedQuantity) })}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-end"><Money value={item.unitPrice || 0} /></TableCell>
                            <TableCell className="text-end"><Money value={item.total || 0} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Signed photos: every photo shipping sent, each can be opened, and the approver can cancel one
                  (owner request 2026-11-27; lib/dp-signed-choice.ts). One sent photo always stays. */}
              <div className="border rounded-lg p-4 bg-muted/30">
                <p className="font-medium mb-3">
                  {t("permit.signed-document")}
                  {reviewFiles.length > 1 && ` (${reviewFiles.length})`}
                </p>
                {reviewFiles.length === 0 && !permitToReview.signedDocumentUrl ? (
                  <p className="text-muted-foreground text-center py-8">{t("permit.no-signed-document")}</p>
                ) : (
                  <ul className="space-y-3">
                    {(reviewFiles.length
                      ? reviewFiles
                      : [{ id: "", fileUrl: permitToReview.signedDocumentUrl as string, fileName: t("permit.signed-dp") }]
                    ).map((file, i) => (
                      <li key={file.id || "legacy"} className="border rounded bg-background p-2 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">
                            {i + 1}. {file.fileName || t("permit.signed-dp")}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => window.open(file.fileUrl, "_blank")}>
                              <Eye className="h-4 w-4 me-1" />
                              {t("action.view")}
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                              <a href={file.fileUrl} download target="_blank" rel="noopener noreferrer">
                                <Download className="h-4 w-4 me-1" />
                                {t("action.download")}
                              </a>
                            </Button>
                            {canApprove && permitToReview.status === "SUBMITTED_SIGNED" && file.id && reviewFiles.length > 1 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-red-700"
                                disabled={cancellingFile === file.id}
                                onClick={() => cancelPhoto(file.id)}
                              >
                                <X className="h-4 w-4 me-1" />
                                {t("permit.cancel-photo")}
                              </Button>
                            )}
                          </div>
                        </div>
                        {file.fileUrl.toLowerCase().includes(".pdf") ? (
                          <iframe src={file.fileUrl} className="w-full h-[300px] rounded" title={`${t("permit.signed-dp")} ${i + 1}`} />
                        ) : (
                          <img
                            src={file.fileUrl}
                            alt={`${t("permit.signed-dp")} ${i + 1}`}
                            className="w-full max-h-[300px] object-contain rounded bg-white"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {permitToReview && canApprove && permitToReview.status === "SUBMITTED_SIGNED" && (
            <ApproveRejectControls
              permitId={permitToReview.id}
              onApprove={() => reviewAction("APPROVE")}
              onReject={(reason) => reviewAction("REJECT", { rejectionReason: reason })}
              onSendBack={(reason) => reviewAction("SEND_BACK_TO_SHIPPING", { reason })}
            />
          )}
          {permitToReview && !canApprove && permitToReview.status === "SUBMITTED_SIGNED" && (
            <p className="text-sm text-muted-foreground">{t("permit.approve-roles-note")}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
              {t("action.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
