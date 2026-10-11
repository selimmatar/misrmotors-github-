"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n-context"
import type { DeliveryPermit } from "@/lib/types"
import { FileText, Download, Eye } from "lucide-react"

interface PermitPreviewDialogProps {
  permit: DeliveryPermit | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PermitPreviewDialog({ permit, open, onOpenChange }: PermitPreviewDialogProps) {
  const { t, formatDate } = useI18n()

  if (!permit) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("permit.delivery-permit")} - {permit.permitNo}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Permit Details */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">{t("field.so-number")}</p>
              <p className="font-medium">{permit.soNumber}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("field.customer")}</p>
              <p className="font-medium">{permit.customerName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("permit.recipient")}</p>
              <p className="font-medium">{permit.recipientName || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("field.phone")}</p>
              <p className="font-medium">{permit.recipientPhone || "-"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-muted-foreground">{t("permit.delivery-address")}</p>
              <p className="font-medium">{permit.deliveryAddress || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("field.total")}</p>
              <p className="font-medium">{permit.soTotal?.toLocaleString() || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("field.created-at")}</p>
              <p className="font-medium">{formatDate(permit.createdAt || "")}</p>
            </div>
          </div>

          {/* Items Table */}
          {permit.items && permit.items.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{t("field.items")}</p>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm">{t("field.product")}</th>
                      <th className="px-4 py-2 text-left text-sm">{t("field.quantity")}</th>
                      <th className="px-4 py-2 text-right text-sm">{t("field.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permit.items.map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2 text-sm">{item.itemNameSnapshot}</td>
                        <td className="px-4 py-2 text-sm">{item.quantity}</td>
                        <td className="px-4 py-2 text-sm text-right">{item.total?.toLocaleString() || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Files */}
          {permit.files && permit.files.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{t("permit.signed-documents")}</p>
              <div className="space-y-2">
                {permit.files.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{file.fileName}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.open(file.fileUrl, "_blank")}
                      className="gap-2"
                    >
                      <Eye className="h-4 w-4" />
                      {t("action.view")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                const url = `${window.location.origin}/api/delivery-permits/pdf?permitId=${permit.id}`
                window.open(url, "_blank")
              }}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              {t("action.download-pdf")}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("action.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
