"use client"

import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/lib/i18n-context"
import type { DeliveryPermitStatus } from "@/lib/types"
import { FileText, Printer, Truck, Upload, CheckCircle, XCircle, Package } from "lucide-react"

interface PermitStatusBadgeProps {
  status: DeliveryPermitStatus
  size?: "sm" | "md" | "lg"
}

export function PermitStatusBadge({ status, size = "md" }: PermitStatusBadgeProps) {
  const { t } = useI18n()

  const statusConfig: Record<
    DeliveryPermitStatus,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any; color: string }
  > = {
    DRAFT: {
      label: t("permit.status.draft"),
      variant: "secondary",
      icon: FileText,
      color: "bg-gray-100 text-gray-700 border-gray-300",
    },
    READY_FOR_PICKUP: {
      label: t("permit.status.ready-for-pickup"),
      variant: "outline",
      icon: Package,
      color: "bg-yellow-50 text-yellow-700 border-yellow-300",
    },
    PRINTED: {
      label: t("permit.status.printed"),
      variant: "outline",
      icon: Printer,
      color: "bg-blue-50 text-blue-700 border-blue-300",
    },
    OUT_FOR_DELIVERY: {
      label: t("permit.status.out-for-delivery"),
      variant: "default",
      icon: Truck,
      color: "bg-amber-50 text-amber-700 border-amber-300",
    },
    SUBMITTED_SIGNED: {
      label: t("permit.status.submitted-signed"),
      variant: "default",
      icon: Upload,
      color: "bg-purple-50 text-purple-700 border-purple-300",
    },
    APPROVED: {
      label: t("permit.status.approved"),
      variant: "default",
      icon: CheckCircle,
      color: "bg-green-50 text-green-700 border-green-300",
    },
    REJECTED: {
      label: t("permit.status.rejected"),
      variant: "destructive",
      icon: XCircle,
      color: "bg-red-50 text-red-700 border-red-300",
    },
  }

  const config = statusConfig[status] || statusConfig.DRAFT
  const Icon = config.icon

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5",
  }

  return (
    <Badge className={`${config.color} ${sizeClasses[size]} flex items-center gap-1.5 font-medium border`}>
      <Icon className={size === "sm" ? "h-3 w-3" : size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
      {config.label}
    </Badge>
  )
}
