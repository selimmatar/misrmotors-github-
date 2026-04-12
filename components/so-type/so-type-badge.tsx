"use client"

import { useI18n } from "@/lib/i18n-context"
import { Badge } from "@/components/ui/badge"
import { Wrench, Settings, Layers } from "lucide-react"
import type { SOType } from "@/lib/types"

interface SOTypeBadgeProps {
  type: SOType
  size?: "sm" | "md"
}

export function SOTypeBadge({ type, size = "md" }: SOTypeBadgeProps) {
  const { t } = useI18n()

  const config = {
    EQUIPMENT: {
      label: t("so-type.equipment"),
      icon: Settings,
      className: "bg-blue-100 text-blue-800 border-blue-200",
    },
    MAINTENANCE_PARTS: {
      label: t("so-type.maintenance-parts"),
      icon: Wrench,
      className: "bg-orange-100 text-orange-800 border-orange-200",
    },
    MIXED: {
      label: t("so-type.mixed"),
      icon: Layers,
      className: "bg-purple-100 text-purple-800 border-purple-200",
    },
  }

  const { label, icon: Icon, className } = config[type] || config.EQUIPMENT

  return (
    <Badge variant="outline" className={`${className} ${size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1"}`}>
      <Icon className={`${size === "sm" ? "w-3 h-3" : "w-4 h-4"} mr-1`} />
      {label}
    </Badge>
  )
}
