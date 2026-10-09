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
        alert("Inventory costing method updated successfully!")
      } else {
        throw new Error("Failed to update settings")
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      alert("Failed to save settings. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center">Loading settings...</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader group={t("group.purchasing")} title={t("module.costing-settings")} />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            <CardTitle>Inventory Costing Method</CardTitle>
          </div>
          <CardDescription>Choose how inventory costs are calculated when products are sold</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={costingMethod} onValueChange={(value) => setCostingMethod(value as "FIFO" | "LIFO")}>
            <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="FIFO" id="fifo" />
              <div className="flex-1">
                <Label htmlFor="fifo" className="cursor-pointer flex items-center gap-2 font-semibold">
                  <TrendingUp className="w-4 h-4" />
                  FIFO (First-In, First-Out)
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Uses the cost of the oldest inventory first. Best for perishable goods or when costs are rising.
                </p>
                <div className="mt-2 p-3 bg-muted rounded text-sm">
                  <strong>Example:</strong> If you bought 10 units at $5 and then 10 units at $7, selling 15 units will
                  use 10 units at $5 and 5 units at $7.
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="LIFO" id="lifo" />
              <div className="flex-1">
                <Label htmlFor="lifo" className="cursor-pointer flex items-center gap-2 font-semibold">
                  <TrendingDown className="w-4 h-4" />
                  LIFO (Last-In, First-Out)
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Uses the cost of the newest inventory first. Can provide tax benefits when costs are rising.
                </p>
                <div className="mt-2 p-3 bg-muted rounded text-sm">
                  <strong>Example:</strong> If you bought 10 units at $5 and then 10 units at $7, selling 15 units will
                  use 10 units at $7 and 5 units at $5.
                </div>
              </div>
            </div>
          </RadioGroup>

          <div className="pt-4 border-t">
            <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
              {saving ? "Saving..." : "Save Costing Method"}
            </Button>
          </div>

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>Important:</strong> Changing the costing method will only affect future sales. Previously allocated
              inventory will retain their original costing method.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
