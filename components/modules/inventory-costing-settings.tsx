"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Settings, TrendingUp, TrendingDown } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"

export function InventoryCostingSettings() {
  const { t } = useI18n()
  const [costingMethod, setCostingMethod] = useState<"FIFO" | "LIFO">("FIFO")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/settings?key=inventory_costing_method")
      const data = await response.json()
      setCostingMethod(data.value || "FIFO")
    } catch (error) {
      console.error("Error fetching settings:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "inventory_costing_method",
          value: costingMethod,
          userId: 1, // TODO: Get actual user ID
        }),
      })

      if (response.ok) {
        alert(t("costing.updated"))
      } else {
        throw new Error("Failed to update settings")
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      alert(t("costing.save-failed"))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center">{t("costing.loading")}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.purchasing")} title={t("module.costing-settings")} />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            <CardTitle>{t("costing.title")}</CardTitle>
          </div>
          <CardDescription>{t("costing.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={costingMethod} onValueChange={(value) => setCostingMethod(value as "FIFO" | "LIFO")}>
            <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="FIFO" id="fifo" />
              <div className="flex-1">
                <Label htmlFor="fifo" className="cursor-pointer flex items-center gap-2 font-semibold">
                  <TrendingUp className="w-4 h-4" />
                  {t("costing.fifo")}
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("costing.fifo-description")}
                </p>
                <div className="mt-2 p-3 bg-muted rounded text-sm">
                  <strong>{t("costing.example")}</strong> {t("costing.fifo-example")}
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="LIFO" id="lifo" />
              <div className="flex-1">
                <Label htmlFor="lifo" className="cursor-pointer flex items-center gap-2 font-semibold">
                  <TrendingDown className="w-4 h-4" />
                  {t("costing.lifo")}
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("costing.lifo-description")}
                </p>
                <div className="mt-2 p-3 bg-muted rounded text-sm">
                  <strong>{t("costing.example")}</strong> {t("costing.lifo-example")}
                </div>
              </div>
            </div>
          </RadioGroup>

          <div className="pt-4 border-t">
            <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
              {saving ? t("common.saving") : t("costing.save")}
            </Button>
          </div>

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>{t("costing.important")}</strong> {t("costing.important-note")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
