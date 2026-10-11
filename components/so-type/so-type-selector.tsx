"use client"

import { useI18n } from "@/lib/i18n-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Wrench, Settings, Layers } from "lucide-react"
import type { SOType } from "@/lib/types"

interface SOTypeSelectorProps {
  value: SOType
  onChange: (value: SOType) => void
  disabled?: boolean
}

export function SOTypeSelector({ value, onChange, disabled }: SOTypeSelectorProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{t("so-type.label")} *</Label>
      <Select value={value} onValueChange={(v) => onChange(v as SOType)} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("so-type.select-placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="EQUIPMENT">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-blue-600" />
              <span>{t("so-type.equipment")}</span>
            </div>
          </SelectItem>
          <SelectItem value="MAINTENANCE_PARTS">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-orange-700" />
              <span>{t("so-type.maintenance-parts")}</span>
            </div>
          </SelectItem>
          <SelectItem value="MIXED">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-600" />
              <span>{t("so-type.mixed")}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
