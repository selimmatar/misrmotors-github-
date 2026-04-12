"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClipboardCheck, Save, Loader2, AlertTriangle, CheckCircle, Warehouse } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { useAppContext } from "@/lib/app-context"
import type { UserRole } from "@/lib/types"

interface InventoryAuditItem {
  inventory_id: number
  product_id: number
  productName: string
  sku: string
  quantity: number
  reorder_point: number
  unit_cost: number
  location: string
  warehouse_id: number | null
  warehouse_name: string | null
  physicalCount: number | null
  notes: string
}

interface InventoryAuditModuleProps {
  userRole: UserRole
}

export function InventoryAuditModule({ userRole }: InventoryAuditModuleProps) {
  const { t, formatNumber, language } = useI18n()
  const { refreshInventory, warehouses } = useAppContext() // Declare the variable before using it
  const [inventoryItems, setInventoryItems] = useState<InventoryAuditItem[]>([])
  const [filteredItems, setFilteredItems] = useState<InventoryAuditItem[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    fetchInventory()
  }, [])

  useEffect(() => {
    applyWarehouseFilter()
  }, [selectedWarehouse, inventoryItems])

  const applyWarehouseFilter = () => {
    if (selectedWarehouse === "all") {
      setFilteredItems(inventoryItems)
    } else {
      const warehouseId = Number.parseInt(selectedWarehouse)
      setFilteredItems(inventoryItems.filter((item) => item.warehouse_id === warehouseId))
    }
  }

  const fetchInventory = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch("/api/inventory/audit")
      if (!response.ok) {
        throw new Error("Failed to fetch inventory")
      }
      const data = await response.json()
      // Initialize with physicalCount as null and empty notes
      const itemsWithAuditFields = data.map((item: any) => ({
        ...item,
        physicalCount: null,
        notes: "",
      }))
      setInventoryItems(itemsWithAuditFields)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory")
    } finally {
      setLoading(false)
    }
  }

  const handlePhysicalCountChange = (productId: number, value: string) => {
    const numValue = value === "" ? null : Number.parseInt(value, 10)
    setInventoryItems((prev) =>
      prev.map((item) =>
        item.product_id === productId ? { ...item, physicalCount: isNaN(numValue as number) ? null : numValue } : item,
      ),
    )
  }

  const handleNotesChange = (productId: number, value: string) => {
    setInventoryItems((prev) => prev.map((item) => (item.product_id === productId ? { ...item, notes: value } : item)))
  }

  const getDifference = (systemQty: number, physicalCount: number | null): number | null => {
    if (physicalCount === null) return null
    return physicalCount - systemQty
  }

  const getDifferenceDisplay = (systemQty: number, physicalCount: number | null) => {
    const diff = getDifference(systemQty, physicalCount)
    if (diff === null) return "-"

    if (diff > 0) {
      return (
        <Badge variant="default" className="bg-green-500">
          +{formatNumber(diff)} ({t("inventory-audit.over")})
        </Badge>
      )
    } else if (diff < 0) {
      return (
        <Badge variant="destructive">
          {formatNumber(diff)} ({t("inventory-audit.short")})
        </Badge>
      )
    }
    return (
      <Badge variant="secondary">
        {formatNumber(0)} ({t("inventory-audit.match")})
      </Badge>
    )
  }

  const handleSaveAdjustments = async () => {
    // Filter items that have a physical count entered
    const itemsWithCounts = inventoryItems.filter((item) => item.physicalCount !== null)

    if (itemsWithCounts.length === 0) {
      setError(t("inventory-audit.no-counts-entered"))
      return
    }

    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)

      const adjustments = itemsWithCounts.map((item) => ({
        productId: item.product_id,
        systemQuantity: item.quantity,
        physicalCount: item.physicalCount,
        notes: item.notes,
      }))

      const response = await fetch("/api/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to save adjustments")
      }

      const result = await response.json()
      setSuccessMessage(result.message || t("inventory-audit.save-success"))

      await Promise.all([
        fetchInventory(), // Refresh audit screen
        refreshInventory(), // Invalidate global inventory cache
      ])

      console.log("[v0] Inventory audit saved and cache refreshed")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save adjustments")
    } finally {
      setSaving(false)
    }
  }

  const countedItems = inventoryItems.filter((item) => item.physicalCount !== null).length
  const discrepancyItems = inventoryItems.filter(
    (item) => item.physicalCount !== null && item.physicalCount !== item.quantity,
  ).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ClipboardCheck className="w-8 h-8" />
            {t("inventory-audit.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("inventory-audit.description")}</p>
        </div>
        <Button onClick={handleSaveAdjustments} disabled={saving || countedItems === 0}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Save className="w-4 h-4 me-2" />}
          {t("inventory-audit.save-adjustments")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("inventory-audit.total-products")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(inventoryItems.length)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("inventory-audit.items-counted")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatNumber(countedItems)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("inventory-audit.discrepancies")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatNumber(discrepancyItems)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/10 text-green-600 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {successMessage}
        </div>
      )}

      {/* Audit Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("inventory-audit.audit-table")}</CardTitle>
              <CardDescription>{t("inventory-audit.audit-table-description")}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Warehouses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Warehouses</SelectItem>
                  {(warehouses || []).map((wh) => (
                    <SelectItem key={wh.id} value={wh.id.toString()}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-start p-3 font-medium">{t("product.name")}</th>
                  <th className="text-start p-3 font-medium">{t("product.sku")}</th>
                  <th className="text-start p-3 font-medium">Warehouse</th>
                  <th className="text-start p-3 font-medium">{t("inventory-audit.system-quantity")}</th>
                  <th className="text-start p-3 font-medium">{t("inventory-audit.physical-count")}</th>
                  <th className="text-start p-3 font-medium">{t("inventory-audit.difference")}</th>
                  <th className="text-start p-3 font-medium">{t("inventory-audit.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={`${item.product_id}-${item.warehouse_id}`} className="border-b hover:bg-muted/50">
                    <td className="p-3 font-medium">{item.productName}</td>
                    <td className="p-3 text-muted-foreground">{item.sku}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="gap-1">
                        <Warehouse className="w-3 h-3" />
                        {item.warehouse_name || "Default"}
                      </Badge>
                    </td>
                    <td className="p-3">{formatNumber(item.quantity)}</td>
                    <td className="p-3">
                      <Input
                        type="number"
                        min="0"
                        className="w-24"
                        placeholder={t("inventory-audit.enter-count")}
                        value={item.physicalCount === null ? "" : item.physicalCount}
                        onChange={(e) => handlePhysicalCountChange(item.product_id, e.target.value)}
                        dir="ltr"
                      />
                    </td>
                    <td className="p-3">{getDifferenceDisplay(item.quantity, item.physicalCount)}</td>
                    <td className="p-3">
                      <Input
                        type="text"
                        className="w-48"
                        placeholder={t("inventory-audit.enter-notes")}
                        value={item.notes}
                        onChange={(e) => handleNotesChange(item.product_id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
