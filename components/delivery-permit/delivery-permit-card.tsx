"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n-context"
import { useAppContext } from "@/lib/app-context"
import { PermitStatusBadge } from "./permit-status-badge"
import { SignedUploadWidget } from "./signed-upload-widget"
import { ApproveRejectControls } from "./approve-reject-controls"
import type { DeliveryPermit, UserRole } from "@/lib/types"
import { Printer, Truck, Upload, FileText, ExternalLink, Package, CheckCircle } from "lucide-react"

interface DeliveryPermitCardProps {
  permit: DeliveryPermit | null
  userRole: UserRole
  onCreatePermit?: () => void
  onRefresh?: () => void
}

export function DeliveryPermitCard({ permit, userRole, onCreatePermit, onRefresh }: DeliveryPermitCardProps) {
  const { t, formatDate } = useI18n()
  const { user } = useAppContext()
  const [isLoading, setIsLoading] = useState(false)

  const updatePermitStatus = async (action: string, additionalData?: any) => {
    if (!permit) return
    setIsLoading(true)
    try {
      const response = await fetch("/api/delivery-permits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permitId: permit.id,
          action,
          userId: user?.id,
          ...additionalData,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error("DeliveryPermitCard - Update failed:", errorData)
        throw new Error(errorData.error || "Failed to update permit")
      }

      const result = await response.json()
      onRefresh?.()
    } catch (error) {
      console.error("DeliveryPermitCard - Error updating permit:", error)
      alert(t("message.error"))
    } finally {
      setIsLoading(false)
    }
  }

  const handlePrintPDF = async () => {
    if (!permit) return
    const url = `${window.location.origin}/api/delivery-permits/pdf?permitId=${permit.id}`
    window.open(url, "_blank")
    // Mark as printed if still draft
    if (permit.status === "DRAFT") {
      await updatePermitStatus("MARK_PRINTED")
    }
  }

  const handleMarkReadyForPickup = () => updatePermitStatus("MARK_READY_FOR_PICKUP")
  const handleMarkOutForDelivery = () => updatePermitStatus("MARK_OUT_FOR_DELIVERY")
  const handleMarkSubmittedSigned = () => updatePermitStatus("MARK_SUBMITTED_SIGNED")
  const handleApprove = () => updatePermitStatus("APPROVE")
  const handleReject = (reason: string) => updatePermitStatus("REJECT", { rejectionReason: reason })

  const canPrint =
    userRole === "accountant" || userRole === "admin" || userRole === "ceo" || userRole === "warehouse-rep"
  const canMarkReadyForPickup = userRole === "warehouse-rep" || userRole === "admin" || userRole === "ceo"
  const canMarkOutForDelivery = userRole === "shipment" || userRole === "admin" || userRole === "ceo"
  const canUploadSigned = userRole === "shipment" || userRole === "admin" || userRole === "ceo"
  const canApproveReject = userRole === "accountant" || userRole === "admin" || userRole === "ceo"

  if (!permit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("permit.delivery-permit")}
          </CardTitle>
          <CardDescription>{t("permit.no-permit")}</CardDescription>
        </CardHeader>
        {onCreatePermit && (
          <CardContent>
            <Button onClick={onCreatePermit}>{t("permit.create")}</Button>
          </CardContent>
        )}
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("permit.delivery-permit")}
            </CardTitle>
            <CardDescription className="mt-1">
              {permit.permitNo} - {formatDate(permit.createdAt || "")}
            </CardDescription>
          </div>
          <PermitStatusBadge status={permit.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Permit Details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">{t("permit.recipient")}:</span>
            <p className="font-medium">{permit.recipientName || permit.customerName || "-"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("field.phone")}:</span>
            <p className="font-medium">{permit.recipientPhone || permit.customerPhone || "-"}</p>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">{t("permit.delivery-address")}:</span>
            <p className="font-medium">{permit.deliveryAddress || permit.customerAddress || "-"}</p>
          </div>
          {permit.soNumber && (
            <div>
              <span className="text-muted-foreground">{t("field.so-number")}:</span>
              <p className="font-medium">{permit.soNumber}</p>
            </div>
          )}
          {permit.soTotal && (
            <div>
              <span className="text-muted-foreground">{t("field.total")}:</span>
              <p className="font-medium">{permit.soTotal.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Items if available */}
        {permit.items && permit.items.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">{t("field.items")}:</p>
            <div className="space-y-1">
              {permit.items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-sm bg-muted/50 p-2 rounded">
                  <span>
                    {item.itemNameSnapshot} {item.skuSnapshot && `(${item.skuSnapshot})`}
                  </span>
                  <span className="font-medium">× {item.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Timeline */}
        <div className="border-t pt-4">
          <div className="space-y-2 text-sm">
            {permit.printedAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Printer className="h-4 w-4" />
                {t("permit.printed-at")}: {formatDate(permit.printedAt)}
              </div>
            )}
            {permit.outForDeliveryAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Truck className="h-4 w-4" />
                {t("permit.out-for-delivery-at")}: {formatDate(permit.outForDeliveryAt)}
              </div>
            )}
            {permit.submittedSignedAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Upload className="h-4 w-4" />
                {t("permit.submitted-at")}: {formatDate(permit.submittedSignedAt)}
              </div>
            )}
            {permit.approvedAt && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" />
                {t("permit.status.approved")}: {formatDate(permit.approvedAt)}
              </div>
            )}
          </div>
        </div>

        {/* Actions based on status and role */}
        <div className="border-t pt-4 space-y-3">
          {/* Print Button - Always visible for authorized roles */}
          {canPrint && (
            <Button variant="outline" onClick={handlePrintPDF} disabled={isLoading} className="w-full bg-transparent">
              <Printer className="h-4 w-4 mr-2" />
              {t("permit.print-pdf")}
              <ExternalLink className="h-3 w-3 ml-2" />
            </Button>
          )}

          {canMarkReadyForPickup && permit.status === "DRAFT" && (
            <Button
              onClick={handleMarkReadyForPickup}
              disabled={isLoading}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              <Package className="h-4 w-4 mr-2" />
              {t("warehouse.mark-ready-for-delivery")}
            </Button>
          )}

          {canMarkOutForDelivery && (permit.status === "READY_FOR_PICKUP" || permit.status === "PRINTED") && (
            <Button onClick={handleMarkOutForDelivery} disabled={isLoading} className="w-full">
              <Truck className="h-4 w-4 mr-2" />
              {t("permit.mark-out-for-delivery")}
            </Button>
          )}

          {/* Upload Signed - After out for delivery */}
          {canUploadSigned && permit.status === "OUT_FOR_DELIVERY" && (
            <SignedUploadWidget
              permitId={permit.id}
              onUploadComplete={() => {
                handleMarkSubmittedSigned()
              }}
              existingFiles={permit.files}
            />
          )}

          {/* Approve/Reject - After signed uploaded */}
          {canApproveReject && permit.status === "SUBMITTED_SIGNED" && (
            <ApproveRejectControls
              permitId={permit.id}
              onApprove={handleApprove}
              onReject={handleReject}
              disabled={isLoading}
            />
          )}

          {/* View Signed Files - If any exist */}
          {permit.files && permit.files.length > 0 && permit.status !== "OUT_FOR_DELIVERY" && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("permit.signed-documents")}:</p>
              {permit.files.map((file) => (
                <a
                  key={file.id}
                  href={file.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 bg-muted rounded text-sm hover:bg-muted/80"
                >
                  <FileText className="h-4 w-4" />
                  {file.fileName}
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </a>
              ))}
            </div>
          )}

          {/* Rejection Reason */}
          {permit.status === "REJECTED" && permit.rejectionReason && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm font-medium text-red-700">{t("permit.rejection-reason")}:</p>
              <p className="text-sm text-red-600 mt-1">{permit.rejectionReason}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
