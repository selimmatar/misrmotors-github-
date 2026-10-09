"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/lib/i18n-context"
import { DeliveryPermitCard } from "@/components/delivery-permit"
import { PageHeader } from "@/components/erp/page-header"
import { KpiGrid, KpiTile } from "@/components/erp/kpi-tile"
import { StatusBadge } from "@/components/erp/status-badge"
import { Money } from "@/components/erp/money"
import { ErpTable, IdCell, ActionsHead, ActionsCell } from "@/components/erp/data-table"
import { ResponsiveList, ListCard } from "@/components/erp/responsive-list"
import { formatDate } from "@/lib/format"
import type { DeliveryPermit, UserRole } from "@/lib/types"
import { Search, FileText, RefreshCw, Eye, Download } from "lucide-react"

interface DeliveryPermitsModuleProps {
  userRole: UserRole
}

export default function DeliveryPermitsModule({ userRole }: DeliveryPermitsModuleProps) {
  const { t, language } = useI18n()
  const [permits, setPermits] = useState<DeliveryPermit[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [activeTab, setActiveTab] = useState<string>("all")
  const [selectedPermit, setSelectedPermit] = useState<DeliveryPermit | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [permitToReview, setPermitToReview] = useState<DeliveryPermit | null>(null)

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
    draft: permits.filter((p) => p.status === "DRAFT").length,
    printed: permits.filter((p) => p.status === "PRINTED").length,
    out_for_delivery: permits.filter((p) => p.status === "OUT_FOR_DELIVERY").length,
    submitted: permits.filter((p) => p.status === "SUBMITTED_SIGNED").length,
    approved: permits.filter((p) => p.status === "APPROVED").length,
    rejected: permits.filter((p) => p.status === "REJECTED").length,
  }

  const filteredPermits = permits.filter((permit) => {
    const matchesSearch =
      permit.permitNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      permit.soNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      permit.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      permit.recipientName?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesTab =
      activeTab === "all" ||
      (activeTab === "draft" && permit.status === "DRAFT") ||
      (activeTab === "printed" && permit.status === "PRINTED") ||
      (activeTab === "out_for_delivery" && permit.status === "OUT_FOR_DELIVERY") ||
      (activeTab === "submitted" && permit.status === "SUBMITTED_SIGNED") ||
      (activeTab === "approved" && permit.status === "APPROVED") ||
      (activeTab === "rejected" && permit.status === "REJECTED")

    return matchesSearch && matchesTab
  })

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
      {permit.status === "SUBMITTED_SIGNED" && (
        <Button variant="outline" size="sm" onClick={() => handleOpenReviewDialog(permit)}>
          <Eye className="h-4 w-4 me-1" />
          {t("permit.signed-document")}
        </Button>
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

      {/* Stats Cards */}
      <KpiGrid className="md:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t("permit.status.draft")} value={statusCounts.draft} onClick={() => setActiveTab("draft")} />
        <KpiTile label={t("permit.status.printed")} value={statusCounts.printed} onClick={() => setActiveTab("printed")} />
        <KpiTile label={t("permit.status.out-for-delivery")} value={statusCounts.out_for_delivery} onClick={() => setActiveTab("out_for_delivery")} />
        <KpiTile label={t("permit.status.submitted-signed")} value={statusCounts.submitted} onClick={() => setActiveTab("submitted")} />
        <KpiTile label={t("permit.status.approved")} value={statusCounts.approved} onClick={() => setActiveTab("approved")} />
        <KpiTile label={t("permit.status.rejected")} value={statusCounts.rejected} onClick={() => setActiveTab("rejected")} />
      </KpiGrid>

      {/* Search and Tabs */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
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
            <TabsList className="mb-4">
              <TabsTrigger value="all">
                {t("all")} ({statusCounts.all})
              </TabsTrigger>
              <TabsTrigger value="draft">{t("permit.status.draft")}</TabsTrigger>
              <TabsTrigger value="printed">{t("permit.status.printed")}</TabsTrigger>
              <TabsTrigger value="out_for_delivery">{t("permit.status.out-for-delivery")}</TabsTrigger>
              <TabsTrigger value="submitted">{t("permit.awaiting-approval")}</TabsTrigger>
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
                          <TableHead className="text-end">{t("field.unit-price")} (EGP)</TableHead>
                          <TableHead className="text-end">{t("field.total")} (EGP)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {permitToReview.items.map((item, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {item.itemNameSnapshot || item.productName || `Product #${item.productId}`}
                            </TableCell>
                            <TableCell className="text-end">
                              {item.quantity}
                              {Number((item as any).returnedQuantity) > 0 && (
                                <span className="block text-xs text-red-600">
                                  Returned {(item as any).returnedQuantity} · net {Number(item.quantity) - Number((item as any).returnedQuantity)}
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

              {/* Signed Document Preview */}
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium">{t("permit.signed-document")}</p>
                  {(permitToReview.signedDocumentUrl ||
                    permitToReview.files?.some((f) => f.fileType === "SIGNED_PERMIT")) && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const signedFile = permitToReview.files?.find((f) => f.fileType === "SIGNED_PERMIT")
                          const url = permitToReview.signedDocumentUrl || signedFile?.fileUrl
                          if (url) window.open(url, "_blank")
                        }}
                      >
                        <Eye className="h-4 w-4 me-1" />
                        {t("action.view")}
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={
                            permitToReview.signedDocumentUrl ||
                            permitToReview.files?.find((f) => f.fileType === "SIGNED_PERMIT")?.fileUrl
                          }
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download className="h-4 w-4 me-1" />
                          {t("action.download")}
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
                {(() => {
                  const signedFile = permitToReview.files?.find((f) => f.fileType === "SIGNED_PERMIT")
                  const documentUrl = permitToReview.signedDocumentUrl || signedFile?.fileUrl


                  if (documentUrl) {
                    return (
                      <div className="border rounded bg-white">
                        {documentUrl.toLowerCase().includes(".pdf") ? (
                          <iframe src={documentUrl} className="w-full h-[300px] rounded" title="Signed DP" />
                        ) : (
                          <img
                            src={documentUrl || "/placeholder.svg"}
                            alt="Signed DP"
                            className="w-full max-h-[300px] object-contain rounded"
                          />
                        )}
                      </div>
                    )
                  }
                  return <p className="text-muted-foreground text-center py-8">{t("permit.no-signed-document")}</p>
                })()}
              </div>
            </div>
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
