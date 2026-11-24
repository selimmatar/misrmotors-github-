"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n-context"
import { CheckCircle, XCircle, Loader2, Undo2 } from "lucide-react"

interface ApproveRejectControlsProps {
  permitId: string
  onApprove: () => void
  onReject: (reason: string) => void
  /** wrong / unclear signed upload: the permit goes back to shipping to upload again (SEND_BACK_TO_SHIPPING) */
  onSendBack?: (reason: string) => void
  disabled?: boolean
}

export function ApproveRejectControls({ permitId, onApprove, onReject, onSendBack, disabled = false }: ApproveRejectControlsProps) {
  const { t } = useI18n()
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      await onApprove()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async (choice: "reject" | "send-back" = "reject") => {
    if (!rejectionReason.trim()) {
      alert(t("permit.rejection-reason-required"))
      return
    }
    setIsProcessing(true)
    try {
      if (choice === "send-back" && onSendBack) await onSendBack(rejectionReason.trim())
      else await onReject(rejectionReason)
      setShowRejectDialog(false)
      setRejectionReason("")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      <div className="flex gap-3">
        <Button
          onClick={handleApprove}
          disabled={disabled || isProcessing}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          {t("permit.approve")}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setShowRejectDialog(true)}
          disabled={disabled || isProcessing}
          className="flex-1"
        >
          <XCircle className="h-4 w-4 mr-2" />
          {t("permit.reject")}
        </Button>
      </div>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("permit.reject-permit")}</DialogTitle>
            <DialogDescription>{onSendBack ? t("permit.reject-choice") : t("permit.reject-description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("permit.rejection-reason")} *</Label>
              <Textarea
                placeholder={t("permit.rejection-reason-placeholder")}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              {t("action.cancel")}
            </Button>
            {/* Two different outcomes (owner rule, 2026-11-24): a wrong / unclear upload goes back to shipping to upload
                again; "Reject permit" rejects the delivery itself. */}
            {onSendBack && (
              <Button variant="outline" onClick={() => handleReject("send-back")} disabled={isProcessing} className="border-amber-500 text-amber-800 dark:text-amber-300">
                {isProcessing ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Undo2 className="h-4 w-4 me-2" />}
                {t("permit.send-back-to-shipping")}
              </Button>
            )}
            <Button variant="destructive" onClick={() => handleReject("reject")} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
              {onSendBack ? t("permit.reject-permit-goods") : t("permit.confirm-reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
